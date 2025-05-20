import { beforeEach, describe, expect, jest, test } from '@jest/globals'
import axios from 'axios'
import mime from 'mime-types'
import { utils } from '@builderbot/bot'
import { EvolutionProvider } from '../src/evolution/provider'
import { EvolutionGlobalVendorArgs } from '../src/types'

jest.mock('axios')

jest.mock('../src/utils', () => ({
    downloadFile: jest.fn(),
    getProfile: jest.fn(),
}))

jest.mock('fs/promises', () => ({
    writeFile: jest.fn(),
}))

jest.mock('@builderbot/bot')

describe('#EvolutionProvider', () => {
    let evolutionProvider: EvolutionProvider

    beforeEach(() => {
        evolutionProvider = new EvolutionProvider({
            name: 'bot',
            apiKey: 'your_api_key',
            baseURL: 'http://localhost:8080',
            instanceName: 'test-instance',
        })
    })

    describe('#afterHttpServerInit', () => {
        test('should emit "ready" event when successfully initialized', async () => {
            // Arrange
            const mockResponse = {
                data: { state: 'open' },
            }

            ;(axios.get as jest.MockedFunction<typeof axios.get>).mockResolvedValue(mockResponse)

            const mockEmit = jest.fn()
            evolutionProvider.emit = mockEmit as any

            // Act
            await evolutionProvider['afterHttpServerInit']()

            // Assert
            expect(mockEmit).toHaveBeenCalledWith('ready')
        })

        test('should emit "notice" event when connection fails', async () => {
            // Arrange
            ;(axios.get as jest.MockedFunction<typeof axios.get>).mockRejectedValue(new Error('Connection error'))

            const mockEmit = jest.fn()
            evolutionProvider.emit = mockEmit as any

            // Act
            await evolutionProvider['afterHttpServerInit']()

            // Assert
            expect(mockEmit).toHaveBeenCalledWith('notice', {
                title: '🟠 ERROR AUTH 🟠',
                instructions: [
                    'Error connecting to Evolution API, please check your credentials',
                    'Make sure your instance is connected',
                ],
            })
        })
    })

    describe('#sendText', () => {
        test('should call sendMessage with the provided parameters', async () => {
            // Arrange
            const fakeRecipient = '1234567890'
            const fakeMessage = 'Hello, World!'

            const originalSendMessage = evolutionProvider.sendMessage
            // Use a different approach to mock the method
            evolutionProvider.sendMessage = jest.fn() as any
            ;(evolutionProvider.sendMessage as jest.Mock).mockImplementation(() => Promise.resolve({}))

            // Act
            await evolutionProvider.sendText(fakeRecipient, fakeMessage)

            // Assert
            expect(evolutionProvider.sendMessage).toHaveBeenCalledWith(fakeRecipient, fakeMessage)

            // Restore original method
            evolutionProvider.sendMessage = originalSendMessage
        })
    })

    describe('#sendMessage', () => {
        test('should send message to the provided recipient', async () => {
            // Arrange
            const fakeRecipient = '1234567890'
            const fakeMessage = 'Hello, World!'
            const fakeResponse = { data: { success: true } }

            ;(axios.post as jest.MockedFunction<typeof axios.post>).mockResolvedValue(fakeResponse)

            // Act
            const result = await evolutionProvider.sendMessage(fakeRecipient, fakeMessage)

            // Assert
            expect(axios.post).toHaveBeenCalledWith(
                'http://localhost:8080/message/sendText/test-instance',
                {
                    number: fakeRecipient,
                    text: fakeMessage,
                },
                {
                    headers: {
                        apikey: 'your_api_key',
                    },
                }
            )
            expect(result).toEqual(fakeResponse)
        })
    })

    describe('#sendImage', () => {
        test('should send image to the provided recipient', async () => {
            // Arrange
            const fakeRecipient = '1234567890'
            const fakeImageUrl = 'https://example.com/image.jpg'
            const fakeCaption = 'This is a test image'
            const fakeResponse = { data: { success: true } }

            jest.spyOn(mime, 'lookup').mockReturnValue('image/jpeg')
            ;(axios.post as jest.MockedFunction<typeof axios.post>).mockResolvedValue(fakeResponse)

            // Act
            const result = await evolutionProvider.sendImage(fakeRecipient, fakeImageUrl, undefined, fakeCaption)

            // Assert
            expect(axios.post).toHaveBeenCalledWith(
                'http://localhost:8080/message/sendMedia/test-instance',
                {
                    number: fakeRecipient,
                    mediaType: 'image',
                    mimeType: 'image/jpeg',
                    caption: fakeCaption,
                    media: fakeImageUrl,
                    fileName: 'image.png',
                },
                {
                    headers: {
                        apikey: 'your_api_key',
                    },
                }
            )
            expect(result).toEqual(fakeResponse)
        })
    })

    describe('#busEvents', () => {
        test('should return an array of event handlers', () => {
            // Arrange
            const events = evolutionProvider.busEvents()

            // Assert
            expect(events.length).toBe(4)
            expect(events[0].event).toBe('auth_failure')
            expect(events[1].event).toBe('notice')
            expect(events[2].event).toBe('ready')
            expect(events[3].event).toBe('message')
        })

        test('should emit events with correct payloads', () => {
            // Arrange
            const events = evolutionProvider.busEvents()
            const mockEmit = jest.fn()
            evolutionProvider.emit = mockEmit as any

            const authPayload = { error: 'Auth failed' }
            const noticePayload = { instructions: ['Test instruction'], title: 'Test Title' }
            const messagePayload = { from: '1234567890', body: 'Test message' }

            // Act
            events[0].func(authPayload)
            events[1].func(noticePayload)
            events[2].func({ message: 'Ready' })
            events[3].func(messagePayload)

            // Assert
            expect(mockEmit).toHaveBeenCalledWith('auth_failure', authPayload)
            expect(mockEmit).toHaveBeenCalledWith('notice', noticePayload)
            expect(mockEmit).toHaveBeenCalledWith('ready', true)
            expect(mockEmit).toHaveBeenCalledWith('message', messagePayload)
        })
    })
})
