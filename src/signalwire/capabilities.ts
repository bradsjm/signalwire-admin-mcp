/**
 * Version-locked capability registry.
 *
 * The sole, auditable mapping from each registered tool and action branch to
 * the public `RestClient` methods of the pinned `@signalwire/sdk` artifact.
 * Each entry declares the SDK methods used to read, mutate, and read back, the
 * named confirmation gate (if any), and the authoritative response parser in
 * `src/tools/contracts.ts`. Absence from this registry means a capability is
 * unsupported — there is no raw-HTTP fallback anywhere in this server.
 */

/** Pinned `@signalwire/sdk` artifact version this registry is locked to. */
export const SDK_VERSION = "2.0.5";

/** Dotted SDK method path (e.g. `fabric.aiAgents.get`). */
export type SdkMethod = string;

/** A single auditable capability mapping. */
export interface Capability {
  /** Tool name (MCP tool identifier). */
  readonly tool: string;
  /** Action branch label for union tools, omitted for single-action tools. */
  readonly action?: string;
  /** One-line description of what this capability does. */
  readonly summary: string;
  /** Public SDK read methods (dotted paths) used to inspect current state. */
  readonly read?: readonly SdkMethod[];
  /** Public SDK mutation methods (dotted paths) that change durable state. */
  readonly mutate?: readonly SdkMethod[];
  /** Named confirmation boolean that gates the mutating SDK call. */
  readonly confirmationField?: string;
  /** Public SDK methods used to read back durable state after a mutation. */
  readonly readback?: readonly SdkMethod[];
  /** Authoritative parser in `src/tools/contracts.ts`. */
  readonly parser: string;
}

/**
 * The complete, closed capability registry. Every tool and action branch
 * implemented by this server is listed here; any operation not present is
 * unsupported.
 */
export const CAPABILITIES: readonly Capability[] = [
  {
    tool: "signalwire_find_resources",
    summary: "Discover phone numbers, Fabric resources, and Datasphere documents.",
    read: ["fabric.aiAgents.list", "fabric.swmlScripts.list", "fabric.callFlows.list", "fabric.callFlows.listVersions", "fabric.relayApplications.list", "fabric.resources.list", "fabric.resources.get", "datasphere.documents.list", "datasphere.documents.get", "phoneNumbers.list", "phoneNumbers.search"],
    parser: "findResourcesResult",
  },
  {
    tool: "signalwire_deploy_ai_agent",
    summary: "Create or update a managed AI Agent and optionally bind a number.",
    read: ["fabric.aiAgents.list", "fabric.aiAgents.get"],
    mutate: ["fabric.aiAgents.create", "fabric.aiAgents.update", "phoneNumbers.setAiAgent"],
    confirmationField: "confirm_route_change",
    readback: ["fabric.aiAgents.get", "phoneNumbers.get"],
    parser: "deployAiAgentResult",
  },
  {
    tool: "signalwire_deploy_call_flow_version",
    summary: "Deploy a known version of an existing Call Flow and optionally bind a number.",
    read: ["fabric.callFlows.get", "fabric.callFlows.listVersions"],
    mutate: ["fabric.callFlows.deployVersion", "phoneNumbers.setCallFlow"],
    confirmationField: "confirm_deployment",
    readback: ["fabric.callFlows.get", "fabric.callFlows.listVersions", "phoneNumbers.get"],
    parser: "deployCallFlowVersionResult",
  },
  {
    tool: "signalwire_deploy_swml_script",
    action: "calling",
    summary: "Create or fully replace a managed Calling SWML Script.",
    read: ["fabric.swmlScripts.list", "fabric.swmlScripts.get"],
    mutate: ["fabric.swmlScripts.create", "fabric.swmlScripts.update"],
    confirmationField: "confirm_replace",
    readback: ["fabric.swmlScripts.get"],
    parser: "deploySwmlScriptResult",
  },
  {
    tool: "signalwire_deploy_swml_script",
    action: "messaging",
    summary: "Create or fully replace a managed Messaging SWML Script.",
    read: ["fabric.swmlScripts.list", "fabric.swmlScripts.get"],
    mutate: ["fabric.swmlScripts.create", "fabric.swmlScripts.update"],
    confirmationField: "confirm_replace",
    readback: ["fabric.swmlScripts.get"],
    parser: "deploySwmlScriptResult",
  },
  {
    tool: "signalwire_connect_webhook",
    action: "swml",
    summary: "Route a development number to an externally deployed SWML webhook.",
    mutate: ["phoneNumbers.setSwmlWebhook"],
    confirmationField: "confirm_route_change",
    readback: ["phoneNumbers.get"],
    parser: "connectWebhookResult",
  },
  {
    tool: "signalwire_connect_webhook",
    action: "cxml",
    summary: "Route a development number to an externally deployed cXML webhook.",
    mutate: ["phoneNumbers.setCxmlWebhook"],
    confirmationField: "confirm_route_change",
    readback: ["phoneNumbers.get"],
    parser: "connectWebhookResult",
  },
  {
    tool: "signalwire_connect_relay_application",
    summary: "Create/update a named RELAY registration and connect a number.",
    read: ["fabric.relayApplications.list", "fabric.relayApplications.get"],
    mutate: ["fabric.relayApplications.create", "fabric.relayApplications.update", "phoneNumbers.setRelayApplication"],
    confirmationField: "confirm_route_change",
    readback: ["fabric.relayApplications.get", "phoneNumbers.get"],
    parser: "connectRelayApplicationResult",
  },
  {
    tool: "signalwire_provision_test_number",
    summary: "Purchase one exact number previously returned by discovery.",
    mutate: ["phoneNumbers.create", "phoneNumbers.update"],
    confirmationField: "confirm_purchase",
    readback: ["phoneNumbers.get"],
    parser: "provisionTestNumberResult",
  },
  {
    tool: "signalwire_add_knowledge",
    summary: "Add one URL-backed Datasphere document.",
    mutate: ["datasphere.documents.create"],
    confirmationField: "confirm_ingestion",
    readback: ["datasphere.documents.get"],
    parser: "addKnowledgeResult",
  },
  {
    tool: "signalwire_search_knowledge",
    summary: "Read-only semantic search over Datasphere documents.",
    read: ["datasphere.documents.search"],
    parser: "searchKnowledgeResult",
  },
  {
    tool: "signalwire_run_call_test",
    summary: "Start one bounded outbound development call.",
    mutate: ["calling.dial"],
    confirmationField: "confirm_call",
    parser: "runCallTestResult",
  },
  {
    tool: "signalwire_run_message_test",
    summary: "Send one text-only development SMS via the Compatibility API.",
    mutate: ["compat.messages.create"],
    confirmationField: "confirm_message",
    parser: "runMessageTestResult",
  },
  {
    tool: "signalwire_control_call",
    action: "end",
    summary: "End a live test call.",
    mutate: ["calling.end"],
    confirmationField: "confirm_end",
    parser: "controlCallResult",
  },
  {
    tool: "signalwire_control_call",
    action: "transfer",
    summary: "Transfer a live test call to another destination.",
    mutate: ["calling.transfer"],
    confirmationField: "confirm_transfer",
    parser: "controlCallResult",
  },
  {
    tool: "signalwire_exercise_call_feature",
    summary: "Exercise one non-AI media feature on a live call.",
    mutate: ["calling.play", "calling.playStop", "calling.record", "calling.recordStop", "calling.collect", "calling.collectStop", "calling.detect", "calling.detectStop", "calling.transcribe", "calling.transcribeStop"],
    parser: "exerciseCallFeatureResult",
  },
  {
    tool: "signalwire_control_ai_call",
    summary: "Interact with an AI session already running on a live call.",
    mutate: ["calling.aiMessage", "calling.aiHold", "calling.aiUnhold", "calling.aiStop"],
    confirmationField: "confirm_ai_action",
    parser: "controlAiCallResult",
  },
  {
    tool: "signalwire_diagnose_interaction",
    action: "voice",
    summary: "Assemble voice-call evidence from logs.",
    read: ["logs.voice.get", "logs.voice.listEvents"],
    parser: "diagnoseInteractionResult",
  },
  {
    tool: "signalwire_diagnose_interaction",
    action: "message",
    summary: "Assemble messaging evidence from logs or the Compatibility API.",
    read: ["logs.messages.get", "logs.messages.list", "compat.messages.get"],
    parser: "diagnoseInteractionResult",
  },
];

/** Look up capabilities for a tool, optionally narrowed by action branch. */
export function lookup(tool: string, action?: string): readonly Capability[] {
  return CAPABILITIES.filter((c) => c.tool === tool && (action === undefined || c.action === action));
}
