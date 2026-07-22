#!/usr/bin/env node
/**
 * Executable entry point — the only process bootstrap.
 *
 * Loads configuration from the environment, constructs the SDK-backed client,
 * creates the server, and connects it over stdio. Startup and uncaught errors
 * write a redacted message to stderr and exit nonzero; nothing is printed to
 * stdout (which is reserved for MCP JSON-RPC frames).
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { createSignalWireClient } from "./signalwire/client.js";
import { createServer } from "./server.js";

/** Write a redacted, single-line message to stderr and exit nonzero. */
function fail(message: string): never {
  try {
    process.stderr.write(`signalwire-admin-mcp: ${message.replace(/\s+/g, " ").trim()}\n`);
  } catch {
    // stderr is best-effort.
  }
  process.exit(1);
}

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig(process.env);
  } catch (err) {
    fail(err instanceof Error ? err.message : "invalid configuration");
  }

  const client = createSignalWireClient(config);
  const server = createServer({ config, client });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  fail(err instanceof Error ? err.message : "unexpected startup failure");
});
