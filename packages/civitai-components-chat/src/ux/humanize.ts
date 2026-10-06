export type ErrorKind = 'free_tier_exhausted' | 'insufficient_buzz' | 'blocked' | 'auth' | 'rate_limit' | 'timeout' | 'network' | 'assistant_unavailable' | 'unavailable' | 'unknown';

export interface HumanError {
  kind: ErrorKind;
  message: string;
  /** What the service actually said, for the Details disclosure only. */
  detail?: string;
}

const WORDS: Record<ErrorKind, string> = {
  free_tier_exhausted: 'Your free replies are used up for now.',
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
  return { kind, message: WORDS[kind], detail };
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
  if (status === 402 || /insufficient|not enough buzz|balance/.test(text)) return 'insufficient_buzz';
  if (/blocked|prohibited|moderat|violat|not allowed|safety/.test(text)) return 'blocked';
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limit';
  if (status === 504 || status === 408 || /timed? ?out|timeout/.test(text)) return 'timeout';
  if (error instanceof TypeError && /fetch|network|load failed/.test(text)) return 'network';
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
