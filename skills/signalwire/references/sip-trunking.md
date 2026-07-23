# SignalWire SIP trunking

Use this reference to design, configure, and diagnose a SignalWire SIP integration without mixing the current Fabric resources with compatibility-era SIP endpoints. Keep the SignalWire Space hostname in the form `https://{space}.signalwire.com`.

> **Re-open the current endpoint `.md` page and its embedded OpenAPI before coding.** SignalWire evolves request fields, enum values, permissions, and resource relationships. Treat the links in this guide as entry points, not as a frozen schema.

> **Approval gate:** Obtain explicit approval immediately before any external write. This includes creating or updating resources, assigning or unassigning routes, purchasing or releasing phone numbers, deleting resources, rotating API tokens/keys or SIP passwords, and uploading a packet capture to a third party. Use placeholders and environment variables; never put real secrets in examples, tickets, or captures.

## Contents

- [Architecture and resource boundaries](#architecture-and-resource-boundaries)
- [Configure a modern SIP path](#configure-a-modern-sip-path)
- [Route inbound and outbound calls](#route-inbound-and-outbound-calls)
- [Authenticate and secure each leg](#authenticate-and-secure-each-leg)
- [Use a device template](#use-a-device-template)
- [FreePBX and FusionPBX caveats](#freepbx-and-fusionpbx-caveats)
- [Diagnose from logs to packets](#diagnose-from-logs-to-packets)
- [Interpret SIP responses and Q.850 causes](#interpret-sip-responses-and-q850-causes)
- [Set DNS, firewall, and NAT evidence boundaries](#set-dns-firewall-and-nat-evidence-boundaries)
- [Build an escalation bundle](#build-an-escalation-bundle)
- [Primary sources](#primary-sources)

## Architecture and resource boundaries

Model the call path before creating anything. Keep these current resources separate:

| Resource | What to use it for | Current API surface |
| --- | --- | --- |
| **SIP Profile** | Project-level SIP domain and defaults for codecs, SRTP ciphers, encryption, and `default_send_as`. | `GET`/`PUT` `/api/relay/rest/sip_profile`; see [SIP Profile API](https://signalwire.com/docs/apis/rest/sip-profile/retrieve-sip-profile.md) and [update SIP Profile](https://signalwire.com/docs/apis/rest/sip-profile/update-sip-profile.md). |
| **SIP Credential** | A username/password SIP resource for a registering PBX, phone, softphone, or application. | Two live surfaces: modern `/api/fabric/resources/sip_endpoints` and legacy `/api/relay/rest/endpoints/sip` (the trunking guide's `password` path). They return **different IDs** for the same credential — never intermix them. See [Create SIP Credential](https://signalwire.com/docs/apis/rest/sip-credentials/create-sip-credential.md). |
| **SIP Address** | A Fabric address for reaching a resource, including optional IP/CIDR authentication, codecs, ciphers, and encryption policy. | `POST` `/api/fabric/sip_addresses`; see [Create SIP Address](https://signalwire.com/docs/apis/rest/sip-addresses/create-sip-address.md). |
| **SIP Gateway** | A resource that routes an outbound call to an external SIP URI. | `POST` `/api/fabric/resources/sip_gateways`; see [Create SIP Gateway](https://signalwire.com/docs/apis/rest/sip-gateway/create-sip-gateway.md). |
| **Domain Application** | A custom SIP domain for inbound carrier/BYOC traffic and a handler such as SWML, RELAY, Call Flow, or another supported application. | `POST` `/api/relay/rest/domain_applications`; see [Create Domain Application](https://signalwire.com/docs/apis/rest/domain-applications/create-domain-application.md) and [SIP Domain Applications](https://signalwire.com/docs/platform/voice/sip/domain-applications.md). |

Use this mental model:

```text
PSTN DID -> phone route -> assigned Fabric resource -> SIP Credential/device
                                             \-> SWML, Call Flow, RELAY, or another handler
PBX REGISTER + digest credentials -> SIP Credential -> SIP Profile domain
PBX IP-authenticated SIP -> SIP Address -> assigned calling handler resource
Carrier inbound SIP -> Domain Application + carrier IP allowlist -> handler
SWML/Calling API/Relay SDK -> SIP URI or SIP Gateway -> external SIP carrier
```

### Do not conflate modern and legacy resources

- Use **SIP Credential** in new designs. The current Fabric API is `POST /api/fabric/resources/sip_endpoints`; verified live it accepts a minimal body (e.g. `{ username, caller_id, encryption }`) and returns HTTP 201 with a server-generated `id` and default `codecs`, `ciphers`, and `call_handler`. The [Create SIP Credential OpenAPI](https://signalwire.com/docs/apis/rest/sip-credentials/create-sip-credential.md) marks `id`, `send_as`, `ciphers`, `codecs`, `call_handler`, and `calling_handler_resource_id` as required, but the live API treats them as optional-with-defaults — do not be deterred by that list.
- `/api/relay/rest/endpoints/sip` is the **legacy surface the [SIP trunking guide](https://signalwire.com/docs/platform/voice/sip/trunking.md) still uses**, and it is live. It is the only documented programmatic path that takes a SIP `password` on create. Use it when you must provision a password via API or when migrating an existing legacy resource; otherwise prefer the modern Fabric endpoint.
- The two surfaces are **not ID-compatible**. The modern response nests config under `sip_endpoint` (`{ id, project_id, display_name, type, sip_endpoint: { id, username, caller_id, send_as, ciphers, codecs, encryption, call_handler, calling_handler_resource_id } }`); its outer Fabric `id` differs from the inner `sip_endpoint.id`, which equals the legacy API's `id`. Pass whichever id shape the receiving phone-route/assignment API expects.
- A SIP **password is write-only** on both surfaces (never returned). Store it at creation; set or rotate it through the Dashboard or the legacy endpoint's documented `password` field.
- Do not use “SIP Address,” “SIP Gateway,” “Domain Application,” and “SIP Credential” interchangeably. They have different ownership, authentication, routing, and handler relationships.
- Treat a SIP Profile's `domain` as the source of truth for the SIP host. Do not invent a hostname from a resource display name.

## Configure a modern SIP path

### 1. Establish the project and authentication boundary

1. Set `SPACE_HOST=https://{space}.signalwire.com`, `PROJECT_ID`, and a narrowly scoped server `API_TOKEN` in the deployment secret store.
2. Use REST Basic Auth as `Project ID:scoped API token`; do not put that token in a phone, browser, or SIP device. See [SignalWire Authorization](https://signalwire.com/docs/apis/authorization.md).
3. Use short-lived Bearer tokens for client-side Fabric applications where the API requires them; do not mistake a Bearer token for a SIP username/password. The same authorization reference documents the Bearer boundary.
4. Verify the token scope required by each endpoint. Expect `401` for invalid credentials and `403` for insufficient scope; inspect the structured error body in [API error codes](https://signalwire.com/docs/apis/error-codes.md).
5. Before a mutating request, record the intended resource, diff, and approver. Run the request only after approval.

### 2. Read the SIP Profile first

1. `GET $SPACE_HOST/api/relay/rest/sip_profile` with Basic Auth.
2. Record `domain`, `domain_identifier`, `default_codecs`, `default_ciphers`, `default_encryption`, and `default_send_as`.
3. Compare those defaults with the selected resource. An endpoint or gateway can override profile defaults; resolve the effective policy from the resource response and current OpenAPI schema rather than assuming inheritance.
4. Change profile defaults only through an approved, reviewed update. Treat a profile change as a fleet-wide change because multiple resources may use it.

### 3. Create or inspect the SIP Credential

Use the modern **SIP Credential** API resource:

```text
POST $SPACE_HOST/api/fabric/resources/sip_endpoints
GET  $SPACE_HOST/api/fabric/resources/sip_endpoints
```

1. The modern create works with a minimal body. Verified live, `POST /api/fabric/resources/sip_endpoints` with `{ username, caller_id, encryption }` returns HTTP 201 and auto-generates the `id`, `send_as`, `codecs`, `ciphers`, and `call_handler` defaults — even though the OpenAPI marks those as required. Supply only the fields you care about; do not pad the request with the legacy curl's fields.
2. The SIP **password** is the one field the modern OpenAPI omits, and it is never returned by either surface. To provision a password programmatically, use the live legacy endpoint (`POST /api/relay/rest/endpoints/sip` with `password`, as the trunking guide shows); otherwise set it in the Dashboard. Do not rely on sending an undocumented `password` to the modern endpoint.
3. When the Dashboard or an existing credential workflow provisions a SIP password, generate and store it in the secret manager. Never log it or copy it into a ticket.
4. Set `caller_id`/`send_as` only to an identity permitted by the project and route.
5. Select non-empty `codecs` and `ciphers` that the device actually supports.
6. Set `encryption` deliberately (`default`, `required`, or `optional` in the credential schema); do not silently downgrade a required policy.
7. Decide the outbound `call_handler`: use the current schema's `default`, `passthrough`, `block-pstn`, or `resource` behavior as appropriate, and supply `calling_handler_resource_id` only when the schema requires it.
8. Save the returned resource ID and SIP domain.

### 4. Create a SIP Address for IP-authenticated traffic

Use [Create SIP Address](https://signalwire.com/docs/apis/rest/sip-addresses/create-sip-address.md) when the design calls for a Fabric SIP address rather than a registering credential.

1. Choose a URL-safe `name` and, if needed, a specific `user`; `*` accepts any username according to the current schema.
2. Set `calling_handler_resource_id` to the resource that handles inbound calls.
3. Set `ip_auth_enabled=true` only when you can maintain a precise `ip_auth` CIDR allowlist. Allowlist the known PBX, SBC, or carrier source addresses, not an unbounded network.
4. Select `codecs`, `ciphers`, and `encryption` from the current schema. Address encryption supports `required`, `optional`, and `forbidden`; do not copy the credential or SWML enum spelling.
5. Treat the write-only `password` as a secret if you use it. Read responses will not return it.
6. Record the returned `uri`, `context`, and handler ID. Route using that URI, not a guessed domain.

### 5. Create a SIP Gateway for an external SIP URI

Use [Create SIP Gateway](https://signalwire.com/docs/apis/rest/sip-gateway/create-sip-gateway.md) when SignalWire must dial an external SIP entity:

1. Set a descriptive `name` and the carrier's complete `uri`.
2. Set the gateway's effective `encryption`, `codecs`, and `ciphers` to an intersection supported by the carrier.
3. Keep carrier credentials in the approved secret store and confirm whether the current gateway schema supports the required authentication fields; do not add undocumented fields.
4. Assign the gateway to a phone/resource route only after reviewing the resulting dial path. A gateway is not a SIP Credential and does not automatically register a PBX device.

### 6. Configure a Domain Application for inbound BYOC

Use a [Domain Application](https://signalwire.com/docs/platform/voice/sip/domain-applications.md) when a carrier sends SIP traffic to SignalWire and SignalWire should run application logic.

1. Create the Domain Application through the Dashboard or `/api/relay/rest/domain_applications`.
2. Select the handler and its required fields from the [Domain Application API schema](https://signalwire.com/docs/apis/rest/domain-applications/create-domain-application.md). Supported handler families include SWML/Relay, LaML, Call Flow, Video Room, and other values shown by the current schema.
3. Enable IP authentication and allowlist the carrier's documented source CIDRs. Do not publish the custom domain without an allowlist unless the exposure is intentional and approved.
4. Set encryption, codecs, and ciphers to the carrier's tested intersection.
5. For SWML, point the handler at a script that declares `version: 1.0.0`. For RELAY, make the Domain Application topic/context match the listener. Test the handler independently before introducing a carrier route.

## Route inbound and outbound calls

### Inbound PSTN to a PBX or phone

1. Acquire or identify a SignalWire phone number. Require approval immediately before a purchase or release; see [Phone Numbers](https://signalwire.com/docs/platform/phone-numbers.md).
2. Open the number's **Assign Resource** workflow and select the intended modern resource.
3. For automation, use the current phone-route assignment endpoint `POST /api/fabric/resources/{id}/phone_routes`; see [Assign Resource to phone route](https://signalwire.com/docs/apis/rest/phone-numbers/assign-resource-phone-route.md). Re-open the page for the current request body and handler enum.
4. If assigning a SIP Credential directly, review [Assign a resource to a SIP Credential](https://signalwire.com/docs/apis/rest/sip-credentials/assign-resource-to-sip-credential.md) and use the current `/api/fabric/resources/{id}/sip_endpoints` relationship API.
5. Verify the phone route, resource type/ID, SIP URI, and PBX registration as separate facts. A purchased number can exist without being assigned, and an assigned credential can exist without a registered device.

### Inbound carrier to application or PBX (BYOC)

1. Obtain the carrier's SIP URI, source CIDRs, transport/security requirements, and authentication contract.
2. Create a Domain Application, enable the carrier allowlist, and assign the handler. Use [BYOC](https://signalwire.com/docs/platform/voice/sip/bring-your-own-carrier.md) for the current inbound flow.
3. Test DNS resolution of the Domain Application host from the carrier and test the handler from SignalWire logs.
4. If the handler should reach a PBX, make the application explicitly connect to the PBX SIP URI or resource address. Do not assume a Domain Application forwards directly to a credential.

### Outbound PBX to PSTN or SIP

1. Register the PBX to a SIP Credential when using username/password authentication, or send from an IP-authenticated SIP Address when the design and network allow it.
2. Confirm the resource's `call_handler`, `caller_id`/`send_as`, geographic permissions, destination format, and codec/encryption intersection.
3. Route the PBX dial plan to the exact SignalWire SIP domain/URI from the profile or address response.
4. For external carrier SIP, use a SIP Gateway or an explicitly authenticated SIP URI. Verify the carrier's URI, credentials, and identity requirements before testing.

### Outbound application to SIP

Use SWML `connect` for a SIP URI, and provide the SIP authentication fields only on that SIP leg. The current [SWML `connect` reference](https://signalwire.com/docs/swml/reference/calling/connect.md) defines SIP URI destinations, serial/parallel dialing, `sip_auth_username`, `sip_auth_password`, per-leg encryption, codec offers, and status callbacks.

```yaml
version: 1.0.0
sections:
  main:
    - connect:
        to: "sip:${SIP_DESTINATION}"
        sip_auth_username: "${SIP_AUTH_USERNAME}"
        sip_auth_password: "${SIP_AUTH_PASSWORD}"
        encryption: "${SIP_ENCRYPTION_POLICY}"
```

Treat this as a server-side template. Substitute values before submission; do not expect SWML to read process environment variables automatically. Use the [Calling API call commands](https://signalwire.com/docs/apis/rest/calls/call-commands.md), the current [TypeScript server SDK `connect`](https://signalwire.com/docs/server-sdks/reference/typescript/relay/call/connect), or the [Python server SDK `dial`](https://signalwire.com/docs/server-sdks/reference/python/relay/client/dial) with a SIP device when those surfaces better fit the application. The BYOC guide also demonstrates the current Relay `dialSip()` shape. Use [`sip_refer`](https://signalwire.com/docs/swml/reference/calling/sip-refer.md) for an explicit SIP REFER and record both the REFER response and the INVITE-to-target response.

## Authenticate and secure each leg

Separate these credentials and policies:

| Boundary | Credential/policy | Evidence to collect |
| --- | --- | --- |
| REST management | Basic Auth with `PROJECT_ID` + scoped `API_TOKEN` | HTTP status, structured error body, token scope (never the token) |
| Client application | Short-lived Bearer token | Token expiry and permission, never a long-lived API token in client code |
| SIP Credential device | SIP username/password and the resource's encryption policy | REGISTER challenge/result, realm/domain, selected transport, resource ID |
| SIP Address or Domain Application | `ip_auth_enabled` + explicit CIDR list; optional write-only SIP password where supported | Source IP observed by SignalWire/PBX, allowlist version, handler/resource ID |
| SIP Gateway/BYOC | External SIP URI plus carrier-defined credentials or IP policy | Carrier contract, URI, auth result, route/resource ID |

1. Keep REST API tokens, SIP passwords, and carrier passwords in separate secret scopes.
2. Set TLS signaling and SRTP media according to the [SIP trunking security guidance](https://signalwire.com/docs/platform/voice/sip/trunking.md).
3. Require a compatible codec and SRTP cipher on both ends. Current API schemas list examples such as `PCMU`, `PCMA`, `G722`, `G729`, `OPUS` variants, `VP8`, and `H264`, and ciphers `AEAD_AES_256_GCM_8`, `AES_256_CM_HMAC_SHA1_80`, `AES_CM_128_HMAC_SHA1_80`, `AES_256_CM_HMAC_SHA1_32`, and `AES_CM_128_HMAC_SHA1_32`. Re-open the resource's current OpenAPI before selecting from this list.
4. Align the policy vocabulary at each boundary. Profiles and some resources use `required`/`optional`/`default`; SIP Addresses and Domain Applications can use `required`/`optional`/`forbidden`; SWML uses `mandatory`/`optional`/`forbidden`. Translate intentionally rather than copying an enum between APIs.
5. For a failure, compare the offered/accepted codec and cipher lists and the SDP encryption attributes. Do not infer a media failure solely from a call's final status.

## Use a device template

Populate every value from the current SIP Profile/resource response and the PBX's own transport/NAT model:

| Device field | Value to provide |
| --- | --- |
| SIP username | `${SIP_USERNAME}` for a SIP Credential; leave unset for pure IP auth if the device requires no credential |
| SIP password | `${SIP_PASSWORD}` from the secret store; never print it |
| SIP server/domain | `${SIP_PROFILE_DOMAIN}` or the exact SIP Address URI host |
| SIP transport | `${SIP_TRANSPORT}` (`TLS`, `TCP`, or `UDP` only if the selected resource/device supports it) |
| SIP server port | `${SIP_SIGNALING_PORT}` from the current endpoint/device documentation; do not infer it from an RTP rule |
| Outbound proxy | `${SIP_OUTBOUND_PROXY}` only when the current resource/PBX design requires one |
| Outbound proxy port/transport | `${SIP_OUTBOUND_PROXY_PORT}` / `${SIP_OUTBOUND_PROXY_TRANSPORT}` from the same verified design |
| Local SIP port | `${PBX_LOCAL_SIP_PORT}`; choose and document a value appropriate for the PBX, NAT, and collision model |
| Registration | `${REGISTER_MODE}`; use the mode required by the credential or IP-auth design |
| Media security | `${SRTP_MODE}` and the negotiated cipher intersection |
| Codecs | `${CODEC_LIST}`; use the non-empty intersection, in the intended preference order |
| Caller ID / From user | `${CALLER_ID}` / `${SIP_FROM_USER}`; use a purchased or verified identity permitted by the project |
| NAT/public media address | `${PBX_PUBLIC_ADDRESSING}` from the PBX/SBC's external signaling and media configuration |

1. Copy the profile domain from the API/Dashboard, not from a stale screenshot.
2. Confirm certificate validation and the device's TLS version/cipher support before enabling `required`/`mandatory` encryption.
3. Confirm that the PBX advertises a reachable media address in SDP and that its firewall permits the negotiated media flow.
4. Test one inbound and one outbound call while retaining the exact template values and timestamp.

## FreePBX and FusionPBX caveats

### FreePBX/Asterisk

Use the official [FreePBX integration guide](https://signalwire.com/docs/platform/freepbx.md) as a product-specific starting point, then reconcile it with the current Fabric SIP Credential schema:

- The guide's terminology and screenshots use “SIP Endpoint,” which may describe a compatibility-era resource. Map the design to the modern SIP Credential and current assignment API before creating anything new.
- The guide requires encryption and specifically tells operators to disable `AEAD_AES_256_GCM_8` because the documented Asterisk compatibility issue can produce warnings. Choose another mutually supported cipher and validate with a real call.
- Treat its signaling-port and transport examples as that guide's device configuration, not a universal SignalWire port policy. Populate the device template from the current resource and PBX transport settings.
- Use PJSIP's correct inbound context and inspect the `To`/destination handling. Verify the generated dialplan after every GUI reload; do not assume the sample context matches an existing installation.

### FusionPBX/FreeSWITCH

Use the official [FusionPBX integration guide](https://signalwire.com/docs/platform/fusionpbx.md) for its GUI workflow:

- FusionPBX is FreeSWITCH-based. Treat gateway registration state, profile choice, inbound context, outbound route, destination variable, certificates, and access control as separate checks.
- The guide's TLS gateway and certificate steps are prerequisites for that example; verify the deployed FreeSWITCH profile and certificate chain rather than copying values from the screenshot.
- The guide recommends resolving `sip.signalwire.com` for access control. Prefer domain-based authorization and periodic refresh as described in [Allow SignalWire IPs through your firewall](https://signalwire.com/docs/platform/allow-signalwire-ips-through-your-firewall.md); do not build a permanent static list.
- Label `sofia`, `fs_cli`, `siptrace`, `hangup_cause`, and `sofia status gateway` evidence as **FreeSWITCH-specific**. Do not present those commands as SignalWire REST diagnostics.

## Diagnose from logs to packets

### Start with a reproducible call record

1. Freeze one failing scenario: direction, source, destination, resource, transport, time in UTC, and whether the failure is setup, answer, teardown, or media.
2. Record the Dashboard Logs entry. Use the Voice Logs API with Basic Auth: `GET $SPACE_HOST/api/voice/logs`, then `GET $SPACE_HOST/api/voice/logs/{id}` and `GET $SPACE_HOST/api/voice/logs/{id}/events` for the selected call. See [List Voice Logs](https://signalwire.com/docs/apis/rest/voice-logs/list-voice-logs.md), [Get Voice Log](https://signalwire.com/docs/apis/rest/voice-logs/get-voice-log.md), and [List Voice Log Events](https://signalwire.com/docs/apis/rest/voice-logs/list-voice-log-events.md).
3. Filter for the SIP log type `relay_sip_call` where present. Preserve the log ID, direction, `from`, `to`, status, duration, and event timestamps. Expect statuses such as `queued`, `ringing`, `in-progress`, `answered`, `busy`, `failed`, `no-answer`, `completed`, and `ended`; use the current endpoint enum as authoritative.
4. For native REST `dial`, record the submitted `params.codecs`. The current API accepts an array or comma-separated string; a `codecs=...` value embedded in the destination SIP URI takes precedence. Keep `VP8` and `H264` out of an audio-only offer rather than inferring media type from billing labels or the endpoint UI.
5. Compare the event stream's level/name/details with the resource configuration snapshot. Never treat a missing Dashboard entry as proof that no SIP packet reached the PBX.
6. For SWML, collect `connect` status callbacks. For REFER, collect `sip_refer_result`, `sip_refer_response_code`, and `sip_refer_to_response_code` from the [SWML SIP REFER variables](https://signalwire.com/docs/swml/reference/calling/sip-refer.md).

### Follow a packet-capture ladder

Climb only as far as the evidence requires:

1. **Application layer:** reproduce with one call and save the log/event IDs and exact UTC interval.
2. **DNS layer:** resolve the exact configured host from the PBX/SBC and from an independent network. Save resolver, answer set, TTL, and time; compare the result with the host in the SIP URI.
3. **Signaling layer:** capture at the PBX/SBC boundary. Use `sngrep` for a quick SIP ladder and `tcpdump` for a complete capture; use the [FreeSWITCH Packet Capture guide](https://developer.signalwire.com/freeswitch/FreeSWITCH-Explained/Troubleshooting-Debugging/Packet-Capture/) for FreeSWITCH-specific tooling. Capture the selected transport, not an assumed port.
4. **Media layer:** derive the capture filter from the negotiated SDP addresses and ports in that call. SignalWire does not publish a universal RTP port range; do not invent one. Capture only the observed media flow and retain the SDP offer/answer with credentials redacted.
5. **Endpoint layer:** compare `Via`, `Contact`, `Record-Route`, source/destination addresses, response codes, SDP addresses, codec payloads, SRTP attributes, and authentication challenges. Check both directions.
6. **FreeSWITCH-only layer:** if the PBX is FreeSWITCH, inspect `hangup_cause`, `sip_term_status`, and `proto_specific_hangup_cause`; use `sofia status gateway <name>` and scoped `sofia ... siptrace on` only during the approved test. Turn tracing off after capture. Follow [FreeSWITCH Call-Setup Failures](https://developer.signalwire.com/freeswitch/troubleshooting/call-setup/) for the documented mappings.
7. **FreeSWITCH live-channel layer:** during the approved call, use `fs_cli -x 'show channels'` to obtain the local UUID, then `fs_cli -x 'uuid_dump <uuid>'`. Compare `Channel-Read-Codec-Name`/`Channel-Write-Codec-Name`, `variable_rtp_use_codec_name`, `variable_dtmf_type`, `variable_video_possible`, `variable_video_media_flow`, `variable_video_read_codec`, and `variable_is_video_call`. In one verified SIP call, PCMU audio and VP8 video were both negotiated even though the provider charge details named only `SIP Audio`; charge classification was therefore not proof of an audio-only SDP.
8. Redact `Authorization`, SIP digest responses, passwords, API tokens, SRTP key material, private IPs where policy requires, and unrelated calls before sharing a capture or `uuid_dump`. Preserve packet timestamps and the relevant transaction/dialog.

## Interpret SIP responses and Q.850 causes

Separate these evidence layers:

- **REST/API HTTP:** authenticate and validate the management request; inspect the structured `errors` array and endpoint-specific status. Do not convert an HTTP `422` into a SIP response.
- **SIP signaling:** preserve the raw response code and reason phrase from the failing transaction. A response may come from SignalWire, the carrier, the PBX, or another proxy.
- **Q.850/FreeSWITCH cause:** use it as a summarized channel outcome only when the PBX is FreeSWITCH. Several SIP responses can map to one cause, so retain the raw SIP status too.

### FreeSWITCH-specific mapping

Use this table only for FreeSWITCH channel evidence; it is not a universal SignalWire API mapping. The mappings below come from [FreeSWITCH Call-Setup Failures](https://developer.signalwire.com/freeswitch/troubleshooting/call-setup/):

| Raw SIP response | FreeSWITCH Q.850/cause | First diagnostic direction |
| --- | --- | --- |
| `401`, `402`, `403`, `407`, `603`, `608` | `CALL_REJECTED` | Check the challenge/credentials, caller identity, policy, and the rejecting hop. |
| `404` | `UNALLOCATED_NUMBER` | Check the URI/number and route ownership. |
| `480` | `NO_USER_RESPONSE` | Check reachability, registration, timeout, and the far-end response. |
| `486` or `600` | `USER_BUSY` | Check destination state and whether the PBX correctly handles busy. |
| `484` | `INVALID_NUMBER_FORMAT` | Check dial-string normalization and required destination format. |
| `488` or `606` | `INCOMPATIBLE_DESTINATION` | Compare codec, SRTP, and SDP offer/answer. |
| `408` or `504` | `RECOVERY_ON_TIMER_EXPIRE` | Check DNS, firewall, NAT, route, and transaction timers. |
| `485` or `604` | `NO_ROUTE_DESTINATION` | Check route selection and the destination domain/number. |
| `502` | `NETWORK_OUT_OF_ORDER` | Identify the gateway/proxy that returned the error and inspect its upstream. |
| `400`, `481`, `500`, or `503` | `NORMAL_TEMPORARY_FAILURE` | Capture the transaction and determine whether the failure is transient or configuration-specific. |
| `487` | `ORIGINATOR_CANCEL` | Check which leg cancelled and whether a timeout or parallel dial cancelled the other legs. |

Treat each first direction as a hypothesis until the trace identifies the rejecting hop. **[INFERENCE]** A one-way-audio symptom commonly points to SDP/NAT/firewall asymmetry, but prove it by comparing advertised and observed media addresses and packet direction.

## Set DNS, firewall, and NAT evidence boundaries

### DNS and address policy

- Use the profile/resource-provided hostname and resolve it at test time. Do not substitute a remembered IP.
- SignalWire publishes DNS names rather than a static IP list. The official [firewall guidance](https://signalwire.com/docs/platform/allow-signalwire-ips-through-your-firewall.md) names `sip.signalwire.com`, `relay.signalwire.com`, and `firewall.signalwire.com`, recommends domain-based authorization, and warns that media can originate from a wide variety of non-deterministic locations.
- Refresh DNS-derived firewall state according to your change-control policy. Record the observed answer set and timestamp without presenting it as a permanent SignalWire range.
- For a carrier-to-Domain-Application allowlist, use the carrier's documented source CIDRs and verify them independently. Do not add SignalWire DNS answers to a carrier allowlist unless the traffic direction requires it.

### Firewall and NAT proof

1. Check the selected SIP transport from the device/resource configuration and allow the corresponding signaling flow in both directions. Do not assume a port from a different PBX vendor or screenshot.
2. Check TLS certificate validation and the actual destination hostname when using TLS. A successful DNS lookup does not prove that signaling or media is permitted.
3. Do not claim a universal RTP range: official SignalWire documentation does not publish one. Derive media rules from the environment/PBX/SBC configuration, negotiated SDP, and observed packets. Require environment- and PBX-specific verification before opening media ports.
4. Record NAT mappings, public address advertised in SDP, firewall state, SIP ALG behavior, symmetric/asymmetric routing, and packet counters. Keep the exact observation time.
5. Test from the actual PBX/SBC network. A laptop DNS or connectivity test can disprove a local DNS problem but cannot prove the PBX's NAT and media path.
6. Prefer a narrowly scoped, temporary rule for a controlled test. Remove it after the test under the approval gate.

## Build an escalation bundle

Assemble one sanitized, time-bounded bundle before contacting SignalWire or the carrier:

1. **Ownership and consent:** Space name (not token), project ID if approved, timezone, UTC test interval, approver, and consent to share each artifact.
2. **Reproduction:** inbound/outbound/BYOC direction, source/destination in a permitted form, exact UTC timestamps, frequency, and whether setup, answer, teardown, DTMF, or media fails.
3. **Resource graph:** SIP Profile ID/domain, SIP Credential/SIP Address/SIP Gateway/Domain Application IDs and types, phone route ID, assigned handler/resource ID, and legacy-vs-modern classification.
4. **Effective configuration:** transport, signaling port, local port, outbound proxy, registration/IP-auth mode, CIDRs, encryption policy, codec/cipher lists, caller ID/send-as, PBX/SBC software/version, certificate status, and NAT/public addressing. Exclude passwords and tokens.
5. **SignalWire evidence:** Dashboard log URL/ID, `relay_sip_call` record, event list with levels and timestamps, REST status and redacted structured errors, SWML status callback payloads, and REFER response variables where applicable.
6. **Wire evidence:** one redacted SIP ladder or PCAP covering the failing transaction, SDP offer/answer, DNS answer set with resolver/TTL/time, and firewall/NAT counters. Include the capture filter and collection point. Do not attach unrelated calls.
7. **Interpretation:** raw SIP response/reason phrase, rejecting hop, any FreeSWITCH `hangup_cause`/`sip_term_status`/`proto_specific_hangup_cause`, and the exact test that separates authentication, routing, policy, codec/SRTP, signaling reachability, and media reachability.
8. **Change history:** resource/profile edits, DNS/firewall changes, PBX reloads, token/password rotations, and the approval for each external write. Never include the secret value itself.

Ask Support or the carrier to identify the failing transaction/dialog and timestamp before proposing a broad firewall or resource change. Keep the current API/OpenAPI pages open while applying any requested remediation.

## Primary sources

- [SIP trunking](https://signalwire.com/docs/platform/voice/sip/trunking.md)
- [SIP Domain Applications](https://signalwire.com/docs/platform/voice/sip/domain-applications.md)
- [Bring Your Own Carrier](https://signalwire.com/docs/platform/voice/sip/bring-your-own-carrier.md)
- [Create SIP Credential](https://signalwire.com/docs/apis/rest/sip-credentials/create-sip-credential.md)
- [Assign resource to SIP Credential](https://signalwire.com/docs/apis/rest/sip-credentials/assign-resource-to-sip-credential.md)
- [Retrieve SIP Profile](https://signalwire.com/docs/apis/rest/sip-profile/retrieve-sip-profile.md)
- [Update SIP Profile](https://signalwire.com/docs/apis/rest/sip-profile/update-sip-profile.md)
- [Create SIP Address](https://signalwire.com/docs/apis/rest/sip-addresses/create-sip-address.md)
- [Create SIP Gateway](https://signalwire.com/docs/apis/rest/sip-gateway/create-sip-gateway.md)
- [Create Domain Application](https://signalwire.com/docs/apis/rest/domain-applications/create-domain-application.md)
- [Assign resource to Domain Application](https://signalwire.com/docs/apis/rest/domain-applications/assign-resource-domain-application.md)
- [Assign resource to phone route](https://signalwire.com/docs/apis/rest/phone-numbers/assign-resource-phone-route.md)
- [Phone Numbers](https://signalwire.com/docs/platform/phone-numbers.md)
- [SignalWire Authorization](https://signalwire.com/docs/apis/authorization.md)
- [API error codes](https://signalwire.com/docs/apis/error-codes.md)
- [Calling API call commands](https://signalwire.com/docs/apis/rest/calls/call-commands.md)
- [TypeScript server SDK `connect`](https://signalwire.com/docs/server-sdks/reference/typescript/relay/call/connect)
- [Python server SDK `dial`](https://signalwire.com/docs/server-sdks/reference/python/relay/client/dial)
- [SWML `connect`](https://signalwire.com/docs/swml/reference/calling/connect.md)
- [SWML `sip_refer`](https://signalwire.com/docs/swml/reference/calling/sip-refer.md)
- [List Voice Logs](https://signalwire.com/docs/apis/rest/voice-logs/list-voice-logs.md)
- [Get Voice Log](https://signalwire.com/docs/apis/rest/voice-logs/get-voice-log.md)
- [List Voice Log Events](https://signalwire.com/docs/apis/rest/voice-logs/list-voice-log-events.md)
- [FreePBX integration](https://signalwire.com/docs/platform/freepbx.md)
- [FusionPBX integration](https://signalwire.com/docs/platform/fusionpbx.md)
- [Allow SignalWire IPs through your firewall](https://signalwire.com/docs/platform/allow-signalwire-ips-through-your-firewall.md)
- [FreeSWITCH Call-Setup Failures](https://developer.signalwire.com/freeswitch/troubleshooting/call-setup/)
- [FreeSWITCH Packet Capture](https://developer.signalwire.com/freeswitch/FreeSWITCH-Explained/Troubleshooting-Debugging/Packet-Capture/)
