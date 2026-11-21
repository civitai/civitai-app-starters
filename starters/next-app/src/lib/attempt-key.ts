/**
 * The idempotency key of one Generate attempt, kept by the Generate form.
 *
 * The form sends this key with `POST /api/generate`, and the route puts it on
 * the workflow as `externalId`. The orchestrator dedupes on `externalId` per
 * user: a second submit with the same key returns the workflow the first one
 * started instead of starting (and charging for) another. So a retry after a
 * failed submit, or after a failed wait, cannot pay twice.
 *
 * 🔴 THE KEY IS BOUND TO THE EXACT INPUT. The orchestrator returns the existing
 * workflow for a repeat key EVEN IF THE BODY DIFFERS, so a key reused for a
 * different prompt would silently hand back the old prompt's images. The form
 * submits only the prompt, so the prompt is the whole input here. If you add an
 * input to the form (model, size, seed, ...), add it to {@link Attempt} and to
 * the comparison in {@link attemptFor}.
 *
 * The form keeps one attempt across a failed submit, a failed wait and the
 * re-Preview a failure forces, and drops it on success, on Reset and when the
 * prompt is edited.
 *
 * 🔴 THE SAME FILE IN EVERY STANDALONE STARTER. next-app, sveltekit-app,
 * react-pwa and svelte-pwa each carry a byte-identical copy, and the repo guard
 * `tests/guards/starter-shared-modules-parity.test.mjs` fails when one copy
 * changes alone.
 */

/** One Generate attempt: its key, and the exact prompt the key was minted for. */
export interface Attempt {
  prompt: string;
  key: string;
}

/**
 * A new key: 32 lowercase hex characters, inside the `^[A-Za-z0-9_-]{1,64}$`
 * the generate route accepts.
 *
 * `crypto.getRandomValues`, not `crypto.randomUUID`: `randomUUID` exists only
 * in a secure context, so it would throw on a plain-http LAN dev URL.
 */
export function mintAttemptKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The attempt to submit `prompt` under: the current one when it was minted for
 * exactly this prompt, otherwise a new one.
 */
export function attemptFor(
  attempt: Attempt | null,
  prompt: string,
  mint: () => string = mintAttemptKey,
): Attempt {
  return attempt !== null && attempt.prompt === prompt ? attempt : { prompt, key: mint() };
}
