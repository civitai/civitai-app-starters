/**
 * The uniform `{ ok, error }` reply REJECT test, single-sourced.
 *
 * Every reply validator for an `{ ok, error }`-shaped result early-accepts a
 * reply carrying an `error` (see the `validate.ts` module header). That
 * early-accept is only sound because the consuming hook throws on a PRESENT
 * `error` BEFORE reading any other payload field. This module is that throw.
 *
 * ## Why presence, not truthiness
 *
 * `error: ''` is FALSY but PRESENT. A validator early-accepts it and therefore
 * SKIPS the success-field checks, so a hook testing `if (result.error)` sails
 * past and reads fields the validator never verified. The wire types make this
 * invisible to `tsc`: `SHARED_LIST_RESULT.items` is typed REQUIRED while
 * `error` is optional, so `result.items.map(...)` compiles and then throws
 * `Cannot read properties of undefined` at runtime — or worse, returns
 * `undefined` typed as `number` with no throw at all.
 *
 * ## Why `||` and not `??`
 *
 * `??` only replaces `null`/`undefined`, so an empty error string would produce
 * `new Error('')` — an exception with no message. `||` falls through to the
 * fallback, so an empty error string still yields readable copy.
 *
 * ## Why this is a module and not a line at each call site
 *
 * It was a line at each call site. PR #273 fixed six of them; eleven more kept
 * the truthiness test, and the two spellings sat side by side in one file for a
 * release. A predicate open-coded at N sites is typically wrong at N-1 of them
 * in the same direction — single-sourcing it makes a future divergence ONE
 * edit instead of seventeen.
 *
 * 🔴 It does NOT make picking the WRONG helper a compile error, and an earlier
 * draft of this header claimed it did. Both parameter types are weak (all
 * properties optional) and every reply payload carries `error?: string`, so the
 * weak-type check never fires. Measured with `tsc --noEmit`, BOTH of these
 * compile clean:
 *
 *   - `throwOnFailedReply` on a reply with NO `ok` field (e.g.
 *     `SHARED_GET_COUNT_RESULT`) — `!result.ok` is `!undefined`, so EVERY
 *     successful reply throws. Loud, but invisible to the type checker.
 *   - `throwOnReplyError` on a reply that HAS `ok` — the `!ok` check is
 *     silently skipped, so `{ ok: false }` with no error resolves as SUCCESS.
 *     That is exactly the hole this arc exists to close, re-opened by choosing
 *     the wrong function.
 *
 * So choose by a rule, not by the compiler: **does the reply carry `ok`?**
 * Yes → `throwOnFailedReply`. No → `throwOnReplyError`. Measured across all 17
 * sites at the time of writing: 7 payloads carry `ok?` and all 7 use
 * `throwOnFailedReply`; the other 10 lack it and all use `throwOnReplyError`.
 *
 * The truth-table test in `test/replyError.test.ts` pins both helpers'
 * behaviour independently of any call site — necessary because dropping
 * `!result.ok` survives at three call sites (`withdraw`, `delete`, `set`),
 * whose own assertions cannot reach that clause.
 *
 * 🔴 Do NOT "fix" the hazard by tightening the VALIDATOR to require a non-empty
 * error. That puts `{ requestId, error: '' }` back on the drop-and-hang path
 * this contract exists to close. The fix belongs here, at the consumer.
 */

/**
 * Throw when a reply carries an `error` — PRESENT, not truthy.
 *
 * For replies whose error path is `{ requestId, error }` with no `ok` field.
 *
 * @param result   the validated reply payload
 * @param fallback developer-facing copy used when `error` is present but empty
 */
export function throwOnReplyError(
  result: { error?: string },
  fallback: string,
): void {
  if (result.error !== undefined) {
    throw new Error(result.error || fallback);
  }
}

/**
 * Throw when a reply carries an `error` (PRESENT, not truthy) **or** fails to
 * confirm `ok`.
 *
 * For replies carrying the `{ ok, error }` pair. `ok` is optional on the wire
 * type because an error reply omits it (PR #273), so a missing `ok` on a reply
 * that also carries no `error` is itself a failure — not a success.
 *
 * @param result   the validated reply payload
 * @param fallback developer-facing copy used when `error` is absent or empty
 */
export function throwOnFailedReply(
  result: { ok?: boolean; error?: string },
  fallback: string,
): void {
  if (result.error !== undefined || !result.ok) {
    throw new Error(result.error || fallback);
  }
}
