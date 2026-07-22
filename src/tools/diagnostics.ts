/**
 * Tool: signalwire_diagnose_interaction — read-only evidence assembly.
 *
 * Voice interactions use logs.voice.get plus the event timeline. Messaging
 * uses logs.messages.get for a native UUID, or compat.messages.get for a
 * Compatibility SID with an optional bounded log correlation. Results are
 * projected into bounded evidence, inferences, unknowns, and a next step.
 */

import { executeTool, complete, notFound, type ToolContext } from "./runtime.js";
import { asArray, toEvidence, type DiagnoseInteractionInput } from "./contracts.js";
import type { Envelope, EnvelopeFields, McpToolResult } from "../core/output.js";
import { isNotFoundError } from "../core/errors.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function strField(raw: unknown, ...keys: string[]): string | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  for (const k of keys) {
    const v = r[k];
    if (typeof v === "string" && v.length > 0 && v.length <= 128) return v;
  }
  return undefined;
}

function pushEvidence(evidence: NonNullable<Envelope["evidence"]>, source: string, raw: unknown): void {
  const entry = toEvidence(raw, source);
  if (entry && evidence.length < 20) evidence.push(entry);
}
const CORRELATION_WINDOW_MS = 5 * 60_000;
const CORRELATION_PAGE_SIZE = 50;

function parseTimestamp(v: unknown): number | undefined {
  if (typeof v !== "string" || v.length === 0 || v.length > 128) return undefined;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : undefined;
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

/** Diagnose a voice call or message from logs. */
export async function signalwireDiagnoseInteraction(ctx: ToolContext, input: DiagnoseInteractionInput): Promise<McpToolResult> {
  return executeTool("signalwire_diagnose_interaction", ctx, "read", async () => {
    const c = ctx.client;
    const evidence: NonNullable<Envelope["evidence"]> = [];
    const inferences: NonNullable<Envelope["inferences"]> = [];
    const unknowns: NonNullable<Envelope["unknowns"]> = [];

    if (input.interaction_type === "voice") {
      const logId = input.log_id;
      if (!logId) throw new Error("voice requires log_id");
      let logRaw: unknown;
      try {
        logRaw = await c.logs.voice.get(logId);
      } catch (err) {
        if (isNotFoundError(err)) {
          return notFound(
            `No voice log found for ${logId}.`,
            `Verify the voice log UUID exists in this Project and has not been deleted, then retry.`,
          );
        }
        throw err;
      }
      const status = strField(logRaw, "status", "state", "result");
      pushEvidence(evidence, "voice_log", logRaw);
      if (status) inferences.push({ statement: `Voice log ${logId} reports status '${status}'.`, confidence: "high" });

      const includeTimeline = input.include_timeline ?? true;
      if (includeTimeline) {
        try {
          const events = asArray(await c.logs.voice.listEvents(logId));
          for (const ev of events) {
            pushEvidence(evidence, "voice_event", ev);
            if (evidence.length >= 20) break;
          }
          if (events.length === 0) unknowns.push("No timeline events were returned for this voice log.");
        } catch {
          unknowns.push("The event timeline could not be retrieved.");
        }
      }
    } else {
      // message
      const id = input.message_id;
      if (!id) throw new Error("message requires message_id");
      if (UUID_RE.test(id)) {
        let msgRaw: unknown;
        try {
          msgRaw = await c.logs.messages.get(id);
        } catch (err) {
          if (isNotFoundError(err)) {
            return notFound(
              `No message log found for ${id}.`,
              `Verify the message log UUID exists in this Project and has not been deleted, then retry.`,
            );
          }
          throw err;
        }
        pushEvidence(evidence, "message_log", msgRaw);
        const status = strField(msgRaw, "status", "state");
        if (status) inferences.push({ statement: `Message log ${id} reports status '${status}'.`, confidence: "high" });
      } else {
        // Compatibility SID
        let compatRaw: unknown;
        try {
          compatRaw = await c.compat.messages.get(id);
        } catch (err) {
          if (isNotFoundError(err)) {
            return notFound(
              `No Compatibility message found for ${id}.`,
              `Verify the message SID exists in this Project and has not been deleted, then retry.`,
            );
          }
          throw err;
        }
        pushEvidence(evidence, "compat_message", compatRaw);
        const status = strField(compatRaw, "status", "state");
        if (status) inferences.push({ statement: `Compatibility message ${id} reports status '${status}'.`, confidence: "high" });

        const from = strField(compatRaw, "from", "From");
        const to = strField(compatRaw, "to", "To");
        const sentAt = parseTimestamp(strField(compatRaw, "date_created", "date_sent", "DateCreated", "DateSent"));
        if (from && to && sentAt !== undefined) {
          const after = iso(sentAt - CORRELATION_WINDOW_MS);
          const before = iso(sentAt + CORRELATION_WINDOW_MS);
          try {
            const candidates = asArray(
              await c.logs.messages.list({ created_after: after, created_before: before, page_size: CORRELATION_PAGE_SIZE }),
            );
            const matches: unknown[] = [];
            for (const m of candidates) {
              if (typeof m !== "object" || m === null) continue;
              const mFrom = strField(m, "from", "From");
              const mTo = strField(m, "to", "To");
              const mCreated = parseTimestamp(strField(m, "created_at", "created", "date_created"));
              if (mFrom !== from || mTo !== to) continue;
              if (mCreated === undefined) continue;
              if (mCreated < sentAt - CORRELATION_WINDOW_MS || mCreated > sentAt + CORRELATION_WINDOW_MS) continue;
              matches.push(m);
            }
            if (matches.length === 1) {
              pushEvidence(evidence, "message_log_candidate", matches[0]);
              inferences.push({ statement: `One native message log matches the Compatibility message endpoints and the bounded 5-minute timestamp window.`, confidence: "medium" });
            } else if (matches.length === 0) {
              unknowns.push("No native message log could be correlated with this SID.");
            } else {
              unknowns.push(`${matches.length} native message logs matched the correlation window; none were selected to avoid ambiguity.`);
            }
          } catch {
            unknowns.push("Native message log correlation was unavailable.");
          }
        }
      }
    }

    const fields: EnvelopeFields = { evidence, inferences, unknowns };
    if (unknowns.length > 0) {
      fields.next_step = "Address the noted gaps, then re-diagnose if needed.";
    }
    return complete(`Assembled ${evidence.length} evidence item(s) for the interaction.`, fields);
  });
}
