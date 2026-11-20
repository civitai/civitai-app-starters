/**
 * mockHostIdempotency.ts — the dev host's IDEMPOTENCY-KEY FORMAT GATE.
 *
 * THE MOTIVATING FAILURE (2026-10-02). A character-sheet block sent an
 * `idempotencyKey` of the form `sheetId:panelId:nonce`. It passed **201 local
 * tests**, the dev harness and review. Every save in production failed:
 *
 *     { "code": "invalid_format", "format": "regex",
 *       "pattern": "/^[A-Za-z0-9_-]{1,64}$/",
 *       "path": ["idempotencyKey"],
 *       "message": "Invalid string: must match pattern /^[A-Za-z0-9_-]{1,64}$/" }
 *
 * `BAD_REQUEST` / httpStatus 400 on path `blocks.submitWorkflow`.
 *
 * 🔴 THE REASON IT GOT THAT FAR IS THIS FILE'S ABSENCE — the exact shape of
 * #511's storage-scope gap, one surface over. `createMockHost` had **zero**
 * occurrences of `idempotencyKey`: it accepted the field, forwarded nothing, and
 * validated nothing, so the one submit failure mode that actually ships was the
 * only one the mock could not produce. It models a caught server exception, a
 * disallowed account pool, insufficient Buzz, a fail-rate dice roll and an
 * induced transport failure — and not the input validator that runs before any
 * of them.
 *
 * This is the missing arm of an existing simulation, not a new feature.
 *
 * ---
 *
 * WHAT THE SERVER ACTUALLY DOES, and why the refusal has THIS shape.
 *
 * The rule is a zod `.regex()` on the procedure INPUT
 * (`blocks.router.ts:6227`), so it fires **before the procedure body runs** —
 * ahead of every scenario, budget and balance decision the handler below would
 * otherwise make. That ordering is modelled deliberately: the gate sits ahead of
 * the message switch, so a malformed key is refused even when the scenario,
 * the balance and the spend cap would all have allowed the submit, because
 * production refuses it then too.
 *
 * A tRPC input rejection reaches the block as a host-synthesised failure
 * snapshot, NOT as a thrown error — the reply crosses `postMessage`.
 * `internal/liveHost.ts:298` is the mapping: `errorSnapshot(error)` →
 * `{ workflowId: 'failed', status: 'failed', error }`, with **no `cost`**. That
 * is byte-for-byte the shape the disallowed-account branch in `mockHost.ts`
 * already emits, and it is what makes `useBuzzWorkflow().submit` reject with
 * `WorkflowSubmitError` code `'exception'`. Emitting anything else here — a
 * priced refusal, a thrown error, a silent drop — would model a host that does
 * not exist.
 *
 * 🔴 ONE MESSAGE TYPE TODAY, AND A TABLE ANYWAY. `SUBMIT_WORKFLOW` is the only
 * block→host message in `@civitai/app-sdk`'s protocol carrying an
 * `idempotencyKey` (the tip and good-purchase paths are direct REST POSTs and
 * never traverse the mock host, so they are covered by the hook-boundary guard
 * alone — see `resolveIdempotencyKey`). The table is still the right shape: a
 * future money message that gains the field is governed the moment it joins
 * `IDEMPOTENT_MESSAGES`, rather than whenever someone remembers to copy a check
 * into its handler. That is the property #511 bought on the storage side and the
 * reason its gate sits ahead of the switch.
 *
 * 🔴 WHY THIS IS NOT REDUNDANT WITH THE HOOK GUARD. Two independent reachable
 * paths bypass the hooks: a block may drive the transport directly
 * (`getTransport().sendRequest({ type: 'SUBMIT_WORKFLOW', … })`, which the
 * package exports), and the dev harness dispatches hand-built messages. The gate
 * is also the arm that makes the DEV HARNESS and the TEST SUITE go red, which is
 * what the original defect needed and did not have: a hook-side throw protects
 * callers of that hook, while this protects the protocol.
 */

import {
  BLOCK_IDEMPOTENCY_KEY_REGEX,
  blockIdempotencyKeyRejection,
} from '@civitai/app-sdk/blocks';

/**
 * Block→host message types whose payload carries an `idempotencyKey` the host
 * validates. Exported for the ledger test, which fails when the set grows or
 * shrinks — so a new money message cannot join the protocol ungated and a
 * retired one cannot leave a dead row behind.
 */
export const IDEMPOTENT_MESSAGES: readonly string[] = ['SUBMIT_WORKFLOW'];

/** Does this gate govern `type`? */
export function governsIdempotencyKey(type: string): boolean {
  return IDEMPOTENT_MESSAGES.includes(type);
}

/**
 * The refusal text, modelled on the server's own `invalid_format` message so a
 * developer grepping their production logs for the string finds the dev one too.
 *
 * 🔴 DO NOT LET A BLOCK BRANCH ON THIS STRING and do not render it to a viewer.
 * It is developer-facing: a malformed key is a defect in the block's code, so
 * "please try again" is the wrong copy for it — no number of retries fixes it.
 */
export function idempotencyKeyDeniedMessage(reason: string): string {
  // 🔴 INTERPOLATED FROM THE VENDORED CONSTANT, NEVER RE-TYPED. The first draft
  // of this line spelled the pattern out — and the single-source guard
  // (`tests/guards/idempotency-key-rule-single-source.test.mjs`) caught it,
  // which is the whole point of that guard: a second copy of a rule the host
  // owns can only ever drift from it.
  return `Invalid string: must match pattern ${String(BLOCK_IDEMPOTENCY_KEY_REGEX)} (idempotencyKey) — ${reason}`;
}

/**
 * The reason `payload.idempotencyKey` is unacceptable, or `null` to proceed.
 *
 * 🔴 AN ABSENT KEY IS VALID AND MUST STAY VALID. The field is optional on the
 * wire; `undefined` means "no dedupe", which is the ordinary case for every
 * block that never passes one. Validating absence would refuse almost every
 * submit in the suite — and would be a FALSE model, since the host's own schema
 * is `.optional()` on this path.
 *
 * Note the asymmetry the host has and this cannot: the REST submit endpoint
 * (`submit.ts:135`) makes the field REQUIRED. The mock serves the postMessage
 * bridge, which is the `.optional()` arm, so absence is correct here.
 */
export function idempotencyKeyRefusal(payload: { idempotencyKey?: unknown } | undefined): string | null {
  const key = payload?.idempotencyKey;
  if (key === undefined) return null;
  return blockIdempotencyKeyRejection(key);
}
