import { isNetworkDrop } from '../agent/network-retry.js';

export type ErrorKind = 'free_tier_exhausted' | 'free_tier_not_free' | 'fund_empty' | 'insufficient_buzz' | 'blocked' | 'auth' | 'rate_limit' | 'timeout' | 'network' | 'assistant_unavailable' | 'unavailable' | 'unknown';

/**
 * The failures a Retry is offered for: the connection was lost, or the service was busy or down for a
 * moment. Not a refusal (sign-in, Buzz, the safety filter), which asking again would only repeat, nor
 * a failure of unknown cause.
 */
/** `interrupted`: a reply read back from a save made while it ran, which can carry on from its finished steps (see `turnFrom`). */
export const RETRYABLE_ERRORS: ReadonlySet<string> = new Set(['network', 'rate_limit', 'unavailable', 'assistant_unavailable', 'interrupted']);

export interface HumanError {
  kind: ErrorKind;
  message: string;
  /** What the service actually said, for the Details disclosure only. */
  detail?: string;
}

const WORDS: Record<ErrorKind, string> = {
  free_tier_exhausted: 'Your free replies are used up for now.',
  free_tier_not_free: "This model has no free replies, and you chose free replies only.",
  fund_empty: 'Your chat balance is empty.',
  insufficient_buzz: "You don't have enough Buzz for this.",
  blocked: 'That request was blocked by the safety filter. Try wording it differently.',
  auth: "Civitai didn't accept your sign-in. Please sign in again.",
  rate_limit: 'Civitai is busy right now. Wait a moment and try again.',
  timeout: "This took too long and was stopped. You weren't charged for unfinished work.",
  network: 'Lost the connection to Civitai. Check your network and try again.',
  assistant_unavailable: "The assistant isn't available right now. Try again in a minute.",
  unavailable: "Civitai isn't available right now. Try again in a minute.",
  unknown: 'Something went wrong on our side.',
};

export function humanize(error: unknown): HumanError {
  const detail = detailOf(error);
  const kind = kindOf(error, detail);
  if (kind === 'free_tier_exhausted') return { kind, message: freeTierMessage(detail), detail };
  if (kind === 'free_tier_not_free' && /could not be checked/i.test(detail)) {
    return { kind, message: "Your free replies couldn't be checked, so nothing was sent. Try again, or allow paid replies.", detail };
  }
  return { kind, message: WORDS[kind], detail };
}

/** The words for a host's own gateway, where "Civitai" and "Buzz" would be wrong. */
const HOST_WORDS: Partial<Record<ErrorKind, string>> = {
  insufficient_buzz: 'This request was refused.',
  auth: "Your sign-in wasn't accepted. Please sign in again.",
  rate_limit: 'The assistant is busy right now. Wait a moment and try again.',
  network: 'Lost the connection. Check your network and try again.',
  unavailable: "The assistant isn't available right now. Try again in a minute.",
  timeout: 'This took too long and was stopped.',
  unknown: 'Something went wrong.',
};

/** The most of a gateway's own message the viewer is shown. */
export const HOST_MESSAGE_MAX = 500;

/**
 * A reply that failed on a host's own gateway: the gateway's own message when it gave one (a refusal
 * such as a spend cap must reach the viewer as written), else plain words with no Civitai in them.
 * The kind still follows the status code (402 is `insufficient_buzz`, 429 `rate_limit`, …).
 */
export function humanizeHost(error: unknown): HumanError {
  const inner = lastAttempt(error);
  const found = humanize(inner);
  // A host's gateway has no free tier or chat balance: those kinds would offer Civitai's top-up.
  const human = found.kind === 'free_tier_exhausted' || found.kind === 'free_tier_not_free' || found.kind === 'fund_empty' ? { ...found, kind: 'unknown' as const } : found;
  const said = hostMessage(inner);
  const status = (inner as { statusCode?: unknown } | null)?.statusCode;
  // A 5xx body never reaches the viewer, also not as `detail`: the AI SDK makes a JSON body's message
  // the error's own message, which would be shown under Details, saved with the turn and sent in
  // `reply-error`. The body stays in the reply's trace, which is neither saved nor shown whole.
  const detail = typeof status === 'number' && status >= 500 ? `The server answered ${status}.` : human.detail;
  return { ...human, message: said ?? HOST_WORDS[human.kind] ?? human.message, ...(detail === undefined ? {} : { detail }) };
}

/** The AI SDK gives up on a retried request with a `RetryError` around every attempt's error; the last one is what the gateway said. */
function lastAttempt(error: unknown): unknown {
  const last = (error as { lastError?: unknown } | null)?.lastError;
  return last !== undefined && last !== null && (error as { reason?: unknown }).reason !== undefined ? last : error;
}

/**
 * What a gateway said: from an HTTP error's body (`{ error: { message } }`, `{ error: "…" }`,
 * `{ message }` or plain text), or from an error frame inside the stream (`{ message }`).
 */
export function hostMessage(error: unknown): string | undefined {
  if (error === null || typeof error !== 'object') return undefined;
  const record = error as { statusCode?: unknown; responseBody?: unknown; message?: unknown; error?: unknown };
  if (typeof record.statusCode === 'number') {
    // A 5xx body is the server's own trouble (a stack trace, an upstream provider's error), not words for
    // the viewer: it stays in the reply's trace, and the viewer gets a plain line.
    if (record.statusCode >= 500) return undefined;
    return typeof record.responseBody === 'string' ? fromBody(record.responseBody) : undefined;
  }
  if (error instanceof Error) return undefined;
  return fromJson(record);
}

function fromBody(body: string): string | undefined {
  const text = body.trim();
  if (text === '') return undefined;
  try {
    return fromJson(JSON.parse(text));
  } catch {
    // An HTML error page says nothing a viewer should read.
    return /^</.test(text) ? undefined : clip(text);
  }
}

function fromJson(value: unknown): string | undefined {
  const record = value as { error?: unknown; message?: unknown } | null;
  if (typeof record?.error === 'string') return clip(record.error);
  const nested = (record?.error as { message?: unknown } | null | undefined)?.message;
  if (typeof nested === 'string') return clip(nested);
  if (typeof record?.message === 'string') return clip(record.message);
  return undefined;
}

function clip(text: string): string | undefined {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat === '') return undefined;
  return flat.length > HOST_MESSAGE_MAX ? `${flat.slice(0, HOST_MESSAGE_MAX - 1)}…` : flat;
}

export function humanizeText(text: string): HumanError {
  return humanize(new Error(text));
}

function freeTierMessage(detail: string): string {
  const until = Date.parse(/until (\S+)/.exec(detail)?.[1] ?? '');
  if (Number.isNaN(until)) return WORDS.free_tier_exhausted;
  const at = new Date(until);
  const sameDay = at.toDateString() === new Date().toDateString();
  const when = sameDay ? at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : at.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  return `Your free replies are used up until ${when}.`;
}

function kindOf(error: unknown, detail: string): ErrorKind {
  const status = statusOf(error);
  const text = detail.toLowerCase();
  if (/free allowance used up/.test(text)) return 'free_tier_exhausted';
  if (/model has no free replies|free replies could not be checked/.test(text)) return 'free_tier_not_free';
  if (/chat balance is empty/.test(text)) return 'fund_empty';
  if (status === 402 || /insufficient|not enough buzz|balance/.test(text)) return 'insufficient_buzz';
  if (/blocked|prohibited|moderat|violat|not allowed|safety/.test(text)) return 'blocked';
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limit';
  if (status === 504 || status === 408 || /timed? ?out|timeout/.test(text)) return 'timeout';
  if (error instanceof TypeError && /fetch|network|load failed/.test(text)) return 'network';
  // A 2xx answer whose body the browser cut when it dropped the connection.
  if (isNetworkDrop(error)) return 'network';
  // The orchestrator reports a chat model it could not run as an error frame inside a 200 stream.
  if (/chat completion failed/.test(text)) return 'assistant_unavailable';
  if (status === 502 || status === 503) return 'unavailable';
  return 'unknown';
}

function statusOf(error: unknown): number | undefined {
  if (error === null || typeof error !== 'object') return undefined;
  const record = error as { status?: unknown; statusCode?: unknown };
  const value = record.status ?? record.statusCode;
  return typeof value === 'number' ? value : undefined;
}

function detailOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  const reported = error as { message?: unknown; workflow_id?: unknown } | null;
  if (typeof reported?.message === 'string') {
    return typeof reported.workflow_id === 'string' ? `${reported.message} (workflow ${reported.workflow_id})` : reported.message;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
