import { describe, expect, test, beforeEach } from '@jest/globals'

import { EmailProvider } from '../src/email/provider'
import type { IEmailProviderArgs } from '../src/types'

const mockConfig: IEmailProviderArgs = {
    imap: {
        host: 'imap.example.com',
        port: 993,
        secure: true,
        auth: {
            user: 'test@example.com',
            pass: 'password123',
        },
    },
    smtp: {
        host: 'smtp.example.com',
        port: 465,
        secure: true,
        auth: {
            user: 'test@example.com',
            pass: 'password123',
        },
    },
}

describe('EmailProvider', () => {
    describe('constructor', () => {
        test('should create instance with valid config', () => {
            const provider = new EmailProvider(mockConfig)
            expect(provider).toBeInstanceOf(EmailProvider)
            expect(provider.globalVendorArgs.imap).toBeDefined()
            expect(provider.globalVendorArgs.smtp).toBeDefined()
        })

        test('should throw error without IMAP config', () => {
            expect(() => {
                new EmailProvider({
                    smtp: mockConfig.smtp,
                } as IEmailProviderArgs)
            }).toThrow('IMAP configuration is required')
        })

        test('should throw error without SMTP config', () => {
            expect(() => {
                new EmailProvider({
                    imap: mockConfig.imap,
                } as IEmailProviderArgs)
            }).toThrow('SMTP configuration is required')
        })

        test('should throw error without IMAP auth', () => {
            expect(() => {
                new EmailProvider({
                    imap: {
                        host: 'imap.example.com',
                        port: 993,
                    } as any,
                    smtp: mockConfig.smtp,
                })
            }).toThrow('IMAP host and authentication are required')
        })

        test('should set default values', () => {
            const provider = new EmailProvider(mockConfig)
            expect(provider.globalVendorArgs.name).toBe('email-bot')
            expect(provider.globalVendorArgs.port).toBe(3000)
            expect(provider.globalVendorArgs.mailbox).toBe('INBOX')
            expect(provider.globalVendorArgs.markAsRead).toBe(true)
        })

        test('should allow overriding default values', () => {
            const provider = new EmailProvider({
                ...mockConfig,
                name: 'custom-bot',
                port: 4000,
                mailbox: 'Custom',
                markAsRead: false,
            })
            expect(provider.globalVendorArgs.name).toBe('custom-bot')
            expect(provider.globalVendorArgs.port).toBe(4000)
            expect(provider.globalVendorArgs.mailbox).toBe('Custom')
            expect(provider.globalVendorArgs.markAsRead).toBe(false)
        })
    })

    describe('helper methods', () => {
        let provider: EmailProvider

        beforeEach(() => {
            provider = new EmailProvider(mockConfig)
        })

        test('isReply should return correct value', () => {
            expect(provider.isReply({ isReply: true } as any)).toBe(true)
            expect(provider.isReply({ isReply: false } as any)).toBe(false)
        })

        test('getThreadId should return threadId', () => {
            expect(provider.getThreadId({ threadId: 'test-thread' } as any)).toBe('test-thread')
            expect(provider.getThreadId({} as any)).toBeUndefined()
        })

        test('getAttachments should return attachments array', () => {
            const attachments = [{ filename: 'test.txt', contentType: 'text/plain', size: 100 }]
            expect(provider.getAttachments({ attachments } as any)).toEqual(attachments)
            expect(provider.getAttachments({} as any)).toEqual([])
        })
    })
})
