/**
 * Secret redaction and sanitized audit logging.
 *
 * `redactDeep` recursively scrubs keys that commonly carry credentials before
 * any value reaches MCP output. Output construction only projects bounded,
 * contract-defined fields, so this is a defensive net rather than the primary
 * boundary. All diagnostics go to stderr — stdout is reserved for MCP frames.
 */

/** Key fragments (case-insensitive) that mark a value as sensitive. */
const SENSITIVE_KEY = [
  "token",
  "authorization",
  "password",
  "secret",
  "credential",
  "jwt",
  "signed_url",
  "signed-url",
  "signedurl",
  "api_key",
  "api-key",
  "apikey",
];

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SENSITIVE_KEY.some((frag) => lower.includes(frag));
}

/**
 * Recursively replace sensitive-keyed values with `"[redacted]"`.
 *
 * Cycles are guarded with a seen-set. Arrays and plain objects are walked;
 * everything else is returned by reference when not sensitive.
 */
export function redactDeep<T>(value: T, seen: Set<unknown> = new Set()): T {
  if (typeof value !== "object" || value === null) return value;
  if (seen.has(value)) return value;
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redactDeep(item, seen)) as unknown as T;
  }

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = isSensitiveKey(key) ? "[redacted]" : redactDeep(val, seen);
  }
  return out as unknown as T;
}

/**
 * Format a single sanitized stderr audit line.
 *
 * Contains only the tool name, elapsed milliseconds, and outcome status — no
 * argument values, identifiers, or response bodies.
 */
export function auditLine(toolName: string, durationMs: number, status: string): string {
  return `signalwire-admin-mcp tool=${toolName} duration_ms=${durationMs} status=${status}`;
}

/** Write one audit line to stderr. No-op outside a TTY-aware process is fine. */
export function writeAudit(toolName: string, durationMs: number, status: string): void {
  try {
    process.stderr.write(`${auditLine(toolName, durationMs, status)}\n`);
  } catch {
    // stderr is best-effort; never let logging disrupt the MCP session.
  }
}
