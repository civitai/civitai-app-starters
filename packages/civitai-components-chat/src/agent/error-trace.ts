import { APICallError, RetryError } from 'ai';

/**
 * Where a reply failed and what the service said, kept on the errored turn and sent with the agent's
 * `error` event so a page can forward it to its own telemetry. The viewer sees only a summary line,
 * under Details. It is not saved with the conversation: a response body may carry the reply's text.
 */
export interface ErrorTrace {
  /**
   * `tools`: building the reply's tools; `request`: the step's request had no answer yet; `stream`:
   * the step's answer had started; `tool`: a tool call was still running.
   */
  stage: 'tools' | 'request' | 'stream' | 'tool';
  /** Which of the reply's steps (model requests) it was, from 1; 0 when the tools failed before any request. */
  step: number;
  /** Milliseconds since that step's request went out (for `tools`, since the reply started). */
  msIntoStep: number;
  /** The latest tool call of the reply, and how far it got. */
  lastTool?: { name: string; state: 'calling' | 'done' | 'error' };
  /** The error's own class, e.g. `AI_APICallError` or `TypeError`. */
  name?: string;
  message: string;
  statusCode?: number;
  isRetryable?: boolean;
  /** Only the host, never the path or query. */
  host?: string;
  /** The first {@link BODY_CHARS} characters. */
  responseBody?: string;
  /** What the error wraps, e.g. why a 200 response could not be read. */
  cause?: string;
  /**
   * A request id from the response headers (the first of `x-request-id`, `x-correlation-id`,
   * `request-id` present), for asking the service about it. Which header the orchestrator sets is not
   * confirmed.
   */
  requestId?: string;
}

export const BODY_CHARS = 500;
const REQUEST_ID_HEADERS = ['x-request-id', 'x-correlation-id', 'request-id'];

export interface TraceContext {
  stage: ErrorTrace['stage'];
  step: number;
  msIntoStep: number;
  lastTool?: ErrorTrace['lastTool'];
}

export function errorTrace(error: unknown, context: TraceContext): ErrorTrace {
  // A failure retried until it gave up reports the last attempt's error.
  const inner = RetryError.isInstance(error) ? (error.lastError ?? error) : error;
  const trace: ErrorTrace = { ...context, message: messageOf(inner) };
  if (inner instanceof Error) trace.name = inner.name;
  if (APICallError.isInstance(inner)) {
    if (inner.statusCode !== undefined) trace.statusCode = inner.statusCode;
    trace.isRetryable = inner.isRetryable;
    const host = hostOf(inner.url);
    if (host) trace.host = host;
    if (inner.responseBody) trace.responseBody = inner.responseBody.slice(0, BODY_CHARS);
    const headers = inner.responseHeaders ?? {};
    const id = REQUEST_ID_HEADERS.map((name) => headers[name]).find((value) => typeof value === 'string' && value !== '');
    if (id) trace.requestId = id;
  }
  const cause = (inner as { cause?: unknown } | null)?.cause;
  if (cause !== undefined && cause !== null) trace.cause = messageOf(cause).slice(0, BODY_CHARS);
  return trace;
}

/** One line for the Details disclosure, e.g. `stream · step 3 · HTTP 200 · cause: Unexpected token`. */
export function describeTrace(trace: ErrorTrace): string {
  return [
    trace.stage,
    trace.step > 0 ? `step ${trace.step}` : '',
    trace.lastTool ? `last tool ${trace.lastTool.name} (${trace.lastTool.state})` : '',
    trace.statusCode !== undefined ? `HTTP ${trace.statusCode}` : '',
    trace.cause ? `cause: ${trace.cause}` : '',
    trace.requestId ? `request ${trace.requestId}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

function messageOf(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === 'string') return value;
  const message = (value as { message?: unknown } | null)?.message;
  if (typeof message === 'string') return message;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function hostOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).host;
  } catch {
    return undefined;
  }
}
