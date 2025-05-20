import { ProviderClass } from '@builderbot/bot'
import type { Vendor } from '@builderbot/bot/dist/provider/interface/provider'
import type { BotContext, SendOptions } from '@builderbot/bot/dist/types'
import axios from 'axios'
import { ParamsDictionary } from 'express-serve-static-core'
import fs from 'fs'
import mime from 'mime-types'
import path from 'path'
import { Middleware } from 'polka'
import { ParsedQs } from 'qs'
import Queue from 'queue-promise'

import type { EvolutionInterface } from '../interface/evolution'
import type { EvolutionGlobalVendorArgs } from '../types'
import { generalDownload } from '../utils'
import { EvolutionCoreVendor } from './core'

/**
 * Evolution API Provider implementation
 * Handles all communication with Evolution API for sending messages, media, etc.
 */
class EvolutionProvider extends ProviderClass<EvolutionInterface> implements EvolutionInterface {
    public vendor: Vendor<EvolutionInterface>
    public queue: Queue = new Queue()
    public incomingMsg: any

    public globalVendorArgs: EvolutionGlobalVendorArgs = {
        name: 'bot',
        apiKey: '',
        baseURL: 'http://localhost:8080',
        instanceName: '',
        port: 3000,
    }

    /**
     * Creates an instance of Evolution Provider
     * @param args Provider configuration
     */
    constructor(args: EvolutionGlobalVendorArgs) {
        super()
        this.globalVendorArgs = { ...this.globalVendorArgs, ...args }
        this.queue = new Queue({
            concurrent: 1,
            interval: 100,
            start: true,
        })
    }
    sendMessageMeta: (body: any) => Promise<any>
    sendImageUrl: (to: string, url: string, mediaName?: string, caption?: string) => Promise<any>
    sendVideoUrl: (to: string, url: string, mediaName?: string, caption?: string) => Promise<any>
    sendAudioUrl: (to: string, url: string, mediaName?: string, caption?: string) => Promise<any>
    sendList: (to: string, list: any) => Promise<any>
    sendListComplete: (to: string, list: any) => Promise<any>
    indexHome?: Middleware<ParamsDictionary, any, any, ParsedQs>

    /**
     * Initialize HTTP server middleware
     */
    protected beforeHttpServerInit(): void {
        this.server = this.server
            .use((req, _, next) => {
                req['globalVendorArgs'] = this.globalVendorArgs
                return next()
            })
            .post('/', this.vendor.indexHome)
            .post('/webhook', this.vendor.incomingMsg)
    }

    /**
     * Initialize vendor core
     */
    protected initVendor(): Promise<any> {
        const vendor = new EvolutionCoreVendor(this.queue)
        this.server = this.server
            .use((req, _, next) => {
                req['globalVendorArgs'] = this.globalVendorArgs
                return next()
            })
            .post('/webhook', vendor.incomingMsg)

        this.vendor = vendor as unknown as Vendor<EvolutionInterface>
        return Promise.resolve(this.vendor)
    }

    /**
     * Build standard headers for API requests
     * @param additionalHeaders Optional additional headers to include
     * @returns Headers object with apiKey
     */
    private builderHeader(additionalHeaders: Record<string, string> = {}): Record<string, string> {
        const { apiKey } = this.globalVendorArgs
        return {
            apikey: apiKey,
            ...additionalHeaders,
        }
    }

    /**
     * Verify connection with Evolution API after HTTP server initialization
     */ protected async afterHttpServerInit(): Promise<void> {
        try {
            const { baseURL, instanceName } = this.globalVendorArgs

            // Verify connection with Evolution API
            const response = await axios.get(`${baseURL}/instance/connectionState/${instanceName}`, {
                headers: this.builderHeader(),
            })

            const state = response.data.state ?? response.data.instance.state ?? 'close'
            if (state === 'open') {
                this.emit('ready')
            } else {
                throw new Error(`Instance state: ${state}`)
            }
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : 'Unknown error'
            this.emit('notice', {
                title: '🟠 ERROR AUTH 🟠',
                instructions: [
                    'Error connecting to Evolution API, please check your credentials',
                    'Make sure your instance is connected',
                    `Details: ${errorMessage}`,
                ],
            })
        }
    }

    /**
     * Event bus configuration
     */
    protected busEvents() {
        return [
            {
                event: 'auth_failure',
                func: (payload: any) => this.emit('auth_failure', payload),
            },
            {
                event: 'notice',
                func: ({ instructions, title }: { instructions: string[]; title: string }) =>
                    this.emit('notice', { instructions, title }),
            },
            {
                event: 'ready',
                func: () => this.emit('ready', true),
            },
            {
                event: 'message',
                func: (payload: BotContext) => {
                    this.emit('message', payload)
                },
            },
        ]
    }

    /**
     * Punto de entrada para envío de archivos multimedia.
     * Detecta el tipo de archivo y redirige a la función correspondiente.
     *
     * @param number Número de destino
     * @param mediaUrl URL o path del archivo
     * @param caption Texto opcional
     */
    sendMedia = async (number: string, mediaUrl: string, caption: string) => {
        const fileDownloaded = await generalDownload(mediaUrl)
        const mimeType = mime.lookup(fileDownloaded)

        if (!mimeType) throw new Error('No se pudo determinar el tipo MIME')

        if (mimeType.includes('image')) {
            return this.sendImage(number, fileDownloaded, caption || '')
        }

        if (mimeType.includes('video')) {
            return this.sendVideo(number, fileDownloaded, caption || '')
        }

        if (mimeType.includes('audio')) {
            return this.sendAudio(number, fileDownloaded)
        }

        return this.sendFile(number, fileDownloaded, caption || '')
    }

    /**
     * Envía una imagen al número dado.
     * @param number Número destino
     * @param filePath Ruta local de la imagen
     * @param caption Texto opcional
     */
    sendImage = async (number: string, filePath: string, caption: string) => {
        const mediaBase64 = fs.readFileSync(filePath, { encoding: 'base64' })
        const mimeType = mime.lookup(filePath)

        const body = {
            number,
            media: mediaBase64,
            mimetype: mimeType,
            mediatype: 'image',
            caption: caption || path.basename(filePath),
            delay: 0,
        }

        return this.sendMessageEvoApi(body, '/message/sendMedia/')
    }

    /**
     * Envía un video al número dado.
     * @param number Número destino
     * @param filePath Ruta local del video
     * @param caption Texto opcional
     */
    sendVideo = async (number: string, filePath: string, caption: string) => {
        const mediaBase64 = fs.readFileSync(filePath, { encoding: 'base64' })
        const mimeType = mime.lookup(filePath)

        const body = {
            number,
            media: mediaBase64,
            mimetype: mimeType,
            mediatype: 'video',
            caption: caption || path.basename(filePath),
            delay: 0,
        }

        return this.sendMessageEvoApi(body, '/message/sendMedia/')
    }

    /**
     * Envía un archivo de audio en formato compatible (OPUS).
     * @param number Número destino
     * @param filePath Ruta local del archivo de audio
     */
    sendAudio = async (number: string, filePath: string) => {
        const mediaBase64 = fs.readFileSync(filePath, { encoding: 'base64' })

        const body = {
            number,
            media: mediaBase64,
            mimetype: 'audio/ogg; codecs=opus',
            mediatype: 'audio',
            delay: 0,
        }

        return this.sendMessageEvoApi(body, '/message/sendMedia/')
    }

    /**
     * Envía un documento genérico al número dado.
     * @param number Número destino
     * @param filePath Ruta local del archivo
     * @param caption Texto opcional
     */
    sendFile = async (number: string, filePath: string, caption: string) => {
        const mediaBase64 = fs.readFileSync(filePath, { encoding: 'base64' })
        const mimeType = mime.lookup(filePath)
        const fileName = path.basename(filePath)

        const body = {
            number,
            media: mediaBase64,
            mimetype: mimeType,
            mediatype: 'document',
            fileName,
            caption: caption || path.basename(filePath),
            delay: 0,
        }

        return this.sendMessageEvoApi(body, '/message/sendMedia/')
    }

    /**
     * Envía un mensaje de texto plano.
     * @param number Número destino
     * @param message Contenido del mensaje
     */
    sendText = async (number: string, message: string) => {
        const ruta = '/message/sendText/'

        const body = {
            number,
            text: message,
            delay: 0,
        }

        return this.sendMessageEvoApi(body, ruta)
    }

    /**
     * Función general para hacer peticiones POST a la API externa.
     * @param body Cuerpo de la petición
     * @param ruta Ruta relativa del endpoint
     */
    sendMessageToApi = async (body: any, ruta: string): Promise<any> => {
        const { baseURL, instanceName, apiKey } = this.globalVendorArgs

        const response = await fetch(`${baseURL}${ruta}${instanceName}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                apikey: apiKey,
            },
            body: JSON.stringify(body),
        })

        if (!response.ok) {
            throw new Error(`Error sending message: ${response.statusText}`)
        }

        const data = await response.json()
        return data
    }

    /**
     * Encola el envío de un mensaje para asegurar orden y evitar conflictos.
     * @param body Cuerpo del mensaje
     * @param ruta Ruta del endpoint
     */
    sendMessageEvoApi = (body: any, ruta: string): Promise<any> => {
        return new Promise((resolve) =>
            this.queue.add(async () => {
                const resp = await this.sendMessageToApi(body, ruta)
                resolve(resp)
            })
        )
    }

    /**
     * Enrutador general para envío de mensajes.
     * Si incluye media, se envía como archivo. Si no, como texto plano.
     *
     * @param number Número destino
     * @param message Mensaje de texto
     * @param options Opciones adicionales (media, etc.)
     */
    async sendMessage(number: string, message: string, options?: SendOptions): Promise<any> {
        options = { ...options, ...options['options'] }

        if (options.media) return this.sendMedia(number, options.media, message)
        return this.sendText(number, message)
    }

    saveFile(ctx: any, options?: { path: string }): Promise<string> {
        throw new Error('Method not implemented.')
    }
}

export { EvolutionProvider }
