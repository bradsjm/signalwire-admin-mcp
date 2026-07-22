/**
 * MCP server factory.
 *
 * `createServer` constructs an `McpServer`, registers exactly the 15 tools,
 * and wires each strict Zod input schema, the shared output envelope, accurate
 * tool annotations, and the handler from the focused tool modules. Tools
 * receive an immutable {@link ToolContext} built from the injected deps.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "./config.js";
import type { SignalWireClient } from "./signalwire/client.js";
import { outputEnvelopeSchema } from "./core/output.js";
import type { ToolContext } from "./tools/runtime.js";
import {
  findResourcesInput,
  deployAiAgentInput,
  deployCallFlowVersionInput,
  deploySwmlScriptInput,
  connectWebhookInput,
  connectRelayApplicationInput,
  provisionTestNumberInput,
  addKnowledgeInput,
  searchKnowledgeInput,
  runCallTestInput,
  runMessageTestInput,
  controlCallInput,
  exerciseCallFeatureInput,
  controlAiCallInput,
  diagnoseInteractionInput,
} from "./tools/contracts.js";
import { signalwireFindResources } from "./tools/inventory.js";
import { signalwireDeployAiAgent, signalwireDeployCallFlowVersion, signalwireDeploySwmlScript, signalwireConnectWebhook, signalwireConnectRelayApplication, signalwireProvisionTestNumber } from "./tools/deployment.js";
import { signalwireAddKnowledge, signalwireSearchKnowledge } from "./tools/knowledge.js";
import { signalwireRunCallTest, signalwireRunMessageTest } from "./tools/testing.js";
import { signalwireControlCall, signalwireExerciseCallFeature, signalwireControlAiCall } from "./tools/call-control.js";
import { signalwireDiagnoseInteraction } from "./tools/diagnostics.js";

/** Dependencies injected into the server factory. */
export interface ServerDependencies {
  readonly config: Config;
  readonly client: SignalWireClient;
}

/** Tool hint annotations. */
type Hints = { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: boolean };

const READ_ONLY: Hints = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };

/** Construct the configured MCP server with all 15 tools registered. */
export function createServer(deps: ServerDependencies): McpServer {
  const server = new McpServer({ name: "signalwire-admin-mcp", version: "0.1.0" });
  const ctx: ToolContext = { client: deps.client, config: deps.config };

  server.registerTool(
    "signalwire_find_resources",
    {
      description: "Discover SignalWire phone numbers, Fabric resources (AI agents, call flows, SWML scripts, RELAY applications, webhooks), and Datasphere documents. Read-only. Use this to find identifiers and inspect what exists before configuring or testing.",
      inputSchema: findResourcesInput,
      outputSchema: outputEnvelopeSchema,
      annotations: READ_ONLY,
    },
    (input) => signalwireFindResources(ctx, input),
  );

  server.registerTool(
    "signalwire_deploy_ai_agent",
    {
      description: "Create or update one managed Fabric AI Agent (by exact id or unique name) and optionally bind a development number to it. Use after discovering an agent definition you want to make reachable.",
      inputSchema: deployAiAgentInput,
      outputSchema: outputEnvelopeSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    (input) => signalwireDeployAiAgent(ctx, input),
  );

  server.registerTool(
    "signalwire_deploy_call_flow_version",
    {
      description: "Deploy a known version of an existing Call Flow and optionally bind a development number to it. Use when a Call Flow is authored and you want to publish a specific version live.",
      inputSchema: deployCallFlowVersionInput,
      outputSchema: outputEnvelopeSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    (input) => signalwireDeployCallFlowVersion(ctx, input),
  );

  server.registerTool(
    "signalwire_deploy_swml_script",
    {
      description: "Create or fully replace a managed SWML Script (Calling or Messaging) from a validated document. Use to store SWML behavior in the Dashboard. Does not bind a number directly.",
      inputSchema: deploySwmlScriptInput,
      outputSchema: outputEnvelopeSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    (input) => signalwireDeploySwmlScript(ctx, input),
  );

  server.registerTool(
    "signalwire_connect_webhook",
    {
      description: "Route a development number to externally deployed SWML or cXML at an HTTPS URL. Use to point a number at your own application endpoint. Configures routing only; it does not deploy or probe the external app.",
      inputSchema: connectWebhookInput,
      outputSchema: outputEnvelopeSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    (input) => signalwireConnectWebhook(ctx, input),
  );

  server.registerTool(
    "signalwire_connect_relay_application",
    {
      description: "Create or update a named RELAY application registration and connect a development number to it. Use for RELAY-based real-time call control applications.",
      inputSchema: connectRelayApplicationInput,
      outputSchema: outputEnvelopeSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    (input) => signalwireConnectRelayApplication(ctx, input),
  );

  server.registerTool(
    "signalwire_provision_test_number",
    {
      description: "Purchase one exact phone number previously returned by discovery. Use to acquire a development number. Carrier charges may apply; does not search or select automatically.",
      inputSchema: provisionTestNumberInput,
      outputSchema: outputEnvelopeSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    (input) => signalwireProvisionTestNumber(ctx, input),
  );

  server.registerTool(
    "signalwire_add_knowledge",
    {
      description: "Add one URL-backed document to Datasphere for RAG ingestion. Use to index a knowledge source. Ingestion is asynchronous; the tool reports the returned status truthfully without polling.",
      inputSchema: addKnowledgeInput,
      outputSchema: outputEnvelopeSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    (input) => signalwireAddKnowledge(ctx, input),
  );

  server.registerTool(
    "signalwire_search_knowledge",
    {
      description: "Read-only semantic search over Datasphere documents. Use to retrieve relevant excerpts and scores from indexed knowledge.",
      inputSchema: searchKnowledgeInput,
      outputSchema: outputEnvelopeSchema,
      annotations: READ_ONLY,
    },
    (input) => signalwireSearchKnowledge(ctx, input),
  );

  server.registerTool(
    "signalwire_run_call_test",
    {
      description: "Start one bounded outbound development call that speaks given text and hangs up. Use to verify voice reachability. Returns the call id and initial status; it does not claim the call was answered.",
      inputSchema: runCallTestInput,
      outputSchema: outputEnvelopeSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    (input) => signalwireRunCallTest(ctx, input),
  );

  server.registerTool(
    "signalwire_run_message_test",
    {
      description: "Send one text-only development SMS via the Compatibility API. Use to verify messaging reachability. Returns the message SID and initial status as accepted.",
      inputSchema: runMessageTestInput,
      outputSchema: outputEnvelopeSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    (input) => signalwireRunMessageTest(ctx, input),
  );

  server.registerTool(
    "signalwire_control_call",
    {
      description: "Perform a high-level lifecycle action (end or transfer) on a live test call. Use with a call id from a prior test call.",
      inputSchema: controlCallInput,
      outputSchema: outputEnvelopeSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    (input) => signalwireControlCall(ctx, input),
  );

  server.registerTool(
    "signalwire_exercise_call_feature",
    {
      description: "Exercise one non-AI media feature (playback, recording, digit collection, detection, transcription) on a live call. Start actions return a control id for a later stateless stop.",
      inputSchema: exerciseCallFeatureInput,
      outputSchema: outputEnvelopeSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    (input) => signalwireExerciseCallFeature(ctx, input),
  );

  server.registerTool(
    "signalwire_control_ai_call",
    {
      description: "Interact with an AI session already running on a live call (message, hold, unhold, stop). Use only when an AI session is active on the call.",
      inputSchema: controlAiCallInput,
      outputSchema: outputEnvelopeSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    (input) => signalwireControlAiCall(ctx, input),
  );

  server.registerTool(
    "signalwire_diagnose_interaction",
    {
      description: "Assemble read-only evidence about a past voice call or message from SignalWire logs. Use to diagnose why an interaction succeeded or failed. Returns evidence, inferences, and gaps.",
      inputSchema: diagnoseInteractionInput,
      outputSchema: outputEnvelopeSchema,
      annotations: READ_ONLY,
    },
    (input) => signalwireDiagnoseInteraction(ctx, input),
  );

  return server;
}
