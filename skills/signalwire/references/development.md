# SignalWire development path

Use this reference to choose a SignalWire interface, move from a first SWML response to a production service, and avoid mixing current and compatibility APIs. Re-open the current [SWML reference](https://signalwire.com/docs/swml), [REST API index](https://signalwire.com/docs/apis/llms.txt), and [Server SDK docs](https://signalwire.com/docs/server-sdks) immediately before coding: endpoint schemas, SDK methods, and account capabilities evolve.

## Contents

- [Select an interface](#select-an-interface)
- [Map capabilities and tools](#map-capabilities-and-tools)
- [Progress from simple to complex](#progress-from-simple-to-complex)
- [Expose and route a webhook](#expose-and-route-a-webhook)
- [Provision with REST](#provision-with-rest)
- [Validate, test, and deploy](#validate-test-and-deploy)
- [Choose current versus legacy](#choose-current-versus-legacy)
- [Production checklist](#production-checklist)
- [Primary sources](#primary-sources)

## Select an interface

Start with the smallest interface that owns the behavior you need. Treat Calling SWML and Messaging SWML as different document flavors even though both use `version: "1.0.0"` and `sections.main`.

| Need | Start here | Execution model | Move away when |
| --- | --- | --- | --- |
| A fixed voice greeting or IVR | Dashboard-hosted Calling SWML | Declarative, serverless | You need source control, tests, secrets, or external data |
| A keyword SMS reply | Dashboard-hosted Messaging SWML | Declarative, serverless | You need authenticated backend lookups or complex branching |
| Dynamic call/message instructions | Self-hosted SWML webhook | SignalWire POSTs context; your server returns SWML | You need long-lived event streams or low-level call control |
| Number/resource administration | Native REST/Fabric APIs | HTTPS requests with Basic Auth | Never replace this with a compatibility endpoint without a migration reason |
| A voice AI agent | `AgentBase` in `signalwire-sdk` / `@signalwire/sdk` | SDK serves Calling SWML and SWAIG tools | You need deterministic, non-AI call control or a separate media/event loop |
| Deterministic IVR, call routing, or event reactions | RELAY client | Persistent WebSocket, imperative async events | You need the AI prompt/tool lifecycle supplied by AgentBase |
| Existing TwiML/cXML application | Compatibility API | Compatibility surface | Migrate new work to native REST/Fabric or SWML |

Use Browser SDK for browser/mobile media and SIP-specific references for trunk/device setup; those topics are intentionally out of scope here.

## Map capabilities and tools

Use the product surface that owns the channel:

| Capability | Primary development surfaces | Operational evidence |
| --- | --- | --- |
| Voice/calling | Calling SWML, AgentBase, RELAY, Calling REST, Call Flow Builder | Voice logs, per-call events, status callbacks |
| SMS/MMS | Native Messaging REST, Messaging SWML, Compatibility API for migrations | Message logs, delivery callbacks, 10DLC/toll-free registration state |
| WhatsApp | Native Messaging REST plus the WhatsApp account/number/template APIs | Message logs and template/account status |
| Video | Video REST for rooms/tokens/sessions/recordings/streams; Browser SDK for participants | Video logs, room sessions, recording/stream events |
| Browser voice/video/chat | Browser SDK v4, Web Components, Subscriber/Room/Chat tokens | `errors$`, `warnings$`, preflight, exported diagnostics |
| Fax | Fax Platform/Compatibility APIs and Calling SWML `send_fax`/`receive_fax` where documented | Fax logs and callbacks; fax shares Voice throughput limits |
| AI and knowledge | AgentBase, Calling SWML `ai`, SWAIG, DataMap, MCP, Datasphere REST | Debug events, tool results, post-prompt summaries, document ingestion status |
| SIP/BYOC | SIP Credentials, Addresses, Gateways, Domain Applications, SWML/RELAY SIP dialing | Voice logs/events, SIP responses, PBX/carrier traces |
| PubSub and Tasking | Current Server/Browser SDK and token APIs | Subscription/task events and service-specific logs |

Open the current section index before choosing a package or endpoint; feature coverage differs across SDK languages.

Use the development tool that shortens the current feedback loop:

- Use **SWSH** for interactive or scripted inspection of projects, numbers, calls, messages, and supported SIP resources. Verify the current command set and Python compatibility in [SWSH](https://signalwire.com/docs/platform/swsh.md).
- Use **WireStarter** only when its containerized SDK/demo/ngrok environment is useful for an isolated tutorial or reproduction; do not make its bundled versions the production dependency source. See [WireStarter](https://signalwire.com/docs/platform/wirestarter.md).
- Use `sw-agent-init` to scaffold a current Agent project, `swaig-test` to render SWML/list or execute tools, and `sw-search` to build/validate knowledge indexes. See [Server SDK CLI tools](https://signalwire.com/docs/server-sdks/reference/python/agents/cli.md).
- Use the official Postman collection or direct curl for endpoint exploration and the OpenAPI document for schema generation. Keep application code on the maintained SDK/client already used by the repository.
- Use Call Flow Builder for a visual/no-code owner, but version and deploy the flow deliberately and inspect its Resource/Address/phone route like any other live application.

## Progress from simple to complex

### 1. Put a deterministic greeting in Dashboard SWML

Choose a Calling SWML resource in the Dashboard, paste this document, validate it, and attach the resource to a test number. The document answers, speaks one fixed sentence, and hangs up:

```yaml
version: 1.0.0
sections:
  main:
    - answer: {}
    - play:
        url: "say:Hello from SignalWire."
    - hangup: {}
```

Use the Dashboard-hosted path for a first smoke test. Do not add a webhook, database, or AI until the number reaches this known response. See [SWML introduction](https://signalwire.com/docs/swml) and [SWML deployment](https://signalwire.com/docs/swml/guides/deployment).

### 2. Add a Messaging SWML reply

Configure a Messaging SWML resource for inbound SMS/MMS and use a canned reply:

```json
{
  "version": "1.0.0",
  "sections": {
    "main": [
      { "reply": "Thanks for your message. We will reply during support hours." }
    ]
  }
}
```

Messaging SWML supports `%{path}` substitution, not Calling SWML JavaScript expressions. Keep this flow deterministic; use `switch` for keyword routing and `request` for server-side data. SignalWire stops a Messaging SWML execution after 100 method steps. Read the [Messaging SWML reference](https://signalwire.com/docs/swml/reference/messaging) before adding methods.

### 3. Serve SWML from your own webhook

Move to a self-hosted endpoint when you need source control, tests, an internal service, or runtime decisions. SignalWire sends a Calling-document POST with `call` plus context-dependent `params`, `vars`, and `envs`; validate scopes when present instead of requiring every key on every fetch. It sends a Messaging document with `message`, `params`, and `vars`. Return `application/json`, `application/yaml`, or `text/x-yaml` containing valid SWML.

Use a small ESM Node endpoint for a deterministic voice response:

```typescript
import express from "express";

const app = express();
app.use(express.json());

app.post("/swml/calling", (_request, response) => {
  response.type("application/json").send({
    version: "1.0.0",
    sections: {
      main: [
        { answer: {} },
        { play: { url: "say:Your request reached the self-hosted handler." } },
        { hangup: {} },
      ],
    },
  });
});

app.listen(Number(process.env.PORT ?? 3000), "0.0.0.0");
```

Return placeholders when SignalWire should expand call data at runtime, for example `say:Calling from %{call.from}`. For complex logic, read and validate the webhook body server-side, query your systems, then build a response. Keep the endpoint HTTPS-only, authenticate requests, and configure a fallback URL where the resource supports one. Follow [Handle incoming calls from code](https://signalwire.com/docs/swml/guides/remote-server) and the [Calling webhook payload](https://signalwire.com/docs/swml/reference/calling#webhook-payload).

Expose a local endpoint through an HTTPS tunnel only for development. Use a managed HTTPS deployment for shared testing and production; do not place a tunnel URL in a permanent number route.

### 4. Provision and route with REST

Use the native REST/Fabric APIs for repeatable administration. Set these placeholders in a secret manager or shell environment; never commit values:

```bash
export SPACE_HOST="https://{space}.signalwire.com"
export SIGNALWIRE_PROJECT_ID="<project-id>"
export SIGNALWIRE_API_TOKEN="<scoped-api-token>"
```

Server-side REST calls use Basic Auth with `Project ID:scoped API token`, and every request uses the Space hostname `https://{space}.signalwire.com`. Keep credentials server-side. Use short-lived Bearer tokens for client-side Fabric calls instead of exposing the API token. See [REST authorization](https://signalwire.com/docs/apis/authorization) and [REST base URL](https://signalwire.com/docs/apis/base-url).

Search before purchasing. The current native endpoint is documented at [Search phone numbers](https://signalwire.com/docs/apis/rest/phone-numbers/search-available-phone-numbers):

```bash
curl --fail-with-body --user "$SIGNALWIRE_PROJECT_ID:$SIGNALWIRE_API_TOKEN" \
  "$SPACE_HOST/api/relay/rest/phone_numbers/search?areacode=<area-code>&max_results=5"
```

Require explicit human approval before any purchase or other billable external write. After approval, purchase only the E.164 number selected from the search response, using the current [Purchase phone number](https://signalwire.com/docs/apis/rest/phone-numbers/purchase-phone-number) schema:

```bash
curl --fail-with-body --request POST \
  --user "$SIGNALWIRE_PROJECT_ID:$SIGNALWIRE_API_TOKEN" \
  --header "Content-Type: application/json" \
  --data '{"number":"<approved-e164-number>"}' \
  "$SPACE_HOST/api/relay/rest/phone_numbers"
```

For a self-hosted SWML handler, create an SWML webhook resource, choose `used_for` as `calling` or `messaging`, and provide `primary_request_url`. Review the current [Create SWML webhook](https://signalwire.com/docs/apis/rest/swml-webhook/create-swml-webhook) request schema before sending it:

```bash
curl --fail-with-body --request POST \
  --user "$SIGNALWIRE_PROJECT_ID:$SIGNALWIRE_API_TOKEN" \
  --header "Content-Type: application/json" \
  --data '{
    "name":"<resource-name>",
    "used_for":"calling",
    "primary_request_url":"https://app.example.invalid/swml/calling",
    "primary_request_method":"POST"
  }' \
  "$SPACE_HOST/api/fabric/resources/swml_webhooks"
```

Route an existing phone route to a Fabric resource only after reviewing the returned IDs and approval. The current route-assignment endpoint is `POST /api/fabric/resources/{id}/phone_routes`; it requires a `phone_route_id` and a `handler` of `calling` or `messaging`. See [Assign Resource to phone route](https://signalwire.com/docs/apis/rest/phone-numbers/assign-resource-phone-route):

```bash
curl --fail-with-body --request POST \
  --user "$SIGNALWIRE_PROJECT_ID:$SIGNALWIRE_API_TOKEN" \
  --header "Content-Type: application/json" \
  --data '{
    "phone_route_id":"<phone-route-id>",
    "handler":"calling"
  }' \
  "$SPACE_HOST/api/fabric/resources/<resource-id>/phone_routes"
```

Verify the route with a read request and a controlled test call/message. Treat purchase, route changes, releases, deletes, token/key rotation, and production deploys as external writes requiring explicit approval. Re-open [OpenAPI JSON](https://signalwire.com/openapi.json) or [OpenAPI YAML](https://signalwire.com/openapi.yaml) if an endpoint page and generated schema disagree.

### 5. Run a minimal Python or TypeScript agent

Choose `AgentBase` when the product is a voice AI agent rather than a fixed script. The SDK returns Calling SWML and exposes SWAIG tool endpoints.

Install the current packages and runtimes:

```bash
# Follow the repository's established package manager.
# Python 3.10+ with uv:
uv add signalwire-sdk

# Node.js 18+ when pnpm is the repository package manager:
pnpm add @signalwire/sdk
pnpm add --save-dev tsx
```

Use `signalwire-sdk` with `from signalwire import ...` in Python. Use the ESM-only `@signalwire/sdk` package in TypeScript; set `"type": "module"` in `package.json` and do not use `require()`.

Start with a deterministic Python agent:

```python
from signalwire import AgentBase


class WelcomeAgent(AgentBase):
    def __init__(self) -> None:
        super().__init__(name="welcome-agent")
        self.add_language("English", "en-US", "rime.spore")
        self.prompt_add_section(
            "Role",
            "Greet the caller and ask one concise question. Do not invent account data.",
        )


if __name__ == "__main__":
    WelcomeAgent().run()
```

Start the matching TypeScript agent:

```typescript
import { AgentBase } from "@signalwire/sdk";

const agent = new AgentBase({ name: "welcome-agent" });
agent.addLanguage({ name: "English", code: "en-US", voice: "rime.spore" });
agent.promptAddSection("Role", {
  body: "Greet the caller and ask one concise question. Do not invent account data.",
});
agent.run();
```

Both agents serve an HTTP endpoint (port `3000` by default) that returns Calling SWML. Protect the endpoint with `SWML_BASIC_AUTH_USER` and `SWML_BASIC_AUTH_PASSWORD`; set `SWML_PROXY_URL_BASE` when a proxy or tunnel hides the public URL. Follow [Server SDK installation](https://signalwire.com/docs/server-sdks/guides/installation), [quickstart](https://signalwire.com/docs/server-sdks/guides/quickstart), and [development environment](https://signalwire.com/docs/server-sdks/guides/dev-environment).

### 6. Add one SWAIG tool

Define a tool when the AI must call your code. Give it a narrow JSON Schema, validate every argument, authorize the requested operation in your handler, and return a `FunctionResult`:

```python
from signalwire import AgentBase, FunctionResult


class SupportAgent(AgentBase):
    def __init__(self) -> None:
        super().__init__(name="support-agent")
        self.prompt_add_section("Role", "Help callers check a ticket status.")
        self.define_tool(
            name="lookup_ticket",
            description="Look up a ticket by its opaque ticket identifier.",
            parameters={
                "type": "object",
                "properties": {
                    "ticket_id": {"type": "string", "description": "Ticket identifier"}
                },
                "required": ["ticket_id"],
            },
            handler=self.lookup_ticket,
        )

    def lookup_ticket(self, args: dict, raw_data: dict) -> FunctionResult:
        ticket_id = args.get("ticket_id", "")
        # Replace this fixed fixture with an authorized, bounded service call.
        status = {"TICKET-100": "open"}.get(ticket_id, "not found")
        return FunctionResult(f"Ticket {ticket_id} status: {status}.")
```

Use the TypeScript equivalent when the service is ESM:

```typescript
import { AgentBase, FunctionResult } from "@signalwire/sdk";

const agent = new AgentBase({ name: "support-agent" });
agent.promptAddSection("Role", { body: "Help callers check a ticket status." });
agent.defineTool({
  name: "lookup_ticket",
  description: "Look up a ticket by its opaque ticket identifier.",
  parameters: {
    type: "object",
    properties: { ticket_id: { type: "string", description: "Ticket identifier" } },
    required: ["ticket_id"],
  },
  handler: (args: Record<string, unknown>) => {
    const ticketId = typeof args.ticket_id === "string" ? args.ticket_id : "";
    const status = ticketId === "TICKET-100" ? "open" : "not found";
    return new FunctionResult(`Ticket ${ticketId} status: ${status}.`);
  },
});
agent.run();
```

Use `FunctionResult` actions such as `connect`, `hangup`, `send_sms`, or `update_global_data` only after validating and authorizing the request. Keep terminal actions last in a chain. Read [SWAIG](https://signalwire.com/docs/server-sdks/guides/swaig), [defining functions](https://signalwire.com/docs/server-sdks/guides/defining-functions), and [FunctionResult](https://signalwire.com/docs/server-sdks/reference/python/agents/function-result).

### 7. Choose RELAY for event-driven control

Use RELAY for deterministic IVR, low-level call control, recording, bridging, and reactions to call events. It maintains a persistent WebSocket and dispatches events to context subscriptions; it is not a replacement for AgentBase's prompt/tool lifecycle.

Use environment variables rather than embedding credentials:

```python
import os
from signalwire.relay import RelayClient


client = RelayClient(
    project=os.environ["SIGNALWIRE_PROJECT_ID"],
    token=os.environ["SIGNALWIRE_API_TOKEN"],
    host=os.environ["SIGNALWIRE_SPACE_HOST"],
    contexts=["<approved-context>"],
)


@client.on_call
async def handle_call(call) -> None:
    await call.answer()
    action = await call.play([{"type": "tts", "params": {"text": "Welcome."}}])
    await action.wait()
    await call.hangup()


client.run()
```

Subscribe only to contexts that this worker owns. Handle reconnection, action failures, timeouts, and shutdown. Use [RELAY Client](https://signalwire.com/docs/server-sdks/guides/relay-client) and the current [RELAY reference](https://signalwire.com/docs/server-sdks/reference/python/relay) for the exact action/event shape.

### 8. Compose multiple agents for production

Split agents by bounded responsibility, route each one at a stable path, and give each tool only the scopes it needs. For a shared Python process, use `AgentServer`; for independent scaling or fault isolation, deploy separate services behind a controlled router:

```python
from signalwire import AgentBase, AgentServer


class SalesAgent(AgentBase):
    def __init__(self) -> None:
        super().__init__(name="sales-agent", route="/sales")
        self.prompt_add_section("Role", "Handle product questions and approved sales handoff.")


class SupportAgent(AgentBase):
    def __init__(self) -> None:
        super().__init__(name="support-agent", route="/support")
        self.prompt_add_section("Role", "Handle support triage without exposing private data.")


server = AgentServer(host="0.0.0.0", port=3000)
server.register(SalesAgent(), "/sales")
server.register(SupportAgent(), "/support")
server.run()
```

Give every route its own prompt, tools, auth policy, health check, logs, and rollback plan. Move shared logic into tested internal libraries, not shared mutable agent state. Read [AgentServer](https://signalwire.com/docs/server-sdks/reference/python/agents/agent-server).

## Expose and route a webhook

Follow this order:

1. **Build:** Return a static `version: "1.0.0"` document from `/swml/calling` or `/swml/messaging`.
2. **Validate:** Parse JSON/YAML, require `version`, require `sections.main`, and reject unknown or malformed method shapes before deployment.
3. **Protect:** Require HTTPS, authenticate webhook requests, validate SignalWire signatures when configured, and rate-limit public endpoints. Do not put API tokens in URLs.
4. **Expose:** Use a tunnel only for local testing. Record the public URL and route path in the resource configuration.
5. **Attach:** In the Dashboard, select the resource and assign the phone route; or use the current Fabric/phone-route REST endpoint after approval.
6. **Exercise:** Test one inbound call and one inbound message separately. Confirm the webhook receives the expected `call` versus `message` payload and the response content type is accepted.
7. **Observe:** Record request IDs, call/message IDs, SWML validation failures, status callbacks, latency, and fallback activations without logging secrets or raw sensitive content.

Use `execute` for a reusable subroutine that returns; use `transfer` for a tail call that does not return. Keep `vars` and `params` semantics explicit in every remote handoff. See [Calling variables](https://signalwire.com/docs/swml/reference/calling#webhook-payload), [Messaging variables](https://signalwire.com/docs/swml/reference/messaging#webhook-payload), and [control flow](https://signalwire.com/docs/swml/guides/goto-execute-transfer-disambiguation).

## Validate, test, and deploy

Run the smallest check that proves each layer:

- **SWML:** Render JSON/YAML and validate against the current SWML schema. Keep `version` exactly `"1.0.0"`; verify a `main` section and flavor-specific methods.
- **Server webhook:** Send fixture payloads for Calling and Messaging webhooks; assert `Content-Type`, deterministic output, bounded request time, and safe failure behavior.
- **Agent:** Run `swaig-test <agent-file> --dump-swml`, `--list-tools`, and a specific `--exec <tool>` invocation. Use `curl` against the locally protected endpoint with credentials supplied via environment variables.
- **RELAY:** Exercise answer/play/collect/hangup with a test context and assert action completion plus reconnect behavior.
- **REST:** Use read endpoints first. Check token scopes and response IDs. Require an approval record for purchases, route changes, deletes, releases, deploys, and rotations.
- **Production:** Build an immutable artifact, inject secrets at runtime, expose HTTPS health/readiness endpoints, set timeouts, and roll out to a test number before production numbers.

The Agents SDK documents a `/debug` endpoint and `swaig-test` CLI for inspection. Enable debug event webhooks only in controlled development or staging; remove diagnostic tools before production. See [quickstart debugging](https://signalwire.com/docs/server-sdks/guides/quickstart#using-the-debug-endpoint) and [debug events](https://signalwire.com/docs/server-sdks/reference/python/agents/agent-base/enable-debug-events).

## Choose current versus legacy

Prefer these current surfaces for new work:

- Native REST/Fabric endpoints under `https://{space}.signalwire.com/api/...`.
- Calling and Messaging SWML with `version: "1.0.0"`.
- `signalwire-sdk` and `from signalwire import ...` for Python.
- ESM-only `@signalwire/sdk` for TypeScript.
- `AgentBase` for voice AI and SWAIG; RELAY for event-driven imperative control.
- Short-lived Bearer tokens for browser/client calls; never ship a Project ID plus API token to a client.

Label Compatibility API/cXML/TwiML and legacy SIP endpoint material as compatibility or legacy. Use it only when an existing integration requires it, and isolate it behind a migration boundary. Do not copy old `@signalwire/realtime-api` or legacy SIP endpoint examples into a new service. Confirm the endpoint's current status in [Compatibility API](https://signalwire.com/docs/compatibility-api) and the [REST API index](https://signalwire.com/docs/apis/llms.txt).

## Production checklist

- Keep one source of truth for every number-to-resource route and review changes.
- Scope API tokens to the smallest required REST capabilities; rotate only with explicit approval and a tested rollback.
- Keep `SWML_BASIC_AUTH_USER`, `SWML_BASIC_AUTH_PASSWORD`, signing keys, database credentials, and provider keys in a secret manager.
- Validate webhook signatures and reject replayed or malformed requests where the current SDK/API supports it.
- Make tool handlers idempotent for retries and require confirmation for purchases, transfers, releases, deletes, or other irreversible writes.
- Redact phone numbers, message bodies, transcripts, tool arguments, and auth headers in logs unless a documented retention policy permits them.
- Set bounded timeouts and safe fallbacks for every external request; never allow an AI tool to perform an unrestricted network request.
- Load the current `.md` endpoint page or OpenAPI schema during every implementation pass; do not infer fields from an older snippet.
- Obtain explicit approval before external writes: purchases, production releases/deploys, route changes, deletes, token/key rotation, or billing-affecting operations.

## Primary sources

- [SWML introduction and document structure](https://signalwire.com/docs/swml)
- [Calling SWML reference](https://signalwire.com/docs/swml/reference/calling)
- [Messaging SWML reference](https://signalwire.com/docs/swml/reference/messaging)
- [SWML deployment guide](https://signalwire.com/docs/swml/guides/deployment)
- [REST authorization](https://signalwire.com/docs/apis/authorization)
- [REST API index and OpenAPI links](https://signalwire.com/docs/apis/llms.txt)
- [Platform and Dashboard](https://signalwire.com/docs/platform/llms.txt)
- [Fax](https://signalwire.com/docs/platform/fax.md)
- [Browser SDK](https://signalwire.com/docs/browser-sdk/llms.txt)
- [SWSH](https://signalwire.com/docs/platform/swsh.md)
- [WireStarter](https://signalwire.com/docs/platform/wirestarter.md)
- [Server SDK CLI tools](https://signalwire.com/docs/server-sdks/reference/python/agents/cli.md)
- [Server SDK quickstart](https://signalwire.com/docs/server-sdks/guides/quickstart)
- [RELAY Client guide](https://signalwire.com/docs/server-sdks/guides/relay-client)
