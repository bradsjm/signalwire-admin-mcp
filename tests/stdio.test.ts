/**
 * Built-process stdio smoke test.
 *
 * Spawns `node dist/index.js` with syntactically valid placeholder credentials
 * and performs a manual newline-delimited JSON-RPC handshake (initialize,
 * notifications/initialized, tools/list). Asserts exactly 15 tools, that
 * stdout carries only MCP JSON-RPC frames (no startup banner), that stderr
 * contains no credential values, and that the child exits cleanly once stdin
 * closes.
 */

import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const INDEX = resolve(here, "..", "dist", "index.js");

interface JsonRpc {
  jsonrpc?: string;
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
}
async function smoke() {
  const token = "placeholder-secret-token-xyz";
  const env = {
    ...process.env,
    SIGNALWIRE_SPACE: "example.signalwire.com",
    SIGNALWIRE_PROJECT_ID: "11111111-2222-3333-4444-555555555555",
    SIGNALWIRE_API_TOKEN: token,
    SIGNALWIRE_MCP_ALLOW_WRITES: "false",
  };

  const child = spawn("node", [INDEX], { env, stdio: ["pipe", "pipe", "pipe"] });
  let stderrBuf = "";
  let stdoutBuf = "";
  const lines: string[] = [];
  const parsed: JsonRpc[] = [];

  child.stdout.on("data", (chunk: Buffer) => {
    stdoutBuf += chunk.toString("utf8");
    let nl: number;
    while ((nl = stdoutBuf.indexOf("\n")) >= 0) {
      const line = stdoutBuf.slice(0, nl);
      stdoutBuf = stdoutBuf.slice(nl + 1);
      if (line.trim().length === 0) continue;
      lines.push(line);
      try {
        parsed.push(JSON.parse(line) as JsonRpc);
      } catch {
        // non-JSON line recorded as a banner/corruption signal
      }
    }
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderrBuf += chunk.toString("utf8");
  });

  const send = (obj: JsonRpc) => {
    child.stdin.write(`${JSON.stringify(obj)}\n`);
  };
  const waitFor = (id: number, timeoutMs = 10000) =>
    new Promise<JsonRpc>((resolveP, rejectP) => {
      const t = setTimeout(() => rejectP(new Error(`timeout waiting for id ${id}`)), timeoutMs);
      const check = () => {
        const found = parsed.find((m) => m.id === id);
        if (found) {
          clearTimeout(t);
          resolveP(found);
        } else {
          setTimeout(check, 10);
        }
      };
      check();
    });

  send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "stdio-test", version: "1.0.0" } } });
  await waitFor(1);
  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  const listResult = await waitFor(2);

  const exitCode = await new Promise<number>((resolveP) => {
    child.stdin.end();
    const t = setTimeout(() => {
      child.kill("SIGKILL");
      resolveP(-1);
    }, 10000);
    child.on("exit", (code) => {
      clearTimeout(t);
      resolveP(code ?? -1);
    });
  });

  return { listResult, lines, parsed, stderrBuf, token, exitCode };
}

describe("stdio smoke (built process)", () => {
  it("initializes, lists 15 tools, clean stdout/stderr, clean exit", async () => {
    const observed = await smoke();
    const result = observed.listResult.result as { tools?: { name: string }[] } | undefined;
    const names = (result?.tools ?? []).map((t) => t.name).sort();
    expect(names).toHaveLength(15);
    expect(names).toContain("signalwire_find_resources");
    expect(names).toContain("signalwire_diagnose_interaction");

    // Every non-empty stdout line is valid JSON-RPC (no startup banner).
    expect(observed.lines.length).toBeGreaterThan(0);
    for (const line of observed.lines) {
      const obj = JSON.parse(line) as JsonRpc;
      expect(obj.jsonrpc).toBe("2.0");
    }
    // The number of successfully parsed frames equals the number of lines.
    expect(observed.parsed.length).toBe(observed.lines.length);

    // stderr must not leak the credential value.
    expect(observed.stderrBuf).not.toContain(observed.token);

    // Clean shutdown.
    expect(observed.exitCode).toBe(0);
  }, 20000);
});
