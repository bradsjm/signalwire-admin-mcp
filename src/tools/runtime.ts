/**
 * Shared orchestration helpers used by every tool module.
 *
 * Centralizes the write gate, confirmation gate, exact name resolution, the
 * per-invocation operation journal, error normalization, and the single
 * finalize-and-audit path. Tools compose these to stay stateless and
 * consistent; orchestration functions remain separately callable for tests.
 */

import type { Config } from "../config.js";
import type { SignalWireClient } from "../signalwire/client.js";
import {
  type Envelope,
  type EnvelopeFields,
  type McpToolResult,
  blocked as blockedEnv,
  confirmationRequired,
  envelope,
  finalize,
} from "../core/output.js";
import { toErrorEnvelope } from "../core/errors.js";
import { writeAudit } from "../core/redaction.js";
import { asArray, toItem, type Item } from "./contracts.js";

/** Injected dependencies available to every tool. */
export interface ToolContext {
  readonly client: SignalWireClient;
  readonly config: Config;
}

/** Operation journal entry (re-exported shape from the envelope). */
export type Operation = NonNullable<Envelope["operations"]>[number];

/** Build an operation journal entry. */
export function op(operation: string, sdkMethod: string, status: Operation["status"], summary: string, resourceId?: string): Operation {
  const entry: Operation = { operation, sdk_method: status === "complete" ? sdkMethod : sdkMethod, status, summary };
  if (resourceId) entry.resource_id = resourceId;
  return entry;
}

/**
 * Write-gate check. Returns a `blocked` envelope when mutations are disabled
 * for this process, otherwise `null` so the caller may proceed.
 */
export function writeGateBlocked(ctx: ToolContext): Envelope | null {
  if (ctx.config.allowWrites) return null;
  return blockedEnv(
    "Writes are disabled for this server process.",
    "Restart the server with SIGNALWIRE_MCP_ALLOW_WRITES=true to permit mutating tools. Discovery, knowledge search, and diagnosis remain available.",
  );
}

/** Outcome of resolving a target by name. */
export type NameResolution =
  | { readonly kind: "found"; readonly id: string; readonly raw: unknown }
  | { readonly kind: "not_found" }
  | { readonly kind: "ambiguous"; readonly candidates: readonly Item[] };

/**
 * Resolve exactly one resource by name from a raw SDK list.
 *
 * Returns `found` for a single exact-name match, `not_found` for zero matches,
 * and `ambiguous` (with bounded candidates) for more than one. Never picks the
 * first result.
 */
export function resolveByName(rawList: unknown, wantName: string, type: string): NameResolution {
  const arr = asArray(rawList);
  const matches: { id: string; raw: unknown }[] = [];
  const candidates: Item[] = [];
  for (const entry of arr) {
    if (typeof entry !== "object" || entry === null) continue;
    const r = entry as Record<string, unknown>;
    const entryName =
      (typeof r["name"] === "string" && r["name"]) ||
      (typeof r["label"] === "string" && r["label"]) ||
      (typeof r["friendly_name"] === "string" && r["friendly_name"]);
    if (!entryName || entryName !== wantName) continue;
    const id =
      (typeof r["id"] === "string" && r["id"]) ||
      (typeof r["resource_id"] === "string" && r["resource_id"]) ||
      (typeof r["sid"] === "string" && r["sid"]);
    if (!id) continue;
    matches.push({ id, raw: entry });
    const item = toItem(entry, type);
    if (item) candidates.push(item);
  }
  if (matches.length === 0) return { kind: "not_found" };
  if (matches.length > 1) return { kind: "ambiguous", candidates: candidates.slice(0, 20) };
  return { kind: "found", id: matches[0]!.id, raw: matches[0]!.raw };
}

const cap = (s: string, max = 1000): string => (s.length <= max ? s : `${s.slice(0, max - 1)}…`);

/** Build a `confirmation_required` envelope describing the proposed mutation. */
export function confirmationRequiredEnvelope(opts: {
  operation: string;
  target: string;
  impact: string;
  confirmationField: string;
  existingState?: string;
  fields?: EnvelopeFields;
}): Envelope {
  const summary = cap(
    `Confirmation required to ${opts.operation} on ${opts.target}.` +
      (opts.existingState ? ` Current state: ${opts.existingState}.` : ""),
  );
  const nextStep = cap(
    `Set '${opts.confirmationField}' to true and repeat the same request to proceed. Impact: ${opts.impact}`,
  );
  return confirmationRequired(summary, nextStep, opts.fields);
}

/**
 * Wrap a tool body: run it, normalize any thrown error, then finalize and emit
 * one sanitized audit line. Tools that need a partial-result journal catch
 * per-operation errors themselves and return a `partial` envelope.
 */
export async function executeTool(
  toolName: string,
  ctx: ToolContext,
  kind: "read" | "mutation",
  body: () => Promise<Envelope>,
): Promise<McpToolResult> {
  const start = Date.now();
  let env: Envelope;
  try {
    env = await body();
  } catch (err) {
    env = toErrorEnvelope(err, { summary: `${toolName} failed`, kind });
  }
  let result: McpToolResult;
  try {
    result = finalize(env);
  } catch {
    result = finalize(
      envelope(
        "error",
        `${toolName} produced an invalid result`,
        {
          error: { category: "internal", message: "internal result invariant violated" },
          next_step: "This is a defect in the MCP server; report it.",
        },
      ),
    );
  }
  writeAudit(toolName, Date.now() - start, result.structuredContent.status);
  return result;
}

/** Re-exported envelope status builders for tool convenience. */
export {
  complete,
  unchanged,
  accepted,
  partial,
  blocked,
  notFound,
  unsupported,
  envelope,
} from "../core/output.js";
