/**
 * Non-fatal error forwarding for a host that collects them — a civitai.com
 * moderator's review preview. Ported from `@civitai/sdk` (`src/host/dev-errors.ts`),
 * whose caps and redaction it keeps byte-for-byte in behaviour.
 */

/** The `BLOCK_INIT.capabilities` entry by which a host says it collects them. Compared exactly. */
export const ERROR_REPORTS_CAPABILITY = 'blockErrors:v1';

/**
 * Did the host ask for this frame's non-fatal errors? Only an array holding the
 * exact string answers yes; any other shape, or a host that predates the field,
 * answers no. Read off the raw wire payload: `@civitai/app-sdk`'s
 * `BlockInitPayload` type does not declare `capabilities`.
 */
export function hostCollectsErrors(initPayload: unknown): boolean {
  const capabilities = (initPayload as { capabilities?: unknown } | null)?.capabilities;
  return Array.isArray(capabilities) && capabilities.includes(ERROR_REPORTS_CAPABILITY);
}

/** `message` is cut to at most this many characters. */
export const ERROR_REPORT_MESSAGE_MAX = 2_000;
/** `stack` is cut to at most this many characters. */
export const ERROR_REPORT_STACK_MAX = 4_000;
/** At most this many reports per {@link ERROR_REPORT_WINDOW_MS}, per frame. */
export const ERROR_REPORT_RATE_LIMIT = 20;
export const ERROR_REPORT_WINDOW_MS = 60_000;
/** The same `message` again within this long of its last report is dropped. */
export const ERROR_REPORT_DEDUPE_MS = 10_000;

/**
 * Input is cut to this before redaction, so a huge string costs bounded work.
 * Far above both caps, so a token split at this boundary is never inside what
 * is sent.
 */
const PRE_CAP = 64 * 1024;
/** Values visited when stringifying a non-Error rejection reason. */
const STRINGIFY_NODE_BUDGET = 500;

/** Where one transport's reports go, and the token it must never leak. */
export interface ErrorReportTarget {
  /** Posts a `BLOCK_ERROR` payload to the host. */
  post(payload: ErrorReportPayload): void;
  /** The raw token the frame holds now; redacted from every report. */
  secret(): string;
}

export type ErrorReportSource = 'error' | 'unhandledrejection' | 'console';

export interface ErrorReportPayload {
  message: string;
  fatal: false;
  source: ErrorReportSource;
  stack?: string;
  at: number;
}

interface Sink {
  target: ErrorReportTarget;
  sent: number[];
  lastSent: Map<string, number>;
}

/** One sink per target, however often it is asked for. */
const sinks = new Map<ErrorReportTarget, Sink>();
let uninstall: (() => void) | null = null;
/** True while a report is being built or posted: a `console.error` it causes is not reported. */
let reporting = false;

/**
 * REVIEW PREVIEWS ONLY. Forwards this frame's uncaught errors, unhandled promise
 * rejections and `console.error` calls to the host as non-fatal `BLOCK_ERROR`s
 * carrying `source`, `stack` and `at`, so the moderator reviewing the app can
 * see them. `IframeTransport` calls it only when the host listed
 * `blockErrors:v1` in `BLOCK_INIT.capabilities` (`hostCollectsErrors`); a
 * production embed sends nothing new.
 *
 * The same reporter, limits and redaction as `@civitai/sdk`'s `reportDevErrors`
 * (this package does not depend on that one): nothing is swallowed, listeners
 * are passive, `console.error` still reaches the console first, and messages are
 * redacted (JWT-shaped strings, `Bearer …`, the frame's own token), truncated,
 * deduplicated and rate limited before they leave the frame.
 *
 * Idempotent per target. Returns a stop function; the last stop removes the
 * listeners and restores `console.error`. A no-op where there is no `window`.
 */
export function reportErrorsToHost(target: ErrorReportTarget): () => void {
  const win = (globalThis as { window?: EventTarget }).window;
  if (!win || typeof win.addEventListener !== 'function') return () => {};
  if (!sinks.has(target)) {
    sinks.set(target, { target, sent: [], lastSent: new Map() });
    uninstall ??= install(win);
  }
  return () => {
    if (!sinks.delete(target) || sinks.size > 0) return;
    uninstall?.();
    uninstall = null;
  };
}

function install(win: EventTarget): () => void {
  const onError = (event: Event) => {
    const e = event as Event & {
      error?: unknown;
      message?: unknown;
      filename?: unknown;
      lineno?: unknown;
      colno?: unknown;
    };
    if (e.error !== undefined && e.error !== null) {
      report('error', () => describe(e.error));
      return;
    }
    // No error object: a cross-origin "Script error." or a bare `ErrorEvent`.
    report('error', () => {
      const message = typeof e.message === 'string' && e.message ? e.message : 'Unknown error';
      const where =
        typeof e.filename === 'string' && e.filename
          ? `at ${e.filename}:${String(e.lineno ?? 0)}:${String(e.colno ?? 0)}`
          : undefined;
      return { message, stack: where };
    });
  };
  const onRejection = (event: Event) => {
    report('unhandledrejection', () => describe((event as Event & { reason?: unknown }).reason));
  };
  win.addEventListener('error', onError);
  win.addEventListener('unhandledrejection', onRejection);

  const con = (globalThis as { console?: Console }).console;
  const original = con?.error;
  let wrapper: ((...args: unknown[]) => void) | undefined;
  if (con && typeof original === 'function') {
    wrapper = function (this: unknown, ...args: unknown[]) {
      // The original first, always, and its own outcome is the caller's.
      original.apply(this, args);
      if (sinks.size > 0) report('console', () => describeArgs(args));
    };
    con.error = wrapper;
  }

  return () => {
    win.removeEventListener('error', onError);
    win.removeEventListener('unhandledrejection', onRejection);
    // Only undo our own wrapper: someone who wrapped it after us keeps theirs
    // (ours then passes straight through, since no sink is left).
    if (con && wrapper && con.error === wrapper) con.error = original!;
  };
}

/**
 * `build` runs inside the guard: describing a value can run the app's own code
 * (`toJSON`, getters), which may itself throw or call `console.error`.
 */
function report(source: ErrorReportSource, build: () => { message: string; stack?: string }): void {
  if (reporting) return;
  reporting = true;
  try {
    const raw = build();
    const at = Date.now();
    for (const sink of sinks.values()) {
      const secret = sink.target.secret();
      const message = clean(raw.message, ERROR_REPORT_MESSAGE_MAX, secret);
      const stack = raw.stack ? clean(raw.stack, ERROR_REPORT_STACK_MAX, secret) : undefined;
      if (!admit(sink, message, at)) continue;
      sink.target.post({ message, fatal: false, source, ...(stack ? { stack } : {}), at });
    }
  } catch {
    // A report that fails must not become another error: in a listener it
    // would fire `error` again, and in the wrapper it would throw out of the
    // app's own `console.error` call.
  } finally {
    reporting = false;
  }
}

/** Dedupe, then the rate limit, so a repeat dropped as a duplicate costs no budget. */
function admit(sink: Sink, message: string, now: number): boolean {
  for (const [key, time] of sink.lastSent) {
    if (now - time >= ERROR_REPORT_DEDUPE_MS) sink.lastSent.delete(key);
  }
  if (sink.lastSent.has(message)) return false;
  sink.sent = sink.sent.filter((time) => now - time < ERROR_REPORT_WINDOW_MS);
  if (sink.sent.length >= ERROR_REPORT_RATE_LIMIT) return false;
  sink.sent.push(now);
  sink.lastSent.set(message, now);
  return true;
}

const JWT = /eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g;
const BEARER = /\bBearer\s+[^\s"'`,;)}\]]+/gi;

/**
 * Runs BEFORE truncation, so a token is never cut such that a fragment
 * survives. `Bearer` first, so `Bearer <jwt>` reads `Bearer [redacted]`.
 */
function redact(text: string, secret?: string): string {
  let out = text;
  if (secret && secret.length >= 16) out = out.split(secret).join('[redacted]');
  return out.replace(BEARER, 'Bearer [redacted]').replace(JWT, '[redacted-jwt]');
}

function clean(text: string, max: number, secret: string): string {
  return truncate(redact(text.length > PRE_CAP ? text.slice(0, PRE_CAP) : text, secret), max);
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  let cut = text.slice(0, max - 1);
  // Never end on half of a surrogate pair.
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
  return `${cut}…`;
}

function isErrorLike(value: unknown): value is { message: string; stack?: unknown; name?: unknown } {
  if (value instanceof Error) return true;
  // Another realm's Error fails `instanceof`.
  const v = value as { message?: unknown; stack?: unknown } | null;
  return typeof v === 'object' && v !== null && typeof v.message === 'string' && typeof v.stack === 'string';
}

function describe(value: unknown): { message: string; stack?: string } {
  try {
    if (isErrorLike(value)) {
      const name = typeof value.name === 'string' ? value.name : 'Error';
      return {
        message: value.message || name,
        ...(typeof value.stack === 'string' && value.stack ? { stack: value.stack } : {}),
      };
    }
  } catch {
    // A throwing getter: fall through to the generic description.
  }
  return { message: stringify(value) };
}

function describeArgs(args: unknown[]): { message: string; stack?: string } {
  let stack: string | undefined;
  const parts = args.map((arg) => {
    if (typeof arg === 'string') return arg;
    const d = describe(arg);
    stack ??= d.stack;
    return d.message;
  });
  const message = parts.join(' ') || 'console.error()';
  return stack ? { message, stack } : { message };
}

/** Never throws, never loops on a cycle, and visits a bounded number of values. */
function stringify(value: unknown): string {
  try {
    switch (typeof value) {
      case 'string':
        return value;
      case 'undefined':
        return 'undefined';
      case 'bigint':
        return `${value}n`;
      case 'symbol':
        return value.toString();
      case 'function':
        return `[Function ${value.name || 'anonymous'}]`;
      case 'number':
      case 'boolean':
        return String(value);
    }
    if (value === null) return 'null';
    const seen = new WeakSet<object>();
    let budget = STRINGIFY_NODE_BUDGET;
    const json = JSON.stringify(value, (_key, v: unknown) => {
      if (--budget < 0) return '[…]';
      if (typeof v === 'bigint') return `${v}n`;
      if (typeof v === 'function') return `[Function ${v.name || 'anonymous'}]`;
      if (typeof v === 'symbol') return v.toString();
      if (typeof v === 'object' && v !== null) {
        if (seen.has(v)) return '[Circular]';
        seen.add(v);
      }
      return v;
    });
    return json ?? Object.prototype.toString.call(value);
  } catch {
    try {
      return Object.prototype.toString.call(value);
    } catch {
      return '[unserializable]';
    }
  }
}
