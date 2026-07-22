/**
 * Server contract tests over linked in-memory transports.
 *
 * Verifies tools/list exposes exactly the 15 tools, the published JSON schemas
 * are strict (reject unknown fields, expose no generic payload/options bags),
 * and that a representative tools/call returns both text content and valid
 * structuredContent.
 */

import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";
import { fakeClient, fakeConfig } from "./helpers.js";

const EXPECTED_TOOLS = [
  "signalwire_find_resources",
  "signalwire_deploy_ai_agent",
  "signalwire_deploy_call_flow_version",
  "signalwire_deploy_swml_script",
  "signalwire_connect_webhook",
  "signalwire_connect_relay_application",
  "signalwire_provision_test_number",
  "signalwire_add_knowledge",
  "signalwire_search_knowledge",
  "signalwire_run_call_test",
  "signalwire_run_message_test",
  "signalwire_control_call",
  "signalwire_exercise_call_feature",
  "signalwire_control_ai_call",
  "signalwire_diagnose_interaction",
];

async function connect() {
  const server = createServer({ config: fakeConfig(false), client: fakeClient() });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });
  await client.connect(clientTransport);
  return { client, server };
}

describe("server contract", () => {
  it("lists exactly the 15 expected tools", async () => {
    const { client } = await connect();
    const listed = await client.listTools();
    const names = listed.tools.map((t) => t.name).sort();
    expect(names).toEqual([...EXPECTED_TOOLS].sort());
    expect(names).toHaveLength(15);
  });

  it("publishes strict input schemas with no generic bags", async () => {
    const { client } = await connect();
    const listed = await client.listTools();
    for (const tool of listed.tools) {
      const schema = tool.inputSchema as Record<string, unknown>;
      // Strict objects forbid extra properties.
      expect(schema["additionalProperties"]).toBe(false);
      const props = (schema["properties"] ?? {}) as Record<string, unknown>;
      const forbidden = ["options", "params", "payload", "metadata"];
      for (const bag of forbidden) {
        expect(props[bag], `${tool.name} must not expose '${bag}'`).toBeUndefined();
      }
    }
  });

  it("every tool exposes the shared output schema", async () => {
    const { client } = await connect();
    const listed = await client.listTools();
    for (const tool of listed.tools) {
      expect(tool.outputSchema, `${tool.name} needs outputSchema`).toBeDefined();
    }
  });

  it("invoking a read tool returns text content and structuredContent", async () => {
    const { client } = await connect();
    const result = (await client.callTool({ name: "signalwire_search_knowledge", arguments: { query: "anything" } })) as {
      content?: unknown[];
      structuredContent?: Record<string, unknown>;
    };
    expect(result.content).toBeDefined();
    expect(result.content!.length).toBeGreaterThan(0);
    expect(result.structuredContent).toBeDefined();
    expect(result.structuredContent!["status"]).toBe("complete");
    expect(result.structuredContent!["summary"]).toBeTruthy();
  });

  it("rejects unknown input fields at the protocol layer", async () => {
    const { client } = await connect();
    const result = (await client.callTool({ name: "signalwire_find_resources", arguments: { resource_type: "phone_number", bogus: 1 } })) as { isError?: boolean };
    expect(result.isError).toBe(true);
  });

  it("mutation tool is blocked when writes are disabled", async () => {
    const { client } = await connect();
    const result = await client.callTool({ name: "signalwire_run_call_test", arguments: { from: "+14155550100", to: "+14155550101", spoken_text: "hi", confirm_call: true } });
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc["status"]).toBe("blocked");
    expect(sc["next_step"]).toBeTruthy();
  });
});
