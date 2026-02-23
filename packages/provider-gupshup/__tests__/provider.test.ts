import { utils } from '@builderbot/bot'
import { beforeEach, describe, expect, jest, test } from '@jest/globals'
import axios from 'axios'
import { EventEmitter } from 'node:events'
import * as nodeFs from 'node:fs'

import { GupshupCoreVendor } from '../src/gupshup/core'
import { GupshupProvider } from '../src/gupshup/provider'
import { GupshupGlobalVendorArgs } from '../src/types'

jest.mock('axios')

jest.mock('node:fs', () => {
    const actualFs = jest.requireActual('node:fs') as any

    return {
        ...actualFs,
        createReadStream: jest.fn(actualFs.createReadStream),
    }
})

jest.mock('@builderbot/bot', () => ({
    ProviderClass: class {
        server: any = {
            use: jest.fn().mockReturnThis(),
            post: jest.fn().mockReturnThis(),
            get: jest.fn().mockReturnThis(),
        }
        emit = jest.fn()
    },
    utils: {
        generalDownload: jest.fn(),
    },
}))

describe('#GupshupProvider', () => {
    let provider: GupshupProvider
    const mockedAxios = axios as jest.Mocked<typeof axios>

    const mockArgs: GupshupGlobalVendorArgs = {
        name: 'test-bot',
        port: 3000,
        apiKey: 'test-api-key',
        srcName: 'TestApp',
        phoneNumber: '1234567890',
        appId: 'test-app-id',
        logs: {
            status: 'all',
        },
    }

    const mockHttpPost = (response: any = { data: { messageId: 'abc123' } }) => {
        const post = jest.fn()
        ;(post as any).mockResolvedValue(response)
        ;(provider as any).http = { post }
        return post
    }

    beforeEach(() => {
        jest.clearAllMocks()
        mockedAxios.create.mockReturnValue({ post: jest.fn() } as any)
        provider = new GupshupProvider(mockArgs)
    })

    describe('#constructor', () => {
        test('should initialize with provided arguments', () => {
            expect(provider.globalVendorArgs.apiKey).toBe('test-api-key')
            expect(provider.globalVendorArgs.srcName).toBe('TestApp')
            expect(provider.globalVendorArgs.phoneNumber).toBe('1234567890')
            expect(provider.globalVendorArgs.appId).toBe('test-app-id')
            expect(provider.globalVendorArgs.logs).toEqual({
                inbound: false,
                status: 'all',
                outboundErrors: true,
                rawOnFailed: false,
            })
        })

        test('should create axios instance with correct baseURL and headers', () => {
            expect(axios.create).toHaveBeenCalledWith({
                baseURL: 'https://api.gupshup.io/wa/api/v1',
                headers: {
                    apikey: 'test-api-key',
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
            })
        })
    })

    describe('#initVendor', () => {
        test('should create and return GupshupCoreVendor instance', async () => {
            const vendor = await provider['initVendor']()

            expect(vendor).toBeInstanceOf(GupshupCoreVendor)
            expect(provider.vendor).toBe(vendor)
            expect((vendor as any).args).toEqual(provider.globalVendorArgs)
        })
    })

    describe('#busEvents', () => {
        test('should return message, notice and status handlers', () => {
            const events = provider['busEvents']()

            expect(events).toHaveLength(3)
            expect(events[0].event).toBe('message')
            expect(events[1].event).toBe('notice')
            expect(events[2].event).toBe('status')
        })
    })

    describe('#sendMessage', () => {
        test('should call sendText when no options provided', async () => {
            const sendTextSpy = jest.spyOn(provider, 'sendText').mockResolvedValue({ status: 'sent' } as any)

            await provider.sendMessage('5491155551234', 'Hello!')

            expect(sendTextSpy).toHaveBeenCalledWith('5491155551234', 'Hello!', {})
        })

        test('should call sendButtons when options.buttons is provided', async () => {
            const sendButtonsSpy = jest.spyOn(provider, 'sendButtons').mockResolvedValue({ status: 'sent' } as any)

            await provider.sendMessage('5491155551234', 'Choose:', {
                buttons: [{ body: 'Option 1' }, { body: 'Option 2' }],
            })

            expect(sendButtonsSpy).toHaveBeenCalledWith(
                '5491155551234',
                'Choose:',
                [{ body: 'Option 1' }, { body: 'Option 2' }],
                expect.objectContaining({
                    buttons: [{ body: 'Option 1' }, { body: 'Option 2' }],
                })
            )
        })

        test('should call sendMedia when options.media is provided', async () => {
            const sendMediaSpy = jest.spyOn(provider, 'sendMedia').mockResolvedValue({ status: 'sent' } as any)

            await provider.sendMessage('5491155551234', 'Check this image', {
                media: 'https://example.com/image.jpg',
            })

            expect(sendMediaSpy).toHaveBeenCalledWith(
                '5491155551234',
                'Check this image',
                'https://example.com/image.jpg',
                expect.objectContaining({
                    media: 'https://example.com/image.jpg',
                })
            )
        })

        test('should merge nested options before routing', async () => {
            const sendTextSpy = jest.spyOn(provider, 'sendText').mockResolvedValue({ status: 'sent' } as any)

            await provider.sendMessage('5491155551234', 'Hello!', {
                options: {
                    previewUrl: true,
                },
            } as any)

            expect(sendTextSpy).toHaveBeenCalledWith(
                '5491155551234',
                'Hello!',
                expect.objectContaining({ previewUrl: true })
            )
        })

        test('should route flow payload to sendFlow when options.flow is provided', async () => {
            const sendFlowSpy = jest.spyOn(provider, 'sendFlow').mockResolvedValue({ status: 'sent' } as any)

            await provider.sendMessage('5491155551234', 'Fallback message', {
                flow: {
                    body: 'Start flow',
                    flowId: 'flow_123',
                    flowToken: 'token_abc',
                    flowCta: 'Open flow',
                },
            } as any)

            expect(sendFlowSpy).toHaveBeenCalledWith(
                '5491155551234',
                expect.objectContaining({
                    flowId: 'flow_123',
                    flowToken: 'token_abc',
                    flowCta: 'Open flow',
                })
            )
        })

        test('should route list payload to sendList', async () => {
            const sendListSpy = jest.spyOn(provider, 'sendList').mockResolvedValue({ status: 'sent' } as any)

            await provider.sendMessage('5491155551234', 'Fallback body', {
                list: {
                    items: [{ options: [{ title: 'Option 1' }] }],
                },
            } as any)

            expect(sendListSpy).toHaveBeenCalledWith(
                '5491155551234',
                expect.objectContaining({ body: 'Fallback body' })
            )
        })

        test('should route location request payload to sendLocationRequest', async () => {
            const sendLocationRequestSpy = jest
                .spyOn(provider, 'sendLocationRequest')
                .mockResolvedValue({ status: 'sent' } as any)

            await provider.sendMessage('5491155551234', 'Share your location', {
                locationRequest: 'Please share your location',
            } as any)

            expect(sendLocationRequestSpy).toHaveBeenCalledWith('5491155551234', 'Please share your location')
        })
    })

    describe('#sendText', () => {
        test('should send text message with correct URLSearchParams payload', async () => {
            const mockPost = mockHttpPost()

            await provider.sendText('5491155551234', 'Hello World')

            expect(mockPost).toHaveBeenCalledWith('/msg', expect.any(URLSearchParams))

            const calledParams = mockPost.mock.calls[0][1] as URLSearchParams
            expect(calledParams.get('channel')).toBe('whatsapp')
            expect(calledParams.get('source')).toBe('1234567890')
            expect(calledParams.get('destination')).toBe('5491155551234')
            expect(calledParams.get('src.name')).toBe('TestApp')

            const messagePayload = JSON.parse(calledParams.get('message') || '{}')
            expect(messagePayload).toEqual(
                expect.objectContaining({
                    type: 'text',
                    text: 'Hello World',
                    previewUrl: false,
                })
            )
        })

        test('should include context when replyTo is provided', async () => {
            const mockPost = mockHttpPost()

            await provider.sendText('5491155551234', 'Hello World', { replyTo: 'wamid.123' })

            const calledParams = mockPost.mock.calls[0][1] as URLSearchParams
            const messagePayload = JSON.parse(calledParams.get('message') || '{}')
            expect(messagePayload.context).toEqual({ msgId: 'wamid.123' })
        })

        test('should emit notice when outbound request fails', async () => {
            const mockPost = jest.fn()
            ;(mockPost as any).mockRejectedValue(new Error('upstream timeout'))
            ;(provider as any).http = { post: mockPost }
            const emitSpy = jest.spyOn(provider, 'emit')

            await expect(provider.sendText('5491155551234', 'Hello World')).rejects.toThrow('upstream timeout')

            expect(emitSpy).toHaveBeenCalledWith(
                'notice',
                expect.objectContaining({
                    title: '🔔  GUPSHUP ALERT  🔔',
                    instructions: expect.arrayContaining([
                        'Outbound failed (text)',
                        'To: 5491155551234',
                        'upstream timeout',
                    ]),
                })
            )
        })
    })

    describe('#sendMedia', () => {
        test('should send image payload when media is image', async () => {
            const mockPost = mockHttpPost()

            await provider.sendMedia('5491155551234', 'My caption', 'https://example.com/image.jpg')

            const calledParams = mockPost.mock.calls[0][1] as URLSearchParams
            const messagePayload = JSON.parse(calledParams.get('message') || '{}')

            expect(messagePayload.type).toBe('image')
            expect(messagePayload.originalUrl).toBe('https://example.com/image.jpg')
            expect(messagePayload.caption).toBe('My caption')
        })

        test('should send file payload when media type is file', async () => {
            const mockPost = mockHttpPost()

            await provider.sendMedia('5491155551234', 'My caption', 'https://example.com/files/report.pdf')

            const calledParams = mockPost.mock.calls[0][1] as URLSearchParams
            const messagePayload = JSON.parse(calledParams.get('message') || '{}')

            expect(messagePayload.type).toBe('file')
            expect(messagePayload.filename).toBe('report.pdf')
        })

        test('should keep explicit mediaType as authoritative over URL extension', async () => {
            const mockPost = mockHttpPost()

            await provider.sendMedia('5491155551234', 'caption', 'https://example.com/report.pdf', {
                mediaType: 'image',
            })

            const calledParams = mockPost.mock.calls[0][1] as URLSearchParams
            const messagePayload = JSON.parse(calledParams.get('message') || '{}')

            expect(messagePayload.type).toBe('image')
            expect(messagePayload.originalUrl).toBe('https://example.com/report.pdf')
        })

        test('should build provider local-media URL when resolver is not configured', async () => {
            const mockPost = mockHttpPost()

            await provider.sendMedia('5491155551234', 'caption', './fixtures/file.png')

            const calledParams = mockPost.mock.calls[0][1] as URLSearchParams
            const messagePayload = JSON.parse(calledParams.get('message') || '{}')
            expect(messagePayload.originalUrl).toMatch(/^http:\/\/localhost:3000\/local-media\/[a-z0-9-]+$/i)
        })

        test('should fail with explicit error for local media in production when publicUrl is missing', async () => {
            const originalNodeEnv = process.env.NODE_ENV
            process.env.NODE_ENV = 'production'

            try {
                await expect(provider.sendMedia('5491155551234', 'caption', './fixtures/file.png')).rejects.toThrow(
                    'publicUrl is required to serve local media in production/cloud environments'
                )
            } finally {
                process.env.NODE_ENV = originalNodeEnv
            }
        })

        test('should infer local .pdf media as file even when URL is tokenized', async () => {
            const mockPost = mockHttpPost()

            await provider.sendMedia('5491155551234', 'caption', './fixtures/report.pdf')

            const calledParams = mockPost.mock.calls[0][1] as URLSearchParams
            const messagePayload = JSON.parse(calledParams.get('message') || '{}')

            expect(messagePayload.type).toBe('file')
            expect(messagePayload.url).toMatch(/^http:\/\/localhost:3000\/local-media\/[a-z0-9-]+$/i)
        })

        test('should infer local .mp3 media as audio even when URL is tokenized', async () => {
            const mockPost = mockHttpPost()

            await provider.sendMedia('5491155551234', 'caption', './fixtures/voice.mp3')

            const calledParams = mockPost.mock.calls[0][1] as URLSearchParams
            const messagePayload = JSON.parse(calledParams.get('message') || '{}')

            expect(messagePayload.type).toBe('audio')
            expect(messagePayload.url).toMatch(/^http:\/\/localhost:3000\/local-media\/[a-z0-9-]+$/i)
        })

        test('should ignore untrusted inferred host and keep localhost fallback for local media URLs', async () => {
            const mockPost = mockHttpPost()

            ;(provider as any).captureInferredBaseUrl({
                headers: {
                    'x-forwarded-proto': 'https',
                    'x-forwarded-host': 'evil.example.com',
                },
            })

            await provider.sendMedia('5491155551234', 'caption', './fixtures/file.png')

            const calledParams = mockPost.mock.calls[0][1] as URLSearchParams
            const messagePayload = JSON.parse(calledParams.get('message') || '{}')
            expect(messagePayload.originalUrl).toMatch(/^http:\/\/localhost:3000\/local-media\/[a-z0-9-]+$/i)
        })

        test('should ignore invalid protocol from headers and keep localhost fallback', async () => {
            const mockPost = mockHttpPost()

            ;(provider as any).captureInferredBaseUrl({
                headers: {
                    host: 'localhost:9000',
                    'x-forwarded-proto': 'javascript',
                },
            })

            await provider.sendMedia('5491155551234', 'caption', './fixtures/file.png')

            const calledParams = mockPost.mock.calls[0][1] as URLSearchParams
            const messagePayload = JSON.parse(calledParams.get('message') || '{}')
            expect(messagePayload.originalUrl).toMatch(/^http:\/\/localhost:3000\/local-media\/[a-z0-9-]+$/i)
        })

        test('should resolve local media input using resolveMediaUrl hook', async () => {
            const providerWithResolver = new GupshupProvider({
                ...mockArgs,
                resolveMediaUrl: (input: string) => `https://cdn.example.com/${input}`,
            })
            const post = jest.fn(async () => ({ data: { messageId: 'abc123' } }))
            ;(providerWithResolver as any).http = { post }

            await providerWithResolver.sendMedia('5491155551234', 'caption', '/tmp/file.png')

            const calledParams = (post as any).mock.calls[0][1] as URLSearchParams
            const messagePayload = JSON.parse(calledParams.get('message') || '{}')
            expect(messagePayload.originalUrl).toBe('https://cdn.example.com//tmp/file.png')
        })

        test('should throw when resolver returns non-http url', async () => {
            const providerWithInvalidResolver = new GupshupProvider({
                ...mockArgs,
                resolveMediaUrl: () => 'file:///tmp/file.png',
            })

            await expect(
                providerWithInvalidResolver.sendMedia('5491155551234', 'caption', '/tmp/file.png')
            ).rejects.toThrow('Gupshup session messages require a public URL for media payloads')
        })
    })

    describe('#sendButtons', () => {
        test('should map buttons to quick reply payload', async () => {
            const mockPost = mockHttpPost()

            await provider.sendButtons('5491155551234', 'Choose an option', [
                { body: 'One' },
                { body: 'Two' },
                { body: 'Three' },
                { body: 'Four' },
            ] as any)

            const calledParams = mockPost.mock.calls[0][1] as URLSearchParams
            const messagePayload = JSON.parse(calledParams.get('message') || '{}')

            expect(messagePayload.type).toBe('quick_reply')
            expect(messagePayload.options).toHaveLength(3)
            expect(messagePayload.content.text).toBe('Choose an option')
        })

        test('should throw when no valid buttons are provided', async () => {
            await expect(provider.sendButtons('5491155551234', 'Choose', [] as any)).rejects.toThrow(
                'Gupshup quick replies require at least one button with text'
            )
        })
    })

    describe('#sendList', () => {
        test('should build list payload', async () => {
            const mockPost = mockHttpPost()

            await provider.sendList('5491155551234', {
                body: 'Select one',
                buttonTitle: 'Open',
                items: [
                    {
                        title: 'Main section',
                        options: [{ title: 'Option 1', postbackText: 'option_1' }],
                    },
                ],
            })

            const calledParams = mockPost.mock.calls[0][1] as URLSearchParams
            const messagePayload = JSON.parse(calledParams.get('message') || '{}')

            expect(messagePayload.type).toBe('list')
            expect(messagePayload.globalButtons[0].title).toBe('Open')
            expect(messagePayload.items[0].options[0].postbackText).toBe('option_1')
        })

        test('should adapt Meta-style list payload', async () => {
            const mockPost = mockHttpPost()

            await provider.sendList('5491155551234', {
                type: 'list',
                header: {
                    type: 'text',
                    text: 'Catalogo',
                },
                body: {
                    text: 'Selecciona una opcion',
                },
                action: {
                    button: 'Ver opciones',
                    sections: [
                        {
                            title: 'Primera',
                            rows: [{ id: 'row-1', title: 'Producto 1', description: 'Descripcion 1' }],
                        },
                    ],
                },
                footer: {
                    text: 'Footer',
                },
            } as any)

            const calledParams = mockPost.mock.calls[0][1] as URLSearchParams
            const messagePayload = JSON.parse(calledParams.get('message') || '{}')

            expect(messagePayload.title).toBe('Catalogo')
            expect(messagePayload.body).toBe('Selecciona una opcion\nFooter')
            expect(messagePayload.globalButtons[0].title).toBe('Ver opciones')
            expect(messagePayload.items[0].options[0].postbackText).toBe('row-1')
        })
    })

    describe('#sendImage, #sendFile and #sendButtonUrl', () => {
        test('should keep sendImage as alias to sendMedia with image mediaType', async () => {
            const sendMediaSpy = jest.spyOn(provider, 'sendMedia').mockResolvedValue({ status: 'sent' } as any)

            await provider.sendImage('5491155551234', 'https://example.com/photo.jpg', 'Photo caption')

            expect(sendMediaSpy).toHaveBeenCalledWith(
                '5491155551234',
                'Photo caption',
                'https://example.com/photo.jpg',
                expect.objectContaining({ mediaType: 'image' })
            )
        })

        test('should keep sendFile as alias to sendMedia with file mediaType', async () => {
            const sendMediaSpy = jest.spyOn(provider, 'sendMedia').mockResolvedValue({ status: 'sent' } as any)

            await provider.sendFile('5491155551234', 'https://example.com/report.pdf', 'File caption')

            expect(sendMediaSpy).toHaveBeenCalledWith(
                '5491155551234',
                'File caption',
                'https://example.com/report.pdf',
                expect.objectContaining({ mediaType: 'file' })
            )
        })

        test('should map sendButtonUrl payload to sendCtaUrl', async () => {
            const sendCtaUrlSpy = jest.spyOn(provider, 'sendCtaUrl').mockResolvedValue({ status: 'sent' } as any)

            await provider.sendButtonUrl(
                '5491155551234',
                {
                    text: 'Abrir web',
                    url: 'https://example.com',
                },
                ['Linea 1', 'Linea 2']
            )

            expect(sendCtaUrlSpy).toHaveBeenCalledWith(
                '5491155551234',
                {
                    display_text: 'Abrir web',
                    url: 'https://example.com',
                },
                'Linea 1\nLinea 2'
            )
        })

        test('should force image payload for sendImage even with .pdf extension', async () => {
            const mockPost = mockHttpPost()

            await provider.sendImage('5491155551234', 'https://example.com/files/manual.pdf', 'Preview as image')

            const calledParams = mockPost.mock.calls[0][1] as URLSearchParams
            const messagePayload = JSON.parse(calledParams.get('message') || '{}')

            expect(messagePayload.type).toBe('image')
            expect(messagePayload.originalUrl).toBe('https://example.com/files/manual.pdf')
        })

        test('should force file payload for sendFile even with .jpg extension', async () => {
            const mockPost = mockHttpPost()

            await provider.sendFile('5491155551234', 'https://example.com/files/photo.jpg', 'Send as file')

            const calledParams = mockPost.mock.calls[0][1] as URLSearchParams
            const messagePayload = JSON.parse(calledParams.get('message') || '{}')

            expect(messagePayload.type).toBe('file')
            expect(messagePayload.url).toBe('https://example.com/files/photo.jpg')
        })
    })

    describe('#sendLocation, #sendLocationRequest and #sendReaction', () => {
        test('should send location payload', async () => {
            const mockPost = mockHttpPost()

            await provider.sendLocation('5491155551234', {
                latitude: '-34.6037',
                longitude: '-58.3816',
                name: 'CABA',
                address: 'Buenos Aires',
            })

            const calledParams = mockPost.mock.calls[0][1] as URLSearchParams
            const messagePayload = JSON.parse(calledParams.get('message') || '{}')

            expect(messagePayload).toEqual(
                expect.objectContaining({
                    type: 'location',
                    latitude: '-34.6037',
                    longitude: '-58.3816',
                })
            )
        })

        test('should send location request payload through partner passthrough endpoint', async () => {
            const providerWithPartner = new GupshupProvider({
                ...mockArgs,
                partner: {
                    appId: 'partner-app-id',
                    appToken: 'partner-app-token',
                },
            })
            mockedAxios.post.mockResolvedValue({ data: { messageId: 'location-pass-1' } } as any)
            const sessionPost = jest.fn()
            ;(providerWithPartner as any).http = { post: sessionPost }

            await providerWithPartner.sendLocationRequest('5491155551234', 'Please share your current location')

            expect(mockedAxios.post).toHaveBeenCalledWith(
                'https://partner.gupshup.io/partner/app/partner-app-id/v3/message',
                expect.any(URLSearchParams),
                {
                    headers: {
                        Authorization: 'partner-app-token',
                        'Content-Type': 'application/x-www-form-urlencoded',
                    },
                }
            )
            expect(sessionPost).not.toHaveBeenCalled()

            const calledParams = mockedAxios.post.mock.calls[
                mockedAxios.post.mock.calls.length - 1
            ][1] as URLSearchParams
            expect(calledParams.get('messaging_product')).toBe('whatsapp')
            expect(calledParams.get('recipient_type')).toBe('individual')
            expect(calledParams.get('to')).toBe('5491155551234')
            expect(calledParams.get('type')).toBe('interactive')
            expect(calledParams.get('payload')).toBeNull()

            const interactivePayload = JSON.parse(calledParams.get('interactive') || '{}')
            expect(interactivePayload).toEqual({
                type: 'location_request_message',
                body: {
                    text: 'Please share your current location',
                },
                action: {
                    name: 'send_location',
                },
            })
        })

        test('should fail when location request text is empty', async () => {
            await expect(provider.sendLocationRequest('5491155551234', '   ')).rejects.toThrow(
                'Location request body text is required'
            )
        })

        test('should fail when partner config is missing for location request passthrough', async () => {
            await expect(provider.sendLocationRequest('5491155551234', 'Please share your location')).rejects.toThrow(
                'Partner app config is required. Provide partner.appId and partner.appToken.'
            )
        })

        test('should keep compatibility with requestLocation alias', async () => {
            const sendLocationRequestSpy = jest
                .spyOn(provider, 'sendLocationRequest')
                .mockResolvedValue({ status: 'sent' } as any)

            await provider.requestLocation('5491155551234', 'Share your location please')

            expect(sendLocationRequestSpy).toHaveBeenCalledWith('5491155551234', 'Share your location please')
        })

        test('should send reaction payload', async () => {
            const mockPost = mockHttpPost()

            await provider.sendReaction('5491155551234', {
                msgId: 'wamid.123',
                emoji: '✅',
            })

            const calledParams = mockPost.mock.calls[0][1] as URLSearchParams
            const messagePayload = JSON.parse(calledParams.get('message') || '{}')

            expect(messagePayload).toEqual({
                type: 'reaction',
                msgId: 'wamid.123',
                emoji: '✅',
            })
        })

        test('should normalize reaction payload when message_id alias is provided', async () => {
            const mockPost = mockHttpPost()

            await provider.sendReaction('5491155551234', {
                message_id: 'wamid.meta.1',
                emoji: '✅',
            })

            const calledParams = mockPost.mock.calls[0][1] as URLSearchParams
            const messagePayload = JSON.parse(calledParams.get('message') || '{}')

            expect(messagePayload).toEqual({
                type: 'reaction',
                msgId: 'wamid.meta.1',
                emoji: '✅',
            })
        })

        test('should normalize reaction payload when messageId alias is provided', async () => {
            const mockPost = mockHttpPost()

            await provider.sendReaction('5491155551234', {
                messageId: 'wamid.meta.2',
                emoji: '✅',
            })

            const calledParams = mockPost.mock.calls[0][1] as URLSearchParams
            const messagePayload = JSON.parse(calledParams.get('message') || '{}')

            expect(messagePayload).toEqual({
                type: 'reaction',
                msgId: 'wamid.meta.2',
                emoji: '✅',
            })
        })
    })

    describe('#sendTemplate', () => {
        test('should send template payload to template endpoint with request-object signature', async () => {
            const mockPost = mockHttpPost({ data: { templateId: 'tpl-1' } })

            await provider.sendTemplate('5491155551234', {
                template: {
                    id: 'template-id',
                    params: ['A', 'B'],
                },
            })

            expect(mockPost).toHaveBeenCalledWith('/template/msg', expect.any(URLSearchParams))
            const calledParams = mockPost.mock.calls[0][1] as URLSearchParams
            const templatePayload = JSON.parse(calledParams.get('template') || '{}')
            expect(templatePayload.id).toBe('template-id')
        })

        test('should accept Meta-style sendTemplate signature', async () => {
            const mockPost = mockHttpPost({ data: { templateId: 'tpl-2' } })

            await provider.sendTemplate('5491155551234', 'meta-template-id', 'es_AR', [
                {
                    type: 'body',
                    parameters: [
                        { type: 'text', text: 'Juan' },
                        { type: 'text', text: 'Premium' },
                    ],
                },
            ])

            expect(mockPost).toHaveBeenCalledWith('/template/msg', expect.any(URLSearchParams))

            const calledParams = mockPost.mock.calls[0][1] as URLSearchParams
            const templatePayload = JSON.parse(calledParams.get('template') || '{}')
            expect(templatePayload).toEqual({
                id: 'meta-template-id',
                languageCode: 'es_AR',
                params: ['Juan', 'Premium'],
            })
        })

        test('should accept template id without languageCode', async () => {
            const mockPost = mockHttpPost({ data: { templateId: 'tpl-3' } })

            await provider.sendTemplate('5491155551234', 'template-only-id')

            const calledParams = mockPost.mock.calls[0][1] as URLSearchParams
            const templatePayload = JSON.parse(calledParams.get('template') || '{}')
            expect(templatePayload).toEqual({
                id: 'template-only-id',
            })
        })

        test('should accept template components without languageCode', async () => {
            const mockPost = mockHttpPost({ data: { templateId: 'tpl-4' } })

            await provider.sendTemplate('5491155551234', 'template-components-only', [
                {
                    type: 'body',
                    parameters: [{ type: 'text', text: 'Solo param' }],
                },
            ])

            const calledParams = mockPost.mock.calls[0][1] as URLSearchParams
            const templatePayload = JSON.parse(calledParams.get('template') || '{}')
            expect(templatePayload).toEqual({
                id: 'template-components-only',
                params: ['Solo param'],
            })
        })

        test('should auto-route flow template components to partner passthrough when partner config exists', async () => {
            const providerWithPartner = new GupshupProvider({
                ...mockArgs,
                partner: {
                    appId: 'partner-app-id',
                    appToken: 'partner-app-token',
                },
            })
            mockedAxios.post.mockResolvedValue({ data: { messageId: 'flow-template-1' } } as any)

            await providerWithPartner.sendTemplate('5491155551234', 'flow_template_name', 'es_AR', [
                {
                    type: 'button',
                    parameters: [
                        {
                            type: 'action',
                            action: {
                                flow_token: 'flow_token_123',
                            },
                        } as any,
                    ],
                },
            ])

            expect(mockedAxios.post).toHaveBeenCalledWith(
                'https://partner.gupshup.io/partner/app/partner-app-id/v3/message',
                expect.any(URLSearchParams),
                {
                    headers: {
                        Authorization: 'partner-app-token',
                        'Content-Type': 'application/x-www-form-urlencoded',
                    },
                }
            )

            const calledParams = mockedAxios.post.mock.calls[
                mockedAxios.post.mock.calls.length - 1
            ][1] as URLSearchParams
            expect(calledParams.get('messaging_product')).toBe('whatsapp')
            expect(calledParams.get('recipient_type')).toBe('individual')
            expect(calledParams.get('to')).toBe('5491155551234')
            expect(calledParams.get('type')).toBe('template')
            expect(calledParams.get('payload')).toBeNull()

            const templatePayload = JSON.parse(calledParams.get('template') || '{}')
            expect(templatePayload).toEqual(
                expect.objectContaining({
                    name: 'flow_template_name',
                    language: { code: 'es_AR' },
                })
            )
        })

        test('should throw clear error when flow template components are present without partner config', async () => {
            await expect(
                provider.sendTemplate('5491155551234', 'flow_template_name', 'es_AR', [
                    {
                        type: 'button',
                        parameters: [
                            {
                                type: 'action',
                                action: {
                                    flow_token: 'flow_token_123',
                                },
                            } as any,
                        ],
                    },
                ])
            ).rejects.toThrow('Partner app config is required. Provide partner.appId and partner.appToken.')
        })

        test('should keep legacy non-flow template route on /template/msg', async () => {
            const providerWithPartner = new GupshupProvider({
                ...mockArgs,
                partner: {
                    appId: 'partner-app-id',
                    appToken: 'partner-app-token',
                },
            })
            const post = jest.fn(async () => ({ data: { templateId: 'legacy-template-1' } }))
            ;(providerWithPartner as any).http = { post }

            await providerWithPartner.sendTemplate('5491155551234', 'legacy_template_name', 'es_AR', [
                {
                    type: 'body',
                    parameters: [{ type: 'text', text: 'Juan' }],
                },
            ])

            expect(post as any).toHaveBeenCalledWith('/template/msg', expect.any(URLSearchParams))
            expect(mockedAxios.post).not.toHaveBeenCalled()
        })
    })

    describe('#sendFlow and #sendTemplatePassthrough', () => {
        test('should send flow payload to partner passthrough v3 endpoint', async () => {
            const providerWithPartner = new GupshupProvider({
                ...mockArgs,
                partner: {
                    appId: 'partner-app-id',
                    appToken: 'partner-app-token',
                },
            })
            mockedAxios.post.mockResolvedValue({ data: { messageId: 'flow-1' } } as any)

            await providerWithPartner.sendFlow('5491155551234', {
                header: 'Flow header',
                body: 'Flow body',
                footer: 'Flow footer',
                flowMessageVersion: '3',
                flowAction: 'navigate',
                flowToken: 'flow-token',
                flowId: 'flow-id',
                flowCta: 'Open flow',
                flowActionPayload: {
                    screen: 'WELCOME',
                },
                isDraftFlow: true,
            })

            expect(mockedAxios.post).toHaveBeenCalledWith(
                'https://partner.gupshup.io/partner/app/partner-app-id/v3/message',
                expect.any(URLSearchParams),
                {
                    headers: {
                        Authorization: 'partner-app-token',
                        'Content-Type': 'application/x-www-form-urlencoded',
                    },
                }
            )

            const calledParams = mockedAxios.post.mock.calls[
                mockedAxios.post.mock.calls.length - 1
            ][1] as URLSearchParams
            expect(calledParams.get('messaging_product')).toBe('whatsapp')
            expect(calledParams.get('recipient_type')).toBe('individual')
            expect(calledParams.get('to')).toBe('5491155551234')
            expect(calledParams.get('type')).toBe('interactive')
            expect(calledParams.get('payload')).toBeNull()

            const interactivePayload = JSON.parse(calledParams.get('interactive') || '{}')
            expect(interactivePayload.type).toBe('flow')
            expect(interactivePayload.action.parameters).toEqual(
                expect.objectContaining({
                    flow_message_version: '3',
                    flow_token: 'flow-token',
                    flow_id: 'flow-id',
                    flow_cta: 'Open flow',
                    flow_action: 'navigate',
                    flow_action_payload: { screen: 'WELCOME' },
                    mode: 'draft',
                })
            )
        })

        test('should send template passthrough payload to partner v3 endpoint', async () => {
            const providerWithPartner = new GupshupProvider({
                ...mockArgs,
                partner: {
                    appId: 'partner-app-id',
                    appToken: 'partner-app-token',
                    baseUrl: 'https://custom-partner.gupshup.io',
                },
            })
            mockedAxios.post.mockResolvedValue({ data: { messageId: 'template-pass-1' } } as any)

            await providerWithPartner.sendTemplatePassthrough('5491155551234', {
                name: 'welcome_flow_template',
                language: { code: 'es_AR' },
                components: [
                    {
                        type: 'body',
                        parameters: [{ type: 'text', text: 'Juan' }],
                    },
                ],
            })

            expect(mockedAxios.post).toHaveBeenCalledWith(
                'https://custom-partner.gupshup.io/partner/app/partner-app-id/v3/message',
                expect.any(URLSearchParams),
                {
                    headers: {
                        Authorization: 'partner-app-token',
                        'Content-Type': 'application/x-www-form-urlencoded',
                    },
                }
            )

            const calledParams = mockedAxios.post.mock.calls[
                mockedAxios.post.mock.calls.length - 1
            ][1] as URLSearchParams
            expect(calledParams.get('messaging_product')).toBe('whatsapp')
            expect(calledParams.get('recipient_type')).toBe('individual')
            expect(calledParams.get('to')).toBe('5491155551234')
            expect(calledParams.get('type')).toBe('template')
            expect(calledParams.get('payload')).toBeNull()

            const templatePayload = JSON.parse(calledParams.get('template') || '{}')
            expect(templatePayload).toEqual(
                expect.objectContaining({
                    name: 'welcome_flow_template',
                    language: { code: 'es_AR' },
                })
            )
        })

        test('should normalize flow passthrough components missing sub_type and index', async () => {
            const providerWithPartner = new GupshupProvider({
                ...mockArgs,
                partner: {
                    appId: 'partner-app-id',
                    appToken: 'partner-app-token',
                },
            })
            mockedAxios.post.mockResolvedValue({ data: { messageId: 'template-pass-2' } } as any)

            await providerWithPartner.sendTemplatePassthrough('5491155551234', {
                name: 'welcome_flow_template',
                language: { code: 'es_AR' },
                components: [
                    {
                        parameters: [
                            {
                                type: 'action',
                                action: {
                                    flow_token: 'flow_token_123',
                                },
                            } as any,
                        ],
                    },
                ],
            })

            const calledParams = mockedAxios.post.mock.calls[
                mockedAxios.post.mock.calls.length - 1
            ][1] as URLSearchParams
            expect(calledParams.get('messaging_product')).toBe('whatsapp')
            expect(calledParams.get('recipient_type')).toBe('individual')
            expect(calledParams.get('to')).toBe('5491155551234')
            expect(calledParams.get('type')).toBe('template')
            expect(calledParams.get('payload')).toBeNull()

            const templatePayload = JSON.parse(calledParams.get('template') || '{}')
            expect(templatePayload.components[0]).toEqual(
                expect.objectContaining({
                    type: 'button',
                    sub_type: 'flow',
                    index: '0',
                })
            )
        })

        test('should stringify numeric flow button index in passthrough payload', async () => {
            const providerWithPartner = new GupshupProvider({
                ...mockArgs,
                partner: {
                    appId: 'partner-app-id',
                    appToken: 'partner-app-token',
                },
            })
            mockedAxios.post.mockResolvedValue({ data: { messageId: 'template-pass-3' } } as any)

            await providerWithPartner.sendTemplatePassthrough('5491155551234', {
                name: 'welcome_flow_template',
                language: { code: 'es_AR' },
                components: [
                    {
                        type: 'button',
                        sub_type: 'flow',
                        index: 2 as any,
                        parameters: [
                            {
                                type: 'action',
                                action: {
                                    flow_token: 'flow_token_123',
                                },
                            } as any,
                        ],
                    },
                ],
            })

            const calledParams = mockedAxios.post.mock.calls[
                mockedAxios.post.mock.calls.length - 1
            ][1] as URLSearchParams
            expect(calledParams.get('messaging_product')).toBe('whatsapp')
            expect(calledParams.get('recipient_type')).toBe('individual')
            expect(calledParams.get('to')).toBe('5491155551234')
            expect(calledParams.get('type')).toBe('template')
            expect(calledParams.get('payload')).toBeNull()

            const templatePayload = JSON.parse(calledParams.get('template') || '{}')
            expect(templatePayload.components[0].index).toBe('2')
        })

        test('should force flow sub_type when flow action component has invalid sub_type', async () => {
            const providerWithPartner = new GupshupProvider({
                ...mockArgs,
                partner: {
                    appId: 'partner-app-id',
                    appToken: 'partner-app-token',
                },
            })
            mockedAxios.post.mockResolvedValue({ data: { messageId: 'template-pass-5' } } as any)

            await providerWithPartner.sendTemplatePassthrough('5491155551234', {
                name: 'welcome_flow_template',
                language: { code: 'es_AR' },
                components: [
                    {
                        type: 'button',
                        sub_type: 'quick_reply' as any,
                        index: '0',
                        parameters: [
                            {
                                type: 'action',
                                action: {
                                    flow_token: 'flow_token_123',
                                },
                            } as any,
                        ],
                    },
                ],
            })

            const calledParams = mockedAxios.post.mock.calls[
                mockedAxios.post.mock.calls.length - 1
            ][1] as URLSearchParams
            expect(calledParams.get('messaging_product')).toBe('whatsapp')
            expect(calledParams.get('recipient_type')).toBe('individual')
            expect(calledParams.get('to')).toBe('5491155551234')
            expect(calledParams.get('type')).toBe('template')
            expect(calledParams.get('payload')).toBeNull()

            const templatePayload = JSON.parse(calledParams.get('template') || '{}')
            expect(templatePayload.components[0].sub_type).toBe('flow')
        })

        test('should trim string flow button index before passthrough send', async () => {
            const providerWithPartner = new GupshupProvider({
                ...mockArgs,
                partner: {
                    appId: 'partner-app-id',
                    appToken: 'partner-app-token',
                },
            })
            mockedAxios.post.mockResolvedValue({ data: { messageId: 'template-pass-6' } } as any)

            await providerWithPartner.sendTemplatePassthrough('5491155551234', {
                name: 'welcome_flow_template',
                language: { code: 'es_AR' },
                components: [
                    {
                        type: 'button',
                        sub_type: 'flow',
                        index: '  7  ' as any,
                        parameters: [
                            {
                                type: 'action',
                                action: {
                                    flow_token: 'flow_token_123',
                                },
                            } as any,
                        ],
                    },
                ],
            })

            const calledParams = mockedAxios.post.mock.calls[
                mockedAxios.post.mock.calls.length - 1
            ][1] as URLSearchParams
            expect(calledParams.get('messaging_product')).toBe('whatsapp')
            expect(calledParams.get('recipient_type')).toBe('individual')
            expect(calledParams.get('to')).toBe('5491155551234')
            expect(calledParams.get('type')).toBe('template')
            expect(calledParams.get('payload')).toBeNull()

            const templatePayload = JSON.parse(calledParams.get('template') || '{}')
            expect(templatePayload.components[0].index).toBe('7')
        })

        test('should normalize passthrough language string to language.code', async () => {
            const providerWithPartner = new GupshupProvider({
                ...mockArgs,
                partner: {
                    appId: 'partner-app-id',
                    appToken: 'partner-app-token',
                },
            })
            mockedAxios.post.mockResolvedValue({ data: { messageId: 'template-pass-4' } } as any)

            await providerWithPartner.sendTemplatePassthrough('5491155551234', {
                name: 'welcome_flow_template',
                language: 'es_AR',
                components: [
                    {
                        type: 'button',
                        parameters: [
                            {
                                type: 'action',
                                action: {
                                    flow_token: 'flow_token_123',
                                },
                            } as any,
                        ],
                    },
                ],
            })

            const calledParams = mockedAxios.post.mock.calls[
                mockedAxios.post.mock.calls.length - 1
            ][1] as URLSearchParams
            expect(calledParams.get('messaging_product')).toBe('whatsapp')
            expect(calledParams.get('recipient_type')).toBe('individual')
            expect(calledParams.get('to')).toBe('5491155551234')
            expect(calledParams.get('type')).toBe('template')
            expect(calledParams.get('payload')).toBeNull()

            const templatePayload = JSON.parse(calledParams.get('template') || '{}')
            expect(templatePayload.language).toEqual({ code: 'es_AR' })
        })

        test('should throw clear error for uuid-like flow template identifier in passthrough', async () => {
            const providerWithPartner = new GupshupProvider({
                ...mockArgs,
                partner: {
                    appId: 'partner-app-id',
                    appToken: 'partner-app-token',
                },
            })

            await expect(
                providerWithPartner.sendTemplatePassthrough('5491155551234', {
                    name: '123e4567-e89b-42d3-a456-426614174000',
                    language: 'es_AR',
                    components: [
                        {
                            type: 'button',
                            parameters: [
                                {
                                    type: 'action',
                                    action: {
                                        flow_token: 'flow_token_123',
                                    },
                                } as any,
                            ],
                        },
                    ],
                })
            ).rejects.toThrow(
                'Flow template passthrough expects template name (not a UUID/numeric template id). Use template.name from Meta.'
            )
        })
    })

    describe('#saveFile', () => {
        test('should download media with apikey header for trusted gupshup host', async () => {
            ;(utils.generalDownload as any).mockResolvedValue('/tmp/file.jpg')

            const result = await provider.saveFile({ url: 'https://api.gupshup.io/media/file.jpg' })

            expect(utils.generalDownload).toHaveBeenCalledWith('https://api.gupshup.io/media/file.jpg', undefined, {
                apikey: 'test-api-key',
            })
            expect(result).toBe('/tmp/file.jpg')
        })

        test('should not attach apikey header for trusted host over http', async () => {
            ;(utils.generalDownload as any).mockResolvedValue('/tmp/file.jpg')

            const result = await provider.saveFile({ url: 'http://api.gupshup.io/media/file.jpg' })

            expect(utils.generalDownload).toHaveBeenCalledWith(
                'http://api.gupshup.io/media/file.jpg',
                undefined,
                undefined
            )
            expect(result).toBe('/tmp/file.jpg')
        })

        test('should download media without apikey header for untrusted host', async () => {
            ;(utils.generalDownload as any).mockResolvedValue('/tmp/file.jpg')

            const result = await provider.saveFile({ url: 'https://example.com/file.jpg' })

            expect(utils.generalDownload).toHaveBeenCalledWith('https://example.com/file.jpg', undefined, undefined)
            expect(result).toBe('/tmp/file.jpg')
        })

        test('should use mediaId when url is not present', async () => {
            const resolveMediaUrlFromIdSpy = jest
                .spyOn(provider as any, 'resolveMediaUrlFromId')
                .mockResolvedValue('https://example.com/from-id.jpg')
            ;(utils.generalDownload as any).mockResolvedValue('/tmp/from-id.jpg')

            const result = await provider.saveFile({ mediaId: 'media-123' })

            expect(resolveMediaUrlFromIdSpy).toHaveBeenCalledWith('media-123')
            expect(result).toBe('/tmp/from-id.jpg')
        })

        test('should return ERROR when media url cannot be resolved', async () => {
            const resolveMediaUrlFromIdSpy = jest
                .spyOn(provider as any, 'resolveMediaUrlFromId')
                .mockResolvedValue(null)

            const result = await provider.saveFile({ mediaId: 'media-404' })

            expect(resolveMediaUrlFromIdSpy).toHaveBeenCalledWith('media-404')
            expect(result).toBe('ERROR')
        })
    })

    describe('#serveRegisteredLocalMedia', () => {
        test('should return 404 when token does not exist', async () => {
            const mockReq = {
                params: {
                    token: 'missing-token',
                },
            }
            const mockRes = {
                statusCode: 0,
                end: jest.fn(),
                setHeader: jest.fn(),
                headersSent: false,
            }

            await (provider as any).serveRegisteredLocalMedia(mockReq, mockRes)

            expect(mockRes.statusCode).toBe(404)
            expect(mockRes.end).toHaveBeenCalledWith('Not Found')
        })

        test('should return 404 when token is expired', async () => {
            ;(provider as any).localMediaRegistry.set('expired-token', {
                absolutePath: __filename,
                expiresAt: Date.now() - 1,
            })

            const mockReq = {
                params: {
                    token: 'expired-token',
                },
            }
            const mockRes = {
                statusCode: 0,
                end: jest.fn(),
                setHeader: jest.fn(),
                headersSent: false,
            }

            await (provider as any).serveRegisteredLocalMedia(mockReq, mockRes)

            expect(mockRes.statusCode).toBe(404)
            expect(mockRes.end).toHaveBeenCalledWith('Not Found')
            expect((provider as any).localMediaRegistry.has('expired-token')).toBe(false)
        })

        test('should return 404 when registered file is missing', async () => {
            const missingPath = `${__filename}.missing.${Date.now()}`
            ;(provider as any).localMediaRegistry.set('missing-file-token', {
                absolutePath: missingPath,
                expiresAt: Date.now() + 60_000,
            })

            const mockReq = {
                params: {
                    token: 'missing-file-token',
                },
            }
            const mockRes = {
                statusCode: 0,
                end: jest.fn(),
                setHeader: jest.fn(),
                headersSent: false,
            }

            await (provider as any).serveRegisteredLocalMedia(mockReq, mockRes)

            expect(mockRes.statusCode).toBe(404)
            expect(mockRes.end).toHaveBeenCalledWith('Not Found')
        })

        test('should return 500 when stream emits error', async () => {
            const fakeStream = new EventEmitter() as EventEmitter & { pipe: jest.Mock }
            fakeStream.pipe = jest.fn(() => {
                fakeStream.emit('error', new Error('stream failed'))
            })
            const createReadStreamMock = nodeFs.createReadStream as unknown as jest.Mock
            createReadStreamMock.mockImplementationOnce(() => fakeStream as any)
            ;(provider as any).localMediaRegistry.set('stream-error-token', {
                absolutePath: __filename,
                expiresAt: Date.now() + 60_000,
            })

            const mockReq = {
                params: {
                    token: 'stream-error-token',
                },
            }
            const mockRes = {
                statusCode: 0,
                end: jest.fn(),
                setHeader: jest.fn(),
                headersSent: false,
            }

            await (provider as any).serveRegisteredLocalMedia(mockReq, mockRes)

            expect(createReadStreamMock).toHaveBeenCalled()
            expect(mockRes.statusCode).toBe(500)
            expect(mockRes.end).toHaveBeenCalledWith('Error')
        })
    })

    describe('#markAsRead and #getMessageStatus', () => {
        test('should mark message as read', async () => {
            mockedAxios.put.mockResolvedValue({ data: { success: true } } as any)

            await provider.markAsRead('wamid.1')

            expect(mockedAxios.put).toHaveBeenCalledWith(
                'https://api.gupshup.io/wa/app/test-app-id/msg/wamid.1/read',
                null,
                {
                    headers: {
                        apikey: 'test-api-key',
                    },
                }
            )
        })

        test('should get message status', async () => {
            mockedAxios.get.mockResolvedValue({ data: { status: 'read' } } as any)

            await provider.getMessageStatus('wamid.2')

            expect(mockedAxios.get).toHaveBeenCalledWith('https://api.gupshup.io/wa/app/test-app-id/msg/wamid.2', {
                headers: {
                    apikey: 'test-api-key',
                },
            })
        })

        test('should require appId for markAsRead', async () => {
            const providerWithoutAppId = new GupshupProvider({
                ...mockArgs,
                appId: '',
            })

            await expect(providerWithoutAppId.markAsRead('wamid.3')).rejects.toThrow(
                'appId is required to mark messages as read'
            )
        })
    })

    describe('#afterHttpServerInit', () => {
        test('should emit ready and notice events', async () => {
            const emitSpy = jest.spyOn(provider, 'emit')

            await provider['afterHttpServerInit']()

            expect(emitSpy).toHaveBeenCalledWith('ready')
            expect(emitSpy).toHaveBeenCalledWith(
                'notice',
                expect.objectContaining({
                    title: '🟢 Gupshup Provider Ready',
                })
            )
        })
    })
})
