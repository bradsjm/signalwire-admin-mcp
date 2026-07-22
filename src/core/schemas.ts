/**
 * Reusable strict Zod primitives shared by every tool contract.
 *
 * These are the only bounded string/number/identifier schemas in the project.
 * Tool input schemas in `src/tools/contracts.ts` compose them; nothing
 * invents its own bounds. Every primitive carries an LLM-friendly description
 * so the generated JSON Schema is self-documenting.
 */

import { z } from "zod";

/** Lowercase-or-uppercase RFC 4122 UUID. */
export const uuid = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "must be a UUID")
  .describe("RFC 4122 UUID identifier (e.g. 11111111-2222-3333-4444-555555555555)");

/** Compatibility (LAML) message SID: `SM`/`MM` + 32 hex chars. */
export const messageSid = z
  .string()
  .regex(/^(SM|MM)[0-9a-f]{32}$/i, "must be a Compatibility message SID (SM…/MM…)")
  .describe("Compatibility API message SID beginning with SM (SMS) or MM (MMS) followed by 32 hex characters");

/** E.164 phone number. */
export const e164 = z
  .string()
  .regex(/^\+[1-9]\d{1,14}$/, "must be an E.164 number (e.g. +14155550123)")
  .describe("Phone number in E.164 format with a leading + and country code (e.g. +14155550123)");

/** HTTPS URL, at most 2048 characters. */
export const httpsUrl = z
  .string()
  .min(1)
  .max(2048)
  .url()
  .refine((v) => v.startsWith("https://"), "must use the https scheme")
  .describe("Public HTTPS URL (http:// is rejected)");

/** Bounded name or label. */
export const name = z.string().min(1).max(128).describe("Short name or label (1–128 characters)");

/** General free-text or search query. */
export const textQuery = z.string().min(1).max(4096).describe("Free-text or search query (1–4096 characters)");

/** AI prompt text. */
export const promptText = z.string().min(1).max(32000).describe("AI agent prompt text (1–32000 characters)");

/** SMS body. */
export const smsBody = z.string().min(1).max(1600).describe("SMS message body text (1–1600 characters)");

/** Spoken test text. */
export const spokenText = z.string().min(1).max(2000).describe("Text to be spoken on a test call (1–2000 characters)");

/** Result/page limit (1–20). */
export const limit = z.number().int().min(1).max(20).describe("Maximum number of results to return (1–20)");

/** Excerpt text projected into output (truncated before parsing). */
export const excerpt = z.string().min(1).max(1000).describe("Short excerpt of retrieved content (at most 1000 characters)");

/** A single tag (1–64 chars). */
const tag = z.string().min(1).max(64).describe("A single tag");

/** Tag list (at most 10 entries). */
export const tags = z.array(tag).max(10).describe("Optional tags (at most 10, each 1–64 characters)");

/** A required confirmation: the caller must send the literal `true`. */
export const confirmed = z
  .literal(true)
  .describe("Set to true to confirm and proceed with this gated action; omit it to request confirmation details first");

/** A bounded free-text string used in output inference statements. */
export const inferenceStatement = z.string().min(1).max(1000).describe("A reasoned inference about the interaction");

/** A bounded free-text string used in output "unknown" notes. */
export const unknownNote = z.string().min(1).max(1000).describe("A noted gap or uncertainty in the evidence");

/** Measure the nesting depth of an arbitrary JSON-shaped value. */
function depthOf(value: unknown, seen: Set<unknown> = new Set()): number {
  if (typeof value !== "object" || value === null || seen.has(value)) return 0;
  seen.add(value);
  const arr = Array.isArray(value) ? value : Object.values(value as Record<string, unknown>);
  let max = 0;
  for (const child of arr) {
    max = Math.max(max, depthOf(child, seen));
  }
  return max + 1;
}

/** Serialized UTF-8 byte length of a JSON value. */
function byteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

/** SWML document bound (≤128 KiB serialized, ≤20 nesting depth). */
export const SWML_MAX_BYTES = 128 * 1024;
export const SWML_MAX_DEPTH = 20;

/** An opaque SWML instruction object (key → any JSON value). */
const swmlInstruction = z.record(z.string(), z.unknown());

/** SWML sections: section name → instruction array. */
const swmlSections = z.record(z.string(), z.array(swmlInstruction));

/**
 * SWML document with the documented `version` + `sections` shape.
 *
 * Rejects values whose serialized UTF-8 size exceeds 128 KiB or whose nesting
 * depth exceeds 20. The raw object is forwarded to the SDK without
 * stringification.
 */
export const swmlDocument = z
  .object({
    version: z.string().min(1).max(32).describe("SWML document version (e.g. 1.0.0)"),
    sections: swmlSections.describe("Named sections mapping to arrays of SWML instructions"),
  })
  .strict()
  .refine((v) => byteLength(v) <= SWML_MAX_BYTES, "SWML document exceeds 128 KiB")
  .refine((v) => depthOf(v) <= SWML_MAX_DEPTH, "SWML document nesting exceeds depth 20");

/** Truncate a free-text value to the excerpt bound (on a UTF-16 code-point edge). */
export function truncate(value: string, max = 1000): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
