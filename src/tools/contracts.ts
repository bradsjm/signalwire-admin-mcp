/**
 * Sole owner of every tool input schema and the response parsers that project
 * `unknown` SDK results into bounded domain values.
 *
 * Input schemas are strict (unknown fields are rejected) and carry LLM-friendly
 * descriptions. No tool exposes a generic `options`/`params`/`payload` bag.
 * Parsers are named to match the `parser` field of the capability registry in
 * `src/signalwire/capabilities.ts`.
 */

import { z } from "zod";
import {
  confirmed,
  e164,
  excerpt,
  httpsUrl,
  limit,
  messageSid,
  name,
  promptText,
  smsBody,
  spokenText,
  swmlDocument,
  tags,
  textQuery,
  truncate,
  uuid,
} from "../core/schemas.js";
import type { Envelope } from "../core/output.js";

// ---------------------------------------------------------------------------
// Safe projection helpers (operate on `unknown` SDK values — never `any`).
export type Item = NonNullable<Envelope["items"]>[number];
export type Resource = NonNullable<Envelope["resources"]>[number];
export type Operation = NonNullable<Envelope["operations"]>[number];

function str(v: unknown, max = 128): string | undefined {
  return typeof v === "string" && v.length > 0 && v.length <= max ? v : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}
function textValue(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}
/** Pull a list of records out of common paginated/Array SDK shapes. */
export function asArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "object" && raw !== null) {
    const r = raw as Record<string, unknown>;
    for (const key of ["data", "items", "results", "documents", "phone_numbers", "resources", "ai_agents", "call_flows"]) {
      const candidate = r[key];
      if (Array.isArray(candidate)) return candidate;
    }
  }
  return [];
}

/** Project one raw record into a discovery/search item. */
export function toItem(raw: unknown, type: string): Item | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  const id = str(r["id"]) ?? str(r["resource_id"]) ?? str(r["sid"]) ?? str(r["number"]);
  const itemName = str(r["name"]) ?? str(r["label"]) ?? str(r["friendly_name"]);
  const status = str(r["status"]);
  const number = str(r["number"]) ?? str(r["phone_number"]);
  const score = num(r["score"]) ?? num(r["similarity"]);
  const content = str(r["content"], 1000) ?? str(r["text"], 1000) ?? str(r["chunk_text"], 1000);
  const item: Item = { type };
  if (id) item.id = id;
  if (itemName) item.name = itemName;
  if (status) item.status = status;
  if (number) item.number = number;
  if (score !== undefined) item.score = score;
  if (content) item.excerpt = truncate(content, 1000);
  return item;
}

/** Project one raw record into a durable resource readback. */
export function toResource(raw: unknown, type: string): Resource | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  const id = str(r["id"]) ?? str(r["resource_id"]) ?? str(r["sid"]);
  if (!id) return undefined;
  const resourceName = str(r["name"]) ?? str(r["label"]) ?? str(r["friendly_name"]);
  const status = str(r["status"]);
  const resource: Resource = { id, type };
  if (resourceName) resource.name = resourceName;
  if (status) resource.status = status;
  return resource;
}

/** Extract a bounded identifier from a raw record. */
export function pickId(raw: unknown, ...keys: string[]): string | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  for (const key of keys) {
    const v = str(r[key]);
    if (v) return v;
  }
  return undefined;
}

/** Extract a bounded status string from a raw record. */
export function pickStatus(raw: unknown, ...keys: string[]): string | undefined {
  return pickId(raw, ...keys);
}

// ===========================================================================
// 1. signalwire_find_resources
// ===========================================================================

const resourceTypeEnum = z
  .enum([
    "phone_number",
    "available_phone_number",
    "ai_agent",
    "call_flow",
    "call_flow_version",
    "swml_script",
    "swml_webhook",
    "cxml_webhook",
    "relay_application",
    "datasphere_document",
  ])
  .describe("Kind of SignalWire resource to discover");

export const findResourcesInput = z
  .object({
    resource_type: resourceTypeEnum,
    resource_id: uuid.optional().describe("Exact resource UUID to fetch directly; when set, search fields are ignored"),
    name: name.optional().describe("Name substring to filter Fabric/Datasphere resources by"),
    area_code: z
      .string()
      .regex(/^\d{3}$/, "must be a 3-digit area code")
      .optional()
      .describe("3-digit area code; applies only to available_phone_number search"),
    contains: z
      .string()
      .min(1)
      .max(30)
      .optional()
      .describe("Digit pattern a available phone number must contain; applies only to available_phone_number search"),
    parent_id: uuid.optional().describe("Parent Call Flow UUID; required when resource_type is call_flow_version"),
    limit: limit.optional().describe("Maximum number of matches to return (1–20, default 10)"),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.resource_id) {
      for (const forbidden of ["name", "area_code", "contains"] as const) {
        if (v[forbidden] !== undefined) {
          ctx.addIssue({
            code: "custom",
            message: `resource_id excludes the ${forbidden} search field`,
            path: [forbidden],
          });
        }
      }
    }
    if (v.resource_type === "call_flow_version" && !v.parent_id) {
      ctx.addIssue({ code: "custom", message: "call_flow_version requires parent_id", path: ["parent_id"] });
    }
    if ((v.area_code || v.contains) && v.resource_type !== "available_phone_number") {
      ctx.addIssue({ code: "custom", message: "area_code/contains apply only to available_phone_number", path: ["resource_type"] });
    }
  })
  .describe("Discover SignalWire phone numbers, Fabric resources, and Datasphere documents");
export type FindResourcesInput = z.infer<typeof findResourcesInput>;

/** Project a discovery response into at most `limit` items. */
export function findResourcesResult(raw: unknown, resourceType: string, limitCount = 10): { items: Item[] } {
  const arr = asArray(raw).slice(0, Math.min(Math.max(limitCount, 0), 20));
  const items: Item[] = [];
  for (const entry of arr) {
    const item = toItem(entry, resourceType);
    if (item) items.push(item);
    if (items.length >= 20) break;
  }
  return { items };
}

// ===========================================================================
// 2. signalwire_deploy_ai_agent
// ===========================================================================

export const deployAiAgentInput = z
  .object({
    name: name.describe("AI Agent display name"),
    agent_id: name.describe("Identifier of an already-created SignalWire AI agent definition to attach"),
    prompt_text: promptText.describe("Prompt text for the agent"),
    resource_id: uuid.optional().describe("Existing Fabric AI Agent UUID to update; omit to create by name"),
    phone_number_id: name.optional().describe("Phone-number resource ID to bind to this agent"),
    confirm_route_change: confirmed.optional().describe("Set to true to confirm binding the phone number to this agent"),
  })
  .strict()
  .describe("Create or update a managed AI Agent and optionally bind a number");
export type DeployAiAgentInput = z.infer<typeof deployAiAgentInput>;

export function deployAiAgentResult(rawAgent: unknown, rawNumber?: unknown): { resources: Resource[] } {
  const resources: Resource[] = [];
  const agent = toResource(rawAgent, "ai_agent");
  if (agent) resources.push(agent);
  if (rawNumber !== undefined) {
    const number = toResource(rawNumber, "phone_number");
    if (number) resources.push(number);
  }
  return { resources };
}

// ===========================================================================
// 3. signalwire_deploy_call_flow_version
// ===========================================================================

export const deployCallFlowVersionInput = z
  .object({
    call_flow_id: uuid.describe("Existing Call Flow UUID to deploy a version of"),
    document_version: name.optional().describe("Document version label to deploy (mutually exclusive with call_flow_version_id)"),
    call_flow_version_id: uuid.optional().describe("Existing Call Flow version UUID to deploy (mutually exclusive with document_version)"),
    phone_number_id: name.optional().describe("Phone-number resource ID to bind to this Call Flow"),
    confirm_deployment: confirmed.optional().describe("Set to true to confirm deploying the Call Flow version"),
    confirm_route_change: confirmed.optional().describe("Set to true to confirm binding the phone number to this Call Flow"),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (!v.document_version && !v.call_flow_version_id) {
      ctx.addIssue({ code: "custom", message: "provide exactly one of document_version or call_flow_version_id", path: ["document_version"] });
    }
    if (v.document_version && v.call_flow_version_id) {
      ctx.addIssue({ code: "custom", message: "provide exactly one of document_version or call_flow_version_id", path: ["call_flow_version_id"] });
    }
  })
  .describe("Deploy a known version of an existing Call Flow and optionally bind a number");
export type DeployCallFlowVersionInput = z.infer<typeof deployCallFlowVersionInput>;

export function deployCallFlowVersionResult(rawFlow: unknown, rawNumber?: unknown): { resources: Resource[] } {
  const resources: Resource[] = [];
  const flow = toResource(rawFlow, "call_flow");
  if (flow) resources.push(flow);
  if (rawNumber !== undefined) {
    const number = toResource(rawNumber, "phone_number");
    if (number) resources.push(number);
  }
  return { resources };
}

// ===========================================================================
// 4. signalwire_deploy_swml_script
// ===========================================================================

const swmlScriptCommon = {
  name: name.describe("SWML Script name"),
  swml: swmlDocument.describe("SWML document with version and named sections of instructions"),
  resource_id: uuid.optional().describe("Existing SWML Script UUID to replace; omit to create by name"),
  confirm_replace: confirmed.optional().describe("Set to true to confirm fully replacing the SWML Script"),
};

export const deploySwmlScriptInput = z
  .object({
    ...swmlScriptCommon,
    script_type: z.enum(["calling", "messaging"]).describe("SWML document family (calling or messaging)"),
    status_callback_url: httpsUrl.optional().describe("HTTPS URL receiving Calling status callbacks (calling only)"),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.status_callback_url && v.script_type !== "calling") {
      ctx.addIssue({ code: "custom", message: "status_callback_url applies only to calling", path: ["status_callback_url"] });
    }
  })
  .describe("Create or fully replace a managed SWML Script (Calling or Messaging)");
export type DeploySwmlScriptInput = z.infer<typeof deploySwmlScriptInput>;

export function deploySwmlScriptResult(raw: unknown): { resources: Resource[] } {
  const resources: Resource[] = [];
  const script = toResource(raw, "swml_script");
  if (script) resources.push(script);
  return { resources };
}

// ===========================================================================
// 5. signalwire_connect_webhook
// ===========================================================================

export const connectWebhookInput = z
  .object({
    webhook_type: z.enum(["swml", "cxml"]).describe("Which external webhook format to route to"),
    phone_number_id: name.describe("Phone-number resource ID to route"),
    url: httpsUrl.describe("Public HTTPS URL serving the webhook document"),
    confirm_route_change: confirmed.optional().describe("Set to true to confirm changing this number's route"),
    fallback_url: httpsUrl.optional().describe("HTTPS URL used when the primary URL fails (cxml only)"),
    status_callback_url: httpsUrl.optional().describe("HTTPS URL receiving call status callbacks (cxml only)"),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.webhook_type === "swml" && (v.fallback_url || v.status_callback_url)) {
      ctx.addIssue({ code: "custom", message: "fallback_url and status_callback_url apply only to cxml", path: ["webhook_type"] });
    }
  })
  .describe("Route a development number to externally deployed SWML or cXML");
export type ConnectWebhookInput = z.infer<typeof connectWebhookInput>;

export function connectWebhookResult(rawNumber: unknown): { resources: Resource[] } {
  const resources: Resource[] = [];
  const number = toResource(rawNumber, "phone_number");
  if (number) resources.push(number);
  return { resources };
}

// ===========================================================================
// 6. signalwire_connect_relay_application
// ===========================================================================

export const connectRelayApplicationInput = z
  .object({
    application_name: name.describe("RELAY application name to create or update"),
    topic: name.describe("RELAY topic the application subscribes to"),
    application_id: uuid.optional().describe("Existing RELAY application UUID to update; omit to resolve by name"),
    phone_number_id: name.optional().describe("Phone-number resource ID to bind to this RELAY application"),
    confirm_route_change: confirmed.optional().describe("Set to true to confirm binding the phone number to this application"),
  })
  .strict()
  .describe("Create/update a named RELAY registration and connect a number");
export type ConnectRelayApplicationInput = z.infer<typeof connectRelayApplicationInput>;

export function connectRelayApplicationResult(rawApp: unknown, rawNumber?: unknown): { resources: Resource[] } {
  const resources: Resource[] = [];
  const app = toResource(rawApp, "relay_application");
  if (app) resources.push(app);
  if (rawNumber !== undefined) {
    const number = toResource(rawNumber, "phone_number");
    if (number) resources.push(number);
  }
  return { resources };
}

// ===========================================================================
// 7. signalwire_provision_test_number
// ===========================================================================

export const provisionTestNumberInput = z
  .object({
    number: e164.describe("Exact E.164 number previously returned by discovery to purchase"),
    label: name.optional().describe("Optional friendly label to assign to the purchased number"),
    confirm_purchase: confirmed.optional().describe("Set to true to confirm purchasing; carrier charges may apply"),
  })
  .strict()
  .describe("Purchase one exact number previously returned by discovery");
export type ProvisionTestNumberInput = z.infer<typeof provisionTestNumberInput>;

export function provisionTestNumberResult(rawNumber: unknown): { resources: Resource[] } {
  const resources: Resource[] = [];
  const number = toResource(rawNumber, "phone_number");
  if (number) resources.push(number);
  return { resources };
}

// ===========================================================================
// 8. signalwire_add_knowledge
// ===========================================================================

export const addKnowledgeInput = z
  .object({
    url: httpsUrl.describe("Public HTTPS URL of the document to ingest into Datasphere"),
    tags: tags.optional().describe("Optional tags to attach to the document"),
    confirm_ingestion: confirmed.optional().describe("Set to true to confirm starting asynchronous ingestion"),
  })
  .strict()
  .describe("Add one URL-backed Datasphere document");
export type AddKnowledgeInput = z.infer<typeof addKnowledgeInput>;

export function addKnowledgeResult(raw: unknown): { resource_id?: string; platform_status?: string } {
  const id = pickId(raw, "id", "document_id", "uuid");
  const status = pickStatus(raw, "status", "ingestion_status", "state");
  const out: { resource_id?: string; platform_status?: string } = {};
  if (id) out.resource_id = id;
  if (status) out.platform_status = status;
  return out;
}

// ===========================================================================
// 9. signalwire_search_knowledge
// ===========================================================================

export const searchKnowledgeInput = z
  .object({
    query: textQuery.describe("Natural-language search query"),
    document_id: uuid.optional().describe("Restrict the search to one Datasphere document UUID"),
    tags: tags.optional().describe("Restrict the search to documents with these tags"),
    count: limit.optional().describe("Maximum number of result chunks to return (1–20, default 5)"),
  })
  .strict()
  .describe("Read-only semantic search over Datasphere documents");
export type SearchKnowledgeInput = z.infer<typeof searchKnowledgeInput>;

/** Project one Datasphere search chunk into a search-result item. */
function toChunkItem(raw: unknown): Item | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  const id = str(r["chunk_id"]) ?? str(r["document_id"]) ?? str(r["id"]);
  const score = num(r["score"]) ?? num(r["similarity"]);
  const src = textValue(r["content"]) ?? textValue(r["text"]) ?? textValue(r["chunk_text"]);
  const item: Item = { type: "datasphere_chunk" };
  if (id) item.id = id;
  if (score !== undefined) item.score = score;
  if (src) item.excerpt = truncate(src, 1000);
  return item;
}

export function searchKnowledgeResult(raw: unknown, count = 5): { items: Item[] } {
  if (typeof raw !== "object" || raw === null) return { items: [] };
  const chunks = (raw as Record<string, unknown>)["chunks"];
  if (!Array.isArray(chunks)) return { items: [] };
  const bounded = chunks.slice(0, Math.min(Math.max(count, 0), 20));
  const items: Item[] = [];
  for (const entry of bounded) {
    const item = toChunkItem(entry);
    if (item) items.push(item);
    if (items.length >= 20) break;
  }
  return { items };
}

// ===========================================================================
// 10. signalwire_run_call_test
// ===========================================================================

export const runCallTestInput = z
  .object({
    from: e164.describe("Caller E.164 number (a number you own)"),
    to: e164.describe("Destination E.164 number"),
    spoken_text: spokenText.describe("Text to speak on the test call"),
    ring_timeout_seconds: z.number().int().min(1).max(60).optional().describe("Seconds to ring before giving up (1–60)"),
    status_callback_url: httpsUrl.optional().describe("HTTPS URL receiving call status callbacks"),
    confirm_call: confirmed.optional().describe("Set to true to confirm placing the test call"),
  })
  .strict()
  .describe("Start one bounded outbound development call");
export type RunCallTestInput = z.infer<typeof runCallTestInput>;

export function runCallTestResult(raw: unknown): { call_id?: string; platform_status?: string } {
  const id = pickId(raw, "call_id", "id", "callID");
  const status = pickStatus(raw, "state", "status", "call_state");
  const out: { call_id?: string; platform_status?: string } = {};
  if (id) out.call_id = id;
  if (status) out.platform_status = status;
  return out;
}

// ===========================================================================
// 11. signalwire_run_message_test
// ===========================================================================

export const runMessageTestInput = z
  .object({
    from: e164.describe("Sender E.164 number (a number you own)"),
    to: e164.describe("Destination E.164 number"),
    body: smsBody.describe("SMS body text"),
    status_callback_url: httpsUrl.optional().describe("HTTPS URL receiving message status callbacks"),
    confirm_message: confirmed.optional().describe("Set to true to confirm sending the SMS"),
  })
  .strict()
  .describe("Send one text-only development SMS via the Compatibility API");
export type RunMessageTestInput = z.infer<typeof runMessageTestInput>;

export function runMessageTestResult(raw: unknown): { message_sid?: string; platform_status?: string } {
  const sid = pickId(raw, "sid", "message_sid", "id");
  const status = pickStatus(raw, "status", "state");
  const out: { message_sid?: string; platform_status?: string } = {};
  if (sid) out.message_sid = sid;
  if (status) out.platform_status = status;
  return out;
}

// ===========================================================================
// 12. signalwire_control_call
// ===========================================================================

export const controlCallInput = z
  .object({
    action: z.enum(["end", "transfer"]).describe("Lifecycle action to perform"),
    call_id: uuid.describe("UUID of the live call to control"),
    to: e164.optional().describe("Destination E.164 number to transfer to (transfer action)"),
    confirm_end: confirmed.optional().describe("Set to true to confirm ending the call (end action)"),
    confirm_transfer: confirmed.optional().describe("Set to true to confirm transferring the call (transfer action)"),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.action === "transfer" && !v.to) {
      ctx.addIssue({ code: "custom", message: "transfer requires to", path: ["to"] });
    }
  })
  .describe("Perform a high-level lifecycle action on a live test call");
export type ControlCallInput = z.infer<typeof controlCallInput>;

export function controlCallResult(raw: unknown): { platform_status?: string } {
  const status = pickStatus(raw, "state", "status", "call_state");
  const out: { platform_status?: string } = {};
  if (status) out.platform_status = status;
  return out;
}

// ===========================================================================
// 13. signalwire_exercise_call_feature
// ===========================================================================

export const exerciseCallFeatureInput = z
  .object({
    action: z
      .enum([
        "play_audio",
        "stop_playback",
        "collect_digits",
        "stop_collect",
        "start_recording",
        "stop_recording",
        "start_detection",
        "stop_detection",
        "start_transcription",
        "stop_transcription",
      ])
      .describe("Media feature to exercise on the call"),
    call_id: uuid.describe("UUID of the live call to exercise the feature on"),
    audio_url: httpsUrl.optional().describe("HTTPS URL of the audio to play (play_audio)"),
    control_id: uuid.optional().describe("control_id from the original start action (stop_* actions)"),
    max_digits: z.number().int().min(1).max(64).optional().describe("Maximum digits to collect (collect_digits, 1-64)"),
    timeout_seconds: z.number().int().min(1).max(120).optional().describe("Seconds to wait for input (collect_digits, 1-120)"),
    confirm_recording: confirmed.optional().describe("Set to true to confirm recording (start_recording)"),
    detector: z.enum(["machine", "fax", "digit"]).optional().describe("Detector type to run (start_detection)"),
    status_callback_url: httpsUrl.optional().describe("HTTPS URL receiving transcription events (start_transcription)"),
    confirm_transcription: confirmed.optional().describe("Set to true to confirm transcription (start_transcription)"),
  })
  .strict()
  .superRefine((v, ctx) => {
    const req = (cond: boolean, field: string, msg: string) => {
      if (cond) ctx.addIssue({ code: "custom", message: msg, path: [field] });
    };
    const stopActions = ["stop_playback", "stop_collect", "stop_recording", "stop_detection", "stop_transcription"];
    req(v.action === "play_audio" && !v.audio_url, "audio_url", "play_audio requires audio_url");
    req(stopActions.includes(v.action) && !v.control_id, "control_id", `${v.action} requires control_id`);
    req(v.action === "collect_digits" && v.max_digits === undefined, "max_digits", "collect_digits requires max_digits");
    req(v.action === "start_detection" && !v.detector, "detector", "start_detection requires detector");
    req(v.action === "start_transcription" && !v.status_callback_url, "status_callback_url", "start_transcription requires status_callback_url");
  })
  .describe("Exercise one non-AI media feature on a live call");
export type ExerciseCallFeatureInput = z.infer<typeof exerciseCallFeatureInput>;

export function exerciseCallFeatureResult(raw: unknown, controlId?: string): { control_id?: string; platform_status?: string } {
  const id = controlId ?? pickId(raw, "control_id", "controlID");
  const status = pickStatus(raw, "state", "status");
  const out: { control_id?: string; platform_status?: string } = {};
  if (id) out.control_id = id;
  if (status) out.platform_status = status;
  return out;
}

// ===========================================================================
// 14. signalwire_control_ai_call
// ===========================================================================

export const controlAiCallInput = z
  .object({
    action: z.enum(["message", "hold", "unhold", "stop"]).describe("AI session action to perform"),
    call_id: uuid.describe("UUID of the live call with a running AI session"),
    role: z.enum(["system", "user", "assistant"]).optional().describe("Role of the message author (message action)"),
    text: textQuery.optional().describe("Message text (message action)"),
    prompt: textQuery.optional().describe("Optional prompt spoken before holding (hold action)"),
    timeout_seconds: z.number().int().min(1).max(3600).optional().describe("Seconds to hold before resuming (hold action, 1-3600)"),
    confirm_ai_action: confirmed.optional().describe("Set to true to confirm this AI action"),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.action === "message" && (!v.role || !v.text)) {
      ctx.addIssue({ code: "custom", message: "message requires role and text", path: ["action"] });
    }
  })
  .describe("Interact with an AI session already running on a live call");
export type ControlAiCallInput = z.infer<typeof controlAiCallInput>;

export function controlAiCallResult(raw: unknown): { platform_status?: string } {
  const status = pickStatus(raw, "state", "status");
  const out: { platform_status?: string } = {};
  if (status) out.platform_status = status;
  return out;
}

// ===========================================================================
// 15. signalwire_diagnose_interaction
// ===========================================================================

const messageId = z
  .union([uuid, messageSid])
  .describe("Message log UUID or Compatibility message SID (SM…/MM…)");

export const diagnoseInteractionInput = z
  .object({
    interaction_type: z.enum(["voice", "message"]).describe("Which kind of interaction to diagnose"),
    log_id: uuid.optional().describe("Voice log UUID to inspect (required for voice)"),
    message_id: messageId.optional().describe("Message log UUID or Compatibility message SID (required for message)"),
    include_timeline: z.boolean().optional().describe("Include the call event timeline (voice only, default true)"),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.interaction_type === "voice" && !v.log_id) {
      ctx.addIssue({ code: "custom", message: "voice requires log_id", path: ["log_id"] });
    }
    if (v.interaction_type === "message" && !v.message_id) {
      ctx.addIssue({ code: "custom", message: "message requires message_id", path: ["message_id"] });
    }
  })
  .describe("Assemble read-only evidence about a voice call or message");
export type DiagnoseInteractionInput = z.infer<typeof diagnoseInteractionInput>;

/** Project a single evidence source record into a bounded evidence entry. */
export function toEvidence(raw: unknown, source: string): NonNullable<Envelope["evidence"]>[number] | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  const fact =
    str(r["fact"], 1000) ??
    str(r["message"], 1000) ??
    str(r["summary"], 1000) ??
    str(r["description"], 1000) ??
    str(r["status"], 1000);
  if (!fact) return undefined;
  const id = pickId(raw, "id", "event_id", "sid");
  const evidence: NonNullable<Envelope["evidence"]>[number] = { source, fact };
  if (id) evidence.id = id;
  return evidence;
}

/** Count helper for operation journals. */
export function toOperation(op: Operation): Operation {
  return op;
}

export { excerpt };
