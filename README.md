# signalwire-admin-mcp

A [Model Context Protocol](https://modelcontextprotocol.io) server that exposes
SignalWire administration operations to AI clients over stdio. It lets an MCP-aware
assistant discover, configure, test, and diagnose SignalWire voice, messaging, and
knowledge (Datasphere) resources through 15 tools backed by the official
`@signalwire/sdk` REST client.

- **Transport:** stdio
- **Runtime:** Node.js ≥ 20.19.0 (ESM, TypeScript)
- **SDK:** pinned to `@signalwire/sdk` 2.0.5

## Tools

The server registers exactly these 15 tools. Mutating tools are gated behind
`SIGNALWIRE_MCP_ALLOW_WRITES`; they return a `blocked` envelope when writes are off.

| Tool | Category | Hint | What it does |
| --- | --- | --- | --- |
| `signalwire_find_resources` | Discovery | read-only | Discover phone numbers, Fabric resources, and Datasphere documents |
| `signalwire_deploy_ai_agent` | Deployment | destructive/idempotent | Create or update a Fabric AI Agent, optionally bind a number |
| `signalwire_deploy_call_flow_version` | Deployment | destructive | Publish a known version of an existing Call Flow, optionally bind a number |
| `signalwire_deploy_swml_script` | Deployment | destructive/idempotent | Create or fully replace a managed SWML Script (Calling or Messaging) |
| `signalwire_connect_webhook` | Deployment | destructive/idempotent | Route a number to externally deployed SWML/cXML at an HTTPS URL |
| `signalwire_connect_relay_application` | Deployment | destructive/idempotent | Create/update a RELAY registration and connect a number |
| `signalwire_provision_test_number` | Deployment | — | Purchase one exact number previously returned by discovery |
| `signalwire_add_knowledge` | Knowledge | — | Add one URL-backed Datasphere document for RAG ingestion |
| `signalwire_search_knowledge` | Knowledge | read-only | Semantic search over Datasphere documents |
| `signalwire_run_call_test` | Testing | — | Start one bounded outbound development call that speaks text and hangs up |
| `signalwire_run_message_test` | Testing | — | Send one text-only development SMS via the Compatibility API |
| `signalwire_control_call` | Call control | destructive | High-level lifecycle action (end/transfer) on a live test call |
| `signalwire_exercise_call_feature` | Call control | — | Exercise one non-AI media feature on a live call |
| `signalwire_control_ai_call` | Call control | destructive | Interact with an AI session running on a live call |
| `signalwire_diagnose_interaction` | Diagnostics | read-only | Assemble read-only evidence about a past voice call or message |

## Requirements

- Node.js ≥ 20.19.0
- [pnpm](https://pnpm.io) 11 (the project pins `pnpm@11.16.0`)
- A SignalWire account with a **Space**, **Project ID**, and a scoped **API token**
  with the permissions the tools you use require

## Configure

All configuration is read from the environment via three required variables and one
optional write-gate flag. Copy `.env.example` and fill in your values:

```ini
SIGNALWIRE_SPACE=example.signalwire.com
SIGNALWIRE_PROJECT_ID=00000000-0000-0000-0000-000000000000
SIGNALWIRE_API_TOKEN=your-scoped-api-token
SIGNALWIRE_MCP_ALLOW_WRITES=false
```

| Variable | Required | Notes |
| --- | --- | --- |
| `SIGNALWIRE_SPACE` | yes | Bare hostname (e.g. `example.signalwire.com`) or an `https://` URL containing only that host. Paths, ports, query strings, fragments, and credentials are rejected. |
| `SIGNALWIRE_PROJECT_ID` | yes | Your SignalWire Project ID (UUID). |
| `SIGNALWIRE_API_TOKEN` | yes | A scoped API token. Its value is never echoed in output or errors. |
| `SIGNALWIRE_MCP_ALLOW_WRITES` | no | Literal `"true"` or `"false"`. Defaults to `"false"`, which blocks every mutating tool. |

At startup the server validates all variables and reports every problem in a single
error; it exits nonzero on misconfiguration without printing anything to stdout
(stdout is reserved for MCP JSON-RPC frames).

## Connect from an MCP client

Point any stdio MCP client (Claude Desktop, Cursor, etc.) at the server. The server is
configured entirely through environment variables, so the two methods below differ only
in `command`/`args`.

### Global install (recommended)

Install once with pnpm to put the `signalwire-admin-mcp` command on your `PATH`:

```bash
pnpm add -g @bradsjm/signalwire-admin-mcp
```

Then reference the command by name — no `args` needed:

```jsonc
{
  "mcpServers": {
    "signalwire-admin-mcp": {
      "command": "signalwire-admin-mcp",
      "env": {
        "SIGNALWIRE_SPACE": "example.signalwire.com",
        "SIGNALWIRE_PROJECT_ID": "00000000-0000-0000-0000-000000000000",
        "SIGNALWIRE_API_TOKEN": "your-scoped-api-token",
        "SIGNALWIRE_MCP_ALLOW_WRITES": "false"
      }
    }
  }
}
```

### From a local build

Clone the repo and build the TypeScript to `dist/`:

```bash
pnpm install
pnpm build
```

Then point the client at the built entry point:

```jsonc
{
  "mcpServers": {
    "signalwire-admin-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/signalwire-admin-mcp/dist/index.js"],
      "env": {
        "SIGNALWIRE_SPACE": "example.signalwire.com",
        "SIGNALWIRE_PROJECT_ID": "00000000-0000-0000-0000-000000000000",
        "SIGNALWIRE_API_TOKEN": "your-scoped-api-token",
        "SIGNALWIRE_MCP_ALLOW_WRITES": "false"
      }
    }
  }
}
```

## Result envelope

Every tool returns the same strict result envelope as `structuredContent` (and as
compact JSON in a single text block). The shape is enforced in Zod so it cannot drift
by convention:

```ts
{
  status: "complete" | "unchanged" | "accepted" | "partial"
        | "confirmation_required" | "blocked" | "not_found"
        | "unsupported" | "error",
  summary: string,                 // 1–1000 chars
  resource_id?: string,            // primary durable resource affected
  call_id?: string,                // voice test correlation
  message_sid?: string,            // SMS test correlation
  control_id?: string,             // for stopping a started media feature
  platform_status?: string,        // latest platform-reported status
  safe_to_retry?: boolean,         // may the caller repeat after a partial?
  next_step?: string,              // concrete next action when relevant
  resources?:  Resource[],         // durable read-back (≤ 20)
  items?:      Item[],             // discovery / search results (≤ 20)
  operations?: Operation[],        // per-invocation journal (≤ 20)
  evidence?:   Evidence[],         // observed facts (≤ 20)
  inferences?: Inference[],        // reasoned conclusions + confidence (≤ 20)
  unknowns?:   string[],           // gaps and uncertainties (≤ 20)
  error?:      Error,              // sanitized failure detail (error status only)
}
```

Status-dependent invariants are enforced: `error` requires `error`, `accepted`
requires a correlation id, `confirmation_required`/`blocked`/`not_found`/`unsupported`
require `next_step`, and `partial` requires a non-empty `operations` journal and
`safe_to_retry`.

## Safety model

- **Write gate.** `SIGNALWIRE_MCP_ALLOW_WRITES=false` (the default) blocks every
  mutating tool; they return `blocked` with a `next_step` rather than touching state.
- **Version-locked capability registry.** `src/signalwire/capabilities.ts` is the sole,
  auditable mapping from each tool/action to the pinned SDK methods it uses. Operations
  absent from the registry are unsupported — there is no raw-HTTP escape hatch.
- **Bounded I/O.** Each tool has a strict Zod input schema and only projects bounded,
  contract-defined fields into output.
- **Secret redaction.** Sensitive keys (`token`, `authorization`, `secret`,
  `api_key`, `signed_url`, …) are recursively scrubbed to `[redacted]` before any value
  reaches output. The API token is never echoed.
- **Channel discipline.** stdout carries only MCP frames; sanitized audit lines
  (tool name, elapsed ms, outcome status — no argument values) go to stderr.

## Development

```bash
pnpm install        # install dependencies
pnpm build          # tsc -> dist/, makes dist/index.js executable
pnpm dev            # run src/index.ts directly via tsx
pnpm start          # run the built dist/index.js
pnpm typecheck      # tsc --noEmit
pnpm test           # build, then run the vitest suite
```

### Project layout

```
src/
  index.ts            executable entry point (stdio bootstrap)
  server.ts           MCP server factory; registers all 15 tools
  config.ts           environment loading + validation
  signalwire/
    client.ts         sole RestClient boundary (constructs the SDK client)
    capabilities.ts   version-locked capability registry
  core/
    output.ts         strict result envelope + finalization/redaction
    schemas.ts        bounded string schemas
    redaction.ts      secret scrubbing + sanitized audit logging
    errors.ts         error classification/normalization
  tools/
    contracts.ts      every tool input schema + result parser
    runtime.ts        shared orchestration (write gate, executeTool)
    inventory.ts      deployment.ts    knowledge.ts
    testing.ts        call-control.ts  diagnostics.ts
tests/
  server-contract.test.ts  stdio.test.ts
  sdk-compositions.test.ts helpers.ts
```

## License

Private package (`@bradsjm/signalwire-admin-mcp` v0.1.0).
