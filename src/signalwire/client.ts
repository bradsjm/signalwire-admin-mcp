/**
 * SDK boundary — the only place that imports and constructs `RestClient`.
 *
 * The published `@signalwire/sdk` types most request bodies and responses as
 * `any`. This module narrows that surface to a small structural interface
 * whose methods return `Promise<unknown>`. Callers must parse those results
 * through the bounded Zod schemas in `src/tools/contracts.ts` before use; no
 * tool ever receives the raw SDK value directly.
 */

import type { Config } from "../config.js";
import { RestClient, setGlobalLogStream } from "@signalwire/sdk";

/** Loose query/body parameter bag crossing the boundary. */
export type Params = Record<string, unknown>;

/** Generic Fabric resource surface (create/get/list/update). */
export interface FabricResourceLike {
  list(params?: Params): Promise<unknown>;
  get(resourceId: string): Promise<unknown>;
  create(body: Params): Promise<unknown>;
  update(resourceId: string, body: Params): Promise<unknown>;
}

/** Call-flow resource adds version management. */
export interface CallFlowsResourceLike extends FabricResourceLike {
  listVersions(resourceId: string, params?: Params): Promise<unknown>;
  deployVersion(resourceId: string, body?: Params): Promise<unknown>;
}

/** Fabric namespace composition. */
export interface FabricNamespaceLike {
  readonly aiAgents: FabricResourceLike;
  readonly swmlScripts: FabricResourceLike;
  readonly callFlows: CallFlowsResourceLike;
  readonly relayApplications: FabricResourceLike;
  readonly resources: {
    list(params?: Params): Promise<unknown>;
    get(resourceId: string): Promise<unknown>;
  };
}

/** Phone-number resource with binding helpers. */
export interface PhoneNumbersResourceLike {
  list(params?: Params): Promise<unknown>;
  get(resourceId: string): Promise<unknown>;
  create(body: Params): Promise<unknown>;
  update(resourceId: string, body: Params): Promise<unknown>;
  search(params?: Params): Promise<unknown>;
  setAiAgent(resourceId: string, agentId: string, extra?: Params): Promise<unknown>;
  setCallFlow(resourceId: string, params: Params): Promise<unknown>;
  setSwmlWebhook(resourceId: string, url: string, extra?: Params): Promise<unknown>;
  setCxmlWebhook(resourceId: string, params: Params): Promise<unknown>;
  setRelayApplication(resourceId: string, name: string, extra?: Params): Promise<unknown>;
}

/** REST-based call control surface. */
export interface CallingNamespaceLike {
  dial(params?: Params): Promise<unknown>;
  end(callId: string, params?: Params): Promise<unknown>;
  transfer(callId: string, params?: Params): Promise<unknown>;
  play(callId: string, params?: Params): Promise<unknown>;
  playStop(callId: string, params?: Params): Promise<unknown>;
  record(callId: string, params?: Params): Promise<unknown>;
  recordStop(callId: string, params?: Params): Promise<unknown>;
  collect(callId: string, params?: Params): Promise<unknown>;
  collectStop(callId: string, params?: Params): Promise<unknown>;
  detect(callId: string, params?: Params): Promise<unknown>;
  detectStop(callId: string, params?: Params): Promise<unknown>;
  transcribe(callId: string, params?: Params): Promise<unknown>;
  transcribeStop(callId: string, params?: Params): Promise<unknown>;
  aiMessage(callId: string, params?: Params): Promise<unknown>;
  aiHold(callId: string, params?: Params): Promise<unknown>;
  aiUnhold(callId: string, params?: Params): Promise<unknown>;
  aiStop(callId: string, params?: Params): Promise<unknown>;
}

/** Datasphere RAG documents. */
export interface DatasphereDocumentsLike {
  list(params?: Params): Promise<unknown>;
  get(resourceId: string): Promise<unknown>;
  create(body: Params): Promise<unknown>;
  search(body: Params): Promise<unknown>;
}

export interface DatasphereNamespaceLike {
  readonly documents: DatasphereDocumentsLike;
}

/** Read-only logs. */
export interface LogsNamespaceLike {
  readonly voice: {
    list(params?: Params): Promise<unknown>;
    get(logId: string): Promise<unknown>;
    listEvents(logId: string, params?: Params): Promise<unknown>;
  };
  readonly messages: {
    list(params?: Params): Promise<unknown>;
    get(logId: string): Promise<unknown>;
  };
}

/** Twilio-compatible LAML surface. */
export interface CompatNamespaceLike {
  readonly messages: {
    list(params?: Params): Promise<unknown>;
    get(sid: string): Promise<unknown>;
    create(body: Params): Promise<unknown>;
  };
}

/** Narrow SignalWire client surface used by every tool. */
export interface SignalWireClient {
  readonly fabric: FabricNamespaceLike;
  readonly calling: CallingNamespaceLike;
  readonly phoneNumbers: PhoneNumbersResourceLike;
  readonly datasphere: DatasphereNamespaceLike;
  readonly logs: LogsNamespaceLike;
  readonly compat: CompatNamespaceLike;
}

/**
 * Construct the SDK-backed client from immutable configuration.
 *
 * This is the single `RestClient` import and construction site. The returned
 * object satisfies {@link SignalWireClient}; all `any`-typed SDK results are
 * narrowed to `unknown` by the structural cast.
 */
export function createSignalWireClient(config: Config): SignalWireClient {
  // The SDK logger defaults to "auto" which can write to stdout, corrupting
  // the MCP JSON-RPC stream. Force all SDK diagnostics to stderr.
  setGlobalLogStream("stderr");
  const client = new RestClient({
    project: config.projectId,
    token: config.apiToken,
    host: config.space,
  });
  return client as unknown as SignalWireClient;
}
