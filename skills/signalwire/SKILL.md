---
name: signalwire
description: "Design, implement, manage, migrate, test, and troubleshoot SignalWire communications solutions across voice, messaging, fax, video, chat, PubSub, Tasking, AI agents, Browser SDK, SWML, SWAIG, RELAY, REST management APIs, Call Fabric resources, cXML/Compatibility API, phone numbers, webhooks, and SIP trunking."
---

# SignalWire

Build against SignalWire's current interfaces, keep account operations safe, and debug from evidence rather than assumptions. Treat the live official docs as the source of truth; use these references for selection, workflow, and known distinctions.

## Start with live documentation

1. Open `https://signalwire.com/docs/llms.txt` before substantial implementation.
2. Open the relevant section index:
   - Platform: `https://signalwire.com/docs/platform/llms.txt`
   - APIs: `https://signalwire.com/docs/apis/llms.txt`
   - Server SDKs: `https://signalwire.com/docs/server-sdks/llms.txt`
   - SWML: `https://signalwire.com/docs/swml/llms.txt`
   - Browser SDK: `https://signalwire.com/docs/browser-sdk/llms.txt`
   - Compatibility API: `https://signalwire.com/docs/compatibility-api/llms.txt`
3. Append `.md` to a documentation page URL for clean Markdown. Inspect the endpoint-specific page or the current OpenAPI document at the exact root URL `https://signalwire.com/openapi.json` before emitting request fields; never prepend `/docs` to the OpenAPI path. Server SDK inline doc-comments are illustrative and can lag the OpenAPI — `@signalwire/sdk` 2.0.5 shows Datasphere search as `{query, limit}` and places the Calling `play` `url` at the item level, both of which the live API rejects — so confirm field names against the endpoint page or OpenAPI, not the SDK examples.
4. Use SignalWire's documentation MCP endpoint at `https://signalwire.com/docs/_mcp/server` when the environment supports remote MCP.
5. Record the inspected page URLs in the final handoff. Mark behavior that is not established by current docs or an executed test as an inference.

Do not rely on memorized schemas, old blog posts, or legacy examples when a current endpoint page exists.

## Select the interface

Choose the smallest interface that owns the required behavior.

| Need | Prefer | Notes |
| --- | --- | --- |
| Manage projects, tokens, numbers, resources, logs, messaging, calls, fax, video, chat, PubSub, Tasking, or Datasphere | Native REST API or current Server SDK REST client | Use server-side Project ID plus scoped API token. |
| Declare voice or messaging behavior without a persistent process | SWML | Store in the Dashboard or serve valid JSON/YAML over HTTPS. |
| Build a voice AI application with tools, state, prompts, and deployment adapters | Server SDK `AgentBase` | Use Python `signalwire-sdk` or ESM-only TypeScript `@signalwire/sdk`. |
| Control live calls or messaging imperatively from a long-running process | RELAY client | Use event-driven WebSocket control; verify current language support. |
| Add browser voice, video, chat, or click-to-call | Browser SDK v4 `@signalwire/js` | Mint short-lived SAT/embed credentials on the server; never ship an API token. |
| Migrate Twilio/TwiML code with minimal change | Compatibility API and cXML | Keep it isolated from native REST assumptions; its URL and pagination differ. |
| Route PBXs, carriers, SIP devices, or BYOC traffic | Modern SIP Credentials, SIP Gateways, SIP Addresses, or Domain Applications | Do not start new work on legacy SIP Endpoints. |
| Build visually without code | Call Flow Builder or Dashboard AI agent | Use versioning and inspect generated routing/resources. |

Do not introduce a second SignalWire interface merely because it is familiar. Combine interfaces only when responsibilities are distinct, such as REST provisioning plus an AgentBase webhook plus Browser SDK clients.

## Load only the references needed

- Read [references/platform-and-apis.md](references/platform-and-apis.md) for credentials, API families, resource management, phone routing, messaging, logs, rate limits, and safe CRUD workflows.
- Read [references/development.md](references/development.md) for architecture selection and examples progressing from simple SWML to full-stack applications.
- Read [references/ai-agents-and-swml.md](references/ai-agents-and-swml.md) for SWML structure, AgentBase, SWAIG tools, DataMap, state, contexts, skills, security, and deployment.
- Read [references/browser-and-compatibility.md](references/browser-and-compatibility.md) for Browser SDK v4, subscriber tokens, WebRTC media, web components, v3 migration, cXML, or Twilio migration.
- Read [references/sip-trunking.md](references/sip-trunking.md) for SIP resource selection, trunk/PBX configuration, BYOC, media negotiation, and SIP diagnosis.
- Read [references/debugging.md](references/debugging.md) whenever a call, message, webhook, agent tool, browser session, media path, or SIP route fails.

## Preserve the platform boundaries

Apply these distinctions before writing code:

- Treat a **Space** as the tenant hostname and a **Project** as the credential/resource boundary.
- Treat a **Resource** as a callable application or endpoint, an **Address** as a Fabric route to a resource, and a **phone route** as an assignment from a DID to a resource.
- Use Basic Auth with Project ID and a narrowly scoped API token only on trusted servers.
- Use short-lived Bearer credentials such as Subscriber Access Tokens for client-side Fabric access.
- Treat native REST URLs under `/api/{family}/...` and Compatibility API URLs under `/api/laml/2010-04-01/...` as separate contracts.
- Treat **SIP Credentials** and the legacy **SIP Endpoint** surface as two live but non-ID-compatible APIs (`/api/fabric/resources/sip_endpoints` vs `/api/relay/rest/endpoints/sip`); both work, their resource IDs differ, and only the legacy surface documents a `password`.
- Treat Calling SWML and Messaging SWML as different document types with different method and expression rules.
- Treat the Agents SDK's HTTP Basic Auth as protection for the agent's SWML/SWAIG endpoints, not as the Project API credential.

## Follow the delivery workflow

### 1. Define the call or message journey

Write the end-to-end sequence before implementation:

```text
origin -> SignalWire entry resource -> routing decision -> application/interface
       -> callbacks/tools/media -> terminal state -> logs and correlation identifiers
```

Specify inbound and outbound paths separately. Include failure and timeout outcomes, caller/message identity, resource assignment, callback destinations, and the authoritative owner of persistent state.

### 2. Inspect the existing project

- Reuse its language, package manager, web framework, configuration, logging, and test conventions.
- Inspect installed SignalWire packages and versions before choosing syntax.
- Search every phone route, webhook URL, resource ID, callback, and exported helper affected by a change.
- Keep credentials in the project's established secret mechanism; use environment variable names only as examples.

### 3. Establish credentials and permissions

Use conventional placeholders:

```text
SIGNALWIRE_SPACE=example.signalwire.com
SIGNALWIRE_PROJECT_ID=<project-uuid>
SIGNALWIRE_API_TOKEN=<scoped-secret>
```

- Request only the scopes required by the endpoint.
- Keep API tokens, signing keys, SIP passwords, SAT refresh tokens, and webhook credentials out of source, browser bundles, logs, screenshots, fixtures, and shell history.
- Redact authorization headers and query-string secrets from diagnostics.
- Validate webhook signatures against the raw request representation required by the current SDK documentation.

### 4. Implement one vertical slice

Start with the smallest observable path:

1. Return or generate valid instructions.
2. Expose the endpoint over reachable HTTPS when SignalWire must call it.
3. Create or identify the destination resource.
4. Assign an Address or phone number route.
5. Exercise one real or documented test interaction.
6. Inspect the resulting SignalWire log and callback.
7. Add tools, branching, persistence, media, or multi-agent routing only after the slice works.

Use SDK clients in maintained application code when they expose the required operation. Use direct HTTP/curl for isolated diagnosis and for endpoints not yet wrapped by the installed SDK.

### 5. Gate external account changes

Obtain explicit approval immediately before any external write that purchases, releases, deletes, rotates, sends, dials, deploys, or changes live routing. This includes:

- purchasing or releasing phone numbers;
- creating billable calls/messages or test traffic;
- deleting resources, recordings, documents, projects, or tokens;
- rotating signing keys or API credentials;
- assigning production phone routes or changing SIP/domain handlers;
- deploying a Call Flow/SWML version or changing geographic permissions.

Before an approved write, read the target resource, state the exact Space/Project/resource, describe cost or interruption risk, and preserve identifiers needed to verify or reverse the change. Never use a destructive call as a connectivity test.

### 6. Verify in layers

Run the narrowest relevant sequence:

1. **Static contract:** validate JSON/YAML/XML, types, required fields, E.164 numbers, URLs, and content types.
2. **Local application:** start the server/client and exercise the actual route or generated document.
3. **Reachability/auth:** test public HTTPS, Basic/Bearer auth, raw-body signature validation, and token scopes.
4. **Platform execution:** perform an approved test call/message/session or use an official local test tool such as `swaig-test`.
5. **Evidence:** capture the resource ID, call/message SID, HTTP status, callback, log entry, and relevant per-call events.
6. **Cleanup:** remove temporary live routes/resources only with approval; retain no secrets in artifacts.

For browser work, drive the flow in a real browser and inspect `errors$`, `warnings$`, WebSocket state, ICE state, and RTC statistics. For SIP, follow the diagnostic ladder in the SIP reference and do not guess a static SignalWire IP list or universal RTP port range.

## Debug by finding the failing boundary

Classify the first failed transition rather than changing multiple layers:

- request never reached SignalWire;
- SignalWire rejected authentication, scope, format, or routing;
- SignalWire could not fetch or parse instructions;
- the application rejected or mishandled a webhook/tool call;
- signaling succeeded but media negotiation failed;
- execution succeeded but a callback, log, or client state was misread.

Correlate with one call/message/resource identifier and compare timestamps across application logs, SignalWire logs, callbacks, browser diagnostics, and SIP captures. Read [references/debugging.md](references/debugging.md) before proposing a workaround.

## Avoid legacy and unsafe shortcuts

- Do not expose Project ID/API token pairs to browsers or mobile clients.
- Do not copy Twilio base URLs, parameter names, pagination, or webhook validation assumptions into native SignalWire REST code.
- Do not create legacy SIP Endpoints for new work.
- Do not hard-code resolved SignalWire service IPs; follow current DNS/firewall guidance.
- Do not invent media port ranges, codec support, webhook retry behavior, or timeout values.
- Do not disable TLS, SRTP, signature validation, or function security merely to make a test pass.
- Do not log full webhook bodies when they may contain caller data, transcripts, tokens, or payment information.
- Do not tune AI, WebRTC, or SIP parameters before proving which boundary failed.

## Handoff

Lead with the working user journey. Report:

- chosen SignalWire interface and why;
- Space/Project and resource types using redacted identifiers;
- files and live resources changed;
- commands/scenarios executed and observed results;
- call/message/resource correlation IDs with sensitive portions redacted;
- official documentation pages inspected;
- any unverified carrier, PBX, browser, account-tier, geographic, or production-routing assumptions.
