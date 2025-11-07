import { utils } from '@builderbot/bot'
import type { WriteStream } from 'fs'
import { createWriteStream } from 'fs'
import { emptyDir } from 'fs-extra'
import * as qr from 'qr-image'

const emptyDirSessions = async (pathBase: string) =>
    new Promise((resolve, reject) => {
        emptyDir(pathBase, (err) => {
            if (err) reject(err)
            resolve(true)
        })
    })

/**
 * Cleans and extracts the identifier from MessageKey.
 * Baileys handles LID automatically, we just extract the available identifier.
 * @param key The MessageKey object from Baileys
 * @returns The identifier
 */
function baileyCleanNumberWithLid(key: { remoteJid?: string; participant?: string }): string {
    // For groups: use participant
    if (key.participant) {
        return key.participant
    }
    // For DMs: use remoteJid
    if (key.remoteJid) {
        return key.remoteJid
    }
    return ''
}

/**
 * Cleans the WhatsApp number format. Baileys handles LID automatically.
 * @param number The WhatsApp number to be cleaned.
 * @param full Whether to return the full number format or not.
 * @returns The cleaned number.
 */
const baileyCleanNumber = (number: string, full: boolean = false): string => {
    // Handle group chats - return as is
    const regexGroup: RegExp = /\@g.us\b/gm
    const existGroup = number.match(regexGroup)
    if (existGroup) return number

    // Handle any WhatsApp format - return as is (includes @lid, @s.whatsapp.net, etc.)
    if (number.includes('@')) {
        if (full) {
            return number.split('@')[0].replace('+', '').replace(/\s/g, '')
        }
        return number
    }

    // Clean and format raw phone number
    const cleanedNumber = number.replace('+', '').replace(/\s/g, '')
    return full ? cleanedNumber : `${cleanedNumber}@s.whatsapp.net`
}

/**
 * Generates an image from a base64 string.
 * @param base64 The base64 string to generate the image from.
 * @param name The name of the file to write the image to.
 */
const baileyGenerateImage = async (base64: string, name: string = 'qr.png'): Promise<void> => {
    const PATH_QR: string = `${process.cwd()}/${name}`
    const qr_svg = qr.image(base64, { type: 'png', margin: 4 })

    const writeFilePromise = (): Promise<boolean> =>
        new Promise((resolve, reject) => {
            const file: WriteStream = qr_svg.pipe(createWriteStream(PATH_QR))
            file.on('finish', () => resolve(true))
            file.on('error', reject)
        })

    await writeFilePromise()
    await utils.cleanImage(PATH_QR)
}

/**
 * Validates if the given identifier is a valid WhatsApp user identifier and not a group ID.
 * @param rawIdentifier The identifier to validate
 * @returns True if it's a valid user identifier, false otherwise
 */
const baileyIsValidNumber = (rawIdentifier: string): boolean => {
    if (!rawIdentifier || typeof rawIdentifier !== 'string') {
        return false
    }

    // Exclude group chats
    const regexGroup: RegExp = /\@g.us\b/gm
    const isGroup = rawIdentifier.match(regexGroup)
    if (isGroup) return false

    // Exclude broadcast lists
    if (rawIdentifier.includes('@broadcast')) return false

    // Accept any WhatsApp format (Baileys handles @lid, @s.whatsapp.net automatically)
    if (rawIdentifier.includes('@')) return true

    // For raw numbers, consider them valid if they look like phone numbers
    const cleanNumber = rawIdentifier.replace(/\D/g, '')
    return cleanNumber.length >= 10 && cleanNumber.length <= 15
}

export { baileyCleanNumber, baileyGenerateImage, baileyIsValidNumber, emptyDirSessions, baileyCleanNumberWithLid }
