import { createNotifier } from '../core/messaging.js';
import type { BlockTransport } from '../core/transport.js';

import type { DevErrorSource, HostNotifications } from './protocol.js';

const notify = createNotifier<HostNotifications>();

/** `message` is cut to at most this many characters. */
export const DEV_ERROR_MESSAGE_MAX = 2_000;
/** `stack` is cut to at most this many characters. */
export const DEV_ERROR_STACK_MAX = 4_000;
/** At most this many reports per {@link DEV_ERROR_WINDOW_MS}, per frame. */
export const DEV_ERROR_RATE_LIMIT = 20;
export const DEV_ERROR_WINDOW_MS = 60_000;
/** The same `message` again within this long of its last report is dropped. */
export const DEV_ERROR_DEDUPE_MS = 10_000;

/**
 * Input is cut to this before redaction, so a huge string costs bounded work.
 * Far above both caps, so a token split at this boundary is never inside what
 * is sent.
 */
const PRE_CAP = 64 * 1024;
/** Values visited when stringifying a non-Error rejection reason. */
const STRINGIFY_NODE_BUDGET = 500;

interface Sink {
  transport: BlockTransport;
  sent: number[];
  lastSent: Map<string, number>;
}

/** One sink per transport, however often `initialize()` runs against it. */
const sinks = new Map<BlockTransport, Sink>();
let uninstall: (() => void) | null = null;
/** True while a report is being built or posted: a `console.error` it causes is not reported. */
let reporting = false;

/**
 * DEV SESSIONS ONLY. Forwards this frame's uncaught errors, unhandled promise
 * rejections and `console.error` calls to the host as non-fatal `BLOCK_ERROR`s
 * carrying `source`, `stack` and `at`, so the person (or the assistant)
 * building the app can see them. `initialize()` calls it only when the host
 * marked the frame a dev-tunnel preview; a production embed sends nothing new.
 *
 * Nothing is swallowed: listeners are passive, and `console.error` still
 * reaches the console first. Messages are redacted (JWT-shaped strings,
 * `Bearer …`, and the token this frame holds), truncated, deduplicated and
 * rate limited before they leave the frame.
 *
 * Idempotent per transport. Returns a stop function; the last stop removes the
 * listeners and restores `console.error`. A no-op where there is no `window`.
 */
export function reportDevErrors(transport: BlockTransport): () => void {
  const win = (globalThis as { window?: EventTarget }).window;
  if (!win || typeof win.addEventListener !== 'function') return () => {};
  if (!sinks.has(transport)) {
    sinks.set(transport, { transport, sent: [], lastSent: new Map() });
    uninstall ??= install(win);
  }
  return () => {
    if (!sinks.delete(transport) || sinks.size > 0) return;
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
function report(source: DevErrorSource, build: () => { message: string; stack?: string }): void {
  if (reporting) return;
  reporting = true;
  try {
    const raw = build();
    const at = Date.now();
    for (const sink of sinks.values()) {
      const secret = sink.transport.snapshot.get().token.raw;
      const message = clean(raw.message, DEV_ERROR_MESSAGE_MAX, secret);
      const stack = raw.stack ? clean(raw.stack, DEV_ERROR_STACK_MAX, secret) : undefined;
      if (!admit(sink, message, at)) continue;
      notify(
        'BLOCK_ERROR',
        { message, fatal: false, source, ...(stack ? { stack } : {}), at },
        { transport: sink.transport },
      );
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
    if (now - time >= DEV_ERROR_DEDUPE_MS) sink.lastSent.delete(key);
  }
  if (sink.lastSent.has(message)) return false;
  sink.sent = sink.sent.filter((time) => now - time < DEV_ERROR_WINDOW_MS);
  if (sink.sent.length >= DEV_ERROR_RATE_LIMIT) return false;
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
