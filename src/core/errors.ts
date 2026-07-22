/**
 * Error normalization — convert SDK / runtime failures into sanitized MCP
 * error envelopes.
 *
 * A {@link RestError}-shaped failure (any object with a numeric `statusCode`)
 * is mapped to a distinct category, with sanitized HTTP status, exposed
 * request id, and SignalWire code/message/attribute preserved. Mutations are
 * never auto-retried after a timeout or unknown result: the caller is told to
 * inspect current state first.
 */

import { errorResult, type Envelope, type EnvelopeFields, type ErrorCategoryValue } from "./output.js";

type ErrorCategory = ErrorCategoryValue;

/** Structural shape of the SDK `RestError` (detected by duck typing). */
interface RestLikeError {
  statusCode?: number;
  body?: string | Record<string, unknown>;
  url?: string;
  message?: string;
}

function isRestLike(err: unknown): err is RestLikeError {
  return typeof err === "object" && err !== null && typeof (err as RestLikeError).statusCode === "number";
}
/** True when a thrown value is a duck-typed SDK error with HTTP 404. */
export function isNotFoundError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { statusCode?: unknown }).statusCode === 404;
}

/** Sanitized SignalWire error detail extracted from a response body. */
export interface ErrorDetail {
  category: ErrorCategory;
  message: string;
  http_status?: number;
  request_id?: string;
  code?: string;
  attribute?: string;
}

const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

/** Pull code / message / attribute / request_id from a SignalWire body. */
function extractDetail(body: unknown): { code?: string; message?: string; attribute?: string; request_id?: string } {
  if (typeof body === "string") {
    return body.length > 0 && body.length <= 1000 ? { message: body } : {};
  }
  if (typeof body !== "object" || body === null) return {};
  const root = body as Record<string, unknown>;

  // SignalWire commonly nests under `errors[0]` or `error`.
  let node: Record<string, unknown> = root;
  const errorsArr = root["errors"];
  if (Array.isArray(errorsArr) && errorsArr.length > 0 && typeof errorsArr[0] === "object" && errorsArr[0] !== null) {
    node = errorsArr[0] as Record<string, unknown>;
  } else if (typeof root["error"] === "object" && root["error"] !== null) {
    node = root["error"] as Record<string, unknown>;
  }

  const str = (v: unknown): string | undefined =>
    typeof v === "string" && v.length > 0 && v.length <= 1000 ? v : undefined;

  const code = str(node["code"] ?? root["code"]);
  const message = str(node["message"] ?? node["description"] ?? root["message"]);
  const attribute = str(node["attribute"] ?? root["attribute"]);
  const rawRequestId = str(node["request_id"] ?? root["request_id"] ?? root["requestId"]);
  const requestId = rawRequestId && ID_RE.test(rawRequestId) ? rawRequestId : undefined;

  const out: { code?: string; message?: string; attribute?: string; request_id?: string } = {};
  if (code) out.code = code;
  if (message) out.message = message;
  if (attribute) out.attribute = attribute;
  if (requestId) out.request_id = requestId;
  return out;
}

function categoryForStatus(status: number): ErrorCategory {
  if (status === 400 || status === 422) return "validation";
  if (status === 401) return "authentication";
  if (status === 403) return "permission";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 429) return "rate_limit";
  if (status >= 500) return "platform";
  return "transport";
}

const NEXT_STEPS: Record<ErrorCategory, string> = {
  validation: "Correct the invalid field(s) shown in the error attribute, then retry.",
  authentication:
    "Verify SIGNALWIRE_PROJECT_ID and SIGNALWIRE_API_TOKEN are valid for this Space, then retry.",
  permission: "The API token lacks the scope required for this action; grant it and retry.",
  not_found: "Confirm the identifier exists in this Project and has not been deleted.",
  conflict: "Resolve the conflicting resource state described in the error, then retry.",
  rate_limit: "Slow down and retry after a brief backoff.",
  transport: "Check network connectivity and the Space hostname; retry a read before any mutation.",
  platform: "Retry after a brief wait; if the failure persists, contact SignalWire support.",
  internal: "This is a defect in the MCP server; report it with the sanitized detail above.",
};

/**
 * Classify any thrown value into a sanitized {@link ErrorDetail}.
 *
 * Network/fetch errors (no status code) are treated as transport failures.
 * Everything else falls back to internal with the error's message.
 */
export function toErrorDetail(err: unknown): ErrorDetail {
  if (isRestLike(err)) {
    const status = err.statusCode as number;
    const extracted = extractDetail(err.body);
    const category = categoryForStatus(status);
    const message =
      extracted.message ??
      (typeof err.message === "string" && err.message.length > 0
        ? err.message.slice(0, 1000)
        : `SignalWire returned HTTP ${status}.`);
    const detail: ErrorDetail = { category, message, http_status: status };
    if (extracted.request_id) detail.request_id = extracted.request_id;
    if (extracted.code) detail.code = extracted.code;
    if (extracted.attribute) detail.attribute = extracted.attribute;
    return detail;
  }

  if (err instanceof Error) {
    const message = err.message.length > 0 ? err.message.slice(0, 1000) : "An unexpected error occurred.";
    return { category: "internal", message };
  }

  return { category: "internal", message: "An unexpected error occurred." };
}

/**
 * Build an `error`-status envelope from a thrown value.
 *
 * Mutations are never marked safe to retry after a timeout or unknown result:
 * the next step tells the caller to inspect current state first. Reads may be
 * retried for transient categories.
 */
export function toErrorEnvelope(
  err: unknown,
  opts: { summary: string; kind: "read" | "mutation"; fields?: EnvelopeFields },
): Envelope {
  const detail = toErrorDetail(err);
  const transient = detail.category === "rate_limit" || detail.category === "platform" || detail.category === "transport";
  const safeToRetry = opts.kind === "read" ? transient : false;
  const inspect = opts.kind === "mutation" && transient ? " Inspect the current resource state before retrying." : "";
  const nextStep = `${NEXT_STEPS[detail.category]}${inspect}`;
  const fields: EnvelopeFields = { ...opts.fields, safe_to_retry: safeToRetry, next_step: nextStep };
  return errorResult(opts.summary, detail, fields);
}
