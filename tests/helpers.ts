/**
 * Shared test helpers — a fakeable SignalWireClient and config factories.
 *
 * `fakeClient()` returns an object whose methods are `vi.fn` mocks typed as
 * `(...args: unknown[]) => Promise<unknown>` so tests can call `.mock*`
 * accessors, seed resolved values, and index call arguments, while remaining
 * assignable to {@link SignalWireClient}.
 */

import { vi } from "vitest";
import type { Config } from "../src/config.js";

/** A vi.fn mock that accepts any args and resolves to a configurable value. */
function mock(impl?: (...args: unknown[]) => unknown) {
  return vi.fn(async (...args: unknown[]) => (impl ? impl(...args) : ({})));
}

/** A vi.fn-backed mock of a CRUD-style fabric resource. */
function fakeResource() {
  return {
    list: mock(() => ({ data: [] })),
    get: mock(),
    create: mock(() => ({ id: "fake-id" })),
    update: mock(),
  };
}

/** Build a fake client with vi.fn methods (inferred mock types preserved). */
export function fakeClient() {
  return {
    fabric: {
      aiAgents: fakeResource(),
      swmlScripts: fakeResource(),
      callFlows: {
        ...fakeResource(),
        listVersions: mock(() => ({ data: [] })),
        deployVersion: mock(),
      },
      relayApplications: fakeResource(),
      resources: { list: mock(() => ({ data: [] })), get: mock() },
    },
    calling: {
      dial: mock(() => ({ call_id: "call-1", state: "ringing" })),
      end: mock(() => ({ state: "ending" })),
      transfer: mock(() => ({ state: "transferring" })),
      play: mock(() => ({ control_id: "c-play" })),
      playStop: mock(),
      record: mock(() => ({ control_id: "c-record" })),
      recordStop: mock(),
      collect: mock(() => ({ control_id: "c-collect" })),
      collectStop: mock(),
      detect: mock(() => ({ control_id: "c-detect" })),
      detectStop: mock(),
      transcribe: mock(() => ({ control_id: "c-transcribe" })),
      transcribeStop: mock(),
      aiMessage: mock(),
      aiHold: mock(),
      aiUnhold: mock(),
      aiStop: mock(),
    },
    phoneNumbers: {
      ...fakeResource(),
      search: mock(() => ({ data: [] })),
      setAiAgent: mock(),
      setCallFlow: mock(),
      setSwmlWebhook: mock(),
      setCxmlWebhook: mock(),
      setRelayApplication: mock(),
    },
    datasphere: { documents: { ...fakeResource(), search: mock(() => ({ chunks: [] })) } },
    logs: {
      voice: {
        list: mock(() => ({ data: [] })),
        get: mock(() => ({ id: "log-1", status: "completed" })),
        listEvents: mock(() => ({ data: [{ id: "ev-1", message: "answered" }] })),
      },
      messages: {
        list: mock(() => ({ data: [] })),
        get: mock(() => ({ id: "mlog-1", status: "delivered" })),
      },
    },
    compat: {
      messages: {
        list: mock(),
        get: mock(() => ({ sid: "SM" + "a".repeat(32), status: "sent", from: "+14155550100", to: "+14155550101" })),
        create: mock(() => ({ sid: "SM" + "a".repeat(32), status: "queued" })),
      },
    },
  };
}

/** Build a config, defaulting to writes enabled. */
export function fakeConfig(allowWrites = true): Config {
  return {
    space: "example.signalwire.com",
    projectId: "11111111-2222-3333-4444-555555555555",
    apiToken: "super-secret-token",
    allowWrites,
  };
}

/** Build a {@link ToolContext}-equivalent pair for direct handler calls. */
export function fakeCtx(allowWrites = true) {
  const client = fakeClient();
  return { ctx: { client, config: fakeConfig(allowWrites) }, client };
}
