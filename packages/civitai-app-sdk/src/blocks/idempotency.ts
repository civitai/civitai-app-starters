/**
 * The IDEMPOTENCY-KEY FORMAT the host enforces on every money POST — **the only
 * site in this repository that spells this rule**.
 *
 * Sibling of `./appStorageLimits.ts`, for the same reason: the rule lives in the
 * host, the SDK cannot change it, and a hand-copied regex at each call site is
 * how the copies come to agree with each other and disagree with the host.
 *
 * ## THE MOTIVATING FAILURE (2026-10-02)
 *
 * A character-sheet block composed its key as `sheetId:panelId:nonce` — a
 * perfectly reasonable-looking composite id. It passed **201 local tests**, the
 * dev harness and review. Every save in production failed:
 *
 * ```json
 * { "code": "invalid_format", "format": "regex",
 *   "pattern": "/^[A-Za-z0-9_-]{1,64}$/",
 *   "path": ["idempotencyKey"],
 *   "message": "Invalid string: must match pattern /^[A-Za-z0-9_-]{1,64}$/" }
 * ```
 *
 * `BAD_REQUEST` / httpStatus 400 on path `blocks.submitWorkflow`.
 *
 * 🔴 **THE REASON IT GOT THAT FAR: NOTHING IN THIS REPOSITORY MODELLED THE
 * RULE.** The SDK's own key GENERATOR was tested against the charset, but a
 * `crypto.randomUUID()` and the `idem-<base36>` fallback both conform and
 * always did — so the one guard that existed covered the half that cannot fail,
 * while a CALLER-SUPPLIED key went through unexamined at every hook, and the dev
 * mock host had no concept of `idempotencyKey` at all.
 *
 * ## PROVENANCE — measured, not assumed
 *
 * Read from the `civitai/civitai` working tree on **2026-10-02**, file
 * `src/server/utils/block-gen-idempotency.ts` line 77:
 *
 * ```ts
 * export const BLOCK_IDEMPOTENCY_KEY_REGEX = /^[A-Za-z0-9_-]{1,64}$/;
 * ```
 *
 * Enforced at **four** host entry points, which is why no single endpoint fix
 * would have closed it:
 *
 * | entry point | file:line | optional? |
 * |---|---|---|
 * | tRPC `blocks.submitWorkflow` (the one that 400'd) | `src/server/routers/blocks.router.ts:6227` | `.optional()` |
 * | REST `POST /api/v1/blocks/workflows/submit`       | `src/pages/api/v1/blocks/workflows/submit.ts:135` | **REQUIRED** |
 * | REST `POST /api/v1/blocks/goods/purchase`         | `src/pages/api/v1/blocks/goods/purchase.ts:79`  | `.optional()` |
 * | REST `POST /api/v1/blocks/tip`                    | `src/pages/api/v1/blocks/tip.ts:88`             | `.optional()` |
 *
 * 🔴 **THE TWO SURFACES ANSWER DIFFERENT ERROR ENVELOPES — do not quote one for
 * the other.** The tRPC/bridge path (the one the block→host `SUBMIT_WORKFLOW`
 * message takes, and the one that produced the report above) answers the
 * `invalid_format` object shown earlier, which reaches a block as a host
 * `errorSnapshot`. The three REST routes answer, verbatim and all three
 * identically (verified 2026-10-02 at `submit.ts:160`, `tip.ts:127`,
 * `goods/purchase.ts:117`):
 *
 * ```json
 * { "error": "Invalid request body", "details": <zod flatten()> }
 * ```
 *
 * also with HTTP 400. So there is no single "the 400 payload" for this field —
 * which path you are on decides it.
 *
 * Re-derive rather than trusting this comment:
 *
 * ```sh
 * gh api repos/civitai/civitai/contents/src/server/utils/block-gen-idempotency.ts \
 *   --jq '.content' | base64 -d | grep -n 'BLOCK_IDEMPOTENCY_KEY_REGEX'
 * ```
 *
 * ## 🔴 WHY THE COLON BAN IS A CORRECTNESS INVARIANT, NOT COSMETIC
 *
 * The host's own comment calls the charset "colon-free", and two of its redis
 * key builders depend on that being true:
 *
 *   - `block-gen-idempotency.ts` composes `<prefix>:<userId>:<appBlockId>:<key>`
 *     and documents it as **INJECTIVE** *because* "`idempotencyKey` is
 *     charset-restricted … (colon-free). So no two distinct (user, app, key)
 *     triples can ever collide on the delimiter."
 *   - `block-tip-rate-limit.ts:215` composes the tip idempotency key the same
 *     way, with the same stated justification.
 *
 * A colon-bearing key therefore does not merely fail a cosmetic check — it would
 * make those keys **non-injective**, letting one app's slot alias another's. The
 * tip module spells out the harm in that event: app B "would then REPLAY app A's
 * cached response body verbatim, LEARNING A's tip recipient and amount, while
 * B's own tip silently never happens." The 400 is what prevents it.
 *
 * Separately, the key is substringed into the orchestrator `externalId`
 * (`blk<NN><appBlockId><key>`), whose own contract is `^[A-Za-z0-9_-]+$` with a
 * **128**-char ceiling — a colon is outside that charset too. The host's source
 * records that an earlier revision assumed a colon-delimited id and that it
 * "would have 400'd every keyed block generation submit."
 *
 * ## 🔴 WHERE THE 64 COMES FROM
 *
 * It is DERIVED, not chosen. The host composes the orchestrator `externalId` as
 * `blk<NN><appBlockId><key>`; `ORCHESTRATOR_EXTERNAL_ID_MAX` is 128. 64 keeps the
 * worst-case composition inside 128. Do not "relax" it here — the SDK is not the
 * authority, and a key this module accepts but the host rejects is the exact
 * defect above, reintroduced.
 *
 * ## 🔴 REFUSE, NEVER REWRITE
 *
 * Nothing in this module sanitises, truncates or normalises a key, and no
 * consumer may. An idempotency key is an **identity**: silently rewriting a
 * caller's key breaks the property the key exists to provide — two distinct
 * logical submits could collapse onto one slot (one charge for two intended
 * operations), or a retry could be rewritten differently from the first attempt
 * and mint a SECOND reservation for one logical operation. Both are money bugs,
 * and both are quieter than a rejection. A malformed key is a defect in the
 * calling block's code; the only safe response is to refuse it loudly, before
 * anything is sent.
 */

/**
 * The host's charset + length rule for a money-POST idempotency key, vendored
 * verbatim from `block-gen-idempotency.ts:77`.
 *
 * 🔴 NO `g` FLAG, DELIBERATELY. A `g`-flagged regex carries `lastIndex` across
 * calls, so repeated `.test()` on the SAME instance alternates true/false for an
 * identical input — which on this surface would mean a key accepted on one
 * submit and refused on its retry.
 */
export const BLOCK_IDEMPOTENCY_KEY_REGEX = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * The host's length ceiling, named so a caller composing a key can budget
 * against it instead of rediscovering 64 from a rejection.
 *
 * Kept as its own constant rather than parsed back out of the regex: this is the
 * number a caller does arithmetic with, and the two are pinned to each other by
 * `blockIdempotencyKeyRejection`'s own tests.
 */
export const BLOCK_IDEMPOTENCY_KEY_MAX_LENGTH = 64;

/**
 * Does `value` clear the host's rule?
 *
 * Returns `false` for a non-string (including `null`/`undefined`) rather than
 * throwing: callers reach this with untrusted input from a block's own code, and
 * a type-level `string` is not a runtime guarantee at a package boundary.
 *
 * 🔴 This is the predicate EVERY consumer must call. Re-spelling the regex at a
 * call site is what produced the defect in this module's header.
 *
 * 🔴 RETURNS `boolean`, NOT A TYPE PREDICATE (`value is string`), DELIBERATELY.
 * A predicate signature narrows the FALSE branch to `Exclude<string, string>` =
 * `never` for an already-`string` argument, which silently makes the rejection
 * path below uncompilable — and in other callers would make a legitimate
 * else-branch look like dead code. The narrowing bought nothing: no caller needs
 * `unknown` → `string` narrowing from this function.
 */
export function isValidBlockIdempotencyKey(value: unknown): boolean {
  return typeof value === 'string' && BLOCK_IDEMPOTENCY_KEY_REGEX.test(value);
}

/**
 * A developer-facing explanation of WHY `value` was refused, or `null` when it
 * is valid.
 *
 * 🔴 DEVELOPER-FACING, NEVER VIEWER-FACING. A malformed idempotency key is a bug
 * in the block's own code — no retry fixes it and no viewer can act on it, so
 * rendering this string into UI tells the wrong person. It names the offending
 * value because that is the single most useful fact for the person who has to
 * fix it, and because the key is the block's own construction, not viewer data.
 *
 * The returned text is not a contract — branch on
 * {@link isValidBlockIdempotencyKey}, never on this wording.
 *
 * Reasons are reported SPECIFICALLY rather than as one generic sentence: "it has
 * a colon" and "it is 71 characters" lead to different fixes, and the colon case
 * is the one that looks most like valid input.
 */
export function blockIdempotencyKeyRejection(value: unknown): string | null {
  if (typeof value !== 'string') {
    return `the idempotency key must be a string, got ${value === null ? 'null' : typeof value}`;
  }
  if (isValidBlockIdempotencyKey(value)) return null;

  const why: string[] = [];
  if (value.length === 0) {
    why.push('it is empty');
  } else if (value.length > BLOCK_IDEMPOTENCY_KEY_MAX_LENGTH) {
    why.push(`it is ${value.length} characters (the host allows at most ${BLOCK_IDEMPOTENCY_KEY_MAX_LENGTH})`);
  }
  // Report the offending characters, de-duplicated and in first-appearance
  // order, so a key with four colons does not print four identical complaints.
  const offending = [...new Set(value.split('').filter((ch) => !/[A-Za-z0-9_-]/.test(ch)))];
  if (offending.length > 0) {
    const shown = offending.map((ch) => JSON.stringify(ch)).join(', ');
    why.push(
      `it contains ${offending.length === 1 ? 'the character' : 'the characters'} ${shown}` +
        ` (the host allows letters, digits, underscore and hyphen only` +
        (offending.includes(':')
          ? // Called out by name: a colon is BOTH the most natural delimiter for a
            // composite key and the one character the host's redis-key injectivity
            // argument depends on excluding. See this module's header.
            `; a colon is specifically excluded because the host composes its` +
            ` per-(user, app, key) rate-limit and dedupe keys with ':' as the delimiter`
          : '') +
        `)`,
    );
  }
  // Unreachable while the regex and this function agree — but a regex change
  // that this function does not mirror must not produce an EMPTY reason, which
  // would read as "refused for no stated cause".
  if (why.length === 0) {
    why.push(`it does not match the host's required pattern ${String(BLOCK_IDEMPOTENCY_KEY_REGEX)}`);
  }

  return `${why.join(', and ')}. Offending value: ${JSON.stringify(value)}`;
}
