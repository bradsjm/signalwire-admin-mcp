/**
 * Unit tests (config / schemas / redaction / errors / output invariants) and
 * fake-client SDK-composition tests for every tool: method selection, payload
 * transforms, confirmation gates, write gate, readback, ambiguity, partial
 * failures, and error normalization.
 */

import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config.js";
import { redactDeep } from "../src/core/redaction.js";
import { toErrorDetail, toErrorEnvelope } from "../src/core/errors.js";
import { outputEnvelopeSchema, finalize } from "../src/core/output.js";
import { findResourcesInput } from "../src/tools/contracts.js";
import { fakeCtx } from "./helpers.js";
import { signalwireFindResources } from "../src/tools/inventory.js";
import {
  signalwireDeployAiAgent,
  signalwireDeployCallFlowVersion,
  signalwireDeploySwmlScript,
  signalwireConnectWebhook,
  signalwireProvisionTestNumber,
} from "../src/tools/deployment.js";
import { signalwireAddKnowledge, signalwireSearchKnowledge } from "../src/tools/knowledge.js";
import { signalwireRunCallTest, signalwireRunMessageTest } from "../src/tools/testing.js";
import { signalwireControlCall, signalwireExerciseCallFeature, signalwireControlAiCall } from "../src/tools/call-control.js";
import { signalwireDiagnoseInteraction } from "../src/tools/diagnostics.js";

const UUID = "11111111-2222-3333-4444-555555555555";
const SWML = { version: "1.0.0", sections: { main: [{ play: { url: "say:hi" } }] } };

describe("config", () => {
  it("accepts a bare host and defaults allowWrites to false", () => {
    const c = loadConfig({ SIGNALWIRE_SPACE: "example.signalwire.com", SIGNALWIRE_PROJECT_ID: UUID, SIGNALWIRE_API_TOKEN: "tok" });
    expect(c.space).toBe("example.signalwire.com");
    expect(c.allowWrites).toBe(false);
  });

  it("accepts an https URL and normalizes to a bare host", () => {
    const c = loadConfig({ SIGNALWIRE_SPACE: "https://example.signalwire.com", SIGNALWIRE_PROJECT_ID: UUID, SIGNALWIRE_API_TOKEN: "tok", SIGNALWIRE_MCP_ALLOW_WRITES: "true" });
    expect(c.space).toBe("example.signalwire.com");
    expect(c.allowWrites).toBe(true);
  });

  it("rejects ports, paths, and non-https in one error without leaking the token", () => {
    expect(() => loadConfig({ SIGNALWIRE_SPACE: "http://example.signalwire.com", SIGNALWIRE_PROJECT_ID: "", SIGNALWIRE_API_TOKEN: "secret-value" })).toThrow(/SIGNALWIRE_SPACE/);
    expect(() => loadConfig({ SIGNALWIRE_SPACE: "example.signalwire.com:443", SIGNALWIRE_PROJECT_ID: UUID, SIGNALWIRE_API_TOKEN: "tok" })).toThrow();
    try {
      loadConfig({ SIGNALWIRE_SPACE: "example.signalwire.com", SIGNALWIRE_PROJECT_ID: UUID, SIGNALWIRE_API_TOKEN: "leak-me" });
    } catch (e) {
      expect(String(e)).not.toContain("leak-me");
    }
  });
});

describe("schemas", () => {
  it("find_resources: exact resource_id excludes search fields", () => {
    expect(findResourcesInput.safeParse({ resource_type: "ai_agent", resource_id: UUID, name: "x" }).success).toBe(false);
  });
  it("find_resources: call_flow_version requires parent_id", () => {
    expect(findResourcesInput.safeParse({ resource_type: "call_flow_version" }).success).toBe(false);
    expect(findResourcesInput.safeParse({ resource_type: "call_flow_version", parent_id: UUID }).success).toBe(true);
  });
  it("find_resources: area_code only for available_phone_number", () => {
    expect(findResourcesInput.safeParse({ resource_type: "ai_agent", area_code: "512" }).success).toBe(false);
    expect(findResourcesInput.safeParse({ resource_type: "available_phone_number", area_code: "512" }).success).toBe(true);
  });
  it("find_resources rejects unknown fields", () => {
    expect(findResourcesInput.safeParse({ resource_type: "ai_agent", options: {} }).success).toBe(false);
  });
});

describe("redaction", () => {
  it("redacts sensitive keys recursively", () => {
    const out = redactDeep({ api_token: "x", nested: { Authorization: "y", safe: "z" } });
    expect(out).toEqual({ api_token: "[redacted]", nested: { Authorization: "[redacted]", safe: "z" } });
  });
});

describe("errors", () => {
  it("maps HTTP status to categories", () => {
    expect(toErrorDetail({ statusCode: 404, body: {}, url: "", method: "GET" }).category).toBe("not_found");
    expect(toErrorDetail({ statusCode: 401, body: {}, url: "", method: "GET" }).category).toBe("authentication");
    expect(toErrorDetail({ statusCode: 429, body: {}, url: "", method: "GET" }).category).toBe("rate_limit");
    expect(toErrorDetail({ statusCode: 500, body: {}, url: "", method: "GET" }).category).toBe("platform");
  });
  it("extracts body detail and request id", () => {
    const d = toErrorDetail({ statusCode: 422, body: { errors: [{ code: "bad", message: "no good", attribute: "name" }], request_id: "req-1" }, url: "", method: "POST" });
    expect(d.category).toBe("validation");
    expect(d.code).toBe("bad");
    expect(d.attribute).toBe("name");
    expect(d.request_id).toBe("req-1");
  });
  it("marks mutations not safe to retry", () => {
    const env = toErrorEnvelope({ statusCode: 503, body: {}, url: "", method: "POST" }, { summary: "x", kind: "mutation" });
    expect(env.safe_to_retry).toBe(false);
    expect(env.next_step).toMatch(/Inspect/i);
  });
  it("marks transient reads safe to retry", () => {
    const env = toErrorEnvelope({ statusCode: 503, body: {}, url: "", method: "GET" }, { summary: "x", kind: "read" });
    expect(env.safe_to_retry).toBe(true);
  });
});

describe("output invariants", () => {
  it("error status requires error field", () => {
    expect(() => outputEnvelopeSchema.parse({ status: "error", summary: "x" })).toThrow();
  });
  it("confirmation_required requires next_step", () => {
    expect(() => outputEnvelopeSchema.parse({ status: "confirmation_required", summary: "x" })).toThrow();
  });
  it("partial requires operations and safe_to_retry", () => {
    expect(() => outputEnvelopeSchema.parse({ status: "partial", summary: "x" })).toThrow();
  });
  it("rejects unknown fields", () => {
    expect(() => outputEnvelopeSchema.parse({ status: "complete", summary: "x", bogus: 1 })).toThrow();
  });
  it("finalize validates and sets isError only for error", () => {
    const ok = finalize({ status: "complete", summary: "ok" });
    expect(ok.isError).toBe(false);
    expect(ok.structuredContent.status).toBe("complete");
    const err = finalize({ status: "error", summary: "bad", error: { category: "internal", message: "x" }, next_step: "report it" });
    expect(err.isError).toBe(true);
    expect(JSON.stringify(err.content)).toContain("internal");
  });
  it("accepted requires a correlation identifier", () => {
    expect(() => outputEnvelopeSchema.parse({ status: "accepted", summary: "x" })).toThrow();
    expect(() => outputEnvelopeSchema.parse({ status: "accepted", summary: "x", control_id: "c1" })).toThrow();
  });
  it("accepted with a call id or message sid is valid", () => {
    expect(() => outputEnvelopeSchema.parse({ status: "accepted", summary: "x", call_id: "c1" })).not.toThrow();
    expect(() => outputEnvelopeSchema.parse({ status: "accepted", summary: "x", message_sid: "SM" + "a".repeat(32) })).not.toThrow();
    expect(() => outputEnvelopeSchema.parse({ status: "accepted", summary: "x", resource_id: "r1" })).not.toThrow();
  });
});

describe("find_resources compositions", () => {
  it("lists phone numbers via phoneNumbers.list", async () => {
    const { ctx, client } = fakeCtx();
    client.phoneNumbers.list.mockResolvedValueOnce({ data: [{ id: "pn-1", name: "Main", number: "+14155550100" }] });
    const r = await signalwireFindResources(ctx, { resource_type: "phone_number", limit: 5 });
    expect(client.phoneNumbers.list).toHaveBeenCalled();
    expect(r.structuredContent.items?.[0]?.id).toBe("pn-1");
  });
  it("searches available numbers with areacode transform", async () => {
    const { ctx, client } = fakeCtx();
    client.phoneNumbers.search.mockResolvedValueOnce({ data: [{ number: "+15125550100" }] });
    await signalwireFindResources(ctx, { resource_type: "available_phone_number", area_code: "512" });
    expect(client.phoneNumbers.search).toHaveBeenCalledWith({ areacode: "512" });
  });
  it("exact resource_id calls get, not list", async () => {
    const { ctx, client } = fakeCtx();
    client.fabric.aiAgents.get.mockResolvedValueOnce({ id: UUID, name: "A" });
    const r = await signalwireFindResources(ctx, { resource_type: "ai_agent", resource_id: UUID });
    expect(client.fabric.aiAgents.get).toHaveBeenCalledWith(UUID);
    expect(client.fabric.aiAgents.list).not.toHaveBeenCalled();
    expect(r.structuredContent.status).toBe("complete");
  });
  it("exact resource_id 404 returns not_found status (not an error)", async () => {
    const { ctx, client } = fakeCtx();
    client.fabric.aiAgents.get.mockRejectedValueOnce({ statusCode: 404, body: {}, url: "", method: "GET" });
    const r = await signalwireFindResources(ctx, { resource_type: "ai_agent", resource_id: UUID });
    expect(r.structuredContent.status).toBe("not_found");
    expect(r.isError).toBe(false);
    expect(r.structuredContent.next_step).toBeTruthy();
  });
});

describe("deploy_ai_agent compositions", () => {
  it("blocks when writes disabled", async () => {
    const { ctx } = fakeCtx(false);
    const r = await signalwireDeployAiAgent(ctx, { name: "A", agent_id: "ag", prompt_text: "p" });
    expect(r.structuredContent.status).toBe("blocked");
  });
  it("requires route confirmation before binding", async () => {
    const { ctx, client } = fakeCtx();
    const r = await signalwireDeployAiAgent(ctx, { name: "A", agent_id: "ag", prompt_text: "p", phone_number_id: "pn-1" });
    expect(r.structuredContent.status).toBe("confirmation_required");
    expect(client.fabric.aiAgents.create).not.toHaveBeenCalled();
  });
  it("creates when name absent", async () => {
    const { ctx, client } = fakeCtx();
    client.fabric.aiAgents.list.mockResolvedValueOnce({ data: [] });
    client.fabric.aiAgents.create.mockResolvedValueOnce({ id: "ag-1" });
    client.fabric.aiAgents.get.mockResolvedValueOnce({ id: "ag-1", name: "A" });
    const r = await signalwireDeployAiAgent(ctx, { name: "A", agent_id: "ag", prompt_text: "p" });
    expect(client.fabric.aiAgents.create).toHaveBeenCalledWith({ name: "A", agent_id: "ag", prompt: { text: "p" } });
    expect(r.structuredContent.status).toBe("complete");
  });
  it("updates by resource_id and binds number after confirmation", async () => {
    const { ctx, client } = fakeCtx();
    client.fabric.aiAgents.get.mockResolvedValue({ id: UUID, name: "A" });
    const r = await signalwireDeployAiAgent(ctx, { name: "A", agent_id: "ag", prompt_text: "p", resource_id: UUID, phone_number_id: "pn-1", confirm_route_change: true });
    expect(client.fabric.aiAgents.update).toHaveBeenCalledWith(UUID, expect.objectContaining({ prompt: { text: "p" } }));
    expect(client.phoneNumbers.setAiAgent).toHaveBeenCalledWith("pn-1", UUID);
    expect(r.structuredContent.status).toBe("complete");
  });
  it("returns ambiguity error for duplicate names", async () => {
    const { ctx, client } = fakeCtx();
    client.fabric.aiAgents.list.mockResolvedValueOnce({ data: [{ id: "a1", name: "A" }, { id: "a2", name: "A" }] });
    const r = await signalwireDeployAiAgent(ctx, { name: "A", agent_id: "ag", prompt_text: "p" });
    expect(r.structuredContent.status).toBe("error");
    expect(r.isError).toBe(true);
  });
  it("reports partial when binding fails after config", async () => {
    const { ctx, client } = fakeCtx();
    client.fabric.aiAgents.get.mockResolvedValue({ id: UUID, name: "A" });
    client.phoneNumbers.setAiAgent.mockRejectedValueOnce(new Error("boom"));
    client.phoneNumbers.get.mockResolvedValueOnce({ id: "pn-1" });
    const r = await signalwireDeployAiAgent(ctx, { name: "A", agent_id: "ag", prompt_text: "p", resource_id: UUID, phone_number_id: "pn-1", confirm_route_change: true });
    expect(r.structuredContent.status).toBe("partial");
    expect(r.structuredContent.operations?.some((o) => o.status === "failed")).toBe(true);
    expect(r.structuredContent.safe_to_retry).toBe(true);
  });
});

describe("deploy_swml_script compositions", () => {
  it("creates a new script without confirm_replace", async () => {
    const { ctx, client } = fakeCtx();
    client.fabric.swmlScripts.list.mockResolvedValueOnce({ data: [] });
    client.fabric.swmlScripts.create.mockResolvedValueOnce({ id: "sw-1" });
    client.fabric.swmlScripts.get.mockResolvedValueOnce({ id: "sw-1", name: "S" });
    await signalwireDeploySwmlScript(ctx, { script_type: "calling", name: "S", swml: SWML });
    expect(client.fabric.swmlScripts.create).toHaveBeenCalledWith(expect.objectContaining({ name: "S", contents: SWML }));
  });
  it("requires confirm_replace to replace existing", async () => {
    const { ctx, client } = fakeCtx();
    client.fabric.swmlScripts.list.mockResolvedValueOnce({ data: [{ id: "sw-1", name: "S" }] });
    const r = await signalwireDeploySwmlScript(ctx, { script_type: "calling", name: "S", swml: SWML });
    expect(r.structuredContent.status).toBe("confirmation_required");
    expect(client.fabric.swmlScripts.update).not.toHaveBeenCalled();
  });
});

describe("deploy_call_flow_version compositions", () => {
  it("requires deployment confirmation", async () => {
    const { ctx, client } = fakeCtx();
    const r = await signalwireDeployCallFlowVersion(ctx, { call_flow_id: UUID, document_version: "v1" });
    expect(r.structuredContent.status).toBe("confirmation_required");
    expect(client.fabric.callFlows.deployVersion).not.toHaveBeenCalled();
  });
  it("requires route confirmation before binding a number", async () => {
    const { ctx, client } = fakeCtx();
    const r = await signalwireDeployCallFlowVersion(ctx, { call_flow_id: UUID, document_version: "v1", phone_number_id: "pn-1", confirm_deployment: true });
    expect(r.structuredContent.status).toBe("confirmation_required");
    expect(client.fabric.callFlows.deployVersion).not.toHaveBeenCalled();
  });
  it("deploys a version and reads back with the call flow id", async () => {
    const { ctx, client } = fakeCtx();
    client.fabric.callFlows.get.mockResolvedValue({ id: UUID, name: "F", status: "deployed" });
    const r = await signalwireDeployCallFlowVersion(ctx, { call_flow_id: UUID, document_version: "v1", confirm_deployment: true });
    expect(client.fabric.callFlows.deployVersion).toHaveBeenCalledWith(UUID, expect.objectContaining({ document_version: "v1" }));
    expect(r.structuredContent.status).toBe("complete");
    expect(r.structuredContent.resource_id).toBe(UUID);
  });
  it("retains the deployed journal and id when bind then readback fail", async () => {
    const { ctx, client } = fakeCtx();
    client.phoneNumbers.setCallFlow.mockRejectedValueOnce(new Error("bind boom"));
    client.fabric.callFlows.get.mockRejectedValueOnce(new Error("readback boom"));
    client.phoneNumbers.get.mockRejectedValueOnce(new Error("number readback boom"));
    const r = await signalwireDeployCallFlowVersion(ctx, { call_flow_id: UUID, document_version: "v1", phone_number_id: "pn-1", confirm_deployment: true, confirm_route_change: true });
    expect(r.structuredContent.status).toBe("partial");
    expect(r.structuredContent.resource_id).toBe(UUID);
    expect(r.structuredContent.safe_to_retry).toBe(false);
    const ops = r.structuredContent.operations ?? [];
    expect(ops.some((o) => o.operation === "deploy_call_flow_version" && o.status === "complete")).toBe(true);
    expect(ops.some((o) => o.operation === "bind_phone_number" && o.status === "failed" && o.resource_id === "pn-1")).toBe(true);
    expect(ops.some((o) => o.operation === "readback_call_flow" && o.status === "failed")).toBe(true);
  });
});

describe("connect_webhook compositions", () => {
  it("calls setSwmlWebhook after confirmation", async () => {
    const { ctx, client } = fakeCtx();
    client.phoneNumbers.get.mockResolvedValueOnce({ id: "pn-1" });
    const r = await signalwireConnectWebhook(ctx, { webhook_type: "swml", phone_number_id: "pn-1", url: "https://e.com/s", confirm_route_change: true });
    expect(client.phoneNumbers.setSwmlWebhook).toHaveBeenCalledWith("pn-1", "https://e.com/s");
    expect(r.structuredContent.status).toBe("complete");
  });
  it("calls setCxmlWebhook with fallback + status urls", async () => {
    const { ctx, client } = fakeCtx();
    client.phoneNumbers.get.mockResolvedValueOnce({ id: "pn-1" });
    await signalwireConnectWebhook(ctx, { webhook_type: "cxml", phone_number_id: "pn-1", url: "https://e.com/c", fallback_url: "https://e.com/f", status_callback_url: "https://e.com/s", confirm_route_change: true });
    expect(client.phoneNumbers.setCxmlWebhook).toHaveBeenCalledWith("pn-1", { url: "https://e.com/c", fallbackUrl: "https://e.com/f", statusCallbackUrl: "https://e.com/s" });
  });
  it("blocks without confirmation", async () => {
    const { ctx } = fakeCtx();
    const r = await signalwireConnectWebhook(ctx, { webhook_type: "swml", phone_number_id: "pn-1", url: "https://e.com/s" });
    expect(r.structuredContent.status).toBe("confirmation_required");
  });
});

describe("provision_test_number compositions", () => {
  it("requires confirm_purchase", async () => {
    const { ctx, client } = fakeCtx();
    const r = await signalwireProvisionTestNumber(ctx, { number: "+14155550100" });
    expect(r.structuredContent.status).toBe("confirmation_required");
    expect(client.phoneNumbers.create).not.toHaveBeenCalled();
  });
  it("creates, labels, and reads back with the resource id", async () => {
    const { ctx, client } = fakeCtx();
    client.phoneNumbers.create.mockResolvedValueOnce({ id: "pn-9" });
    client.phoneNumbers.get.mockResolvedValueOnce({ id: "pn-9", name: "Dev" });
    const r = await signalwireProvisionTestNumber(ctx, { number: "+14155550100", label: "Dev", confirm_purchase: true });
    expect(client.phoneNumbers.update).toHaveBeenCalledWith("pn-9", { name: "Dev" });
    expect(r.structuredContent.status).toBe("complete");
    expect(r.structuredContent.resource_id).toBe("pn-9");
  });
  it("missing id after create is an error and not retry-safe, with no readback", async () => {
    const { ctx, client } = fakeCtx();
    client.phoneNumbers.create.mockResolvedValueOnce({});
    const r = await signalwireProvisionTestNumber(ctx, { number: "+14155550100", confirm_purchase: true });
    expect(r.structuredContent.status).toBe("error");
    expect(r.isError).toBe(true);
    expect(r.structuredContent.safe_to_retry).toBe(false);
    expect(r.structuredContent.operations?.[0]?.sdk_method).toBe("phoneNumbers.create");
    expect(r.structuredContent.operations?.[0]?.status).toBe("unknown");
    expect(client.phoneNumbers.get).not.toHaveBeenCalled();
  });
  it("label failure after purchase is partial with the purchased id", async () => {
    const { ctx, client } = fakeCtx();
    client.phoneNumbers.create.mockResolvedValueOnce({ id: "pn-9" });
    client.phoneNumbers.update.mockRejectedValueOnce(new Error("label boom"));
    const r = await signalwireProvisionTestNumber(ctx, { number: "+14155550100", label: "Dev", confirm_purchase: true });
    expect(r.structuredContent.status).toBe("partial");
    expect(r.structuredContent.resource_id).toBe("pn-9");
    expect(r.structuredContent.safe_to_retry).toBe(false);
    expect(r.structuredContent.operations?.some((o) => o.status === "failed")).toBe(true);
    expect(r.structuredContent.operations?.some((o) => o.status === "complete")).toBe(true);
  });
  it("readback failure after purchase is partial with the purchased id", async () => {
    const { ctx, client } = fakeCtx();
    client.phoneNumbers.create.mockResolvedValueOnce({ id: "pn-9" });
    client.phoneNumbers.get.mockRejectedValueOnce(new Error("get boom"));
    const r = await signalwireProvisionTestNumber(ctx, { number: "+14155550100", confirm_purchase: true });
    expect(r.structuredContent.status).toBe("partial");
    expect(r.structuredContent.resource_id).toBe("pn-9");
    expect(r.structuredContent.safe_to_retry).toBe(false);
    expect(r.structuredContent.operations?.some((o) => o.status === "failed" && o.sdk_method === "phoneNumbers.get")).toBe(true);
  });
});

describe("knowledge compositions", () => {
  it("add_knowledge requires confirm_ingestion then creates+reads back", async () => {
    const { ctx, client } = fakeCtx();
    let r = await signalwireAddKnowledge(ctx, { url: "https://e.com/doc" });
    expect(r.structuredContent.status).toBe("confirmation_required");
    client.datasphere.documents.create.mockResolvedValueOnce({ id: "doc-1" });
    client.datasphere.documents.get.mockResolvedValueOnce({ id: "doc-1", status: "pending" });
    r = await signalwireAddKnowledge(ctx, { url: "https://e.com/doc", confirm_ingestion: true });
    expect(client.datasphere.documents.create).toHaveBeenCalledWith({ url: "https://e.com/doc" });
    expect(r.structuredContent.platform_status).toBe("pending");
  });
  it("add_knowledge missing id after create is an error and not retry-safe", async () => {
    const { ctx, client } = fakeCtx();
    client.datasphere.documents.create.mockResolvedValueOnce({ status: "accepted" });
    const r = await signalwireAddKnowledge(ctx, { url: "https://e.com/doc", confirm_ingestion: true });
    expect(r.structuredContent.status).toBe("error");
    expect(r.isError).toBe(true);
    expect(r.structuredContent.safe_to_retry).toBe(false);
    expect(r.structuredContent.operations?.[0]?.sdk_method).toBe("datasphere.documents.create");
    expect(r.structuredContent.operations?.[0]?.status).toBe("unknown");
    expect(client.datasphere.documents.get).not.toHaveBeenCalled();
  });
  it("add_knowledge readback failure after a known id is partial with resource_id", async () => {
    const { ctx, client } = fakeCtx();
    client.datasphere.documents.create.mockResolvedValueOnce({ id: "doc-1" });
    client.datasphere.documents.get.mockRejectedValueOnce(new Error("boom"));
    const r = await signalwireAddKnowledge(ctx, { url: "https://e.com/doc", confirm_ingestion: true });
    expect(r.structuredContent.status).toBe("partial");
    expect(r.structuredContent.resource_id).toBe("doc-1");
    expect(r.structuredContent.safe_to_retry).toBe(false);
    expect(r.structuredContent.operations?.some((o) => o.status === "complete")).toBe(true);
  });
  it("search_knowledge projects documented chunks ({ text, document_id })", async () => {
    const { ctx, client } = fakeCtx();
    client.datasphere.documents.search.mockResolvedValueOnce({
      chunks: [{ document_id: "doc-1", text: "hello world" }],
    });
    const r = await signalwireSearchKnowledge(ctx, { query: "hi", count: 3 });
    expect(client.datasphere.documents.search).toHaveBeenCalledWith(expect.objectContaining({ query_string: "hi", count: 3 }));
    const item = r.structuredContent.items?.[0];
    expect(item?.type).toBe("datasphere_chunk");
    expect(item?.id).toBe("doc-1");
    expect(item?.excerpt).toBe("hello world");
  });
  it("search_knowledge tolerates content/text excerpt aliases defensively", async () => {
    // The live API returns only { text, document_id }; the parser still accepts
    // `content` so a future field rename degrades gracefully.
    const { ctx, client } = fakeCtx();
    client.datasphere.documents.search.mockResolvedValueOnce({ chunks: [{ document_id: "doc-2", content: "via content alias" }] });
    const r = await signalwireSearchKnowledge(ctx, { query: "hi" });
    expect(r.structuredContent.items?.[0]?.id).toBe("doc-2");
    expect(r.structuredContent.items?.[0]?.excerpt).toBe("via content alias");
  });
  it("search_knowledge bounds the output by count", async () => {
    const { ctx, client } = fakeCtx();
    client.datasphere.documents.search.mockResolvedValueOnce({
      chunks: [{ document_id: "d1", text: "a" }, { document_id: "d2", text: "b" }, { document_id: "d3", text: "c" }],
    });
    const r = await signalwireSearchKnowledge(ctx, { query: "hi", count: 2 });
    expect(r.structuredContent.items?.length).toBe(2);
  });
  it("search_knowledge truncates a long excerpt to 1000 characters", async () => {
    const { ctx, client } = fakeCtx();
    client.datasphere.documents.search.mockResolvedValueOnce({ chunks: [{ document_id: "d1", text: "x".repeat(2500) }] });
    const r = await signalwireSearchKnowledge(ctx, { query: "hi" });
    const excerpt = r.structuredContent.items?.[0]?.excerpt;
    expect(excerpt).toBeDefined();
    expect(excerpt!.length).toBe(1000);
  });
  it("search_knowledge ignores an unsupported envelope shape", async () => {
    const { ctx, client } = fakeCtx();
    client.datasphere.documents.search.mockResolvedValueOnce({ data: [{ id: "x" }] });
    const r = await signalwireSearchKnowledge(ctx, { query: "hi" });
    expect(r.structuredContent.items?.length).toBe(0);
    expect(r.structuredContent.status).toBe("complete");
  });
});

describe("testing compositions", () => {
  it("run_call_test dials with say-and-hangup SWML", async () => {
    const { ctx, client } = fakeCtx();
    client.calling.dial.mockResolvedValueOnce({ call_id: "c1", state: "ringing" });
    const r = await signalwireRunCallTest(ctx, { from: "+14155550100", to: "+14155550101", spoken_text: "hello", confirm_call: true });
    const arg = client.calling.dial.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg).toMatchObject({ from: "+14155550100", to: "+14155550101" });
    expect((arg.swml as Record<string, unknown>).version).toBe("1.0.0");
    expect(r.structuredContent.status).toBe("accepted");
    expect(r.structuredContent.call_id).toBe("c1");
  });
  it("run_call_test missing call id is an error and not retry-safe", async () => {
    const { ctx, client } = fakeCtx();
    client.calling.dial.mockResolvedValueOnce({ state: "ringing" });
    const r = await signalwireRunCallTest(ctx, { from: "+14155550100", to: "+14155550101", spoken_text: "hello", confirm_call: true });
    expect(r.structuredContent.status).toBe("error");
    expect(r.isError).toBe(true);
    expect(r.structuredContent.safe_to_retry).toBe(false);
    expect(r.structuredContent.call_id).toBeUndefined();
    expect(r.structuredContent.operations?.[0]?.sdk_method).toBe("calling.dial");
    expect(r.structuredContent.operations?.[0]?.status).toBe("unknown");
    expect(r.structuredContent.next_step).toMatch(/Dashboard/i);
  });
  it("run_message_test sends Compatibility body", async () => {
    const { ctx, client } = fakeCtx();
    client.compat.messages.create.mockResolvedValueOnce({ sid: "SM" + "a".repeat(32), status: "queued" });
    const r = await signalwireRunMessageTest(ctx, { from: "+14155550100", to: "+14155550101", body: "hi", confirm_message: true });
    expect(client.compat.messages.create).toHaveBeenCalledWith({ From: "+14155550100", To: "+14155550101", Body: "hi" });
    expect(r.structuredContent.message_sid).toMatch(/^SM/);
  });
  it("run_message_test missing sid is an error and not retry-safe", async () => {
    const { ctx, client } = fakeCtx();
    client.compat.messages.create.mockResolvedValueOnce({ status: "queued" });
    const r = await signalwireRunMessageTest(ctx, { from: "+14155550100", to: "+14155550101", body: "hi", confirm_message: true });
    expect(r.structuredContent.status).toBe("error");
    expect(r.isError).toBe(true);
    expect(r.structuredContent.safe_to_retry).toBe(false);
    expect(r.structuredContent.message_sid).toBeUndefined();
    expect(r.structuredContent.operations?.[0]?.sdk_method).toBe("compat.messages.create");
  });
});

describe("call-control compositions", () => {
  it("control_call end requires confirm_end", async () => {
    const { ctx } = fakeCtx();
    const r = await signalwireControlCall(ctx, { action: "end", call_id: UUID });
    expect(r.structuredContent.status).toBe("confirmation_required");
  });
  it("control_call transfer maps to dest", async () => {
    const { ctx, client } = fakeCtx();
    await signalwireControlCall(ctx, { action: "transfer", call_id: UUID, to: "+14155550199", confirm_transfer: true });
    expect(client.calling.transfer).toHaveBeenCalledWith(UUID, { dest: "+14155550199" });
  });
  it("exercise_call_feature play_audio sends the documented payload", async () => {
    const { ctx, client } = fakeCtx();
    const r = await signalwireExerciseCallFeature(ctx, { action: "play_audio", call_id: UUID, audio_url: "https://e.com/a.wav" });
    const arg = client.calling.play.mock.calls[0]!;
    expect(arg[0]).toBe(UUID);
    const payload = arg[1] as Record<string, unknown>;
    expect(payload.control_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(payload.play).toEqual([{ type: "audio", params: { url: "https://e.com/a.wav" } }]);
    expect(r.structuredContent.control_id).toMatch(/^[0-9a-f-]{36}$/);
  });
  it("exercise_call_feature collect_digits sends documented digits payload with timeout", async () => {
    const { ctx, client } = fakeCtx();
    await signalwireExerciseCallFeature(ctx, { action: "collect_digits", call_id: UUID, max_digits: 5, timeout_seconds: 10 });
    const arg = client.calling.collect.mock.calls[0]!;
    expect(arg[0]).toBe(UUID);
    const payload = arg[1] as Record<string, unknown>;
    expect(payload.control_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(payload.digits).toEqual({ max: 5, digit_timeout: 10 });
  });
  it("exercise_call_feature collect_digits without timeout omits digit_timeout", async () => {
    const { ctx, client } = fakeCtx();
    await signalwireExerciseCallFeature(ctx, { action: "collect_digits", call_id: UUID, max_digits: 4 });
    const payload = client.calling.collect.mock.calls[0]![1] as Record<string, unknown>;
    expect(payload.digits).toEqual({ max: 4 });
  });
  it("exercise_call_feature start_recording requires confirmation and does not record", async () => {
    const { ctx, client } = fakeCtx();
    const r = await signalwireExerciseCallFeature(ctx, { action: "start_recording", call_id: UUID });
    expect(r.structuredContent.status).toBe("confirmation_required");
    expect(client.calling.record).not.toHaveBeenCalled();
  });
  it("exercise_call_feature start_recording sends documented record payload after confirmation", async () => {
    const { ctx, client } = fakeCtx();
    await signalwireExerciseCallFeature(ctx, { action: "start_recording", call_id: UUID, confirm_recording: true });
    const arg = client.calling.record.mock.calls[0]!;
    expect(arg[0]).toBe(UUID);
    const payload = arg[1] as Record<string, unknown>;
    expect(payload.control_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(payload.record).toEqual({ audio: {} });
  });
  it("control_ai_call message maps message_text", async () => {
    const { ctx, client } = fakeCtx();
    await signalwireControlAiCall(ctx, { action: "message", call_id: UUID, role: "user", text: "hi", confirm_ai_action: true });
    expect(client.calling.aiMessage).toHaveBeenCalledWith(UUID, { role: "user", message_text: "hi" });
  });
});

describe("diagnostics compositions", () => {
  it("voice reads log + events and infers status", async () => {
    const { ctx, client } = fakeCtx();
    const r = await signalwireDiagnoseInteraction(ctx, { interaction_type: "voice", log_id: UUID });
    expect(client.logs.voice.get).toHaveBeenCalledWith(UUID);
    expect(client.logs.voice.listEvents).toHaveBeenCalledWith(UUID);
    expect(r.structuredContent.evidence?.length).toBeGreaterThan(0);
    expect(r.structuredContent.inferences?.some((i) => i.statement.includes("completed"))).toBe(true);
  });
  it("voice 404 is not_found, not a false complete", async () => {
    const { ctx, client } = fakeCtx();
    client.logs.voice.get.mockRejectedValueOnce({ statusCode: 404, body: {}, url: "", method: "GET" });
    const r = await signalwireDiagnoseInteraction(ctx, { interaction_type: "voice", log_id: UUID });
    expect(r.structuredContent.status).toBe("not_found");
    expect(r.isError).toBe(false);
    expect(r.structuredContent.summary).toContain(UUID);
  });
  it("voice 403 is an error with the preserved permission category", async () => {
    const { ctx, client } = fakeCtx();
    client.logs.voice.get.mockRejectedValueOnce({ statusCode: 403, body: {}, url: "", method: "GET" });
    const r = await signalwireDiagnoseInteraction(ctx, { interaction_type: "voice", log_id: UUID });
    expect(r.structuredContent.status).toBe("error");
    expect(r.isError).toBe(true);
    expect(r.structuredContent.error?.category).toBe("permission");
  });
  it("voice timeline failure retains the primary voice-log evidence", async () => {
    const { ctx, client } = fakeCtx();
    client.logs.voice.listEvents.mockRejectedValueOnce(new Error("timeline boom"));
    const r = await signalwireDiagnoseInteraction(ctx, { interaction_type: "voice", log_id: UUID });
    expect(r.structuredContent.status).toBe("complete");
    expect(r.structuredContent.evidence?.some((e) => e.source === "voice_log")).toBe(true);
    expect(r.structuredContent.unknowns?.some((u) => /timeline/i.test(u))).toBe(true);
  });
  it("message UUID 404 is not_found", async () => {
    const { ctx, client } = fakeCtx();
    client.logs.messages.get.mockRejectedValueOnce({ statusCode: 404, body: {}, url: "", method: "GET" });
    const r = await signalwireDiagnoseInteraction(ctx, { interaction_type: "message", message_id: UUID });
    expect(r.structuredContent.status).toBe("not_found");
  });
  it("compatibility SID 404 is not_found", async () => {
    const { ctx, client } = fakeCtx();
    const sid = "SM" + "a".repeat(32);
    client.compat.messages.get.mockRejectedValueOnce({ statusCode: 404, body: {}, url: "", method: "GET" });
    const r = await signalwireDiagnoseInteraction(ctx, { interaction_type: "message", message_id: sid });
    expect(r.structuredContent.status).toBe("not_found");
    expect(client.compat.messages.get).toHaveBeenCalledWith(sid);
  });
  it("compatibility SID correlation sends documented date filters and matches exactly one", async () => {
    const { ctx, client } = fakeCtx();
    const sid = "SM" + "a".repeat(32);
    client.compat.messages.get.mockResolvedValueOnce({ sid, status: "sent", from: "+14155550100", to: "+14155550101", date_sent: "Thu, 15 Jan 2026 10:00:00 +0000" });
    client.logs.messages.list.mockResolvedValueOnce({
      data: [
        { id: "mlog-a", from: "+14155550100", to: "+14155550101", created_at: "2026-01-15T10:01:00.000Z", status: "delivered" },
        { id: "mlog-b", from: "+14155550100", to: "+15555550102", created_at: "2026-01-15T10:01:00.000Z", status: "delivered" },
        { id: "mlog-c", from: "+14155550100", to: "+14155550101", created_at: "2026-01-15T11:00:00.000Z", status: "delivered" },
      ],
    });
    const r = await signalwireDiagnoseInteraction(ctx, { interaction_type: "message", message_id: sid });
    expect(client.logs.messages.list).toHaveBeenCalledWith({ created_after: "2026-01-15T09:55:00.000Z", created_before: "2026-01-15T10:05:00.000Z", page_size: 50 });
    expect(r.structuredContent.evidence?.some((e) => e.source === "message_log_candidate" && e.id === "mlog-a")).toBe(true);
    expect(r.structuredContent.inferences?.some((i) => i.confidence === "medium")).toBe(true);
  });
  it("compatibility SID zero matches is an unknown, not an error", async () => {
    const { ctx, client } = fakeCtx();
    const sid = "SM" + "a".repeat(32);
    client.compat.messages.get.mockResolvedValueOnce({ sid, status: "sent", from: "+14155550100", to: "+14155550101", date_sent: "Thu, 15 Jan 2026 10:00:00 +0000" });
    client.logs.messages.list.mockResolvedValueOnce({ data: [] });
    const r = await signalwireDiagnoseInteraction(ctx, { interaction_type: "message", message_id: sid });
    expect(r.structuredContent.status).toBe("complete");
    expect(r.structuredContent.unknowns?.some((u) => /correlat/i.test(u))).toBe(true);
    expect(r.structuredContent.evidence?.some((e) => e.source === "message_log_candidate")).toBe(false);
  });
  it("compatibility SID ambiguous matches selects none", async () => {
    const { ctx, client } = fakeCtx();
    const sid = "SM" + "a".repeat(32);
    client.compat.messages.get.mockResolvedValueOnce({ sid, status: "sent", from: "+14155550100", to: "+14155550101", date_sent: "Thu, 15 Jan 2026 10:00:00 +0000" });
    client.logs.messages.list.mockResolvedValueOnce({
      data: [
        { id: "mlog-a", from: "+14155550100", to: "+14155550101", created_at: "2026-01-15T10:00:30.000Z", status: "delivered" },
        { id: "mlog-b", from: "+14155550100", to: "+14155550101", created_at: "2026-01-15T10:00:45.000Z", status: "delivered" },
      ],
    });
    const r = await signalwireDiagnoseInteraction(ctx, { interaction_type: "message", message_id: sid });
    expect(r.structuredContent.evidence?.some((e) => e.source === "message_log_candidate")).toBe(false);
    expect(r.structuredContent.unknowns?.some((u) => /ambig/i.test(u))).toBe(true);
  });
  it("compatibility SID without a timestamp does not attempt correlation", async () => {
    const { ctx, client } = fakeCtx();
    const sid = "SM" + "a".repeat(32);
    client.compat.messages.get.mockResolvedValueOnce({ sid, status: "sent", from: "+14155550100", to: "+14155550101" });
    const r = await signalwireDiagnoseInteraction(ctx, { interaction_type: "message", message_id: sid });
    expect(client.logs.messages.list).not.toHaveBeenCalled();
    expect(r.structuredContent.evidence?.some((e) => e.source === "compat_message")).toBe(true);
  });
});
