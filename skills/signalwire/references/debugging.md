# SignalWire debugging runbook

Use this runbook to reproduce and isolate failures across REST, routing, SWML/cXML webhooks, Agents/SWAIG, Browser SDK/WebRTC, messaging, calling, and SIP. Start with one failed journey and one correlation identifier. Do not change several boundaries at once.

> **Evidence rule:** Separate observed facts from hypotheses. Redact API tokens, signing keys, SATs, SIP credentials, message bodies, transcripts, recordings, and unrelated traffic. Obtain approval before placing billable test traffic, changing a live route, rotating credentials, or sharing captures externally.

## Contents

- [Classify the first failing boundary](#classify-the-first-failing-boundary)
- [Capture a minimal evidence set](#capture-a-minimal-evidence-set)
- [Diagnose REST and resource management](#diagnose-rest-and-resource-management)
- [Diagnose routing](#diagnose-routing)
- [Diagnose SWML and cXML webhooks](#diagnose-swml-and-cxml-webhooks)
- [Diagnose Agents and SWAIG](#diagnose-agents-and-swaig)
- [Diagnose Browser SDK and WebRTC](#diagnose-browser-sdk-and-webrtc)
- [Diagnose messaging](#diagnose-messaging)
- [Diagnose calling and media](#diagnose-calling-and-media)
- [Hand off SIP failures](#hand-off-sip-failures)
- [Build an escalation bundle](#build-an-escalation-bundle)
- [Primary sources](#primary-sources)

## Classify the first failing boundary

Draw the actual journey and mark the first transition with contrary evidence:

```text
caller/client
  -> phone number, Fabric address, or API request
  -> assigned resource/handler
  -> SWML/cXML/Agent/RELAY execution
  -> tool, callback, browser, carrier, or PBX
  -> final status and platform log
```

| Symptom | First evidence to collect | Do not assume |
| --- | --- | --- |
| REST request fails | HTTP status, sanitized path, Project/Space, error body, scope | That all `/api/*` families share schemas or errors |
| Number rings wrong target | Number ID/phone route, assigned Resource ID/type, handler | That display names imply ownership or routing |
| Webhook never runs | Platform log/event, public URL, DNS/TLS, access log | That local success proves SignalWire reachability |
| SWML/cXML parse failure | Raw response bytes, status, content type, schema/XML parse | That a `2xx` or browser-rendered page is valid instructions |
| SWAIG function is not called | Generated SWML, tool name/schema, conversation/debug events | That prompt wording alone guarantees tool selection |
| Browser cannot call | SAT type/expiry, `errors$`, readiness/registration, destination | That media permissions are the cause |
| Call connects without media | Track attachment, ICE state, SDP/candidate pair, RTC stats | That opening broad firewall ranges will fix it |
| SIP route fails | Voice log/event ID, raw SIP response, rejecting hop | That a FreeSWITCH cause is the original wire error |

Change only the owner of the failed boundary, then repeat the same scenario.

## Capture a minimal evidence set

For every reproduction, record:

- Space hostname and Project ID with sensitive portions redacted;
- UTC start/end time and local timezone;
- direction, source/destination in a permitted redacted form, and expected route;
- immutable phone/resource/address/route IDs;
- call segment ID, message ID, room/session ID, or API operation/response ID;
- application release/package versions and configuration revision;
- HTTP status and sanitized structured error;
- callbacks/log events in timestamp order;
- the exact test command or user action and observed result.

Use one identifier to correlate application logs, SignalWire Dashboard logs, REST log APIs, webhook access logs, browser diagnostics, and SIP captures. Do not paste entire unredacted payloads when a field-level excerpt proves the issue.

## Diagnose REST and resource management

### Reproduce with a read

Verify host/auth without creating traffic:

```bash
curl --fail-with-body --silent --show-error \
  --connect-timeout 5 --max-time 30 \
  "https://$SIGNALWIRE_SPACE/api/projects?page_size=1" \
  --user "$SIGNALWIRE_PROJECT_ID:$SIGNALWIRE_API_TOKEN" \
  --header 'Accept: application/json'
```

Set `SIGNALWIRE_SPACE` to the full host such as `example.signalwire.com`. Never print the command with expanded credentials.

### Interpret the boundary

1. Confirm HTTPS and the exact Space hostname. Plain HTTP is rejected.
2. Confirm the Project ID belongs to the Space and the API token is active.
3. Open the exact endpoint page and confirm required token scope, HTTP verb, path family, content type, request fields, and enum casing.
4. On `400`/`422`, inspect every structured error item and its `attribute`; do not discard the response body.
5. On `401`, verify credentials, expired Bearer token, and endpoint auth scheme. Token scope can also surface as unauthorized according to the endpoint docs.
6. On `403`, verify permission and Project tree ownership.
7. On `404`, retrieve/list in the same Project before assuming deletion.
8. On `429`, honor `Retry-After` when supplied and inspect current limit/remaining headers. Back off; do not retry a billable write blindly.
9. On timeout/`5xx`, reconcile list/log state before repeating create, purchase, send, dial, or delete. An unknown result is not proof that the write failed.
10. Follow `links.next` from list responses instead of inventing a page cursor.

Compare the response to [Authorization](https://signalwire.com/docs/apis/authorization.md), [Base URL](https://signalwire.com/docs/apis/base-url.md), [Paging](https://signalwire.com/docs/apis/paging.md), [Error codes](https://signalwire.com/docs/apis/error-codes.md), and the endpoint's embedded OpenAPI.

## Diagnose routing

Trace immutable relationships:

1. Retrieve the phone number by ID and inspect voice/messaging handlers.
2. Retrieve its phone route and assigned Resource ID/type.
3. Retrieve the Resource and its Address(es).
4. Inspect the resource's handler URL, deployed version, SIP relationship, or application route.
5. Confirm each object belongs to the intended Project.
6. Confirm the entry channel matches the handler (`calling` versus `messaging`).
7. Re-read after an approved change, then run one controlled test.

A number can be purchased but unassigned; a Resource can exist without an Address or phone route; an agent can run at a URL that no live number uses. Diagnose each fact independently. Use [Resources](https://signalwire.com/docs/platform/resources.md), [Phone numbers](https://signalwire.com/docs/platform/phone-numbers.md), and [Assign Resource to phone route](https://signalwire.com/docs/apis/rest/phone-numbers/assign-resource-phone-route.md).

## Diagnose SWML and cXML webhooks

### Prove the HTTP contract

Capture the exact response SignalWire receives:

- final URL after redirects;
- TLS and DNS result;
- request method and authenticated route;
- response status, latency, `Content-Type`, and raw body;
- proxy-added path/prefix and externally visible host/protocol;
- fallback request and retry timestamps where documented.

For SWML, parse the response as JSON/YAML and verify `version: "1.0.0"`, `sections.main`, and flavor-specific methods. Return `application/json`, `application/yaml`, or `text/x-yaml`. Do not serve an HTML error page with status `200`.

For cXML, require well-formed XML rooted at `<Response>` and the correct XML content type. Escape dynamic values. Return `<Response/>` for an intentionally empty valid response.

### Use the documented compatibility error codes

The [Common webhook errors](https://signalwire.com/docs/compatibility-api/guides/common-webhook-errors.md) guide maps these errors:

| Code | Meaning | Check first |
| --- | --- | --- |
| `11200` | Retrieval error/timeout or gateway failure | Public reachability, DNS, response latency, auth wall, and content type |
| `12100` | Document parse error | XML structure, case-sensitive tags, and builder serialization |
| `11251` | Fatal protocol violation | HTTP/HTTPS mismatch and proxy scheme |
| `111215` | Too many redirects | Redirect loop or more than the supported chain |
| `11750` | XML response exceeds 64 KB | Accidental HTML/debug output and response size |

Do not apply these cXML codes to a native REST validation failure unless the log explicitly reports them.

### Validate signatures without mutating input

- Capture raw request bytes before JSON/form parsing when the SDK validator requires them.
- Supply the exact externally visible URL expected by the current validator.
- Trust forwarded host/protocol headers only from configured proxies.
- Use the project's signing key, not the API token.
- Reject invalid signatures before business logic.
- Diagnose tunnel URL rewriting; do not disable validation in production.

See [Webhook security](https://signalwire.com/docs/compatibility-api/guides/webhook-security.md) and [Python webhook validation](https://signalwire.com/docs/server-sdks/reference/python/core/security.md).

## Diagnose Agents and SWAIG

Work from generated artifacts to the model interaction:

1. Render the generated SWML and confirm prompt, language, AI params, tool names, JSON Schemas, function URLs, and auth.
2. List tools and execute each handler locally with valid, missing, malformed, unauthorized, and repeated arguments.
3. Confirm the tool description tells the model exactly when to use it and the prompt does not contradict it.
4. Confirm argument names/types match between schema and handler.
5. Confirm the SWAIG endpoint is publicly reachable over HTTPS and protected by the SDK's Basic Auth/function token flow.
6. Bound backend timeout and response size. Return `FunctionResult` with a model-facing response even on a safe failure.
7. Make writes idempotent and authorize them against call/session data; never trust a model-supplied account ID by itself.
8. Inspect post-prompt/debug events and application logs with sensitive conversation data redacted.

Use the Python CLI before a billable call:

```bash
swaig-test <agent-file> --dump-swml
swaig-test <agent-file> --list-tools
swaig-test <agent-file> --exec <tool-name>
```

Use the agent's protected `/debug` route only in controlled development. Enable `enable_debug_events(level=1)` to capture high-level events; raise verbosity briefly for a targeted reproduction and remove debug routes/native debug functions before production. See [Testing](https://signalwire.com/docs/server-sdks/guides/testing.md), [Troubleshooting](https://signalwire.com/docs/server-sdks/guides/troubleshooting.md), and [debug events](https://signalwire.com/docs/server-sdks/reference/python/agents/agent-base/enable-debug-events.md).

## Diagnose Browser SDK and WebRTC

Separate credential/session, signaling, device, attachment, and transport failures:

1. Subscribe to `client.errors$` and `client.warnings$` before constructing the user journey.
2. Observe `ready$`, `isConnected$`, and `isRegistered$`; do not collapse them into one "online" flag.
3. Verify SAT type, expiry, refresh outcome, and allowed destination. A Guest/Invite/embed token cannot receive inbound calls.
4. Confirm the destination is a valid public/private Fabric address, E.164 number, or supported SIP URI for that token.
5. Confirm the page is HTTPS/localhost and browser media permission is granted.
6. Enumerate devices after permission; confirm selected tracks are live.
7. Confirm `localStream$`/`remoteStream$` tracks are attached to media elements and autoplay was not blocked.
8. Inspect browser Network -> WebSocket frames for disconnect/auth evidence.
9. Inspect `iceConnectionState`, candidate pair, and `getStats()` packet counters/loss/jitter/codec.
10. Run `client.preflight()` and export `client.exportDiagnostics()`. Redact tokens and user data before sharing.
11. Reproduce in another supported browser/network only to separate environment-specific behavior; do not call that a fix.

For one-way/no media, compare offered tracks, selected candidates, RTP packet direction, and audio output device. A connected WebSocket does not prove ICE/media; an ICE connection does not prove the element is attached or allowed to autoplay. See [Browser troubleshooting](https://signalwire.com/docs/browser-sdk/v4/guides/troubleshooting.md) and [RxJS primer](https://signalwire.com/docs/browser-sdk/v4/guides/rxjs-primer.md).

## Diagnose messaging

1. Retrieve the message log by returned message ID and correlate the status callback.
2. Verify `to` and `from` E.164 formatting and that `from` is an allowed SignalWire number/short code/WhatsApp sender for the endpoint.
3. Confirm Messaging scope, balance, Trial Mode, geographic permission, number capabilities, and channel-specific registration.
4. For US A2P traffic, inspect Brand, Campaign, and phone-number assignment status. Do not treat an accepted API request as carrier delivery.
5. Inspect message status, direction, segments, error fields, charge details, and timestamps.
6. Confirm callback URL/signature handling and return a quick valid response.
7. Account for segmentation and Space/carrier MPS limits; do not flood retries after `429` or a carrier rejection.
8. Distinguish platform rejection, queued delivery, carrier rejection, handset filtering, opt-out, and unsupported media.

Use [Message logs](https://signalwire.com/docs/apis/rest/message-logs/list-message-logs.md), [Send a message](https://signalwire.com/docs/apis/rest/messages/create-message.md), [Campaign Registry](https://signalwire.com/docs/platform/messaging/campaign-registry.md), [SMS best practices](https://signalwire.com/docs/platform/messaging/sms-best-practices.md), and [Rate limits](https://signalwire.com/docs/platform/rate-limits.md).

## Diagnose calling and media

Use the call segment/log ID as the primary correlation key:

1. Retrieve `GET /api/voice/logs/{id}` and `/events`.
2. Compare direction, `from`, `to`, type, status, duration, charge details, and event timestamps.
3. Confirm the phone route/Resource and application release active at that time.
4. Correlate status callbacks, recordings/transcriptions/streams, and tool events.
5. Identify the first state transition that did not occur: created, queued, initiated, ringing, answered/in-progress, completed/ended.
6. On busy/no-answer/failed, preserve the downstream status/cause and rejecting hop.
7. On audio problems, prove media attachment/SDP/RTP direction before changing codecs, encryption, or firewall rules.
8. On machine detection, transcription, recording, or streaming problems, inspect the specific callback and method page instead of only the final call status.

Read [Voice logs](https://signalwire.com/docs/apis/rest/voice-logs/list-voice-logs.md), [Voice log events](https://signalwire.com/docs/apis/rest/voice-logs/list-voice-log-events.md), [Call commands](https://signalwire.com/docs/apis/rest/calls/call-commands.md), and the specific SWML method/callback page.

## Hand off SIP failures

Load [sip-trunking.md](sip-trunking.md) and follow its full ladder. At minimum:

- identify SIP Profile, modern SIP Credential/Address/Gateway/Domain Application, and any legacy endpoint;
- capture the raw SIP response and identify the rejecting hop;
- compare effective transport, TLS/SRTP policy, codec/cipher intersection, and SDP;
- resolve the current SignalWire service DNS names instead of using a permanent IP list;
- derive media capture filters from negotiated SDP and environment configuration—SignalWire does not publish a universal RTP range;
- label `sofia`, `fs_cli`, and Q.850 interpretations as FreeSWITCH-specific;
- retain both the raw SIP status and any translated hangup cause.

Do not open broad port ranges or downgrade encryption as a speculative fix.

## Build an escalation bundle

Include only the evidence needed for one failing interaction:

1. business impact and exact expected/observed result;
2. Space/Project and resource graph with secrets redacted;
3. UTC interval, direction, source/destination, and reproducibility;
4. call/message/resource IDs and Dashboard log link;
5. sanitized REST errors, log events, and callbacks in timestamp order;
6. application/package/browser/PBX versions and deployment revision;
7. generated SWML/cXML or relevant fragment;
8. Browser diagnostics/RTC stats or a redacted SIP ladder/PCAP when relevant;
9. DNS/TLS/proxy/firewall observations with collection point and time;
10. changes already attempted and the observation that confirmed or rejected each hypothesis.

Ask SignalWire Support, a carrier, or PBX vendor to identify the failing transaction and boundary. Do not send credentials, broad traffic captures, unrelated customer data, or unredacted recordings/transcripts.

## Primary sources

- [SignalWire API index](https://signalwire.com/docs/apis/llms.txt)
- [Authorization](https://signalwire.com/docs/apis/authorization.md)
- [Error codes](https://signalwire.com/docs/apis/error-codes.md)
- [Paging](https://signalwire.com/docs/apis/paging.md)
- [Platform webhooks](https://signalwire.com/docs/platform/webhooks.md)
- [SWML errors](https://signalwire.com/docs/swml/reference/errors.md)
- [SWML deployment](https://signalwire.com/docs/swml/guides/deployment.md)
- [Common webhook errors](https://signalwire.com/docs/compatibility-api/guides/common-webhook-errors.md)
- [Webhook security](https://signalwire.com/docs/compatibility-api/guides/webhook-security.md)
- [Agent testing](https://signalwire.com/docs/server-sdks/guides/testing.md)
- [Agent troubleshooting](https://signalwire.com/docs/server-sdks/guides/troubleshooting.md)
- [Browser troubleshooting](https://signalwire.com/docs/browser-sdk/v4/guides/troubleshooting.md)
- [Message logs](https://signalwire.com/docs/apis/rest/message-logs/list-message-logs.md)
- [Voice logs](https://signalwire.com/docs/apis/rest/voice-logs/list-voice-logs.md)
- [Voice log events](https://signalwire.com/docs/apis/rest/voice-logs/list-voice-log-events.md)
- [SIP trunking](https://signalwire.com/docs/platform/voice/sip/trunking.md)
- [Firewall guidance](https://signalwire.com/docs/platform/allow-signalwire-ips-through-your-firewall.md)
