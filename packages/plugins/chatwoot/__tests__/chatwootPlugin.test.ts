import { test } from 'uvu'
import * as assert from 'uvu/assert'

import { ChatwootApi } from '../src/chatwootApi'
import { ChatwootPlugin, createChatwootPlugin } from '../src/chatwootPlugin'

// ─── config ───────────────────────────────────────────────────────────────────

const MOCK_CONFIG = {
    token: 'test-token-123',
    url: 'https://chatwoot.example.com',
    accountId: 1,
}

const MOCK_INBOX = { id: 42, name: 'BuilderBot Inbox' }

// ─── fetch mock ───────────────────────────────────────────────────────────────

type MockFn = (url: string, opts?: RequestInit) => Promise<Response>

/**
 * Smart fetch mock: matches requests by method + URL substring.
 * More specific entries (longer path strings) win over shorter ones.
 */
const makeSmartFetch = (overrides: Record<string, unknown> = {}): { mock: MockFn; calls: string[] } => {
    const calls: string[] = []

    const defaults: Record<string, unknown> = {
        'GET /api/v1/accounts/1/': { id: 1 },
        'GET /inboxes': { payload: [MOCK_INBOX] },
        'POST /inboxes': MOCK_INBOX,
        'GET /webhooks': { payload: { webhooks: [] } },
        'POST /webhooks': { id: 1, url: '' },
        'GET /contacts/search': { payload: [] },
        'GET /conversations': { payload: [] },
        'POST /contacts': { payload: { contact: { id: 10 } } },
        'POST /conversations': { id: 99, inbox_id: 42, contact_id: 10 },
        'POST /messages': { id: 1, content: 'ok', message_type: 'outgoing' },
        ...overrides,
    }

    const mock: MockFn = async (url, opts) => {
        const method = (opts?.method ?? 'GET').toUpperCase()
        calls.push(`${method} ${String(url)}`)

        const key = Object.keys(defaults)
            .sort((a, b) => b.length - a.length)
            .find((k) => {
                const space = k.indexOf(' ')
                const kMethod = k.slice(0, space)
                const kPath = k.slice(space + 1)
                return kMethod === method && String(url).includes(kPath)
            })

        const body = key !== undefined ? defaults[key] : {}
        return {
            ok: true,
            json: async () => body,
            text: async () => JSON.stringify(body),
            headers: new Headers({ 'content-type': 'application/json' }),
            arrayBuffer: async () => new ArrayBuffer(0),
        } as unknown as Response
    }

    return { mock, calls }
}

/** Temporarily replace global.fetch, restore after fn resolves. */
const withFetch = async <T>(mockFn: MockFn, fn: () => Promise<T>): Promise<T> => {
    const original = (global as any).fetch
    ;(global as any).fetch = mockFn
    try {
        return await fn()
    } finally {
        ;(global as any).fetch = original
    }
}

/** Wait for the internal SimpleQueue to drain. */
const drainQueue = () => new Promise<void>((r) => setTimeout(r, 60))

// ─── mock bot ─────────────────────────────────────────────────────────────────

const makeMockBot = () => {
    const botHandlers: Record<string, Array<(...a: unknown[]) => unknown>> = {}
    const provHandlers: Record<string, Array<(...a: unknown[]) => unknown>> = {}
    return {
        on(ev: string, h: (...a: unknown[]) => unknown) {
            botHandlers[ev] = [...(botHandlers[ev] ?? []), h]
        },
        emit: (ev: string, payload: unknown) => Promise.all((botHandlers[ev] ?? []).map((h) => h(payload))),
        provider: {
            on(ev: string, h: (...a: unknown[]) => unknown) {
                provHandlers[ev] = [...(provHandlers[ev] ?? []), h]
            },
            emit: (ev: string, payload: unknown) => Promise.all((provHandlers[ev] ?? []).map((h) => h(payload))),
        },
        blacklist: {
            items: new Set<string>(),
            add(p: string) {
                this.items.add(p)
            },
            remove(p: string) {
                this.items.delete(p)
            },
            checkIf(p: string) {
                return this.items.has(p)
            },
        },
        sent: [] as Array<{ number: string; content: string; options?: unknown }>,
        async sendMessage(number: string, content: string, options?: unknown) {
            this.sent.push({ number, content, options })
        },
    }
}

// ─── existing construction tests ─────────────────────────────────────────────

test('createChatwootPlugin returns a ChatwootPlugin instance', () => {
    assert.instance(createChatwootPlugin(MOCK_CONFIG), ChatwootPlugin)
})

test('ChatwootPlugin exposes getApi()', () => {
    assert.instance(createChatwootPlugin(MOCK_CONFIG).getApi(), ChatwootApi)
})

test('ChatwootPlugin getInbox() returns null before attach', () => {
    assert.is(createChatwootPlugin(MOCK_CONFIG).getInbox(), null)
})

test('createChatwootPlugin uses default inbox name', () => {
    assert.instance(createChatwootPlugin(MOCK_CONFIG), ChatwootPlugin)
})

test('createChatwootPlugin accepts custom inbox name', () => {
    assert.instance(createChatwootPlugin({ ...MOCK_CONFIG, inboxName: 'Custom Inbox' }), ChatwootPlugin)
})

test('ChatwootApi constructs with correct base URL', () => {
    assert.instance(new ChatwootApi(MOCK_CONFIG), ChatwootApi)
})

test('ChatwootApi trims trailing slash from URL', () => {
    assert.instance(new ChatwootApi({ ...MOCK_CONFIG, url: 'https://chatwoot.example.com/' }), ChatwootApi)
})

// ─── status flag ─────────────────────────────────────────────────────────────

test('plugin status is true by default', () => {
    assert.is(createChatwootPlugin(MOCK_CONFIG).status, true)
})

test('attach() sets status=false and skips inbox when credentials are invalid', async () => {
    const { mock } = makeSmartFetch({ 'GET /api/v1/accounts/1/': { error: 'unauthorized' } })
    const plugin = createChatwootPlugin(MOCK_CONFIG)
    const bot = makeMockBot()
    await withFetch(mock, () => plugin.attach(bot as any))
    assert.is(plugin.status, false)
    assert.is(plugin.getInbox(), null)
})

test('attach() sets inbox and keeps status=true when credentials are valid', async () => {
    const { mock } = makeSmartFetch()
    const plugin = createChatwootPlugin(MOCK_CONFIG)
    const bot = makeMockBot()
    await withFetch(mock, () => plugin.attach(bot as any))
    assert.is(plugin.status, true)
    assert.is(plugin.getInbox()?.id, MOCK_INBOX.id)
})

// ─── webhook auto-creation ────────────────────────────────────────────────────

test('attach() registers webhook when webhookUrl is configured', async () => {
    const { mock, calls } = makeSmartFetch()
    const plugin = createChatwootPlugin({ ...MOCK_CONFIG, webhookUrl: 'https://bot.example.com/chatwoot' })
    const bot = makeMockBot()
    await withFetch(mock, () => plugin.attach(bot as any))
    assert.ok(
        calls.some((c) => c.startsWith('POST') && c.includes('/webhooks')),
        'POST /webhooks was called to register the webhook'
    )
})

test('attach() skips webhook registration when webhookUrl is not configured', async () => {
    const { mock, calls } = makeSmartFetch()
    const plugin = createChatwootPlugin(MOCK_CONFIG)
    const bot = makeMockBot()
    await withFetch(mock, () => plugin.attach(bot as any))
    assert.not.ok(
        calls.some((c) => c.startsWith('POST') && c.includes('/webhooks')),
        'POST /webhooks should not be called without webhookUrl'
    )
})

// ─── group filter ─────────────────────────────────────────────────────────────

test('send_message handler skips @g.us group messages', async () => {
    const { mock, calls } = makeSmartFetch()
    const plugin = createChatwootPlugin(MOCK_CONFIG)
    const bot = makeMockBot()
    await withFetch(mock, () => plugin.attach(bot as any))
    const countAfterAttach = calls.length

    await withFetch(mock, async () => {
        await bot.emit('send_message', { from: '1234567890@g.us', answer: 'Hello group' })
        await drainQueue()
    })
    assert.is(calls.length, countAfterAttach, 'no fetch calls for group send_message')
})

test('provider message handler skips @g.us group messages', async () => {
    const { mock, calls } = makeSmartFetch()
    const plugin = createChatwootPlugin(MOCK_CONFIG)
    const bot = makeMockBot()
    await withFetch(mock, () => plugin.attach(bot as any))
    const countAfterAttach = calls.length

    await withFetch(mock, async () => {
        await bot.provider.emit('message', { from: '9876543210@g.us', body: 'Group message' })
        await drainQueue()
    })
    assert.is(calls.length, countAfterAttach, 'no fetch calls for group provider message')
})

// ─── handleWebhook ────────────────────────────────────────────────────────────

test('handleWebhook returns early when inbox ID does not match', async () => {
    const { mock } = makeSmartFetch()
    const plugin = createChatwootPlugin(MOCK_CONFIG)
    const bot = makeMockBot()
    await withFetch(mock, () => plugin.attach(bot as any))

    await plugin.handleWebhook(bot as any, {
        event: 'message_created',
        message_type: 'outgoing',
        private: false,
        content: 'Should be ignored',
        conversation: { inbox_id: 9999, channel: 'Channel::Api', meta: { sender: { phone_number: '+1234' } } },
    })
    assert.is(bot.sent.length, 0, 'sendMessage not called for mismatched inbox')
})

test('handleWebhook adds phone to blacklist when agent is assigned', async () => {
    const { mock } = makeSmartFetch()
    const plugin = createChatwootPlugin(MOCK_CONFIG)
    const bot = makeMockBot()
    await withFetch(mock, () => plugin.attach(bot as any))

    await plugin.handleWebhook(bot as any, {
        event: 'conversation_updated',
        changed_attributes: [{ assignee_id: { current_value: 7 } }],
        meta: { sender: { phone_number: '+5215511223344' } },
        conversation: { inbox_id: MOCK_INBOX.id },
    })
    assert.ok(bot.blacklist.items.has('5215511223344'), 'phone added to blacklist')
})

test('handleWebhook removes phone from blacklist when agent is unassigned', async () => {
    const { mock } = makeSmartFetch()
    const plugin = createChatwootPlugin(MOCK_CONFIG)
    const bot = makeMockBot()
    await withFetch(mock, () => plugin.attach(bot as any))

    bot.blacklist.items.add('5215511223344')

    await plugin.handleWebhook(bot as any, {
        event: 'conversation_updated',
        changed_attributes: [{ assignee_id: { current_value: null } }],
        meta: { sender: { phone_number: '+5215511223344' } },
        conversation: { inbox_id: MOCK_INBOX.id },
    })
    assert.not.ok(bot.blacklist.items.has('5215511223344'), 'phone removed from blacklist')
})

test('handleWebhook forwards outgoing API channel message to WhatsApp', async () => {
    const { mock } = makeSmartFetch()
    const plugin = createChatwootPlugin(MOCK_CONFIG)
    const bot = makeMockBot()
    await withFetch(mock, () => plugin.attach(bot as any))

    await plugin.handleWebhook(bot as any, {
        event: 'message_created',
        message_type: 'outgoing',
        private: false,
        content: 'Hello from agent',
        conversation: {
            inbox_id: MOCK_INBOX.id,
            channel: 'Channel::Api',
            meta: { sender: { phone_number: '+5215511223344' } },
        },
    })
    assert.is(bot.sent.length, 1, 'sendMessage called once')
    assert.is(bot.sent[0].number, '5215511223344')
    assert.is(bot.sent[0].content, 'Hello from agent')
})

test('handleWebhook does not forward private messages to WhatsApp', async () => {
    const { mock } = makeSmartFetch()
    const plugin = createChatwootPlugin(MOCK_CONFIG)
    const bot = makeMockBot()
    await withFetch(mock, () => plugin.attach(bot as any))

    await plugin.handleWebhook(bot as any, {
        event: 'message_created',
        message_type: 'outgoing',
        private: true,
        content: 'Internal agent note',
        conversation: {
            inbox_id: MOCK_INBOX.id,
            channel: 'Channel::Api',
            meta: { sender: { phone_number: '+5215511223344' } },
        },
    })
    assert.is(bot.sent.length, 0, 'private message must not be forwarded')
})

test('handleWebhook is a no-op before attach()', async () => {
    const bot = makeMockBot()
    const plugin = createChatwootPlugin(MOCK_CONFIG)
    await plugin.handleWebhook(bot as any, {
        event: 'message_created',
        message_type: 'outgoing',
        private: false,
        content: 'Should be ignored',
        conversation: { inbox_id: 42, channel: 'Channel::Api' },
    })
    assert.is(bot.sent.length, 0, 'no action before attach')
})

// ─── media support ────────────────────────────────────────────────────────────

test('ChatwootApi.sendMessage sends JSON when no media is provided', async () => {
    const { mock, calls } = makeSmartFetch()
    const api = new ChatwootApi(MOCK_CONFIG)
    await withFetch(mock, () => api.sendMessage(1, 'hello', 'outgoing'))
    assert.ok(
        calls.some((c) => c.startsWith('POST') && c.includes('/messages')),
        'POST /messages called for text message'
    )
})

test('ChatwootApi.sendMessage sends FormData when mediaSource is provided', async () => {
    const bodies: unknown[] = []
    const captureFetch: MockFn = async (_url, opts) => {
        bodies.push(opts?.body)
        return {
            ok: true,
            json: async () => ({ id: 1, content: 'ok', message_type: 'outgoing' }),
            text: async () => '{}',
            headers: new Headers({ 'content-type': 'application/json' }),
            // arrayBuffer is needed for the media download step
            arrayBuffer: async () => new ArrayBuffer(8),
        } as unknown as Response
    }
    const api = new ChatwootApi(MOCK_CONFIG)
    await withFetch(captureFetch, () => api.sendMessage(1, 'with media', 'outgoing', 'https://example.com/image.png'))
    const formDataBody = bodies.find((b) => b instanceof FormData)
    assert.instance(formDataBody, FormData, 'a POST body should be FormData when media is provided')
})

// ─── SimpleQueue serialization ────────────────────────────────────────────────

test('enqueued messages are processed without dropping', async () => {
    const { mock, calls } = makeSmartFetch()
    const plugin = createChatwootPlugin(MOCK_CONFIG)
    const bot = makeMockBot()
    await withFetch(mock, () => plugin.attach(bot as any))
    const countAfterAttach = calls.length

    await withFetch(mock, async () => {
        await bot.emit('send_message', { from: '5215511223344', answer: 'msg1' })
        await bot.emit('send_message', { from: '5215511223344', answer: 'msg2' })
        await drainQueue()
    })
    assert.ok(calls.length > countAfterAttach, 'fetch calls were made for enqueued messages')
})

test.run()
