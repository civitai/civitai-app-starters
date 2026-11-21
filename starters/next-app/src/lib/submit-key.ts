/**
 * The generate route's handling of the form's idempotency key.
 *
 * `POST /api/generate` must carry `idempotencyKey`. This module checks it and
 * puts it on the REAL submit's workflow body as `externalId`, which the
 * orchestrator dedupes on per user: a repeat key returns the workflow the first
 * submit started, so a retried submit cannot pay twice.
 *
 * 🔴 NEVER ON THE ESTIMATE. A `whatif=true` estimate sent with the same
 * `externalId` may count as a match, so only the submit path calls
 * {@link withExternalId}.
 *
 * 🔴 REFUSE, NEVER REWRITE. A malformed key is answered with a 400. Trimming or
 * truncating it could fold two different submits onto one key, or give a retry
 * a different key from its first attempt. The accepted format is the SDK's
 * `isValidBlockIdempotencyKey` (`^[A-Za-z0-9_-]{1,64}$`), which sits inside the
 * orchestrator's own `externalId` rule (`^[A-Za-z0-9_-]+$`, at most 128).
 *
 * 🔴 AN ABSENT KEY IS REFUSED TOO. Every Generate form sends one; a caller
 * that forgot it would otherwise get submits that are silently not deduped,
 * which is the double charge this exists to prevent.
 *
 * 🔴 THE SAME FILE IN EVERY STANDALONE STARTER (next-app and sveltekit-app keep
 * it in `src/lib/`, the two PWAs in `server/`), pinned by the repo guard
 * `tests/guards/starter-shared-modules-parity.test.mjs`.
 */
import { isValidBlockIdempotencyKey } from '@civitai/app-sdk/blocks';

export type IdempotencyKeyCheck =
  | { ok: true; key: string }
  | { ok: false; error: string };

/** Read `idempotencyKey` off a generate request body. */
export function readIdempotencyKey(body: unknown): IdempotencyKeyCheck {
  const value =
    body !== null && typeof body === 'object'
      ? (body as { idempotencyKey?: unknown }).idempotencyKey
      : undefined;
  if (typeof value === 'string' && isValidBlockIdempotencyKey(value)) return { ok: true, key: value };
  return { ok: false, error: 'idempotencyKey must match ^[A-Za-z0-9_-]{1,64}$' };
}

/** A copy of the workflow body with `externalId` set to `key`. */
export function withExternalId(body: unknown, key: string): unknown {
  return { ...(body as Record<string, unknown>), externalId: key };
}
