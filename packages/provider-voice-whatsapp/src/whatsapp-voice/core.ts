/**
 * Core vendor for the WhatsApp voice provider.
 *
 * Manages the per-call state machine, WebRTC peer connections, SDP negotiation,
 * Meta Graph API call control, and the inbound STT / outbound TTS audio pipeline.
 *
 * One instance of this class is created per provider and handles multiple
 * concurrent calls via a `Map<callId, CallSession>`.
 */

import { EventEmitter } from 'node:events'

import { bufferToInt16, chunkPcm, SilenceSegmenter } from '../audio'
import { MetaCallClient } from '../meta-call-client'
import { assertOpus, transformAnswer } from '../sdp'
import { CallState } from '../types'
import type {
    ISttAdapter,
    ITtsAdapter,
    IWhatsAppVoiceProviderArgs,
    WhatsAppCallEntryEvent,
    WhatsAppVoicePayload,
} from '../types'
import { createAudioSink, createAudioSource, createPeerConnection } from '../webrtc'
import type { RTCAudioSinkInstance, RTCAudioSourceInstance } from '../webrtc'

/** Duration of each TTS publish frame in milliseconds. */
const PUBLISH_FRAME_MS = 10

/**
 * Internal representation of a single active call session.
 */
interface CallSession {
    /** Current state in the call state machine. */
    state: CallState
    /** The WebRTC peer connection for this call. */
    pc: RTCPeerConnection
    /** Audio sink attached to the first remote track (receives inbound PCM). */
    sink: RTCAudioSinkInstance | null
    /** Audio source for pushing TTS frames to the remote peer. */
    source: RTCAudioSourceInstance | null
    /** Silence segmenter that detects utterance boundaries. */
    segmenter: SilenceSegmenter
    /** Sample rate negotiated for inbound audio. */
    inboundSampleRate: number
    /** Queues utterance processing to preserve spoken order. */
    utteranceQueue: Promise<void>
    /** E.164 phone number of the caller (e.g. "15551234567"). Used as ctx.from. */
    callerPhone: string
}

/**
 * Constructor options for `WhatsAppCallCoreVendor`.
 */
export interface WhatsAppCallCoreVendorArgs {
    /** Resolved STT adapter (custom or default OpenAI Whisper). */
    sttAdapter: ISttAdapter
    /** Resolved TTS adapter (custom or OpenAI TTS). */
    ttsAdapter: ITtsAdapter
    /** Provider configuration (for Meta client and silence tuning). */
    config: IWhatsAppVoiceProviderArgs
}

/**
 * Core event-emitting vendor for WhatsApp voice calls.
 *
 * Emitted events:
 * - `'message'` — `WhatsAppVoicePayload` when a caller utterance is transcribed.
 * - `'ready'` — emitted when the vendor is ready (after provider binds).
 * - `'host'` — emitted with host metadata.
 * - `'auth_failure'` — emitted on critical setup failures.
 * - `'notice'` — `{ title: string; instructions: string[] }` for non-fatal warnings.
 *
 * @example
 * const core = new WhatsAppCallCoreVendor({ sttAdapter, ttsAdapter, config })
 * core.on('message', (payload) => console.log(payload.body))
 */
export class WhatsAppCallCoreVendor extends EventEmitter {
    private readonly sessions = new Map<string, CallSession>()
    /** Reverse lookup: callerPhone → callId (for sendMessage routing). */
    private readonly phoneToCallId = new Map<string, string>()
    private readonly metaClient: MetaCallClient
    private readonly sttAdapter: ISttAdapter
    private readonly ttsAdapter: ITtsAdapter
    private readonly config: IWhatsAppVoiceProviderArgs

    constructor(args: WhatsAppCallCoreVendorArgs) {
        super()
        this.sttAdapter = args.sttAdapter
        this.ttsAdapter = args.ttsAdapter
        this.config = args.config

        this.metaClient = new MetaCallClient({
            jwtToken: args.config.jwtToken,
            numberId: args.config.numberId,
            version: args.config.version,
        })
    }

    // ── Inbound call handling ──────────────────────────────────────────────────

    /**
     * Handle an inbound `connect` call event from the Meta webhook.
     *
     * Performs the full call setup sequence:
     * 1. Creates a WebRTC peer connection and sets the remote SDP offer.
     * 2. Creates an SDP answer, transforms it (actpass → active), validates Opus.
     * 3. Sends `pre_accept` to Meta with the SDP answer.
     * 4. Sends `accept` to Meta.
     * 5. Wires the inbound audio pipeline (RTCAudioSink → SilenceSegmenter → STT → message event).
     * 6. Wires ICE state change for `Active` transition.
     *
     * If `pre_accept` fails, `accept` is NOT called and the session is cleaned up.
     *
     * @param event The connect event from the webhook payload.
     * @returns Resolves when the call is accepted and audio pipeline is wired.
     * @throws {Error} On invalid state (duplicate callId) — also emits `notice`.
     */
    public async onConnect(event: WhatsAppCallEntryEvent): Promise<void> {
        const callId = event.id

        // Guard: reject duplicate sessions
        if (this.sessions.has(callId)) {
            this.emit('notice', {
                title: 'WhatsApp Voice: duplicate connect',
                instructions: [`call_id "${callId}" already has an active session — ignoring.`],
            })
            return
        }

        if (!event.session?.sdp) {
            this.emit('notice', {
                title: 'WhatsApp Voice: missing SDP offer',
                instructions: [`connect event for call_id "${callId}" has no session.sdp — cannot answer.`],
            })
            return
        }

        const segmenter = new SilenceSegmenter({
            sampleRate: 48000, // wrtc delivers 48kHz; updated on first frame if different
            silenceMs: this.config.silenceMs ?? 800,
            silenceThreshold: this.config.silenceThreshold ?? 0.015,
        })

        // Create session in Idle state first, then immediately transition
        const session: CallSession = {
            state: CallState.Idle,
            pc: createPeerConnection(this.config.iceServers),
            sink: null,
            source: null,
            segmenter,
            inboundSampleRate: 48000,
            utteranceQueue: Promise.resolve(),
            callerPhone: event.from,
        }
        this.sessions.set(callId, session)
        this.phoneToCallId.set(event.from, callId)

        try {
            // Transition: Idle → Connecting
            this.transitionState(callId, CallState.Idle, CallState.Connecting)

            // Set remote SDP offer
            await session.pc.setRemoteDescription({
                type: 'offer',
                sdp: event.session.sdp,
            })

            // Create audio source for TTS outbound BEFORE creating answer
            // (so the m-line is included in the answer)
            const audioSource = createAudioSource()
            const outboundTrack = audioSource.createTrack()
            session.pc.addTrack(outboundTrack)
            session.source = audioSource

            // Create answer and transform
            const answerDesc = await session.pc.createAnswer()
            const transformedSdp = transformAnswer(answerDesc.sdp ?? '')
            assertOpus(transformedSdp)
            await session.pc.setLocalDescription({ type: 'answer', sdp: transformedSdp })

            // Wire ICE connection state change
            session.pc.onconnectionstatechange = () => {
                const state = session.pc.connectionState
                if (state === 'connected') {
                    if (session.state === CallState.Accepted) {
                        this.transitionState(callId, CallState.Accepted, CallState.Active)
                    }
                } else if (state === 'failed' || state === 'closed') {
                    void this.onTerminate(callId)
                }
            }

            // Wire inbound audio track (fires once ICE completes but we wire now)
            session.pc.ontrack = (trackEvent: RTCTrackEvent) => {
                if (trackEvent.track.kind !== 'audio') return
                this.wireAudioSink(callId, trackEvent.track)
            }

            // pre_accept: send SDP answer to Meta
            try {
                await this.metaClient.preAccept(callId, transformedSdp)
            } catch (preAcceptErr) {
                this.emit('notice', {
                    title: 'WhatsApp Voice: pre_accept failed',
                    instructions: [
                        `call_id "${callId}" — pre_accept rejected: ${(preAcceptErr as Error).message}`,
                        'Rejecting call and releasing peer connection.',
                    ],
                })
                // Reject and clean up without calling accept
                try {
                    await this.metaClient.reject(callId)
                } catch {
                    // best-effort
                }
                this.releaseSession(callId)
                return
            }

            // Transition: Connecting → PreAccepted
            this.transitionState(callId, CallState.Connecting, CallState.PreAccepted)

            // accept: finalize call setup
            await this.metaClient.accept(callId)

            // Transition: PreAccepted → Accepted
            this.transitionState(callId, CallState.PreAccepted, CallState.Accepted)
        } catch (err) {
            this.emit('notice', {
                title: 'WhatsApp Voice: call setup error',
                instructions: [`call_id "${callId}": ${(err as Error).message}`],
            })
            this.releaseSession(callId)
        }
    }

    /**
     * Handle a `terminate` webhook event for an active or pending call.
     *
     * Closes the peer connection, stops audio tracks, flushes the silence
     * segmenter, and removes the session from the map. If the call_id is
     * unknown, the event is silently ignored.
     *
     * @param callId The call identifier from the webhook.
     */
    public onTerminate(callId: string): void {
        const session = this.sessions.get(callId)
        if (!session) {
            // Unknown call_id — ignore silently per spec FR-6.
            return
        }

        // Flush any partial utterance
        const partial = session.segmenter.flush()
        if (partial) {
            this.enqueueUtterance(session, partial, callId)
        }

        this.releaseSession(callId)

        this.emit('notice', {
            title: 'WhatsApp Voice: call terminated',
            instructions: [`call_id "${callId}" has ended and resources have been released.`],
        })
    }

    // ── Outbound TTS ──────────────────────────────────────────────────────────

    /**
     * Synthesize `text` to speech and transmit it to the caller over the active
     * WebRTC peer connection.
     *
     * @param callId The active call identifier.
     * @param text   The text to synthesize and send.
     * @returns Resolves when all audio frames have been pushed to the peer connection.
     * @throws {Error} Emits `notice` (does not throw) when there is no active call for `callId`.
     */
    public async publishAudio(callIdOrPhone: string, text: string): Promise<void> {
        // Accept either a callId (UUID) or a callerPhone (E.164) — resolve to callId
        const callId = this.sessions.has(callIdOrPhone)
            ? callIdOrPhone
            : (this.phoneToCallId.get(callIdOrPhone) ?? callIdOrPhone)
        const session = this.sessions.get(callId)
        if (!session || !session.source) {
            this.emit('notice', {
                title: 'WhatsApp Voice: no active call',
                instructions: [
                    `publishAudio called for call_id "${callId}" but no active session exists.`,
                    'Ensure sendMessage is only called while a call is active.',
                ],
            })
            return
        }

        const pcm = await this.ttsAdapter.synthesize(text)
        const sampleRate = this.ttsAdapter.sampleRate
        const samplesPerFrame = Math.round((PUBLISH_FRAME_MS / 1000) * sampleRate)
        const frames = chunkPcm(bufferToInt16(pcm), samplesPerFrame, false)

        for (const frame of frames) {
            session.source.onData({
                samples: frame,
                sampleRate,
                bitsPerSample: 16,
                channelCount: 1,
                numberOfFrames: frame.length,
            })
        }
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    /**
     * Attach an `RTCAudioSink` to a remote audio track and wire the PCM data
     * event into the silence segmenter pipeline.
     *
     * @param callId The call identifier for the session being wired.
     * @param track  The remote audio `MediaStreamTrack`.
     */
    private wireAudioSink(callId: string, track: MediaStreamTrack): void {
        const session = this.sessions.get(callId)
        if (!session) return

        const sink = createAudioSink(track)
        session.sink = sink

        let sampleRate = 0
        let activeSegmenter = session.segmenter

        sink.ondata = ({ samples, sampleRate: rate, channels }) => {
            const currentSession = this.sessions.get(callId)
            if (!currentSession) {
                sink.stop()
                return
            }

            // Rebuild segmenter if sample rate changed mid-call
            if (sampleRate !== 0 && rate !== sampleRate) {
                const partial = activeSegmenter.flush()
                if (partial) this.enqueueUtterance(currentSession, partial, callId)
                activeSegmenter = new SilenceSegmenter({
                    sampleRate: rate,
                    silenceMs: this.config.silenceMs ?? 800,
                    silenceThreshold: this.config.silenceThreshold ?? 0.015,
                })
                currentSession.segmenter = activeSegmenter
            }

            sampleRate = rate
            currentSession.inboundSampleRate = rate

            const mono = this.toMono(samples, channels)
            const utterance = activeSegmenter.push(mono)
            if (utterance) {
                this.enqueueUtterance(currentSession, utterance, callId)
            }
        }
    }

    /**
     * Queue an utterance for transcription in order, serializing concurrent calls.
     *
     * @param session   The call session that produced the utterance.
     * @param pcm       Raw 16-bit LE mono PCM buffer.
     * @param callId    The call identifier (for the emitted payload).
     */
    private enqueueUtterance(session: CallSession, pcm: Buffer, callId: string): void {
        session.utteranceQueue = session.utteranceQueue.then(() =>
            this.handleUtterance(pcm, session.inboundSampleRate, callId)
        )
    }

    /**
     * Transcribe a PCM utterance and emit a `message` event.
     *
     * @param pcm        Raw 16-bit LE mono PCM.
     * @param sampleRate Sample rate of the PCM in Hz.
     * @param callId     Call identifier used as the `from` field in the payload.
     */
    private async handleUtterance(pcm: Buffer, sampleRate: number, callId: string): Promise<void> {
        try {
            const body = await this.sttAdapter.transcribe(pcm, sampleRate, this.config.language)
            if (!body || body.trim() === '') return

            const session = this.sessions.get(callId)
            const callerPhone = session?.callerPhone ?? callId

            const payload: WhatsAppVoicePayload = {
                body: body.trim(),
                from: callerPhone,
                name: callerPhone,
                audio: pcm,
                sampleRate,
            }
            this.emit('message', payload)
        } catch (err) {
            this.emit('notice', {
                title: 'WhatsApp Voice: transcription error',
                instructions: [`call_id "${callId}": ${(err as Error).message}`],
            })
        }
    }

    /**
     * Transition the call state machine.
     *
     * Throws and emits `notice` on invalid transitions (e.g. `accept` while `Connecting`).
     *
     * @param callId   The call identifier.
     * @param from     Expected current state.
     * @param to       Target state.
     * @throws {Error} When the current state does not match `from`.
     */
    private transitionState(callId: string, from: CallState, to: CallState): void {
        const session = this.sessions.get(callId)
        if (!session) return

        if (session.state !== from) {
            const msg =
                `[WhatsAppCallCoreVendor] Invalid state transition for call_id "${callId}": ` +
                `expected ${from}, got ${session.state}. Attempted transition to ${to}.`
            this.emit('notice', {
                title: 'WhatsApp Voice: invalid state transition',
                instructions: [msg],
            })
            throw new Error(msg)
        }

        session.state = to
    }

    /**
     * Release all resources for a call session and remove it from the map.
     *
     * Safe to call in any state — closes the peer connection, stops sink,
     * and removes the session entry.
     *
     * @param callId The call identifier to release.
     */
    private releaseSession(callId: string): void {
        const session = this.sessions.get(callId)
        if (!session) return

        try {
            if (session.sink) {
                session.sink.stop()
            }
        } catch {
            // ignore sink stop errors
        }

        try {
            session.pc.close()
        } catch {
            // ignore PC close errors
        }

        session.state = CallState.Terminated
        this.phoneToCallId.delete(session.callerPhone)
        this.sessions.delete(callId)
    }

    /**
     * Mix a multi-channel PCM frame down to mono by averaging all channels.
     *
     * @param data     Raw interleaved PCM samples.
     * @param channels Number of channels in `data`.
     * @returns Mono Int16Array.
     */
    private toMono(data: Int16Array, channels: number): Int16Array {
        if (channels <= 1) return data
        const frames = Math.floor(data.length / channels)
        const mono = new Int16Array(frames)
        for (let i = 0; i < frames; i++) {
            let sum = 0
            for (let c = 0; c < channels; c++) {
                sum += data[i * channels + c]
            }
            mono[i] = Math.round(sum / channels)
        }
        return mono
    }
}
