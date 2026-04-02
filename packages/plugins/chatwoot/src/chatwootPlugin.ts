import type { CoreClass } from '@builderbot/bot'

import { ChatwootApi } from './chatwootApi'
import type {
    BotIncomingMessagePayload,
    BotOutgoingPayload,
    ChatwootBotRef,
    ChatwootInbox,
    ChatwootPluginConfig,
    ChatwootWebhookBody,
} from './types'

const DEFAULT_INBOX_NAME = 'BuilderBot Inbox'
const WEBHOOK_SUBSCRIPTIONS = ['conversation_updated', 'message_created']

/**
 * Minimal single-concurrency async queue.
 * Ensures Chatwoot API calls are serialized to avoid race conditions.
 */
class SimpleQueue {
    private running = false
    private tasks: Array<() => Promise<void>> = []

    enqueue(task: () => Promise<void>): void {
        this.tasks.push(task)
        if (!this.running) this.drain()
    }

    private async drain(): Promise<void> {
        this.running = true
        while (this.tasks.length > 0) {
            const task = this.tasks.shift()!
            await task().catch((err) => console.error('[Chatwoot] Queue task error:', err))
        }
        this.running = false
    }
}

class ChatwootPlugin {
    private api: ChatwootApi
    private config: ChatwootPluginConfig
    private inbox: ChatwootInbox | null = null
    private conversationCache = new Map<string, number>()
    private contactCache = new Map<string, number>()
    private messageQueue = new SimpleQueue()

    /** False if Chatwoot credentials are invalid or unreachable. All operations are skipped when false. */
    public status = true

    constructor(config: ChatwootPluginConfig) {
        this.config = config
        this.api = new ChatwootApi(config)
    }

    /**
     * Conecta el plugin al bot. Una sola línea y listo.
     *
     * ```ts
     * const bot = await createBot({ flow, provider, database })
     * await chatwoot.attach(bot)
     * ```
     */
    async attach(bot: CoreClass): Promise<void> {
        const accountOk = await this.api.checkAccount()
        if (!accountOk) {
            console.error('[Chatwoot] Invalid credentials or unreachable endpoint. Plugin disabled.')
            this.status = false
            return
        }

        const inboxName = this.config.inboxName ?? DEFAULT_INBOX_NAME
        this.inbox = await this.api.findOrCreateInbox(inboxName)
        console.log(`[Chatwoot] Inbox "${this.inbox.name}" ready (id: ${this.inbox.id})`)

        if (this.config.webhookUrl) {
            const existing = await this.api.findWebhook(this.config.webhookUrl)
            if (!existing) {
                await this.api.createWebhook(this.config.webhookUrl, WEBHOOK_SUBSCRIPTIONS)
                console.log(`[Chatwoot] Webhook registered: ${this.config.webhookUrl}`)
            } else {
                console.log(`[Chatwoot] Webhook already exists (id: ${existing.id})`)
            }
        }

        bot.on('send_message', async (payload) => {
            if (!this.status) return
            if (payload.from?.includes('@g.us')) return

            this.messageQueue.enqueue(async () => {
                const { from, answer } = payload
                if (!from || !answer) return

                const content = Array.isArray(answer) ? answer.join('\n') : String(answer)
                if (!content || content.startsWith('__')) return

                const conversationId = await this.resolveConversation(from)
                const mediaUrl = (payload as unknown as BotOutgoingPayload).options?.media ?? null
                await this.api.sendMessage(conversationId, content, 'outgoing', mediaUrl)
            })
        })

        bot.provider.on('message', async (payload: BotIncomingMessagePayload) => {
            if (!this.status) return
            if (payload.from?.includes('@g.us')) return

            this.messageQueue.enqueue(async () => {
                const { from, body, name } = payload
                if (!from || !body) return

                const conversationId = await this.resolveConversation(from, name)
                const mediaUrl = payload.options?.media ?? null
                await this.api.sendMessage(conversationId, body, 'incoming', mediaUrl)
            })
        })

        console.log('[Chatwoot] Plugin attached successfully')
    }

    /**
     * Procesa un webhook entrante desde Chatwoot.
     *
     * Wire this to your HTTP route handler:
     * ```ts
     * server.post('/v1/chatwoot', handleCtx(async (bot, req, res) => {
     *     await chatwoot.handleWebhook(bot, req.body)
     *     res.end(JSON.stringify({ status: 'ok' }))
     * }))
     * ```
     *
     * Handles:
     * - `conversation_updated` + assignee change → add/remove phone from blacklist
     * - `message_created` outgoing on API channel → forward message to WhatsApp
     */
    async handleWebhook(bot: CoreClass & ChatwootBotRef, body: ChatwootWebhookBody): Promise<void> {
        if (!this.inbox) return

        const inboxIdFromBody =
            body?.conversation?.inbox_id ?? body?.inbox?.id ?? body?.conversation?.contact_inbox?.inbox_id

        if (inboxIdFromBody !== undefined && inboxIdFromBody !== this.inbox.id) return

        const changedKeys = body?.changed_attributes?.flatMap((attr) => Object.keys(attr)) ?? []

        if (body?.event === 'conversation_updated' && changedKeys.includes('assignee_id')) {
            const phone = body?.meta?.sender?.phone_number?.replace('+', '')
            const idAssigned = (body?.changed_attributes?.[0] as any)?.assignee_id?.current_value ?? null

            if (phone) {
                if (idAssigned) {
                    bot.blacklist?.add(phone)
                } else if (bot.blacklist?.checkIf(phone)) {
                    bot.blacklist?.remove(phone)
                }
            }
            return
        }

        if (
            body?.private === false &&
            body?.event === 'message_created' &&
            body?.message_type === 'outgoing' &&
            body?.conversation?.channel?.includes('Channel::Api')
        ) {
            const phone = body?.conversation?.meta?.sender?.phone_number?.replace('+', '')
            const content = body?.content ?? ''
            const file = body?.attachments?.length ? body.attachments[0] : null

            if (phone) {
                await bot.sendMessage(phone, content, { media: file?.data_url ?? null })
            }
        }
    }

    /**
     * Resuelve (o crea) el contacto y la conversación en Chatwoot para un número dado.
     */
    private async resolveConversation(phone: string, name?: string): Promise<number> {
        const cached = this.conversationCache.get(phone)
        if (cached) return cached

        let contactId = this.contactCache.get(phone)
        if (!contactId) {
            const contact = await this.api.findOrCreateContact(phone, name)
            if (!contact?.id) throw new Error(`[Chatwoot] Could not resolve contact for ${phone}`)
            contactId = contact.id!
            this.contactCache.set(phone, contactId)
        }

        if (!this.inbox) throw new Error('[Chatwoot] Plugin not attached yet. Call attach() first.')
        const conversation = await this.api.findOrCreateConversation(contactId, this.inbox.id)
        this.conversationCache.set(phone, conversation.id)

        return conversation.id
    }

    /**
     * Acceso directo a la API de Chatwoot para operaciones avanzadas.
     */
    getApi(): ChatwootApi {
        return this.api
    }

    /**
     * Retorna el inbox creado por el plugin.
     */
    getInbox(): ChatwootInbox | null {
        return this.inbox
    }
}

/**
 * Crea una instancia del plugin de Chatwoot.
 *
 * ```ts
 * const chatwoot = createChatwootPlugin({
 *     token: 'tu-token',
 *     url: 'https://app.chatwoot.com',
 *     accountId: 1,
 *     webhookUrl: 'https://mi-bot.example.com/v1/chatwoot',
 * })
 *
 * const bot = await createBot({ flow, provider, database })
 * await chatwoot.attach(bot)
 * ```
 */
const createChatwootPlugin = (config: ChatwootPluginConfig): ChatwootPlugin => {
    return new ChatwootPlugin(config)
}

export { ChatwootPlugin, createChatwootPlugin }
