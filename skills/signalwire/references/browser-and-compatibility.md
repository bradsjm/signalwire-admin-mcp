# Browser SDK v4 and Compatibility API

Use this reference for browser calling/video/chat, subscriber authentication, WebRTC media, Browser SDK v3 migration, or Twilio/cXML compatibility work. Re-open the current [Browser SDK index](https://signalwire.com/docs/browser-sdk/llms.txt) or [Compatibility API index](https://signalwire.com/docs/compatibility-api/llms.txt) before coding; package APIs, token contracts, and feature coverage evolve.

> **Security boundary:** Never put a Project ID/API token pair, signing key, SIP password, or refresh token in a browser bundle. Mint short-lived client credentials on an authenticated server. Obtain explicit approval before creating live subscribers/tokens/resources or changing production routes.

## Contents

- [Choose a browser credential](#choose-a-browser-credential)
- [Mint and refresh credentials](#mint-and-refresh-credentials)
- [Initialize Browser SDK v4](#initialize-browser-sdk-v4)
- [Place and receive calls](#place-and-receive-calls)
- [Attach and diagnose media](#attach-and-diagnose-media)
- [Use Web Components](#use-web-components)
- [Migrate Browser SDK v3](#migrate-browser-sdk-v3)
- [Use the Compatibility API and cXML](#use-the-compatibility-api-and-cxml)
- [Validate webhooks](#validate-webhooks)
- [Primary sources](#primary-sources)

## Choose a browser credential

Match the credential to the user journey. Confirm current limits in [Browser authentication](https://signalwire.com/docs/browser-sdk/v4/guides/authentication.md) and the specific token endpoint.

| Journey | Credential | Inbound | Outbound | Boundary |
| --- | --- | :---: | :---: | --- |
| Signed-in subscriber | Subscriber Access Token (SAT) | Yes | Yes | Server authenticates the application user and mints the SAT. |
| Limited guest | Guest SAT | No | Yes | Restrict to the approved destination set. |
| Invited participant | Invite SAT | No | Yes | Restrict to the invited address. |
| Public click-to-call | Embed/C2C token exchanged by `EmbedTokenCredentialProvider` | No | Yes | Pin to one public resource. |

Do not infer permissions from a token string. Keep token lifetimes short, bind tokens to the application session where supported, and authorize the subscriber reference on the server.

## Mint and refresh credentials

Use the Space host `https://{space}.signalwire.com`. Use server-side Basic Auth with Project ID and a scoped API token to mint a SAT; return only the short-lived SAT to the browser:

```bash
# External token creation requires approval.
curl --fail-with-body --request POST \
  "https://{space}.signalwire.com/api/fabric/subscribers/tokens" \
  --user "$SIGNALWIRE_PROJECT_ID:$SIGNALWIRE_API_TOKEN" \
  --header 'Content-Type: application/json' \
  --data '{"reference":"<authorized-app-user>"}'
```

Re-open [Create Subscriber token](https://signalwire.com/docs/apis/rest/subscribers/tokens/create-subscriber-token.md) for `expire_at`, fingerprint, refresh scope, and response fields. Never let the browser call this endpoint with Project credentials.

Choose one refresh design:

1. **Server-mediated:** Implement a Browser SDK `CredentialProvider` whose `authenticate()` and `refresh()` call the application's authenticated backend. Let the backend rotate or reissue SATs.
2. **Client-bound SAT:** Pass the SDK-provided fingerprint to the backend and request the documented refresh scope. Let the SDK rotate the bound SAT. Keep server refresh as a controlled fallback and observe `warnings$`.
3. **Static/embed:** Use `StaticCredentialProvider` for a pre-minted short session or `EmbedTokenCredentialProvider` for a public resource. Do not expect a static credential to refresh itself.

Log expiry and refresh outcome, not tokens. Revoke the application session separately from the SignalWire token when the user signs out.

## Initialize Browser SDK v4

Follow the repository's package manager; with pnpm:

```bash
pnpm add @signalwire/js rxjs
```

Construct v4 synchronously with a credential provider:

```typescript
import { SignalWire, StaticCredentialProvider } from "@signalwire/js";

const client = new SignalWire(
  new StaticCredentialProvider({ token: satFromAuthenticatedBackend }),
);

const subscriptions = [
  client.ready$.subscribe((ready) => console.info("SignalWire ready", ready)),
  client.errors$.subscribe((error) => console.error("SignalWire error", error)),
  client.warnings$.subscribe((warning) => console.warn("SignalWire warning", warning)),
];
```

The SDK state surfaces are RxJS observables. A `$` suffix denotes the stream; the similarly named property is a current snapshot where documented. Subscribe before relying on lazy collections such as directory/device state. Clean up every subscription and call `client.destroy()` when the application session ends.

Use `skipConnection` or `skipRegister` only when the application needs explicit lifecycle control. Otherwise, let construction connect/register as documented. A connected client is not necessarily registered for inbound calls; inspect `isConnected$`, `isRegistered$`, and `ready$` separately.

## Place and receive calls

### Outbound

Use a destination form allowed by the SAT:

```typescript
const call = await client.dial("/public/<resource-address>", {
  audio: true,
  video: false,
});
```

Current destination forms include public/private Fabric addresses, E.164 phone numbers, and SIP URIs when the credential permits them. Preserve the returned `Call`, subscribe to `status$`, and expose only controls the call state supports:

```typescript
const callSubscriptions = [
  call.status$.subscribe((status) => console.info("Call status", status)),
];

await call.sendDigits("1234#");
await call.hangup();
```

Treat transfer, PSTN dialing, recording, or any billable call as an approved external action. Re-open [Outbound calls](https://signalwire.com/docs/browser-sdk/v4/guides/outbound-calls.md) for the installed SDK's destination and option types.

### Inbound

A full Subscriber SAT can receive inbound calls after registration. Observe the session list and act only on a ringing call:

```typescript
const incomingSubscription = client.session.incomingCalls$.subscribe((calls) => {
  for (const incoming of calls) {
    if (incoming.status === "ringing") {
      incoming.answer({ audio: true, video: false });
    }
  }
});
```

Keep the incoming-call UI idempotent because the observable emits current state and later updates. Provide reject/hangup controls. Do not expect Guest, Invite, or embed credentials to receive inbound calls.

## Attach and diagnose media

Browser SDK v4 does not attach media elements automatically. Subscribe to streams and assign `srcObject`:

```typescript
const remoteMedia = document.querySelector<HTMLVideoElement>("#remote-media");
if (!remoteMedia) throw new Error("Missing remote media element");

const remoteSubscription = call.remoteStream$.subscribe((stream) => {
  remoteMedia.srcObject = stream;
  void remoteMedia.play().catch(() => {
    // Autoplay may require a user gesture; expose a visible play control.
  });
});

// On teardown:
remoteSubscription.unsubscribe();
remoteMedia.srcObject = null;
```

Apply the same pattern to `localStream$`; mute the local preview element to prevent feedback. Request media only from HTTPS or localhost. Explain permission failures to the user and let them retry after changing browser/device permissions.

Diagnose in this order:

1. Subscribe to `errors$` and `warnings$` before dialing.
2. Check `ready$`, `isConnected$`, `isRegistered$`, and SAT expiry/permissions.
3. Enumerate SDK audio/video devices and browser `navigator.mediaDevices.enumerateDevices()` after permission is granted.
4. Inspect the WebSocket in browser developer tools.
5. Inspect `call.rtcPeerConnection?.iceConnectionState` and `iceconnectionstatechange`.
6. Use `getStats()` to compare inbound/outbound RTP packets, loss, jitter, codec, and candidate pairs.
7. Run `client.preflight()` for a staged connectivity check and collect `client.exportDiagnostics()` for a sanitized support bundle.

Do not claim an RTP/firewall cause from a black video element alone. Prove whether signaling, permissions, track attachment, autoplay, ICE, or packet flow is the first failing boundary. See [Browser SDK troubleshooting](https://signalwire.com/docs/browser-sdk/v4/guides/troubleshooting.md).

## Use Web Components

Use `@signalwire/web-components` when its `<sw-call-widget>` and media/control primitives match the required experience. Prefer npm/pnpm imports in maintained applications; use the embed bundle for a deliberately simple integration. Supply an embed token and approved destination, not server credentials.

Read [Web Components](https://signalwire.com/docs/browser-sdk/v4/guides/web-components.md) before choosing attributes or events. Check keyboard access, labels, focus, permission errors, device selection, call status announcements, and teardown in a real browser. Use the lower-level Browser SDK when the application needs custom state, auth refresh, routing, or media layout beyond the components' contract.

## Migrate Browser SDK v3

Treat v4 as an architectural migration, not an import rename. The official [v3 to v4 guide](https://signalwire.com/docs/browser-sdk/v4/guides/migrate-from-v3.md) identifies these cutovers:

- Replace the asynchronous client factory with synchronous `new SignalWire(credentialProvider)`.
- Replace event-emitter handlers with RxJS observable subscriptions.
- Replace `online()`/`offline()` with `register()`/`unregister()`.
- Replace `RoomSession` assumptions with the unified `Call` and `call.self` state.
- Attach local and remote streams explicitly; remove `rootElement` auto-render assumptions.
- Remove `call.start()`, `node_id`, and `userVariables` dependencies.
- Inventory feature gaps before cutover; the migration guide lists v3 features not yet implemented in v4.

Migrate one complete call journey, including auth refresh, media, teardown, and errors. Remove v3 code rather than running two session models in parallel.

## Use the Compatibility API and cXML

Choose the Compatibility API only for an intentional Twilio/TwiML migration or an existing cXML application. Keep it separate from native REST/Fabric code.

### Migration boundary

Change all three together:

1. Twilio Account SID/Auth Token to SignalWire Project ID/API token.
2. API host to the Space-specific compatibility base:
   `https://{space}.signalwire.com/api/laml/2010-04-01`.
3. Webhook and status callback URLs, sending numbers, and resource IDs to SignalWire-owned equivalents.

The Project ID occupies the Account SID position in compatibility routes. Compatibility requests commonly use form-encoded bodies and Twilio-style pagination; native APIs use their endpoint-specific JSON contracts. Never send a native `/api/messaging` payload to the LAML path.

Use the maintained language client for the existing codebase. For Node/TypeScript, the compatibility package is `@signalwire/compatibility-api` and accepts `signalwireSpaceUrl`; for Python, consult the current `signalwire` compatibility reference before importing because the modern SDK also exposes native REST namespaces.

### cXML response

Return well-formed XML rooted at `<Response>` with the correct XML content type:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Thanks for calling.</Say>
</Response>
```

Use cXML builders where the compatibility SDK provides them. Escape dynamic content, keep the response under documented limits, and return `<Response/>` for callbacks that require an empty valid response. Read the [cXML specification](https://signalwire.com/docs/compatibility-api/cxml.md) and [Compatibility REST API](https://signalwire.com/docs/compatibility-api/rest.md).

## Validate webhooks

SignalWire sends `x-signalwire-signature`. Validate it with the project's signing key and the exact URL/body representation required by the current SDK.

- Capture the raw request body before JSON/form parsers mutate it when the validator expects bytes/raw text.
- Reconstruct the externally visible HTTPS URL correctly behind a trusted proxy.
- Compare signatures in constant time through the maintained SDK helper.
- Reject missing/invalid signatures before business logic.
- Keep the signing key server-side and coordinate rotation with every webhook consumer.
- Treat tunnel/proxy URL rewriting as a test-environment difference; do not disable validation in production.

For Node compatibility apps, re-open [Webhook security](https://signalwire.com/docs/compatibility-api/guides/webhook-security.md) for `RestClient.validateRequest()`/middleware. For Python custom servers, use the current [webhook signature validation](https://signalwire.com/docs/server-sdks/reference/python/core/security.md). Read [Common webhook errors](https://signalwire.com/docs/compatibility-api/guides/common-webhook-errors.md) before changing response behavior.

## Primary sources

- [Browser SDK v4 overview](https://signalwire.com/docs/browser-sdk/v4/guides/overview.md)
- [Browser authentication](https://signalwire.com/docs/browser-sdk/v4/guides/authentication.md)
- [RxJS primer](https://signalwire.com/docs/browser-sdk/v4/guides/rxjs-primer.md)
- [Outbound calls](https://signalwire.com/docs/browser-sdk/v4/guides/outbound-calls.md)
- [Browser SDK troubleshooting](https://signalwire.com/docs/browser-sdk/v4/guides/troubleshooting.md)
- [Web Components](https://signalwire.com/docs/browser-sdk/v4/guides/web-components.md)
- [Migrate Browser SDK v3](https://signalwire.com/docs/browser-sdk/v4/guides/migrate-from-v3.md)
- [Subscriber token endpoint](https://signalwire.com/docs/apis/rest/subscribers/tokens/create-subscriber-token.md)
- [Compatibility API](https://signalwire.com/docs/compatibility-api.md)
- [Compatibility REST API](https://signalwire.com/docs/compatibility-api/rest.md)
- [cXML specification](https://signalwire.com/docs/compatibility-api/cxml.md)
- [Webhook security](https://signalwire.com/docs/compatibility-api/guides/webhook-security.md)
- [Common webhook errors](https://signalwire.com/docs/compatibility-api/guides/common-webhook-errors.md)
