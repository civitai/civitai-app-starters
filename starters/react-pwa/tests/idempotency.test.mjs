/**
 * Tests for the Generate idempotency key: the form's attempt key
 * (`src/lib/attempt-key.ts`) and the generate route's check of it
 * (`submit-key.ts`). Runs the SHIPPED modules under `node --test` (Node
 * 22.18+ / 24 strip the TypeScript types natively). That the form and the
 * routes actually use them is pinned by the repo-only guard
 * `tests/guards/starter-idempotency-seam.test.mjs`; what the form sends is
 * also checked by `tests/GenerateForm.test.ts`. The same file runs in every
 * standalone starter, except its one `const MODULE = …` line, which names
 * where that starter keeps `submit-key.ts`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { attemptFor, mintAttemptKey } from '../src/lib/attempt-key.ts';

const MODULE = '../server/submit-key.ts';
const { readIdempotencyKey, withExternalId } = await import(MODULE);

// --- the route's check: refuse a malformed key, never rewrite it -----------

test('submit key: a body without idempotencyKey is refused', () => {
  for (const body of [{ prompt: 'p' }, { prompt: 'p', idempotencyKey: undefined }, null, 'p']) {
    const check = readIdempotencyKey(body);
    assert.equal(check.ok, false, `accepted ${JSON.stringify(body)}`);
    assert.equal(check.error, 'idempotencyKey must match ^[A-Za-z0-9_-]{1,64}$');
  }
});

test('submit key: a well-formed key is accepted unchanged', () => {
  for (const key of ['k', 'Ab_9-zZ', 'a'.repeat(64), '3f9c0b7e1d2a48c6b5e4f70a19d3c2b8']) {
    assert.deepEqual(readIdempotencyKey({ prompt: 'p', idempotencyKey: key }), { ok: true, key });
  }
});

test('submit key: a malformed key is refused, not rewritten', () => {
  const bad = ['', 'a:b', ' padded ', 'a'.repeat(65), 'key.with.dots', 'ключ', 7, null, true, ['k'], { k: 1 }];
  for (const idempotencyKey of bad) {
    const check = readIdempotencyKey({ prompt: 'p', idempotencyKey });
    assert.equal(check.ok, false, `accepted ${JSON.stringify(idempotencyKey)}`);
    assert.equal(check.error, 'idempotencyKey must match ^[A-Za-z0-9_-]{1,64}$');
    assert.equal('key' in check, false);
  }
});

test('submit key: withExternalId sets externalId on a copy of the body', () => {
  const body = { steps: [{ name: 'step_0' }], tags: ['t1'] };
  const out = withExternalId(body, 'k-61_x');
  assert.deepEqual(out, { steps: [{ name: 'step_0' }], tags: ['t1'], externalId: 'k-61_x' });
  assert.equal('externalId' in body, false, 'the input body must not be mutated');
});

// --- the form's attempt key -------------------------------------------------

test('attempt key: a minted key is 32 lowercase hex characters, and each one differs', () => {
  const a = mintAttemptKey();
  const b = mintAttemptKey();
  assert.match(a, /^[0-9a-f]{32}$/);
  assert.match(b, /^[0-9a-f]{32}$/);
  assert.notEqual(a, b);
  assert.deepEqual(readIdempotencyKey({ idempotencyKey: a }), { ok: true, key: a });
});

test('attempt key: the first attempt for a prompt mints a key', () => {
  assert.deepEqual(attemptFor(null, 'fox', () => 'minted1'), { prompt: 'fox', key: 'minted1' });
});

test('attempt key: the same prompt keeps the attempt and its key', () => {
  const current = { prompt: 'fox', key: 'kept2' };
  assert.equal(attemptFor(current, 'fox', () => 'minted3'), current);
});

test('attempt key: a different prompt gets a new key', () => {
  const current = { prompt: 'fox', key: 'kept4' };
  assert.deepEqual(attemptFor(current, 'fox ', () => 'minted5'), { prompt: 'fox ', key: 'minted5' });
  assert.deepEqual(attemptFor(current, 'owl', () => 'minted6'), { prompt: 'owl', key: 'minted6' });
});
