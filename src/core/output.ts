/**
 * Sole owner of the strict MCP result envelope.
 *
 * Every tool returns this exact shape as `structuredContent`, serializes the
 * identical redacted value as compact JSON in a single text `content` block,
 * and publishes the schema as its `outputSchema`. Status-dependent invariants
 * are enforced in Zod so the contract cannot drift by convention.
 */

import { z } from "zod";
import { name, excerpt, inferenceStatement, unknownNote } from "./schemas.js";
import { redactDeep } from "./redaction.js";

/** Outcome status. */
export const envelopeStatus = z
  .enum([
    "complete",
    "unchanged",
    "accepted",
    "partial",
    "confirmation_required",
    "blocked",
    "not_found",
    "unsupported",
    "error",
  ])
  .describe("Outcome status of the tool invocation");
export type EnvelopeStatus = z.infer<typeof envelopeStatus>;

const idScalar = name; // 1–128 characters
const summaryText = z.string().min(1).max(1000);
const nextStepText = z.string().min(1).max(1000);

const resourceElement = z
  .object({
    id: idScalar.describe("Resource identifier"),
    type: name.describe("Resource type (e.g. ai_agent, phone_number)"),
    name: name.optional().describe("Human-readable resource name when available"),
    status: z.string().min(1).max(128).optional().describe("Current resource status when available"),
  })
  .strict();

const itemElement = z
  .object({
    id: idScalar.optional().describe("Item identifier when available"),
    type: name.describe("Item type (e.g. phone_number, ai_agent, document)"),
    name: name.optional().describe("Human-readable item name when available"),
    number: z.string().min(1).max(128).optional().describe("E.164 phone number when the item is a number"),
    status: z.string().min(1).max(128).optional().describe("Current item status when available"),
    score: z.number().min(0).max(1).optional().describe("Relevance score from 0 to 1 when available"),
    excerpt: excerpt.optional().describe("Short content excerpt when available"),
  })
  .strict();

const operationElement = z
  .object({
    operation: name.describe("Logical operation that was attempted"),
    sdk_method: name.describe("Public SDK method that was invoked"),
    status: z.enum(["complete", "failed", "unknown"]).describe("Outcome of this single operation"),
    resource_id: idScalar.optional().describe("Identifier of the resource this operation touched, when known"),
    summary: summaryText.describe("What this operation did and its result"),
  })
  .strict();

const evidenceElement = z
  .object({
    source: name.describe("Where this fact came from (e.g. voice_log, message_log)"),
    fact: summaryText.describe("An observed fact drawn from the source"),
    id: idScalar.optional().describe("Identifier of the source record when available"),
  })
  .strict();

const inferenceElement = z
  .object({
    statement: inferenceStatement.describe("A reasoned conclusion drawn from the evidence"),
    confidence: z.enum(["low", "medium", "high"]).describe("How strongly the evidence supports this inference"),
  })
  .strict();

export const errorCategory = z
  .enum([
    "validation",
    "authentication",
    "permission",
    "not_found",
    "conflict",
    "rate_limit",
    "transport",
    "platform",
    "internal",
  ])
  .describe("Category of failure");

export type ErrorCategoryValue = z.infer<typeof errorCategory>;

export const errorElement = z
  .object({
    category: errorCategory,
    message: summaryText.describe("Sanitized, actionable description of the failure"),
    http_status: z.number().int().min(100).max(599).optional().describe("HTTP status code returned by SignalWire when available"),
    request_id: idScalar.optional().describe("Request identifier exposed by SignalWire when available"),
    code: z.string().min(1).max(128).optional().describe("SignalWire error code when available"),
    attribute: z.string().min(1).max(128).optional().describe("Offending field/attribute when available"),
  })
  .strict();

const cap20 = <T extends z.ZodTypeAny>(schema: T) => z.array(schema).max(20);

/** The authoritative strict MCP result envelope. */
export const outputEnvelopeSchema = z
  .object({
    status: envelopeStatus,
    summary: summaryText.describe("Concise, human-readable summary of the outcome (1–1000 characters)"),
    resource_id: idScalar.optional().describe("Primary durable resource identifier affected by the call"),
    call_id: idScalar.optional().describe("SignalWire call identifier for voice tests"),
    message_sid: idScalar.optional().describe("Compatibility message SID for SMS tests"),
    control_id: idScalar.optional().describe("Control identifier for a started media feature, used to stop it later"),
    platform_status: z.string().min(1).max(128).optional().describe("Latest platform-reported status when available"),
    safe_to_retry: z.boolean().optional().describe("Whether the caller may safely repeat the request after a partial outcome"),
    next_step: nextStepText.optional().describe("The concrete next action the caller should take"),
    resources: cap20(resourceElement).optional().describe("Durable resources read back after a mutation (at most 20)"),
    items: cap20(itemElement).optional().describe("Discovered or search-result items (at most 20)"),
    operations: cap20(operationElement).optional().describe("Per-invocation operation journal entries (at most 20)"),
    evidence: cap20(evidenceElement).optional().describe("Observed facts assembled during diagnosis (at most 20)"),
    inferences: cap20(inferenceElement).optional().describe("Reasoned conclusions with confidence (at most 20)"),
    unknowns: z.array(unknownNote).max(20).optional().describe("Gaps and uncertainties in the evidence (at most 20)"),
    error: errorElement.optional().describe("Sanitized failure detail (present only for the error status)"),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.status === "error" && !v.error) {
      ctx.addIssue({ code: "custom", message: "error status requires the error field", path: ["error"] });
    }
    if (v.status === "accepted" && !v.resource_id && !v.call_id && !v.message_sid) {
      ctx.addIssue({ code: "custom", message: "accepted requires a correlation identifier (resource_id, call_id, or message_sid)", path: ["status"] });
    }
    const needsNextStep: EnvelopeStatus[] = ["confirmation_required", "blocked", "not_found", "unsupported"];
    if (needsNextStep.includes(v.status) && !v.next_step) {
      ctx.addIssue({ code: "custom", message: `${v.status} requires next_step`, path: ["next_step"] });
    }
    if (v.status === "partial") {
      if (!v.operations || v.operations.length === 0) {
        ctx.addIssue({ code: "custom", message: "partial requires non-empty operations", path: ["operations"] });
      }
      if (v.safe_to_retry === undefined) {
        ctx.addIssue({ code: "custom", message: "partial requires safe_to_retry", path: ["safe_to_retry"] });
      }
    }
  });

/** Parsed envelope value. */
export type Envelope = z.infer<typeof outputEnvelopeSchema>;

/** All optional envelope fields, used by builders. */
export type EnvelopeFields = Omit<Envelope, "status" | "summary">;

/** Build an envelope, dropping any field whose value is `undefined`. */
export function envelope(status: EnvelopeStatus, summary: string, fields: EnvelopeFields = {}): Envelope {
  const out: Record<string, unknown> = { status, summary };
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) out[key] = value;
  }
  return out as unknown as Envelope;
}

/** Status-specific builders. Each returns an un-finalized {@link Envelope}. */
export const complete = (summary: string, fields: EnvelopeFields = {}): Envelope => envelope("complete", summary, fields);
export const unchanged = (summary: string, fields: EnvelopeFields = {}): Envelope => envelope("unchanged", summary, fields);
export const accepted = (summary: string, fields: EnvelopeFields = {}): Envelope => envelope("accepted", summary, fields);

export function partial(summary: string, operations: NonNullable<Envelope["operations"]>, fields: EnvelopeFields = {}): Envelope {
  return envelope("partial", summary, { ...fields, operations, safe_to_retry: fields.safe_to_retry ?? true });
}

export const confirmationRequired = (summary: string, next_step: string, fields: EnvelopeFields = {}): Envelope =>
  envelope("confirmation_required", summary, { ...fields, next_step });
export const blocked = (summary: string, next_step: string, fields: EnvelopeFields = {}): Envelope =>
  envelope("blocked", summary, { ...fields, next_step });
export const notFound = (summary: string, next_step: string, fields: EnvelopeFields = {}): Envelope =>
  envelope("not_found", summary, { ...fields, next_step });
export const unsupported = (summary: string, next_step: string, fields: EnvelopeFields = {}): Envelope =>
  envelope("unsupported", summary, { ...fields, next_step });

export function errorResult(summary: string, error: z.infer<typeof errorElement>, fields: EnvelopeFields = {}): Envelope {
  return envelope("error", summary, { ...fields, error });
}

/** MCP text content block. */
export interface TextContent {
  readonly type: "text";
  readonly text: string;
}

/** A finalized MCP tool result. */
export interface McpToolResult {
  content: TextContent[];
  structuredContent: Envelope;
  isError: boolean;
  [x: string]: unknown;
}

/**
 * Validate, redact, and serialize an envelope into an MCP result.
 *
 * The same redacted value is returned as `structuredContent` and serialized as
 * compact JSON in the single text `content` block. `isError` is `true` only
 * for the `error` status.
 */
export function finalize(candidate: Envelope): McpToolResult {
  const parsed = outputEnvelopeSchema.parse(candidate);
  const redacted = redactDeep(parsed);
  return {
    content: [{ type: "text", text: JSON.stringify(redacted) }],
    structuredContent: redacted,
    isError: redacted.status === "error",
  };
}
