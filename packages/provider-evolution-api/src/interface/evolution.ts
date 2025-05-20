import type { BotContext } from '@builderbot/bot/dist/types'
import type polka from 'polka'

import type { SaveFileOptions } from '../types'

export interface EvolutionInterface {
    indexHome?: polka.Middleware
    sendMessageEvoApi: (body: any, ruta: string) => Promise<any>
    sendMessageToApi: (body: any, ruta: string) => Promise<any>
    sendMessage: <K = any>(to: string, message: string, args?: any) => Promise<K>
    sendText: (to: string, message: string, context?: string | null) => Promise<any>
    sendImage: (to: string, mediaInput: string, caption?: string, context?: string | null) => Promise<any>
    sendVideo: (to: string, mediaUrl: string, mediaName?: string, caption?: string) => Promise<any>
    sendAudio: (to: string, mediaUrl: string, mediaName?: string, caption?: string) => Promise<any>
    sendMedia: (to: string, file: string, type: string) => Promise<any>
    sendFile: (to: string, file: string, caption?: string) => Promise<any>
    incomingMsg: (req: any, res: any) => void | Promise<void>
}
