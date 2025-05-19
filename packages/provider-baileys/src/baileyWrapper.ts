import {
    useMultiFileAuthState,
    DisconnectReason,
    proto,
    makeCacheableSignalKeyStore,
    getAggregateVotesInPollMessage,
    WASocket,
    BaileysEventMap,
    AnyMediaMessageContent,
    AnyMessageContent,
    PollMessageOptions,
    downloadMediaMessage,
    WAMessage,
    MessageUpsertType,
    isJidGroup,
    isJidBroadcast,
} from 'baileys'

const makeWASocketOther = require('baileys').default

export {
    makeWASocketOther,
    useMultiFileAuthState,
    DisconnectReason,
    proto,
    makeCacheableSignalKeyStore,
    getAggregateVotesInPollMessage,
    WASocket,
    BaileysEventMap,
    AnyMediaMessageContent,
    AnyMessageContent,
    PollMessageOptions,
    downloadMediaMessage,
    WAMessage,
    MessageUpsertType,
    isJidGroup,
    isJidBroadcast,
}
