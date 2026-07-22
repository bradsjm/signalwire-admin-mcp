/**
 * Process configuration — the single environment-variable reader.
 *
 * `loadConfig` is the only place that touches `process.env`. It validates the
 * three required SignalWire credentials, normalizes the Space to a bare
 * hostname, and parses the write-gate flag. Every problem is collected and
 * reported in one startup error; the API-token value is never echoed.
 */

/** Immutable, process-lifetime configuration. */
export interface Config {
  /** Bare SignalWire Space hostname (e.g. "example.signalwire.com"). */
  readonly space: string;
  /** SignalWire Project ID. */
  readonly projectId: string;
  /** Scoped SignalWire API token (value never leaves this object in clear text). */
  readonly apiToken: string;
  /** Whether mutating tools are permitted for this process lifetime. */
  readonly allowWrites: boolean;
}

/**
 * Normalize a Space value to a bare hostname.
 *
 * Accepts either a bare host ("example.signalwire.com") or an `https://` URL
 * whose only content is that host. Rejects non-HTTPS schemes, paths, query
 * strings, fragments, credentials, ports, and hosts without a dot.
 */
function normalizeSpace(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;

  if (trimmed.includes("://")) {
    // URL form: only an https:// URL with a lone host is allowed.
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      return null;
    }
    if (parsed.protocol !== "https:") return null;
    if (parsed.username !== "" || parsed.password !== "") return null;
    if (parsed.port !== "") return null;
    // pathname must be empty or a lone "/".
    if (parsed.pathname !== "/" && parsed.pathname !== "") return null;
    if (parsed.search !== "" || parsed.hash !== "") return null;
    const host = parsed.hostname;
    if (!host.includes(".")) return null;
    return host;
  }

  // Bare-host form: reject anything that looks like it carries extra parts.
  if (/[/?#@:]/.test(trimmed)) return null;
  if (!trimmed.includes(".")) return null;
  return trimmed;
}

/**
 * Load and validate configuration from a process environment.
 *
 * @throws {Error} listing every missing or invalid variable when one or more
 *   required values are absent or malformed. The error message never includes
 *   the API-token value.
 */
export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const problems: string[] = [];

  const spaceRaw = env.SIGNALWIRE_SPACE;
  const projectIdRaw = env.SIGNALWIRE_PROJECT_ID;
  const apiTokenRaw = env.SIGNALWIRE_API_TOKEN;
  const allowWritesRaw = env.SIGNALWIRE_MCP_ALLOW_WRITES;

  const space = typeof spaceRaw === "string" ? normalizeSpace(spaceRaw) : null;
  if (space === null) {
    problems.push(
      "SIGNALWIRE_SPACE must be a bare hostname (e.g. example.signalwire.com) or an https:// URL containing only that host; paths, ports, query strings, fragments, and credentials are rejected.",
    );
  }

  const projectId =
    typeof projectIdRaw === "string" && projectIdRaw.trim().length > 0
      ? projectIdRaw.trim()
      : null;
  if (projectId === null) {
    problems.push("SIGNALWIRE_PROJECT_ID must be a non-empty string.");
  }

  const apiToken =
    typeof apiTokenRaw === "string" && apiTokenRaw.trim().length > 0
      ? apiTokenRaw.trim()
      : null;
  if (apiToken === null) {
    problems.push("SIGNALWIRE_API_TOKEN must be a non-empty string.");
  }

  let allowWrites = false;
  if (allowWritesRaw === undefined || allowWritesRaw === "") {
    allowWrites = false;
  } else if (allowWritesRaw === "true") {
    allowWrites = true;
  } else if (allowWritesRaw === "false") {
    allowWrites = false;
  } else {
    problems.push(
      'SIGNALWIRE_MCP_ALLOW_WRITES must be the literal string "true" or "false" (default "false").',
    );
  }

  if (problems.length > 0) {
    throw new Error(
      `Invalid SignalWire configuration:\n  - ${problems.join("\n  - ")}`,
    );
  }

  return {
    space: space,
    projectId: projectId,
    apiToken: apiToken,
    allowWrites,
  } as Config;
}
