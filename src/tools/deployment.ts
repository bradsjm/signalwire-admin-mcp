/**
 * Deployment & provisioning tools.
 *
 * - signalwire_deploy_ai_agent
 * - signalwire_deploy_call_flow_version
 * - signalwire_deploy_swml_script
 * - signalwire_connect_webhook
 * - signalwire_connect_relay_application
 * - signalwire_provision_test_number
 *
 * Each mutation resolves exact ids before names (rejecting ambiguity), checks
 * the write gate and the relevant named confirmation before any mutating SDK
 * call, reads durable state back, and reports a truthful partial journal when
 * configuration succeeds but a later step fails.
 */

import { executeTool, writeGateBlocked, confirmationRequiredEnvelope, resolveByName, op, complete, unchanged, accepted, partial, type ToolContext, type Operation } from "./runtime.js";
import {
  deployAiAgentResult,
  deployCallFlowVersionResult,
  deploySwmlScriptResult,
  connectWebhookResult,
  connectRelayApplicationResult,
  provisionTestNumberResult,
  pickId,
  type DeployAiAgentInput,
  type DeployCallFlowVersionInput,
  type DeploySwmlScriptInput,
  type ConnectWebhookInput,
  type ConnectRelayApplicationInput,
  type ProvisionTestNumberInput,
} from "./contracts.js";
import { errorResult, type Envelope, type EnvelopeFields, type McpToolResult } from "../core/output.js";
import type { Params } from "../signalwire/client.js";
function ambiguityError(type: string, name: string, candidates: readonly unknown[]): Envelope {
  return {
    status: "error",
    summary: `Multiple ${type} resources match the name '${name}'.`,
    items: candidates as NonNullable<Envelope["items"]>,
    error: { category: "validation", message: `Name '${name}' is ambiguous; provide an exact resource_id.` },
    next_step: `Provide the exact resource_id of one of the listed ${type} resources.`,
  } as Envelope;
}

// ===========================================================================
// signalwire_deploy_ai_agent
// ===========================================================================

export async function signalwireDeployAiAgent(ctx: ToolContext, input: DeployAiAgentInput): Promise<McpToolResult> {
  return executeTool("signalwire_deploy_ai_agent", ctx, "mutation", async () => {
    const blocked = writeGateBlocked(ctx);
    if (blocked) return blocked;
    const c = ctx.client;

    if (input.phone_number_id && input.confirm_route_change !== true) {
      return confirmationRequiredEnvelope({
        operation: "bind a phone number to the AI agent",
        target: input.phone_number_id,
        impact: "Inbound calls to this number will route to the AI agent, replacing any existing route.",
        confirmationField: "confirm_route_change",
      });
    }

    const operations: Operation[] = [];
    let agentId = input.resource_id;

    if (!agentId) {
      const list = await c.fabric.aiAgents.list();
      const resolution = resolveByName(list, input.name, "ai_agent");
      if (resolution.kind === "ambiguous") return ambiguityError("ai_agent", input.name, resolution.candidates);
      if (resolution.kind === "not_found") {
        const created = await c.fabric.aiAgents.create({ name: input.name, agent_id: input.agent_id, prompt: { text: input.prompt_text } });
        agentId = pickId(created, "id", "resource_id");
        operations.push(op("create_ai_agent", "fabric.aiAgents.create", "complete", `Created AI agent '${input.name}'.`, agentId));
      } else {
        agentId = resolution.id;
      }
    }

    if (agentId) {
      await c.fabric.aiAgents.update(agentId, { name: input.name, agent_id: input.agent_id, prompt: { text: input.prompt_text } });
      operations.push(op("update_ai_agent", "fabric.aiAgents.update", "complete", `Configured AI agent ${agentId}.`, agentId));
    }

    const agentRaw = agentId ? await c.fabric.aiAgents.get(agentId) : undefined;

    if (input.phone_number_id && agentId) {
      try {
        await c.phoneNumbers.setAiAgent(input.phone_number_id, agentId);
        operations.push(op("bind_phone_number", "phoneNumbers.setAiAgent", "complete", `Bound ${input.phone_number_id} to AI agent ${agentId}.`, input.phone_number_id));
      } catch (err) {
        operations.push(op("bind_phone_number", "phoneNumbers.setAiAgent", "failed", `Failed to bind ${input.phone_number_id}.`));
        const numberRaw = await safeGet(c.phoneNumbers.get, input.phone_number_id);
        const parsed = deployAiAgentResult(agentRaw, numberRaw);
        return partial(`AI agent configured, but binding ${input.phone_number_id} failed.`, operations, parsed);
      }
    }

    const numberRaw = input.phone_number_id ? await safeGet(c.phoneNumbers.get, input.phone_number_id) : undefined;
    const parsed = deployAiAgentResult(agentRaw, numberRaw);
    const summary = input.phone_number_id
      ? `AI agent configured and number ${input.phone_number_id} bound.`
      : `AI agent configured.`;
    return complete(summary, parsed);
  });
}

// ===========================================================================
// signalwire_deploy_call_flow_version
// ===========================================================================

export async function signalwireDeployCallFlowVersion(ctx: ToolContext, input: DeployCallFlowVersionInput): Promise<McpToolResult> {
  return executeTool("signalwire_deploy_call_flow_version", ctx, "mutation", async () => {
    const blocked = writeGateBlocked(ctx);
    if (blocked) return blocked;
    const c = ctx.client;

    if (input.confirm_deployment !== true) {
      return confirmationRequiredEnvelope({
        operation: "deploy a Call Flow version",
        target: input.call_flow_id,
        impact: "The deployed version becomes the live Call Flow behavior.",
        confirmationField: "confirm_deployment",
      });
    }
    if (input.phone_number_id && input.confirm_route_change !== true) {
      return confirmationRequiredEnvelope({
        operation: "bind a phone number to the Call Flow",
        target: input.phone_number_id,
        impact: "Inbound calls to this number will route to the Call Flow, replacing any existing route.",
        confirmationField: "confirm_route_change",
      });
    }

    const operations: Operation[] = [];
    const deployBody: Params = input.document_version ? { document_version: input.document_version } : { call_flow_version_id: input.call_flow_version_id };
    if (input.call_flow_version_id) deployBody.call_flow_version_id = input.call_flow_version_id;
    await c.fabric.callFlows.deployVersion(input.call_flow_id, deployBody);
    operations.push(op("deploy_call_flow_version", "fabric.callFlows.deployVersion", "complete", `Deployed a version of Call Flow ${input.call_flow_id}.`, input.call_flow_id));

    let hadFailure = false;
    if (input.phone_number_id) {
      try {
        await c.phoneNumbers.setCallFlow(input.phone_number_id, { flowId: input.call_flow_id, version: "current_deployed" });
        operations.push(op("bind_phone_number", "phoneNumbers.setCallFlow", "complete", `Bound ${input.phone_number_id} to Call Flow ${input.call_flow_id}.`, input.phone_number_id));
      } catch {
        hadFailure = true;
        operations.push(op("bind_phone_number", "phoneNumbers.setCallFlow", "failed", `Failed to bind ${input.phone_number_id} to Call Flow ${input.call_flow_id}.`, input.phone_number_id));
      }
    }

    let flowReadback: unknown;
    try {
      flowReadback = await c.fabric.callFlows.get(input.call_flow_id);
      operations.push(op("readback_call_flow", "fabric.callFlows.get", "complete", `Read back Call Flow ${input.call_flow_id}.`, input.call_flow_id));
    } catch {
      hadFailure = true;
      operations.push(op("readback_call_flow", "fabric.callFlows.get", "failed", `Failed to read back Call Flow ${input.call_flow_id}.`, input.call_flow_id));
    }

    let numberReadback: unknown;
    if (input.phone_number_id) {
      try {
        numberReadback = await c.phoneNumbers.get(input.phone_number_id);
        operations.push(op("readback_phone_number", "phoneNumbers.get", "complete", `Read back number ${input.phone_number_id}.`, input.phone_number_id));
      } catch {
        hadFailure = true;
        operations.push(op("readback_phone_number", "phoneNumbers.get", "failed", `Failed to read back number ${input.phone_number_id}.`, input.phone_number_id));
      }
    }

    const parsed = deployCallFlowVersionResult(flowReadback, numberReadback);
    if (hadFailure) {
      return partial(
        `Call Flow version deployed for ${input.call_flow_id}, but a later step failed; inspect the operation journal.`,
        operations,
        {
          resource_id: input.call_flow_id,
          safe_to_retry: false,
          next_step: "Do not retry automatically; publishing a Call Flow version is not idempotent. Inspect the deployed Call Flow version and the current phone-number route in the SignalWire Dashboard before retrying.",
          resources: parsed.resources,
        },
      );
    }
    const summary = input.phone_number_id ? `Call Flow version deployed and number ${input.phone_number_id} bound.` : `Call Flow version deployed.`;
    return complete(summary, { resource_id: input.call_flow_id, resources: parsed.resources });
  });
}

// ===========================================================================
// signalwire_deploy_swml_script
// ===========================================================================

export async function signalwireDeploySwmlScript(ctx: ToolContext, input: DeploySwmlScriptInput): Promise<McpToolResult> {
  return executeTool("signalwire_deploy_swml_script", ctx, "mutation", async () => {
    const blocked = writeGateBlocked(ctx);
    if (blocked) return blocked;
    const c = ctx.client;

    let scriptId = input.resource_id;
    let replacing = false;
    if (!scriptId) {
      const list = await c.fabric.swmlScripts.list();
      const resolution = resolveByName(list, input.name, "swml_script");
      if (resolution.kind === "ambiguous") return ambiguityError("swml_script", input.name, resolution.candidates);
      if (resolution.kind === "found") {
        scriptId = resolution.id;
        replacing = true;
      }
    } else {
      replacing = true;
    }

    if (replacing && input.confirm_replace !== true) {
      return confirmationRequiredEnvelope({
        operation: "fully replace the SWML Script",
        target: scriptId ?? input.name,
        impact: "The existing SWML document is overwritten in full (PUT semantics).",
        confirmationField: "confirm_replace",
      });
    }

    const body: Params = { name: input.name, contents: input.swml };
    if (input.script_type === "calling" && input.status_callback_url) body.status_callback_url = input.status_callback_url;

    if (scriptId) {
      await c.fabric.swmlScripts.update(scriptId, body);
    } else {
      const created = await c.fabric.swmlScripts.create(body);
      scriptId = pickId(created, "id", "resource_id");
    }

    const readback = scriptId ? await c.fabric.swmlScripts.get(scriptId) : undefined;
    const parsed = deploySwmlScriptResult(readback);
    const summary = replacing ? `SWML Script ${scriptId} replaced.` : `SWML Script '${input.name}' created.`;
    if (!parsed.resources.length) return complete(summary);
    return complete(summary, parsed);
  });
}

// ===========================================================================
// signalwire_connect_webhook
// ===========================================================================

export async function signalwireConnectWebhook(ctx: ToolContext, input: ConnectWebhookInput): Promise<McpToolResult> {
  return executeTool("signalwire_connect_webhook", ctx, "mutation", async () => {
    const blocked = writeGateBlocked(ctx);
    if (blocked) return blocked;
    const c = ctx.client;

    if (input.confirm_route_change !== true) {
      return confirmationRequiredEnvelope({
        operation: `route the number to ${input.webhook_type}`,
        target: input.phone_number_id,
        impact: "Inbound calls to this number will route to the external webhook, replacing any existing route.",
        confirmationField: "confirm_route_change",
      });
    }

    if (input.webhook_type === "swml") {
      await c.phoneNumbers.setSwmlWebhook(input.phone_number_id, input.url);
    } else {
      const params: Params = { url: input.url };
      if (input.fallback_url) params.fallbackUrl = input.fallback_url;
      if (input.status_callback_url) params.statusCallbackUrl = input.status_callback_url;
      await c.phoneNumbers.setCxmlWebhook(input.phone_number_id, params);
    }

    const numberRaw = await c.phoneNumbers.get(input.phone_number_id);
    const parsed = connectWebhookResult(numberRaw);
    return complete(`Number ${input.phone_number_id} routed to ${input.webhook_type} webhook.`, parsed);
  });
}

// ===========================================================================
// signalwire_connect_relay_application
// ===========================================================================

export async function signalwireConnectRelayApplication(ctx: ToolContext, input: ConnectRelayApplicationInput): Promise<McpToolResult> {
  return executeTool("signalwire_connect_relay_application", ctx, "mutation", async () => {
    const blocked = writeGateBlocked(ctx);
    if (blocked) return blocked;
    const c = ctx.client;

    if (input.phone_number_id && input.confirm_route_change !== true) {
      return confirmationRequiredEnvelope({
        operation: "bind a phone number to the RELAY application",
        target: input.phone_number_id,
        impact: "Inbound calls to this number will route to the RELAY application, replacing any existing route.",
        confirmationField: "confirm_route_change",
      });
    }

    let appId = input.application_id;
    if (!appId) {
      const list = await c.fabric.relayApplications.list();
      const resolution = resolveByName(list, input.application_name, "relay_application");
      if (resolution.kind === "ambiguous") return ambiguityError("relay_application", input.application_name, resolution.candidates);
      if (resolution.kind === "not_found") {
        const created = await c.fabric.relayApplications.create({ name: input.application_name, topic: input.topic });
        appId = pickId(created, "id", "resource_id");
      } else {
        appId = resolution.id;
      }
    }

    if (appId) {
      await c.fabric.relayApplications.update(appId, { name: input.application_name, topic: input.topic });
    }

    const operations: Operation[] = [];
    if (input.phone_number_id) {
      try {
        await c.phoneNumbers.setRelayApplication(input.phone_number_id, input.application_name);
        operations.push(op("bind_phone_number", "phoneNumbers.setRelayApplication", "complete", `Bound ${input.phone_number_id} to RELAY application '${input.application_name}'.`, input.phone_number_id));
      } catch {
        operations.push(op("bind_phone_number", "phoneNumbers.setRelayApplication", "failed", `Failed to bind ${input.phone_number_id}.`));
        const appRaw = appId ? await c.fabric.relayApplications.get(appId) : undefined;
        return partial(`RELAY application configured, but binding ${input.phone_number_id} failed.`, operations, connectRelayApplicationResult(appRaw));
      }
    }

    const appRaw = appId ? await c.fabric.relayApplications.get(appId) : undefined;
    const numberRaw = input.phone_number_id ? await safeGet(c.phoneNumbers.get, input.phone_number_id) : undefined;
    const parsed = connectRelayApplicationResult(appRaw, numberRaw);
    const summary = input.phone_number_id ? `RELAY application configured and number ${input.phone_number_id} bound.` : `RELAY application configured.`;
    return complete(summary, parsed);
  });
}

// ===========================================================================
// signalwire_provision_test_number
// ===========================================================================

export async function signalwireProvisionTestNumber(ctx: ToolContext, input: ProvisionTestNumberInput): Promise<McpToolResult> {
  return executeTool("signalwire_provision_test_number", ctx, "mutation", async () => {
    const blocked = writeGateBlocked(ctx);
    if (blocked) return blocked;
    const c = ctx.client;

    if (input.confirm_purchase !== true) {
      return confirmationRequiredEnvelope({
        operation: "purchase the phone number",
        target: input.number,
        impact: "Carrier charges may apply. The number is added to your Project once purchased.",
        confirmationField: "confirm_purchase",
      });
    }

    const created = await c.phoneNumbers.create({ number: input.number });
    const createdId = pickId(created, "id", "resource_id", "sid");
    if (!createdId) {
      return errorResult(
        "Purchase submitted but no resource id was returned; the number may already have been purchased.",
        { category: "platform", message: "SignalWire accepted the purchase but returned no resource id." },
        {
          operations: [op("purchase_phone_number", "phoneNumbers.create", "unknown", "The purchase request was submitted but no resource id was returned; the outcome is unknown.")],
          safe_to_retry: false,
          next_step: "Do not resend automatically; purchasing is not idempotent. Inspect purchased numbers in the SignalWire Dashboard before retrying.",
        },
      );
    }
    const operations: Operation[] = [
      op("purchase_phone_number", "phoneNumbers.create", "complete", `Purchased ${input.number}.`, createdId),
    ];
    let hadFailure = false;
    if (input.label) {
      try {
        await c.phoneNumbers.update(createdId, { name: input.label });
        operations.push(op("label_phone_number", "phoneNumbers.update", "complete", `Applied label '${input.label}' to ${createdId}.`, createdId));
      } catch {
        hadFailure = true;
        operations.push(op("label_phone_number", "phoneNumbers.update", "failed", `Failed to apply label '${input.label}' to ${createdId}.`, createdId));
      }
    }
    let numberReadback: unknown;
    try {
      numberReadback = await c.phoneNumbers.get(createdId);
      operations.push(op("readback_phone_number", "phoneNumbers.get", "complete", `Read back purchased number ${createdId}.`, createdId));
    } catch {
      hadFailure = true;
      operations.push(op("readback_phone_number", "phoneNumbers.get", "failed", `Failed to read back purchased number ${createdId}.`, createdId));
    }
    const parsed = provisionTestNumberResult(numberReadback);
    if (hadFailure) {
      return partial(
        `Purchased ${input.number} as ${createdId}, but a post-purchase step failed; inspect the operation journal.`,
        operations,
        {
          resource_id: createdId,
          safe_to_retry: false,
          next_step: "Do not retry automatically; purchasing is not idempotent. Inspect the purchased number in the SignalWire Dashboard and re-apply the label or read it back if needed.",
          resources: parsed.resources,
        },
      );
    }
    return complete(`Purchased ${input.number}.`, { resource_id: createdId, resources: parsed.resources });
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function safeGet(getter: (id: string) => Promise<unknown>, id: string): Promise<unknown> {
  try {
    return await getter(id);
  } catch {
    return undefined;
  }
}

// Re-exported for callers that compose envelopes.
export type { EnvelopeFields };
