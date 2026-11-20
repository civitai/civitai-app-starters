import { FUND_EMPTY, type ChatFund } from './fund.js';

export interface FreeTierWindow {
  limit: number;
  remaining: number;
  resetAt?: string;
}

export interface FreeTierModel {
  key: string;
  airs: string[];
  remaining: number;
  windows: FreeTierWindow[];
}

export interface FreeTierStatus {
  enabled: boolean;
  models: FreeTierModel[];
}

export const FREE_TIER_EXHAUSTED = 'free_tier_exhausted';
export const FREE_TIER_NOT_FREE = 'free_tier_not_free';

/**
 * The viewer's free allowance per model, read from the orchestrator and kept current from the
 * `RateLimit` headers each free reply carries.
 */
export class FreeTier extends EventTarget {
  status: FreeTierStatus = { enabled: false, models: [] };
  loaded = false;
  #load: () => Promise<FreeTierStatus>;
  #loading?: Promise<void>;

  constructor(load: () => Promise<FreeTierStatus>) {
    super();
    this.#load = load;
  }

  refresh(): Promise<void> {
    this.#loading ??= this.#load()
      .then((status) => {
        this.status = { enabled: Boolean(status?.enabled), models: Array.isArray(status?.models) ? status.models : [] };
        this.loaded = true;
        this.#changed();
      })
      .catch((error: unknown) => console.warn('[chat-cvt] could not read the free allowance', error))
      .finally(() => (this.#loading = undefined));
    return this.#loading;
  }

  modelFor(air: string): FreeTierModel | undefined {
    return this.status.enabled ? this.status.models.find((model) => model.airs.includes(air)) : undefined;
  }

  /** Whether a request for this model may go out free right now. */
  available(air: string): boolean {
    return (this.modelFor(air)?.remaining ?? 0) > 0;
  }

  /** When the allowance comes back, if it is used up. */
  resetAt(air: string): Date | undefined {
    const model = this.modelFor(air);
    const at = model?.windows.filter((window) => window.remaining <= 0 && window.resetAt).map((window) => Date.parse(window.resetAt!));
    return at?.length ? new Date(Math.max(...at)) : undefined;
  }

  exhausted(air: string, retryAfterSeconds?: number): void {
    const model = this.modelFor(air);
    if (!model) return;
    const resetAt = retryAfterSeconds ? new Date(Date.now() + retryAfterSeconds * 1000).toISOString() : model.windows[0]?.resetAt;
    model.remaining = 0;
    model.windows = model.windows.map((window) => ({ ...window, remaining: 0, ...(resetAt ? { resetAt } : {}) }));
    this.#changed();
  }

  /** Reads `RateLimit: "qwen3.8-chat";r=187;t=3600` (a bucket with several windows: `"qwen3.8-chat-3600s"`). */
  note(headers: Headers): boolean {
    const header = headers.get('RateLimit');
    if (!header) return false;
    const seen = new Map<string, { remaining: number; reset: number }[]>();
    for (const entry of header.split(',')) {
      const match = /"([^"]+)"\s*;\s*r=(\d+)(?:\s*;\s*t=(\d+))?/.exec(entry);
      if (!match) continue;
      const [, policy, remaining, reset] = match;
      const model = this.status.models.find((m) => policy === m.key || policy!.startsWith(`${m.key}-`));
      if (!model) continue;
      seen.set(model.key, [...(seen.get(model.key) ?? []), { remaining: Number(remaining), reset: Number(reset ?? 0) }]);
    }
    for (const [key, windows] of seen) {
      const model = this.status.models.find((m) => m.key === key)!;
      model.remaining = Math.min(...windows.map((w) => w.remaining));
      model.windows = windows.map((w, i) => ({ limit: model.windows[i]?.limit ?? w.remaining, remaining: w.remaining, resetAt: new Date(Date.now() + w.reset * 1000).toISOString() }));
    }
    if (seen.size) this.#changed();
    return seen.size > 0;
  }

  #changed(): void {
    this.dispatchEvent(new Event('change'));
  }
}

export interface FreeTierChoice {
  /** Send eligible requests free while the allowance lasts. */
  useFree: boolean;
  /** When the free request cannot go ahead (used up, or the model has none), send it paid without asking. */
  payWhenOut: boolean;
}

/**
 * Sends a chat request free when the model has allowance left, and paid only when the viewer allows
 * it; otherwise a used-up allowance becomes a clear, non-retried error. With a `fund`, replies past a
 * used-up allowance are billed to the viewer's prepaid chat balance instead of their Buzz.
 */
export function freeTierFetch(inner: typeof fetch, air: string, freeTier: FreeTier, choice: () => FreeTierChoice, fund?: ChatFund): typeof fetch {
  const pay: typeof fetch = fund ? (input, init) => fund.send(inner, input, init) : inner;
  return async (input, init) => {
    const { useFree, payWhenOut } = choice();
    if (useFree && !freeTier.loaded) await freeTier.refresh();
    // Free only, and this model has no free replies (or they could not be checked): never send it paid.
    if (useFree && !payWhenOut && !freeTier.modelFor(air)) return notFree(freeTier.loaded);
    if (!useFree || !freeTier.modelFor(air)) return inner(input, init);
    if (!freeTier.available(air)) return payWhenOut ? paidOrUsedUp(input, init) : usedUp(freeTier.resetAt(air));

    const headers = new Headers(init?.headers);
    headers.set('X-Civitai-Tier', 'free');
    const response = await inner(input, { ...init, headers });
    if (response.status === 429) {
      freeTier.exhausted(air, Number(response.headers.get('Retry-After')) || undefined);
      return payWhenOut ? paidOrUsedUp(input, init) : usedUp(freeTier.resetAt(air));
    }
    // Browsers only see RateLimit when the server exposes it; otherwise ask for the count.
    if (!freeTier.note(response.headers)) void freeTier.refresh();
    return response;
  };

  // An empty chat balance after the free replies ran out reads as the free allowance being used up, with its reset time.
  async function paidOrUsedUp(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const response = await pay(input, init);
    return response.status === 400 && (await isFundEmpty(response)) ? usedUp(freeTier.resetAt(air)) : response;
  }
}

async function isFundEmpty(response: Response): Promise<boolean> {
  const body = (await response.clone().json().catch(() => null)) as { error?: { code?: string } } | null;
  return body?.error?.code === FUND_EMPTY;
}

// A 400, so the AI SDK does not retry it as it would a 429.
function notFree(checked: boolean): Response {
  const message = checked ? 'Model has no free replies' : 'Free replies could not be checked';
  return Response.json({ error: { message, code: FREE_TIER_NOT_FREE } }, { status: 400 });
}

// A 400, so the AI SDK does not retry it as it would a 429.
function usedUp(resetAt?: Date): Response {
  const until = resetAt ? ` until ${resetAt.toISOString()}` : '';
  return Response.json({ error: { message: `Free allowance used up${until}`, code: FREE_TIER_EXHAUSTED } }, { status: 400 });
}
