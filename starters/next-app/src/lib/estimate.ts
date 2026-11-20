/**
 * The pure decisions behind the Buzz cost preview, shared by the estimate route
 * (`src/app/api/generate/estimate/route.ts`) and `<GenerateForm>`.
 *
 * Kept free of imports (no `@/` alias, no `server-only`, no React) so
 * `tests/estimate.test.mjs` can run THIS file under plain `node --test` — the
 * tests exercise the code that ships, not a copy of it.
 */

/**
 * A Buzz cost, or `null` when the value is not a real number.
 *
 * 🔴 ABSENT IS NOT ZERO. A what-if snapshot may omit `cost` or `cost.total`
 * (`WorkflowSnapshot.cost?: { total?: number }`). Defaulting that to `0` shows
 * "This will cost 0 Buzz" for a request nobody priced, and the user cannot tell
 * it from a genuinely free one. An explicit numeric `0` is kept as `0`.
 */
export function costOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** The JSON body `POST /api/generate/estimate` returns on success. */
export function estimateResponseBody<S extends { cost?: { total?: unknown } }>(
  snapshot: S,
): { cost: number | null; snapshot: S } {
  return { cost: costOrNull(snapshot.cost?.total), snapshot };
}

/** An estimate, together with the exact prompt it priced. */
export interface Quote {
  prompt: string;
  /** `null` = the estimate came back without a usable cost. */
  cost: number | null;
}

/**
 * The quote that applies to `prompt`, or `null` when there is none.
 *
 * A quote priced a different prompt says nothing about this one, so editing
 * the prompt hides the old price instead of carrying it over.
 */
export function quoteFor(quote: Quote | null, prompt: string): Quote | null {
  return quote !== null && quote.prompt === prompt ? quote : null;
}

/**
 * Whether Generate may be pressed: not busy, a non-blank prompt, and an
 * estimate with a numeric cost for EXACTLY the current prompt.
 */
export function canGenerate(state: {
  busy: boolean;
  prompt: string;
  quote: Quote | null;
}): boolean {
  if (state.busy || !state.prompt.trim()) return false;
  const current = quoteFor(state.quote, state.prompt);
  return current !== null && current.cost !== null;
}

/** One estimate request: its sequence number and the prompt it was sent for. */
export interface EstimateTicket {
  seq: number;
  prompt: string;
}

/**
 * Orders estimate requests so a response can tell whether it is still wanted.
 *
 * `begin` issues a ticket and makes every earlier one stale; `invalidate`
 * (Reset) makes every ticket stale. Only a response whose ticket `isCurrent`
 * may set a quote — a late response to a discarded estimate must leave the
 * current prompt unpriced.
 */
export function createEstimateSequencer() {
  let latest = 0;
  return {
    begin(prompt: string): EstimateTicket {
      latest += 1;
      return { seq: latest, prompt };
    },
    invalidate(): void {
      latest += 1;
    },
    isCurrent(ticket: EstimateTicket): boolean {
      return ticket.seq === latest;
    },
  };
}

export type EstimateSequencer = ReturnType<typeof createEstimateSequencer>;
