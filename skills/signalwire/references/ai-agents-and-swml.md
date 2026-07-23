# AI agents and SWML

Load this reference when a solution combines Calling or Messaging SWML with AI, SWAIG tools, DataMap integrations, AgentBase, skills, MCP, or production conversation state. Re-open the current [SWML documentation](https://signalwire.com/docs/swml), each linked method page, and the [Server SDK reference](https://signalwire.com/docs/server-sdks) before coding: SWML schemas, SDK signatures, limits, and native capabilities evolve.

## Contents

- [Choose a document flavor](#choose-a-document-flavor)
- [Understand variables and expressions](#understand-variables-and-expressions)
- [Control execution](#control-execution)
- [Add AI and SWAIG](#add-ai-and-swaig)
- [Choose handler, DataMap, or native function](#choose-handler-datamap-or-native-function)
- [Build with AgentBase and POM](#build-with-agentbase-and-pom)
- [Implement tools and FunctionResult](#implement-tools-and-functionresult)
- [Keep state and contexts deliberate](#keep-state-and-contexts-deliberate)
- [Add skills and MCP](#add-skills-and-mcp)
- [Test and debug](#test-and-debug)
- [Secure and operate in production](#secure-and-operate-in-production)
- [Primary sources](#primary-sources)

## Choose a document flavor

Use Calling SWML for voice calls and Messaging SWML for inbound SMS/MMS. Both documents require `version: "1.0.0"`, a `sections` map, and `sections.main` as the entry point. Do not copy a Calling method into a Messaging document or assume their variable syntax is interchangeable.

### Calling SWML

Answer, play, prompt, branch, connect, transfer, record, and start AI on a call:

```json
{
  "version": "1.0.0",
  "sections": {
    "main": [
      { "answer": {} },
      { "play": { "url": "say:Hello from a Calling SWML document." } },
      { "hangup": {} }
    ]
  }
}
```

SignalWire fetches a Calling document from an external URL with a POST containing a `call` object and context scopes such as `params`, `vars`, and `envs`. Treat the context scopes as fetch-dependent objects rather than mandatory keys: the current docs describe `params: {}` and no `vars` on an initial inbound fetch, while a verified initial outbound REST-dial fetch carried `vars: {}` and `envs` but omitted `params`. In that outbound fetch, REST `custom_variables` appeared under `envs`. Require only the fields the application uses, validate any present scope as an object, and preserve additive fields. The server must return `application/json`, `application/yaml`, or `text/x-yaml`. Each call leg owns its `call` object; connecting to a new leg reinitializes it. Read the [Calling SWML overview](https://signalwire.com/docs/swml/reference/calling).

### Messaging SWML

Reply to, receive, branch on, and transfer an inbound SMS/MMS:

```json
{
  "version": "1.0.0",
  "sections": {
    "main": [
      {
        "switch": {
          "variable": "message.body",
          "transform": "lowercase_trim",
          "case": {
            "help": [
              { "reply": { "body": "Reply STOP to unsubscribe." } }
            ]
          },
          "default": [
            { "reply": { "body": "Reply HELP for assistance." } }
          ]
        }
      }
    ]
  }
}
```

SignalWire fetches a Messaging document with the inbound `message`, `params`, and runtime `vars`. Messaging SWML accepts `%{path}` substitution only; use `switch` for branching and `request` for server-side computation. Limit each inbound execution to 100 method steps. Read the [Messaging SWML overview](https://signalwire.com/docs/swml/reference/messaging) and [Messaging `switch`](https://signalwire.com/docs/swml/reference/messaging/switch).

### Distinguish the deployment modes

- **Dashboard/serverless:** Store SWML in a SignalWire resource. Let SignalWire evaluate runtime placeholders; use `request` for external data.
- **External webhook:** Serve SWML from your HTTPS server. Validate the incoming payload, perform authenticated backend work, and return a document.
- **AgentBase:** Let `signalwire-sdk` or `@signalwire/sdk` generate Calling SWML and SWAIG wiring from agent configuration.
- **RELAY:** Use the event-driven WebSocket client when imperative call control matters more than declarative SWML or AI.

Configure the number/resource route separately from the document. Use the native REST/Fabric APIs for repeatable provisioning; require explicit approval before purchases, route changes, releases, deletes, deploys, or token/key rotation. See [SWML deployment](https://signalwire.com/docs/swml/guides/deployment) and [REST API authorization](https://signalwire.com/docs/apis/authorization).

## Understand variables and expressions

Use the correct syntax and scope for each flavor:

| Flavor | Runtime scopes | Substitution | JavaScript expressions |
| --- | --- | --- | --- |
| Calling | `call`; context-dependent `params`, `vars`, `envs` | `${path}` or `%{path}` | Calling supports `${...}` expressions |
| Messaging | `message`, `params`, `vars` | `%{path}` | Messaging does not support JavaScript expressions |

Reference fields with explicit scope, for example `${call.from}`, `%{message.body}`, `${vars.customer_tier}`, or `%{vars.request_response.status}`. Use dot and bracket access only when the relevant scope exists, such as `%{message.media[0].url}` in Messaging; do not assume a field exists on every call or message. Calling unprefixed names search `vars` and then `envs`; use explicit prefixes to avoid collisions.

Set and unset runtime state with Calling `set` and `unset`. Methods can also populate variables such as a prompt result or request response. Calling `vars` persist across sections and `execute` calls, propagate through transfers, and reset when a new call leg starts. Messaging `vars` propagate through transfers and record outputs such as the latest reply and request result. Read [Variables](https://signalwire.com/docs/swml/reference/variables), [Calling webhook variables](https://signalwire.com/docs/swml/reference/calling#webhook-payload), and [Messaging webhook variables](https://signalwire.com/docs/swml/reference/messaging#webhook-payload).

Use Calling expressions for bounded transformations, not business logic or secrets:

```yaml
version: 1.0.0
sections:
  main:
    - set:
        caller_type: "${call.type}"
        caller_suffix: "${call.from.substring(call.from.length - 4)}"
    - cond:
        - when: call.type.toLowerCase() == 'phone'
          then:
            - play:
                url: "say:This call came from a phone number ending in ${caller_suffix}."
        - else:
            - play:
                url: "say:This call came from ${caller_type}."
```

Write conditions as JavaScript expressions without wrapping the entire condition in `${...}`. Keep database queries, authorization, transformations requiring secrets, and multi-step policy on your server. Use [Calling expressions](https://signalwire.com/docs/swml/reference/expressions) and [template functions](https://signalwire.com/docs/swml/reference/template-functions) as the authority for supported evaluation.

## Control execution

Compose small named sections and select the right control-flow operation:

| Method | Behavior | Use it for |
| --- | --- | --- |
| `execute` | Invoke a section or remote SWML as a subroutine and return | Reusable greeting, lookup, or menu |
| `return` | Return from `execute`, optionally with a value | Finish a subroutine explicitly |
| `transfer` | Tail-call another section or remote SWML; do not return | Hand off ownership to another flow |
| `goto` + `label` | Jump within the current section | Bounded retry or menu loop |
| Calling `cond` | Branch on a JavaScript expression | Small call-time conditions |
| `switch` | Branch on a value/case map | Exact keyword/value routing |

Keep loops bounded and make the fallback explicit. Pass only intentional values in `params`; remember that `execute` scopes and restores caller parameters while `transfer` hands the rest of the flow to the target. Re-open [Calling control flow](https://signalwire.com/docs/swml/guides/goto-execute-transfer-disambiguation) and the per-method pages before using remote URLs.

## Add AI and SWAIG

Place the Calling `ai` method after any required `answer`, `play`, or `record_call` setup. Configure a prompt, language, parameters, and a narrow SWAIG function schema:

```json
{
  "version": "1.0.0",
  "sections": {
    "main": [
      { "answer": {} },
      {
        "ai": {
          "prompt": {
            "text": "You are a support receptionist. Ask for a ticket identifier before looking up status. Never invent a status."
          },
          "languages": [
            { "name": "English", "code": "en-US", "voice": "rime.spore" }
          ],
          "SWAIG": {
            "functions": [
              {
                "function": "lookup_ticket",
                "description": "Look up one ticket by its opaque identifier.",
                "parameters": {
                  "type": "object",
                  "properties": {
                    "ticket_id": { "type": "string", "description": "Ticket identifier" }
                  },
                  "required": ["ticket_id"]
                },
                "web_hook_url": "https://app.example.invalid/swaig"
              }
            ]
          }
        }
      }
    ]
  }
}
```

The AI selects a function from its description and schema. SignalWire sends a structured POST to the function URL; read the function name and parsed arguments from the request, authorize the operation, and return a JSON object containing `response` plus optional `action` entries. Keep the response useful to the model and keep actions explicit. Read [Calling `ai`](https://signalwire.com/docs/swml/reference/calling/ai), [SWAIG](https://signalwire.com/docs/swml/guides/swaig), [SWAIG functions](https://signalwire.com/docs/swml/reference/calling/ai/swaig/functions), and the [AI SWAIG webhook API](https://signalwire.com/docs/apis/rest/calls/webhooks/ai-swaig-tool-webhook).

Treat AI output as untrusted input. Validate the schema again in the handler, authorize against the caller/session, cap result size and latency, and make writes idempotent. Do not place a bearer token or API token in a `web_hook_url` unless the current documentation explicitly requires and protects that form; prefer authenticated headers or the SDK's signing mechanisms.

## Choose handler, DataMap, or native function

Choose by where logic should execute and how much control you need:

| Option | Runs | Use it for | Avoid it when |
| --- | --- | --- | --- |
| Handler-backed SWAIG tool | Your service | Databases, policy, multi-step logic, private APIs, audited writes | A direct REST call and a template are sufficient |
| `DataMap` | SignalWire infrastructure | One or a few REST calls with parameters, expressions, and formatted output | You need complex code, private network access, custom auth, or durable transactions |
| Native function | SignalWire platform | Built-in capabilities such as `web_search` or development `debug` | You need domain filtering, auditing, private data, or deterministic search |

### Handler-backed tool

Use the SDK's current imports and return `FunctionResult`:

```python
from signalwire import AgentBase, FunctionResult

agent = AgentBase(name="support-agent")
agent.set_prompt_text("Check ticket status; never expose private ticket fields.")


def lookup_ticket(args: dict, raw_data: dict) -> FunctionResult:
    ticket_id = args.get("ticket_id", "")
    if ticket_id != "TICKET-100":
        return FunctionResult("I could not find that ticket.")
    return FunctionResult("Ticket TICKET-100 is open.")


agent.define_tool(
    name="lookup_ticket",
    description="Look up a ticket by its opaque identifier.",
    parameters={
        "type": "object",
        "properties": {"ticket_id": {"type": "string"}},
        "required": ["ticket_id"],
    },
    handler=lookup_ticket,
)
```

Replace the fixture with an authenticated service call. Keep the handler's allow-list, authorization, timeout, and error mapping around that call.

### DataMap

Use `DataMap` for a declarative REST integration. Keep the endpoint a placeholder until you configure an approved service:

```python
from signalwire import AgentBase
from signalwire.core.data_map import DataMap
from signalwire.core.function_result import FunctionResult

agent = AgentBase(name="ticket-agent")
ticket_lookup = (
    DataMap("lookup_ticket")
    .purpose("Look up a ticket by its opaque identifier")
    .parameter("ticket_id", "string", "Ticket identifier", required=True)
    .webhook(
        "GET",
        "https://api.example.invalid/tickets/${enc:args.ticket_id}",
    )
    .output(FunctionResult("Ticket ${args.ticket_id} status: ${response.status}."))
    .fallback_output(FunctionResult("The ticket service is unavailable."))
)
agent.register_swaig_function(ticket_lookup.to_swaig_function())
```

Use `${args.*}`, `${response.*}`, `${enc:*}`, `${global_data.*}`, and `${meta_data.*}` according to the [DataMap reference](https://signalwire.com/docs/server-sdks/reference/python/agents/data-map). Treat external URLs, headers, and returned fields as an integration boundary; configure allow-lists, redaction, error keys, and response-size limits.

### Native function

Enable only the built-in functions required by the agent. SignalWire documents `web_search` and `debug` as native functions; remove `debug` before production:

```python
from signalwire import AgentBase

agent = AgentBase(
    name="research-agent",
    native_functions=["web_search"],
)
agent.set_prompt_text(
    "Use web search only for general public facts; never search for customer data."
)
```

Native web search does not provide your preferred engine, domain filtering, result logging, or private-site access. Use a handler or controlled DataMap integration when you need those guarantees. Read [Native Functions](https://signalwire.com/docs/server-sdks/guides/native-functions).

## Build with AgentBase and POM

Use `AgentBase` to generate Calling SWML, serve webhook routes, register tools, load skills, and manage AI configuration. The current Python package is `signalwire-sdk`, imported as `from signalwire import ...`; the current TypeScript package is ESM-only `@signalwire/sdk`.

Install on supported runtimes with the repository's established package manager:

```bash
# Python 3.10+ with uv:
uv add signalwire-sdk

# Node.js 18+ when pnpm is the repository package manager:
pnpm add @signalwire/sdk
```

Build a minimal Python agent with structured POM sections:

```python
from signalwire import AgentBase


class TriageAgent(AgentBase):
    def __init__(self) -> None:
        super().__init__(name="triage-agent")
        self.add_language("English", "en-US", "rime.spore")
        self.prompt_add_section(
            "Role",
            "Route callers to support without inventing account information.",
        )
        self.prompt_add_section(
            "Rules",
            body="Follow these rules:",
            bullets=[
                "Ask one question at a time.",
                "Use a tool before stating ticket status.",
                "Offer a human handoff when the request is unsupported.",
            ],
        )
```

POM renders structured sections into the AI prompt. Use a plain text prompt for a small agent, POM for independently maintained sections, and contexts for named conversation modes. Do not provide mutually conflicting `text` and `pom` configurations; follow the [prompt reference](https://signalwire.com/docs/swml/reference/calling/ai/prompt) and [AgentBase reference](https://signalwire.com/docs/server-sdks/reference/python/agents/agent-base).

Use the corresponding ESM TypeScript surface:

```typescript
import { AgentBase } from "@signalwire/sdk";

const agent = new AgentBase({ name: "triage-agent" });
agent.addLanguage({ name: "English", code: "en-US", voice: "rime.spore" });
agent.promptAddSection("Role", {
  body: "Route callers to support without inventing account information.",
});
agent.promptAddSection("Rules", {
  body: "Follow these rules:",
  bullets: [
    "Ask one question at a time.",
    "Use a tool before stating ticket status.",
    "Offer a human handoff when the request is unsupported.",
  ],
});
agent.run();
```

Configure `SWML_BASIC_AUTH_USER`, `SWML_BASIC_AUTH_PASSWORD`, and `SWML_PROXY_URL_BASE` through the environment. Set a signing key when the current SDK deployment requires request signature validation. Keep the generated endpoint off the public internet until HTTPS and authentication work.

## Implement tools and FunctionResult

Return a `FunctionResult` from every handler. It contains model-facing response text and an ordered action list; fluent methods return the same object. Put terminal actions such as `connect(final=True)` or `hangup()` last. Use actions only after validation and authorization:

```python
from signalwire import FunctionResult


def transfer_to_support(args: dict, raw_data: dict) -> FunctionResult:
    department = args.get("department")
    if department != "support":
        return FunctionResult("I can transfer only to the approved support queue.")
    return FunctionResult("I will transfer you to support.").connect(
        "<approved-destination>",
        final=True,
    )
```

Useful action categories include `connect`, `hangup`, `hold`, `say`, `send_sms`, `update_global_data`, `set_metadata`, SWML transfer, context/step changes, and user events. Prefer a small action list, keep external writes idempotent, and include a safe response when a downstream service fails. Read [FunctionResult](https://signalwire.com/docs/server-sdks/reference/python/agents/function-result) and the [SWAIG response contract](https://signalwire.com/docs/swml/reference/calling/ai/swaig/functions).

## Keep state and contexts deliberate

Separate these state types:

- **SWML `vars`:** Calling/Messaging runtime values created by methods; use them for flow-local state and pass only intentional values through `params`.
- **AI `global_data`:** Key/value data available across the AI session, prompts, and SWAIG-returned SWML. Store non-sensitive conversation state; do not put secrets here.
- **SWAIG `meta_data`:** Tool-local metadata that should not be exposed to the LLM; use it for correlation or policy context when configured.
- **Your datastore:** Durable state, authorization facts, idempotency keys, and audit records. Never treat conversation text as authoritative state.

Use `FunctionResult.update_global_data(...)` for an approved session update, and use a database transaction for durable writes. Redact state before logging it.

Model multi-stage conversations with prompt contexts. Require a `default` context, name each step, and allow only explicit transitions:

```yaml
version: 1.0.0
sections:
  main:
    - ai:
        prompt:
          text: "You are a support agent."
          contexts:
            default:
              steps:
                - name: greeting
                  text: "Greet the caller and ask whether they need support."
                  valid_contexts:
                    - support
            support:
              isolated: true
              steps:
                - name: troubleshoot
                  text: "Troubleshoot the reported issue and offer an approved handoff."
                  valid_contexts:
                    - default
```

Use `isolated: true` when the context should reset conversation history to the system prompt. Use context/step actions from a tool only after validating the transition. Read [prompt contexts](https://signalwire.com/docs/swml/reference/calling/ai/prompt#contexts) and [context switching](https://signalwire.com/docs/swml/guides/context-switch).

## Add skills and MCP

Use built-in skills for reusable capability bundles of prompts, hints, and tools. Add only what the prompt needs:

```python
from signalwire import AgentBase

agent = AgentBase(name="assistant")
agent.add_skill("datetime")
agent.add_skill("math")
```

For TypeScript, use the current `@signalwire/sdk` skill classes or `addSkillByName` API documented for the installed version; do not infer asynchronous behavior from an older snippet. Read [Skills](https://signalwire.com/docs/server-sdks/guides/understanding-skills) and the installed SDK reference before wiring a skill into a production agent.

Connect to an external MCP server as a client only when its tools and resources have an explicit trust boundary:

```python
from signalwire import AgentBase

agent = AgentBase(name="assistant")
agent.add_mcp_server(
    url="https://mcp.example.invalid/http",
    headers={"Authorization": "Bearer <mcp-token-from-secret-store>"},
    resources=False,
)
```

Use `enable_mcp_server()` to expose your own agent tools at `/mcp` for an external MCP client. Call `add_mcp_server()` separately if you also want the agent to discover that endpoint in its SWML. Allow-list tool names, authenticate the MCP connection, and never pass a raw user-controlled URL. Read [add MCP server](https://signalwire.com/docs/server-sdks/reference/python/agents/agent-base/add-mcp-server) and [enable MCP server](https://signalwire.com/docs/server-sdks/reference/python/agents/agent-base/enable-mcp-server).

## Test and debug

Exercise the generated contract before placing a real call:

1. Render SWML and inspect `version`, `sections.main`, AI configuration, and every SWAIG schema.
2. Execute each handler with valid, missing, malformed, unauthorized, and repeated arguments.
3. Test `FunctionResult` action ordering and terminal actions separately.
4. Send Calling and Messaging webhook fixtures to separate endpoints and assert their content types.
5. Test context transitions, state reset at a new call leg, and bounded loops.
6. Use a staging number/resource with synthetic data before a production route.

For Python agents, use the documented CLI and local endpoint checks:

```bash
swaig-test <agent-file> --dump-swml
swaig-test <agent-file> --list-tools
swaig-test <agent-file> --exec <tool-name>
curl --fail-with-body \
  --user "$SWML_BASIC_AUTH_USER:$SWML_BASIC_AUTH_PASSWORD" \
  http://localhost:3000/
```

Enable the SDK debug endpoint only in controlled development. For real-time AI events, call `enable_debug_events(level=1)` and register `on_debug_event`; the SDK receives events at `/debug_events`. Use level `1` for session, error, barge, and step events; use higher levels only when you need high-volume LLM/conversation events. Remove debug functions/routes and redact event payloads before production. Read [debug events](https://signalwire.com/docs/server-sdks/reference/python/agents/agent-base/enable-debug-events), [debug callbacks](https://signalwire.com/docs/server-sdks/reference/python/agents/agent-base/on-debug-event), and [quickstart debugging](https://signalwire.com/docs/server-sdks/guides/quickstart#using-the-debug-endpoint).

## Secure and operate in production

- Keep server API authentication as Basic Auth with the Project ID and a narrowly scoped API token. Keep it server-side. Use short-lived Bearer tokens for client-side Fabric calls.
- Require HTTPS for SWML, SWAIG, MCP, status callbacks, and REST. Authenticate webhooks and validate current SignalWire signing mechanisms where configured.
- Keep `SWML_BASIC_AUTH_USER`, `SWML_BASIC_AUTH_PASSWORD`, signing keys, MCP tokens, database credentials, and provider keys in a secret manager. Never place real secrets in SWML, POM, logs, URLs, fixtures, or source control.
- Treat caller speech, message bodies, tool arguments, and AI output as untrusted. Validate JSON schemas, normalize identifiers, allow-list destinations, and authorize every read/write against the session and account.
- Require explicit confirmation before purchases, releases, deletes, transfers, production deploys, token/key rotation, or any other irreversible external write. Make tools idempotent and persist an audit record.
- Use DataMap only with approved URLs and bounded response sizes. Protect against SSRF, untrusted redirects, credential leakage, and prompt injection through returned API text.
- Set timeouts, retries with idempotency, circuit breakers, and safe fallbacks for backend calls. Do not retry a non-idempotent write without a durable idempotency key.
- Separate AI sessions, durable account state, and observability. Redact PII and secrets; define transcript retention, access, and deletion policies.
- Monitor SWML fetch latency, SWAIG latency/errors, tool success, context transitions, call/message completion, fallback routes, and token/usage cost. Alert on unexpected tool names or route changes.
- Pin tested package versions, render and validate SWML in CI, stage with a test number, and roll back by changing the resource route only after approval.
- Re-open the current endpoint `.md` page or [OpenAPI specification](https://signalwire.com/openapi.json) during implementation; do not rely on a copied schema.

Label Compatibility API/cXML/TwiML and legacy SIP endpoints as legacy. Use them only behind a migration boundary for an existing integration; prefer native REST/Fabric, SWML, `signalwire-sdk`, and ESM `@signalwire/sdk` for new work. Read [Compatibility API](https://signalwire.com/docs/compatibility-api) when a migration requires it.

## Primary sources

- [SWML introduction](https://signalwire.com/docs/swml)
- [Calling SWML overview](https://signalwire.com/docs/swml/reference/calling)
- [Messaging SWML overview](https://signalwire.com/docs/swml/reference/messaging)
- [Variables](https://signalwire.com/docs/swml/reference/variables)
- [Expressions](https://signalwire.com/docs/swml/reference/expressions)
- [Calling AI](https://signalwire.com/docs/swml/reference/calling/ai)
- [SWAIG guide](https://signalwire.com/docs/swml/guides/swaig)
- [DataMap reference](https://signalwire.com/docs/server-sdks/reference/python/agents/data-map)
- [AgentBase reference](https://signalwire.com/docs/server-sdks/reference/python/agents/agent-base)
- [FunctionResult reference](https://signalwire.com/docs/server-sdks/reference/python/agents/function-result)
- [Skills guide](https://signalwire.com/docs/server-sdks/guides/understanding-skills)
- [Native Functions](https://signalwire.com/docs/server-sdks/guides/native-functions)
