# SignalWire platform and management APIs

Use this reference to choose the correct SignalWire API family, authenticate with the least privilege, and manage platform objects without guessing. Treat the live [API index](https://signalwire.com/docs/apis) and the [OpenAPI 3.1 JSON](https://signalwire.com/openapi.json) or [YAML](https://signalwire.com/openapi.yaml) as the contract: endpoint schemas, permissions, and enum values evolve.

> **Required re-check.** Re-open the current endpoint `.md` page and OpenAPI operation immediately before coding. Do not copy a remembered path, verb, request shape, pagination query, or response status into production.

## Contents

- [Architecture and API-family decision](#architecture-and-api-family-decision)
- [Authentication and data conventions](#authentication-and-data-conventions)
- [List, inspect, then mutate](#list-inspect-then-mutate)
- [Scoped CRUD catalog](#scoped-crud-catalog)
- [Phone numbers and routing](#phone-numbers-and-routing)
- [Messaging and 10DLC](#messaging-and-10dlc)
- [Calling, video, and logs](#calling-video-and-logs)
- [Datasphere, AI, call flows, and SWML](#datasphere-ai-call-flows-and-swml)
- [Safe clients](#safe-clients)
- [Observability and failure handling](#observability-and-failure-handling)
- [Primary sources](#primary-sources)

## Architecture and API-family decision

### Space, Project, Resource, and Address

- A **Space** is the account-level tenant and hostname. Use `https://{space}.signalwire.com` for HTTPS requests; `{space}` is the subdomain shown in the Dashboard.
- A **Project** is the operational and billing boundary for credentials, phone numbers, handlers, and traffic. A root Project can own child **subprojects**. A Project ID is the UUID used as the Basic Auth username. A request is evaluated inside the authenticated project's project tree; do not assume a token can cross trees.
- A **Resource** is a Fabric-managed handler or service object (for example, an AI agent, Call Flow, SWML Script, SWML Webhook, Relay application, or conference room). Generic resource listing is useful for discovery; create/update operations are normally on the type-specific endpoint documented in the API index.
- An **Address** is a routable Fabric address associated with a Resource or client. Enumerate addresses before assigning a phone route or issuing a client token. Do not manufacture an address from a display name.

Read [API credentials and Space concepts](https://signalwire.com/docs/platform/your-signalwire-api-space), [List projects](https://signalwire.com/docs/apis/rest/projects/list-projects), [List Resources](https://signalwire.com/docs/apis/rest/resources/list-resources), and [List Resource Addresses](https://signalwire.com/docs/apis/rest/addresses/list-resource-addresses).

### Choose the family before choosing the path

| Need | Current native family and starting point | Scope usually required | Important distinction |
|---|---|---|---|
| Projects, subprojects, API tokens | `/api/projects`, `/api/project/tokens` | Management | Management mutations affect credentials or tenancy; require approval. |
| Fabric Resources and Addresses | `/api/fabric/resources`, `/api/fabric/addresses`, then a type endpoint | Voice, Messaging, Fax, or Video (varies by resource) | Fabric IDs and addresses are not phone numbers. |
| Phone inventory, E911, number groups, verified caller IDs | `/api/relay/rest/phone_numbers` and related `/api/relay/rest/*` | Numbers | The native phone-number surface currently lives under the Relay REST path. Purchase/release is billable or destructive. |
| Native messaging | `/api/messaging/messages` | Messaging | Uses JSON and a native message object; sending queues external traffic. |
| Native call control | `/api/calling/calls` | Voice | Uses a command-dispatch JSON body; `dial` creates a call and other commands act on an active call. |
| Native video | `/api/video/rooms`, room tokens, sessions, recordings, streams | Video | Room tokens are client credentials, not server API tokens. |
| Datasphere | `/api/datasphere/documents` and chunks | DataSphere | Document ingestion is asynchronous; inspect status before searching or deleting. |
| AI, SWML, Call Flows | Type-specific `/api/fabric/resources/...` endpoints | Scope is shown on each endpoint | SWML object version is `1.0.0`; Call Flow deployment is a separate lifecycle action. |
| Compatibility API (legacy SIP/LAML/TwiML behavior) | `/api/laml/2010-04-01/Accounts/{ProjectId}/...` | Compatibility API token/account permissions | This is a Twilio-compatible surface, not a native JSON resource API. Use only for migration or a documented compatibility requirement. |

Some endpoint families have intentionally inconsistent conventions: `/api/messaging`, `/api/calling`, `/api/video`, `/api/datasphere`, and `/api/fabric` are native surfaces, while phone numbers, E911, registry, and some logs use `/api/relay/rest`; Compatibility uses `/api/laml/2010-04-01/Accounts/...`. Native endpoints also vary in whether creation returns `200` or `201`, whether a list accepts `page_token`, `page_number`, or both, and whether errors are a simple `error` object or an `errors` array. Never infer a sibling endpoint from a familiar one. Follow the exact operation in the [API index](https://signalwire.com/docs/apis) and [OpenAPI](https://signalwire.com/openapi.json).

### Compatibility API versus native REST

Use the [Compatibility API overview](https://signalwire.com/docs/compatibility-api) when migrating Twilio REST/TwiML or legacy SIP/LAML handlers. Compatibility requests commonly use the LAML base path and an Account SID-like Project ID; their XML/TwiML semantics and response shapes differ from native JSON. Do not send a native `/api/messaging` payload to a Compatibility endpoint, or assume a Compatibility resource ID is a Fabric ID. Mark Compatibility API and legacy SIP endpoints as legacy in designs, and prefer native REST/Fabric for new work.

## Authentication and data conventions

### Server API credentials

Use Basic Auth with a Project ID and a **scoped** API token. Keep both server-side, load them from a secret manager or environment, and use the exact Space hostname:

```text
SIGNALWIRE_SPACE=example.signalwire.com
SIGNALWIRE_PROJECT_ID=<project-uuid>
SIGNALWIRE_API_TOKEN=<scoped-server-token>
SIGNALWIRE_BASE_URL=https://example.signalwire.com
```

SignalWire documents Basic and Bearer authorization in [Authorization](https://signalwire.com/docs/apis/authorization). Basic Auth is `ProjectID:APIToken` encoded by the HTTP client; never hand-write or commit a Base64 credential. Use HTTPS only. A token with the wrong scope can appear as `401 Unauthorized`; check the operation's required scope before changing code.

### Client credentials

Never expose a server API token in browser or mobile code. Create a short-lived, narrowly scoped client credential on the server, then return only the client token:

- Fabric applications use a Subscriber Access Token or guest token; see [Create Subscriber token](https://signalwire.com/docs/apis/rest/subscribers/tokens/create-subscriber-token) and [Create guest embed token](https://signalwire.com/docs/apis/rest/subscribers/tokens/create-guest-embed-token).
- Video applications use a Room Token; see [Create room token](https://signalwire.com/docs/apis/rest/video/room-tokens/create-room-token).
- Chat applications use a Chat Token.

Bearer tokens expire and return `401`; refresh them through the documented lifecycle endpoint. A client token is not interchangeable with a server API token.

### Formats and headers

- Send JSON (`Content-Type: application/json`) for native endpoints unless the operation page says otherwise. Compatibility operations may require form-encoded parameters or XML/TwiML.
- Use UTC ISO 8601/RFC 3339 timestamps and E.164 phone numbers such as `+15551234567`; parameter names are case-sensitive. See [Data formats](https://signalwire.com/docs/apis/data-formats).
- Send an `Accept: application/json` header when the endpoint returns JSON. Preserve response IDs, status, timestamps, and links; do not key automation off display names.
- Treat webhook URLs and callback payloads as untrusted input. Require HTTPS in production, authenticate callbacks where supported, and log correlation IDs without logging tokens or message bodies.

## List, inspect, then mutate

Use this lifecycle for every external write:

1. **Identify the family and permission.** Open the exact endpoint page and confirm the Space, Project tree, auth scheme, scope, verb, request schema, and whether the operation can spend money, send traffic, interrupt a call, or delete data.
2. **Read current state.** List with filters, follow pagination, and retrieve the target by immutable ID. For routes, read both the phone number and the candidate Resource/Address. For Datasphere or Call Flow objects, capture status/version fields.
   Follow every list response's `data` and the returned `links.next` URL until it is absent; the links may be relative or absolute. Prefer the server-provided URL over constructing a cursor or incrementing a page number, because concurrent creates can otherwise shift the result set. See [Paging](https://signalwire.com/docs/apis/paging).

3. **Plan a narrow change.** Compare the desired state with the read response. Preserve fields the update schema requires. Do not send a full object back to a PATCH/PUT endpoint unless its page says that is safe.
4. **Obtain explicit approval immediately before the write.** This is mandatory for purchases, releases, deletes, token/key rotation, number routing changes, dialing, message sends, recordings, external callbacks, and any other billable or destructive action. State the exact endpoint, target ID/number, payload, expected charge/impact, and rollback.
5. **Write once using the documented verb and schema.** Do not retry an unknown outcome blindly, especially for purchase, dial, send, or delete. Check whether the endpoint documents idempotency or an operation status before retrying.
6. **Re-read and observe.** Retrieve the object, follow asynchronous status, and inspect logs/webhooks. Record request time, operation ID, target ID, status, and sanitized error details.
7. **Verify routing and ownership.** Confirm that a number, Resource, Address, Project, or token belongs to the intended project tree. Leave unrelated fields and resources unchanged.

## Scoped CRUD catalog

Treat this as a navigation map, not a substitute for the live schemas.

### Projects, subprojects, and tokens (Management)

- List root and child projects: `GET /api/projects`; create a subproject: `POST /api/projects`; retrieve/update/delete one: use the exact operation under [Projects](https://signalwire.com/docs/apis/rest/projects/list-projects). The list is limited to the authenticated root and descendants.
- Create a scoped token: `POST /api/project/tokens`; the request requires a name and permissions array and can target a child `subproject_id`. Valid permissions documented by [Create API token](https://signalwire.com/docs/apis/rest/project-tokens/create-token) include `calling`, `chat`, `datasphere`, `fax`, `management`, `messaging`, `numbers`, `pubsub`, `storage`, `tasking`, and `video`.
- Update a token: `PATCH /api/project/tokens/{token_id}`; delete it through [Delete API token](https://signalwire.com/docs/apis/rest/project-tokens/delete-token). Treat deletion and permission expansion as approval-gated security changes. Store the token value only at creation time if the response provides it.
- Rotate a project's signing key only through [Rotate a project's signing key](https://signalwire.com/docs/apis/rest/projects/rotate-signing-key), after explicit approval and a coordinated consumer cutover. Do not confuse a signing key with an API token.

### Fabric Resources and Addresses

- Discover: `GET /api/fabric/resources` and `GET /api/fabric/addresses`; use `client` filtering only when the current Address operation documents it.
- Inspect: `GET /api/fabric/resources/{id}` and the type-specific get operation.
- Create/update: use the type-specific operation in [Resource Management](https://signalwire.com/docs/apis). Examples include `/api/fabric/resources/call_flows`, SWML scripts/webhooks, AI agents, conference rooms, and applications. Required scopes differ; read the operation page.
- Delete: `DELETE /api/fabric/resources/{id}` where supported, or the type-specific delete operation. Confirm no phone route, address, or live call depends on it first; deletion requires explicit approval.
- Address listing is not a generic create shortcut. Obtain an address from the documented Resource/client workflow and use the returned immutable ID.

### Native service objects

- Messaging: list/create/update or redact according to [Messages](https://signalwire.com/docs/apis/rest/messages/create-message) and message-log operations. A create queues delivery; it is an external write, not a dry run.
- Calling: use [`POST /api/calling/calls`](https://signalwire.com/docs/apis/rest/calls/call-commands) with a documented `command`; `dial` creates a call and commands such as `calling.end`, `calling.transfer`, record, stream, and AI operations affect live media. Attach status webhooks where the operation supports them.
- Video: create/list/get/update/delete rooms under [`/api/video/rooms`](https://signalwire.com/docs/apis/rest/video/rooms/create-room); manage room tokens, sessions, recordings, streams, and conferences through their linked operations. Room creation, recording, and deletion can incur cost or destroy access.
- Datasphere: list/get/create/update/delete/search documents and list/delete chunks under [`/api/datasphere/documents`](https://signalwire.com/docs/apis/rest/documents/list-documents). A document can be `submitted`, `in_progress`, `completed`, or `failed`; wait for the documented terminal state before relying on chunks/search.

## Phone numbers and routing

Phone inventory is a high-impact management surface. Use the current [Phone Number API index](https://signalwire.com/docs/apis/rest/phone-numbers/list-phone-numbers) for schemas and filters.

1. **Search before purchase.** `GET /api/relay/rest/phone_numbers/search` supports documented search filters such as area code, number type, region, city, and contains. Search results are not ownership; re-check availability immediately before any purchase.
2. **Purchase only with approval.** `POST /api/relay/rest/phone_numbers` with the exact E.164 `number` from the approved search result. A successful response includes an ID, capabilities, billing timestamps, handlers, and optional E911 association; see [Purchase phone number](https://signalwire.com/docs/apis/rest/phone-numbers/purchase-phone-number).
3. **Inspect and configure.** `GET /api/relay/rest/phone_numbers` or `/{id}`; update the documented handler fields through [Update phone number](https://signalwire.com/docs/apis/rest/phone-numbers/update-phone-number). Keep call and message handlers separate. A handler can be a webhook, LAML application, Fabric Resource, AI agent, Call Flow, or other enumerated type; never guess an enum.
4. **Route through Fabric deliberately.** To route to a Resource, use the documented phone-route operation (currently `POST /api/fabric/resources/{resource_id}/phone_routes`) with its returned `phone_route_id` and `handler` value. Re-read the number and Resource after assignment, then place a controlled test only with approval.
   Use [Assign Resource to phone route](https://signalwire.com/docs/apis/rest/phone-numbers/assign-resource-phone-route) as the current schema source; do not assume the route body or handler enum is stable across endpoint families.
5. **Manage safety and release.** E911 addresses, number groups, imported numbers, and verified caller IDs have their own `/api/relay/rest/*` operations. Release is `DELETE` and can end service; inspect dependencies and obtain explicit approval. Trial mode can prevent release for 30 days.

Do not treat a verified caller ID as a purchased sending number. The native messaging endpoint requires the `from` value to be a purchased SignalWire number or shortcode; see [Send a message](https://signalwire.com/docs/apis/rest/messages/create-message).

## Messaging and 10DLC

Use native `POST /api/messaging/messages` for new JSON messaging. It requires the Messaging scope and queues SMS/MMS or WhatsApp based on the documented `from` value. Include `to`, a purchased `from`, and `body` or `media`; include a status callback and correlation data when supported. Sending is billable/external and always requires approval.

For US A2P 10DLC, use the Campaign Registry operations under `/api/relay/rest/campaign_registry`: create/list brands, create/list/update campaigns, and create/list/delete phone-number assignments. Read current brand and campaign state before modifying an assignment. Registration and assignment changes can affect deliverability and carrier compliance; they require approval and should be followed by the documented status callback. Start with [Campaign Registry brands](https://signalwire.com/docs/apis/rest/campaign-registry/brands/create-brand), [Campaign Registry campaigns](https://signalwire.com/docs/apis/rest/campaign-registry/campaigns/create-campaign), and [Phone number assignment orders](https://signalwire.com/docs/apis/rest/campaign-registry/phone-number-assignments/create-order).

Respect account and carrier throughput. The published [Rate limits](https://signalwire.com/docs/platform/rate-limits) are Space-level: default voice throughput is 1 CPS, messaging defaults vary by number type, and API POST/PUT/PATCH is 13,800 requests per 10 seconds (GET/DELETE are described as effectively unlimited). Larger messages are segmented and each segment counts. A `429` requires backoff; do not accelerate retries.

## Calling, video, and logs

### Calling

Use native calling for new call control. The [call commands endpoint](https://signalwire.com/docs/apis/rest/calls/call-commands) is a JSON command dispatcher: `dial` creates a call, while updates, transfer, playback, recording, collection, streaming, transcription, AI sidecar, and termination act on active calls. Treat `calling.end`, transfer, recording, streaming, and AI changes as live external writes. Use documented `status_url` callbacks for asynchronous work and reconcile with voice logs.

Command dispatch and verified payload shapes:

- The request body is `{ command, params, id }`, where `id` is the target call ID. The Server SDK `client.calling.<method>(callId, params)` builds this envelope and forwards `params` verbatim — do not re-wrap a command body or translate field names.
- `calling.play`: `params = { control_id, play: [{ type: "audio", params: { url } }] }`. Each play item requires `type` plus `params.url` (audio), `params.text` (tts), or a duration/silence config. The SDK inline example that places `url` at the item level (`{ type: "audio", url }`) is stale and is rejected by the live API.
- `calling.collect`: `params = { control_id, digits: { max, digit_timeout? } }` (or `speech`). `digits.max` is required and `digit_timeout` is in **seconds**. Do not use the nested RELAY shape `collect: { start: { type: "digits", digits } }`; the REST command takes a top-level `digits`.
- `calling.record`: `params = { control_id, record: { audio: {} } }`. The `audio` fields (beep, format, stereo, direction) are optional with defaults, so `{}` is valid.
- `calling.transfer`: `params = { dest }`, where `dest` is an E.164 number, SIP URI, or inline SWML.
- `dial` accepts `params.codecs` as an array or comma-separated string of current `Calling.OutboundCallCodec` values. The current OpenAPI includes audio codecs (`OPUS` variants, `G722`, `PCMU`, `PCMA`, `G729`) and video codecs (`VP8`, `H264`). For an audio-only SIP call, offer only audio codecs; a SIP URI containing `codecs=...` overrides the top-level field, so prefer the explicit body field unless the URI override is intentional.
- Treat a successful `dial` response with status `queued` as submission only. Correlate the returned call ID with status callbacks and the voice log before claiming ringing, answer, media playback, or completion. In a verified native call, the accepted call UUID also appeared as callback `params.call_id` and was directly retrievable as the voice-log ID; confirm this relationship for the interface in use rather than assuming it across API families.
- A native terminal state callback uses `event_type: "calling.call.state"` and places call details under `params`. Parse it additively: require only fields your application needs, preserve unknown fields, and use `call_state`, `end_reason`, and the voice log as the authoritative terminal evidence.
- A `2xx` response to an active-call command proves command acceptance, not media effect. The endpoint can return the call object already in `status: "ended"` when Play, Collect, or End targets a call that ended between dispatch and execution. Require an answered/in-progress state plus the operation's callback, event, or media evidence before claiming the command affected the call.
- When a command targets a call that has transitioned to `status: "failed"`, the API still returns HTTP 200 with the current call object. Check `response.status` after every command; `"failed"` means the call will not progress regardless of subsequent commands.
- `failure_reason` (e.g. `"spam_blocked"`) is **Dashboard-only**: it does not appear in the REST command-dispatch response body, the Voice Logs API (`GET /api/voice/logs/{id}`), the Voice Log Events API, or any status callback. A call blocked by SignalWire's anti-spam filter transitions from `queued` directly to `failed` and never fires `created`, `ringing`, `answered`, or `ended` status callbacks. The only programmatic signal of the failure is the `status: "failed"` field in subsequent command responses.
- For an unanswered terminal callback, `answer_time: 0` plus `end_reason: "busy"` or `"decline"` and `end_source: "inbound"` identifies a far-end rejection at the provider-callback layer. Preserve the raw SIP response or PBX trace before attributing the rejection to a particular device, proxy, or carrier.

### Video

Use `/api/video` for rooms, room tokens, sessions, recordings, streams, and conferences. Create a Room Token on the server and pass only that short-lived client token to a browser or mobile client. Use fine-grained room permissions from [Permissions](https://signalwire.com/docs/apis/permissions), not an all-powerful server credential. Read the current schemas for room limits, layouts, recording, and removal fields before creating or updating a room.

### Logs and observability records

Use logs for reconciliation rather than treating a `2xx` create response as delivery. The API index links current operations for:

- Voice logs and voice log events: [`/api/voice/logs`](https://signalwire.com/docs/apis/rest/voice-logs/list-voice-logs.md).
- Message logs: [`/api/messaging/logs`](https://signalwire.com/docs/apis/rest/message-logs/list-message-logs.md).
- Video logs: [`/api/relay/rest/video_logs`](https://signalwire.com/docs/apis/rest/video-logs/list-logs.md).
- Conference and fax logs: their `/api/relay/rest/*_logs` operations.

Filter by the documented created-before/created-on/created-after fields, page through links, and persist the returned ID and status. Correlate logs with your own request ID, call/message ID, phone number, Project ID, and callback event. Redact tokens, authorization headers, and sensitive message or recording content from application logs.

Verified log shapes: list endpoints return `{ links, data: [ … ] }` and accept `created_after`, `created_before`, `created_on`, `page_size` (default 50, max 1000), and `page_number`/`page_token`. A message-log entry exposes `id`, `from`, `to`, `status`, `direction`, `kind`, `source`, `type`, `created_at` (ISO 8601), `error_code`, and `error_message`; a voice-log entry exposes `id`, `from`, `to`, `status`, `created_at`, with events at `/{id}/events`. When correlating a Compatibility message SID to a native log, retrieve the SID (`GET /api/laml/2010-04-01/Accounts/{ProjectId}/Messages/{Sid}`) for its `from`, `to`, and `date_sent`/`date_created` (**RFC 2822** — normalize before comparing to the native ISO-8601 `created_at`), then query message logs by a date window and match `from`/`to` exactly. A non-2xx response surfaces in the SDK as a `RestError` carrying `statusCode`, `body`, `url`, and `method`; a 404 may be a `{code,message,status,more_info}` object (Compatibility) or a plain `"Not Found"` string (native), so classify by HTTP status.

## Datasphere, AI, call flows, and SWML

- **Datasphere:** Use the native `/api/datasphere/documents` operations for upload/list/get/update/delete/search and chunk inspection. Ingestion is asynchronous, so poll only as documented or consume the completion signal; do not delete a failed/in-progress document without approval. Verified search shapes: `POST /api/datasphere/documents/search` takes `{ query_string, count?, document_id?, tags?, distance?, language? }` with `query_string` **required** (`count` defaults to 5; the SDK doc-comment example `{ query, limit }` is rejected with 422) and returns `{ chunks: [{ text, document_id }] }` — each chunk carries **only** `text` and `document_id` (there is no `chunk_id`, `chunk_text`, `content`, or `score`). List and get use the standard `{ links, data }` envelope.
- **AI agents:** Manage AI agents as Fabric Resources through the AI-agent type operations in the API index. Read the generated Resource and Address IDs; configure voice, language, tools, and SWAIG fields according to the endpoint schema. Do not embed provider secrets in a Resource payload unless the current docs explicitly require a secret reference.
- **Call Flows:** Create and manage Call Flows at `/api/fabric/resources/call_flows`; versions and deployment are separate operations. Read the current version and address before deploying. Deployment changes live behavior and requires approval. See [Create call flow](https://signalwire.com/docs/apis/rest/call-flows/create-call-flow).
- **SWML:** Use SWML `1.0.0` objects as documented by [SWML](https://signalwire.com/docs/swml) and the [calling reference](https://signalwire.com/docs/swml/reference/calling). Store SWML scripts/webhooks as type-specific Fabric Resources when you need managed addresses. Validate the current schema and keep external SWAIG tools authenticated and idempotent.
- **Compatibility fallback:** Do not convert native SWML/Call Flow payloads to XML/TwiML unless the application intentionally targets the Compatibility API.

## Safe clients

### Safe curl baseline

Use environment variables, `--fail-with-body`, bounded timeouts, and JSON output. This example only reads; it must not print secrets:

```bash
set -euo pipefail
: "${SIGNALWIRE_SPACE:?set SIGNALWIRE_SPACE}"
: "${SIGNALWIRE_PROJECT_ID:?set SIGNALWIRE_PROJECT_ID}"
: "${SIGNALWIRE_API_TOKEN:?set SIGNALWIRE_API_TOKEN}"

curl --fail-with-body --silent --show-error --connect-timeout 5 --max-time 30 \
  "https://${SIGNALWIRE_SPACE}/api/projects?page_size=50" \
  --user "${SIGNALWIRE_PROJECT_ID}:${SIGNALWIRE_API_TOKEN}" \
  -H 'Accept: application/json'
```

For a mutation, first show the exact request and payload, obtain explicit approval, then add `-X`/`-d` and record the response. Never place a real token, phone number, callback secret, or media URL in a committed example. Never run purchase, release, delete, rotate, dial, send, route, or deploy commands as a speculative probe.

### Python RestClient pattern

Install the current `signalwire-sdk` package and re-open the [Python REST reference](https://signalwire.com/docs/server-sdks/reference/python/rest) for the installed version. Keep credentials server-side and use the SDK's structured error object. Import the REST client from `signalwire.rest`:

```python
import os
from signalwire.rest import RestClient, SignalWireRestError

client = RestClient(
    project=os.environ["SIGNALWIRE_PROJECT_ID"],
    token=os.environ["SIGNALWIRE_API_TOKEN"],
    host=os.environ["SIGNALWIRE_SPACE"],
)

try:
    page = client.logs.voice.list(page_size=50)
    for entry in page.get("data", []):
        print(entry["id"], entry["status"])
except SignalWireRestError as exc:
    # Preserve status and sanitized body; do not log Authorization headers.
    print(f"HTTP {exc.status_code} {exc.method} {exc.url}")
    raise
```

SDK namespaces and method names can differ from raw paths. Use the installed SDK reference and inspect the raw operation when a namespace is absent; do not silently switch to the Compatibility client.

### TypeScript RestClient pattern

Use the ESM-only `@signalwire/sdk` package and keep this code on a trusted server. The [TypeScript REST reference](https://signalwire.com/docs/server-sdks/reference/typescript/rest) documents the current constructor, namespaces, and `RestError` fields:

```ts
import { RestClient, RestError } from "@signalwire/sdk";

const client = new RestClient({
  project: process.env.SIGNALWIRE_PROJECT_ID!,
  token: process.env.SIGNALWIRE_API_TOKEN!,
  host: process.env.SIGNALWIRE_SPACE!,
});

try {
  const page = await client.logs.voice.list({ pageSize: 50 });
  for (const entry of page.data ?? []) {
    console.log(entry.id, entry.status);
  }
} catch (error: unknown) {
  if (error instanceof RestError) {
    console.error(`HTTP ${error.statusCode} ${error.method} ${error.url}`);
  }
  throw error;
}
```

Use `page.links.next` (or the SDK's documented iterator) rather than inventing `pageNumber + 1`. Never bundle this server client into a browser application; mint a short-lived Bearer, Room, Chat, or Subscriber token instead.

## Observability and failure handling

1. Record a sanitized request fingerprint: family, operation ID, HTTP verb, path template, Project ID, target ID, and timestamp. Omit Basic/Bearer values and secrets.
2. On `2xx`, persist the returned ID and status. A queued message, call, recording, or Datasphere document is not necessarily complete.
3. On `400`, fix malformed JSON or missing fields. On `401`, verify credentials, Project ID, Space hostname, token expiry, and scope. On `403`, confirm the operation's permission and project tree. On `404`, confirm the ID belongs to the authenticated project. On `422`, iterate every item in the `errors` array and fix the named attribute.
4. On `429`, honor `Retry-After` when present and apply bounded exponential backoff with jitter. Also inspect the response's current limit/remaining headers and Space-level voice/messaging backlog; do not retry a billable write blindly.
5. On `5xx` or a network timeout, retry only operations that the endpoint documents as safe or whose idempotency you can prove. For an unknown purchase/send/dial outcome, list or retrieve first and reconcile logs before another write.
6. Native errors commonly look like `{ "errors": [{ "type", "code", "message", "attribute", "url" }] }`; `/api/relay/rest` can use `{ "errors": [{ "detail", "status", "title", "code" }] }`; some endpoint schemas return `{ "error": "Unauthorized" }`. See [Error codes](https://signalwire.com/docs/apis/error-codes) and the exact operation response schema.
7. Keep a dead-letter/reconciliation path for failed callbacks, incomplete async jobs, and orphaned routes. Alert on auth failures, rising `429`/`5xx`, queue age, delivery failures, unexpected billable volume, and token-scope changes.

### Trial mode guardrails

New accounts start in Trial Mode. The [Trial Mode guide](https://signalwire.com/docs/platform/trial-mode) limits calls/messages to purchased and verified numbers, limits total numbers and queued traffic, blocks international calling/SMS, and may prevent release for 30 days. Add at least `$5` of credit to leave Trial Mode as documented; do not attempt to bypass these controls. Run a non-billable read and confirm the Space status before planning a production smoke test.

## Primary sources

- [SignalWire API index](https://signalwire.com/docs/apis)
- [OpenAPI 3.1 JSON](https://signalwire.com/openapi.json) and [YAML](https://signalwire.com/openapi.yaml)
- [Authorization](https://signalwire.com/docs/apis/authorization)
- [Base URL](https://signalwire.com/docs/apis/base-url)
- [Data formats](https://signalwire.com/docs/apis/data-formats)
- [Paging](https://signalwire.com/docs/apis/paging)
- [Error codes](https://signalwire.com/docs/apis/error-codes)
- [Permissions](https://signalwire.com/docs/apis/permissions)
- [API credentials](https://signalwire.com/docs/platform/your-signalwire-api-space)
- [Rate limits](https://signalwire.com/docs/platform/rate-limits)
- [Trial mode](https://signalwire.com/docs/platform/trial-mode)
- [List projects](https://signalwire.com/docs/apis/rest/projects/list-projects)
- [Create API token](https://signalwire.com/docs/apis/rest/project-tokens/create-token)
- [List Resources](https://signalwire.com/docs/apis/rest/resources/list-resources)
- [Purchase phone number](https://signalwire.com/docs/apis/rest/phone-numbers/purchase-phone-number)
- [Send a message](https://signalwire.com/docs/apis/rest/messages/create-message)
- [Send call commands](https://signalwire.com/docs/apis/rest/calls/call-commands)
- [Create room](https://signalwire.com/docs/apis/rest/video/rooms/create-room)
- [List documents](https://signalwire.com/docs/apis/rest/documents/list-documents)
- [Create call flow](https://signalwire.com/docs/apis/rest/call-flows/create-call-flow)
- [Python REST reference](https://signalwire.com/docs/server-sdks/reference/python/rest)
- [TypeScript REST reference](https://signalwire.com/docs/server-sdks/reference/typescript/rest)
- [Compatibility API overview](https://signalwire.com/docs/compatibility-api)
