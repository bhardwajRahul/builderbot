<p align="center">
  <a href="https://builderbot.app/">
    <h2 align="center">@builderbot/provider-gupshup</h2>
  </a>
</p>

## Description

Gupshup provider for BuilderBot v1.

## Inbound Webhook Format

This provider expects Gupshup WhatsApp Cloud (WABA) webhook payloads (`entry[].changes[].value.messages[]`).
Legacy webhook payloads (`type: "message"` with top-level `payload`) are not supported.
Inbound messages and delivery status updates are emitted as `notice` events for runtime visibility.

## Installation

```bash
npm install @builderbot/provider-gupshup
```

## Quick Start
```typescript
import { createProvider } from '@builderbot/bot'
import { GupshupProvider } from '@builderbot/provider-gupshup'

const adapterProvider = createProvider(GupshupProvider, {
    apiKey: 'YOUR_API_KEY',
    srcName: 'YOUR_APP_NAME',
    phoneNumber: 'YOUR_SOURCE_NUMBER',
    logs: {
        inbound: false,
        status: 'failed',
        outboundErrors: true,
        rawOnFailed: false,
    },
})
```

You can also disable provider notices globally when creating the bot:

```typescript
const { httpServer } = await createBot(
    { flow, provider: adapterProvider, database },
    {
        logs: {
            notices: false,
        },
    }
)
```

## Location Request Transport

`sendLocationRequest`, `requestLocation`, and `sendMessage(..., { locationRequest })` send messages through the partner passthrough endpoint (`/partner/app/{appId}/v3/message`).

- `partner.appId` and `partner.appToken` are required.
- `bodyText` must be non-empty.
- Missing partner config throws: `Partner app config is required. Provide partner.appId and partner.appToken.`
