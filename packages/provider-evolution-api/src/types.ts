import type { GlobalVendorArgs } from '@builderbot/bot/dist/types'

export interface SaveFileOptions {
    path?: string
}

export interface EvolutionGlobalVendorArgs extends GlobalVendorArgs {
    name: string
    apiKey: string
    baseURL: string
    instanceName: string
    port?: number
}
