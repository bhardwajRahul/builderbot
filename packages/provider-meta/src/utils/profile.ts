import axios from 'axios'
import type { AxiosResponse } from 'axios'

import type { WhatsAppProfile } from '~/types'

/**
 * Verify Meta JWT token validity
 * @param token - The JWT token to verify
 * @returns Token verification result
 */
async function verifyToken(token: string): Promise<any> {
    const response = await axios.get('https://graph.facebook.com/debug_token', {
        params: {
            input_token: token,
            access_token: token,
        },
    })
    return response.data
}

/**
 * Get the profile of a WhatsApp user
 * @param version - The version of the WhatsApp API
 * @param numberId - The ID of the WhatsApp user
 * @param token - The token of the WhatsApp user
 * @returns The profile of the WhatsApp user
 */
async function getProfile(version: string, numberId: string, token: string): Promise<WhatsAppProfile> {
    const response: AxiosResponse<WhatsAppProfile> = await axios.get(
        `https://graph.facebook.com/${version}/${numberId}`,
        {
            headers: {
                Authorization: `Bearer ${token}`,
            },
        }
    )
    return response.data
}

export { getProfile, verifyToken }
