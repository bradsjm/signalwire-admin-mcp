# Repository Guidelines

## Project Overview

`signalwire-admin-mcp` is a TypeScript **MCP (Model Context Protocol) server** that exposes SignalWire administrative operations to MCP clients (e.g., AI assistants). It runs as a stdio process and registers **15 tools** spanning resource discovery, deployment/provisioning, knowledge (RAG), live call testing/control, and interaction diagnostics. The server fronts the SignalWire REST/RELAY/Compatibility APIs through a narrow, auditable, redaction-safe boundary.

## Architecture & Data Flow

**Entry → Config → Client → Server → stdio** (`src/index.ts`):

1. `loadConfig(process.env)` (`src/config.ts`) reads & validates env vars, normalizing the Space host.
2. `createSignalWireClient(config)` (`src/signalwire/client.ts`) builds the SDK `RestClient`.
3. `createServer({ config, client })` (`src/server.ts`) constructs `new McpServer(...)` and registers all 15 tools.
4. `server.connect(new StdioServerTransport())` serves JSON-RPC over stdin/stdout.

**Per-request flow** (every tool is wrapped by `executeTool()` in `src/tools/runtime.ts`):

```
MCP client → server.registerTool handler → executeTool(body)
  → tool handler calls SignalWire client (returns Promise<unknown>)
  → bounded parser in contracts.ts projects unknown → envelope
  → finalize(): outputEnvelopeSchema.parse() → redactDeep() → writeAudit() (stderr)
  → returns { content:[{type:"text", text: JSON}], structuredContent, isError }
```

- **Mutations** are gated *before* any SDK call: a **write-gate** (`writeGateBlocked` when `allowWrites=false`) and a **confirmation gate** (`confirmationRequiredEnvelope` for destructive/duplicate-binding actions).
- **Errors** thrown anywhere are caught by `executeTool` → `toErrorEnvelope()` (`src/core/errors.ts`), classified by HTTP status into 9 categories with `safe_to_retry` + `next_step` guidance.
- The **capability registry** (`src/signalwire/capabilities.ts`) maps every tool/action to auditable SDK dotted paths (`read`/`mutate`/`readback`) and its output `parser` — there is no raw-HTTP fallback.

## Key Directories

| Path | Purpose |
|------|---------|
| `src/index.ts` | Process entry (shebang). Wires config→client→server, connects stdio transport, redacts startup errors. |
| `src/server.ts` | MCP server factory. Registers all 15 tools with descriptions, input/output schemas, and MCP annotations. |
| `src/config.ts` | Env-var loader/validator. Aggregates all validation errors; never echoes the API token. |
| `src/tools/` | Tool handler modules (one concern each) + shared orchestration. |
| `src/tools/contracts.ts` | **Sole owner** of all 15 Zod input schemas and bounded projection parsers (`asArray`, `toItem`, `toResource`, `pickId`). |
| `src/tools/runtime.ts` | `ToolContext` type + `executeTool()` wrapper (gating, error catch, finalize, audit). |
| `src/tools/{inventory,deployment,knowledge,testing,call-control,diagnostics}.ts` | Domain handlers. |
| `src/core/` | Cross-cutting primitives: `schemas.ts`, `output.ts` (envelope), `errors.ts`, `redaction.ts`. |
| `src/signalwire/client.ts` | **Only file importing `@signalwire/sdk`**; narrow structural `SignalWireClient` interface. |
| `src/signalwire/capabilities.ts` | Closed registry mapping tools→SDK paths; pins `SDK_VERSION`. |
| `tests/` | Vitest suite: composition tests, MCP contract test, stdio smoke test, shared fakes. |

## Development Commands

Package manager is **pnpm** (lockfile `pnpm-lock.yaml`). `package.json` scripts:

| Command | Action |
|---------|--------|
| `pnpm build` | `tsc -p tsconfig.build.json` → compiles `src/` to `dist/` (excludes tests). |
| `pnpm start` | `node dist/index.js` — run the built server. |
| `pnpm dev` | `tsx src/index.ts` — run from source without compiling. |
| `pnpm typecheck` | `tsc --noEmit` — type-checks `src/` **and** `tests/`. |
| `pnpm test` | `pnpm build && vitest run` — **build first**, then run the suite once. |
| `pnpm vitest run [file]` | Run tests without rebuilding (the stdio test needs `dist/index.js`). |
| `pnpm vitest` | Vitest watch mode for fast TDD. |

> Note: `tests/stdio.test.ts` spawns `node dist/index.js`, so it fails without a prior `pnpm build`. `pnpm test` handles this.

## Runtime/Tooling Preferences

- **Runtime:** Node.js `>=20.19.0`. ESM-only (`"type": "module"`).
- **Package manager:** pnpm 11.16 (do **not** use npm/yarn; `pnpm-workspace.yaml` exists solely to allow esbuild's postinstall — this is **not** a monorepo).
- **No linter/formatter/CI configured.** There is no ESLint, Prettier, Biome, `.editorconfig`, `.github/`, README, or docs directory. Type-safety (`tsc`) is the primary quality gate.
- **Dev runner:** `tsx` (no rebuild loop needed during development).
- **Environment** (see `.env.example`; `.env` is gitignored/local-only):
  - `SIGNALWIRE_SPACE` — Space host (bare host or `https://` URL; normalized to bare host).
  - `SIGNALWIRE_PROJECT_ID` — project UUID.
  - `SIGNALWIRE_API_TOKEN` — API token.
  - `SIGNALWIRE_MCP_ALLOW_WRITES` — `true`/`false`; defaults `false`. **Write-gate** — when false, all mutating tools return a `blocked` envelope.

## Code Conventions & Common Patterns

- **Dependency injection via a context object.** Every tool handler is `async (ctx: ToolContext, input) => McpToolResult` where `ToolContext = { client, config }`. No singletons, no module-level state, no global client. This is the seam tests use (see Testing).
- **Strict Zod everywhere.** Input schemas are `strict()` objects (reject unknown fields), every field carries an LLM-friendly `.describe()`, and `additionalProperties: false` is enforced. Reusable primitives live in `src/core/schemas.ts` (`uuid`, `e164`, `messageSid`, `httpsUrl`, `smsBody`, `swmlDocument`, etc.).
- **Unified output envelope.** Every tool returns `outputEnvelopeSchema` (`src/core/output.ts`) with one of 9 statuses: `complete`, `unchanged`, `accepted`, `partial`, `confirmation_required`, `blocked`, `not_found`, `unsupported`, `error`. Build via the named builders (`complete(...)`, `errorResult(...)`, etc.) — never hand-roll.
- **Dual-format output.** `finalize()` emits both `content` (JSON text) and `structuredContent` (parsed object) with a correct `isError` flag.
- **SDK boundary is typed `unknown`, not `any`.** `src/signalwire/client.ts` declares each SDK method as `Promise<unknown>`; handlers then project results through bounded parsers in `contracts.ts`. Avoid `any`.
- **Defensive redaction.** `redactDeep()` (case-insensitive sensitive-key fragments: `token`, `authorization`, `password`, `secret`, `credential`, `jwt`, `signed_url`, `api_key`) runs on all output. Audit logs (`writeAudit`) emit only tool name + duration + status to stderr — never request/response data.
- **TypeScript is maximally strict.** `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`; `NodeNext` module/resolution; ES2022 target. Use `import type` for type-only imports (required by `verbatimModuleSyntax`). No path aliases — use relative imports.
- **Async/await** throughout; no raw promise chains. Mutations follow a consistent sequence: write-gate → confirmation → resolve IDs → mutate → journal → readback → envelope.

## Important Files

- **Entry point:** `src/index.ts` (CLI binary via `bin: { "signalwire-admin-mcp": "dist/index.js" }`).
- **Tool registry:** `src/server.ts` — add/remove a tool here; the count is asserted as exactly 15 by `tests/server-contract.test.ts` and `tests/stdio.test.ts`.
- **Schemas + parsers:** `src/tools/contracts.ts` — add a new tool's input schema and result parser here.
- **Capability map:** `src/signalwire/capabilities.ts` — register the new tool's SDK paths here.
- **Output envelope:** `src/core/output.ts`; **error mapping:** `src/core/errors.ts`; **redaction/audit:** `src/core/redaction.ts`.
- **SDK boundary:** `src/signalwire/client.ts` (the only `@signalwire/sdk` import).
- **Config:** `src/config.ts` and `.env.example`.

## Testing & QA

**Framework:** Vitest 4.1.10, Node environment, 30s hook/test timeouts. **No coverage threshold** and no coverage tooling. Type-correctness (`pnpm typecheck`) and behavioral assertions are the quality gates.

**Three test layers** (`tests/`):

1. **`sdk-compositions.test.ts`** (~650 lines) — unit + composition tests. Imports handlers directly and calls them with a fake context; asserts envelope fields, gating, error mapping, and redaction. Covers config, schemas, redaction, errors, output invariants, and composition behavior for all 15 tools (write-gate, confirmation, resolve-by-name create/update/ambiguity, readback, and partial-on-bind-failure).
2. **`server-contract.test.ts`** — full MCP protocol via `InMemoryTransport.createLinkedPair()` + SDK `Client`. Asserts exactly 15 tools, strict input schemas (no generic bags), shared output schema, dual-format results, and write-gate blocking.
3. **`stdio.test.ts`** — spawns the built `node dist/index.js`, does a raw JSON-RPC handshake, asserts 15 tools, no stdout banner, no credential leak in stderr, clean exit.

**Test conventions:**

- **Mocking is pure DI.** `tests/helpers.ts` provides `fakeClient()` (every method a `vi.fn()`), `fakeConfig()`, and `fakeCtx()` → `{ ctx, client }`. There are **no** `vi.mock()` calls, no module mocking, no HTTP mocking — the real SignalWire SDK is never instantiated.
- **File names:** `kebab-case.test.ts`. **`describe` blocks:** snake_case feature names. **`it` strings:** present-tense descriptive sentences.
- **Run a single file:** `pnpm vitest run tests/sdk-compositions.test.ts`.

When adding or changing a tool: update `contracts.ts` (schema/parser) and `capabilities.ts`, register it in `server.ts`, bump the tool-count expectation is *implicit* (tests assert 15), and add composition coverage in `sdk-compositions.test.ts`.
