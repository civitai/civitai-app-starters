import { BLOCK_SCOPES } from '@civitai/app-sdk/blocks';
import type { ConsentUnavailablePayload } from '@civitai/app-sdk/blocks';

/**
 * The known block-scope vocabulary as a Set, for the payload filter below.
 *
 * 🔴 A `Set` deliberately, NOT `scope in BLOCK_SCOPES` and NOT a plain object
 * lookup. `in` walks the prototype chain, so `'toString'`, `'constructor'`,
 * `'__proto__'` and 9 other inherited `Object.prototype` keys would test as
 * "known scopes" — and the input here is untrusted block-supplied text, which
 * is exactly the case that turns that into a real echo. The host hit this
 * (civitai #3733) and fixed it with an own-property test; `Set.has` has no
 * prototype-chain behaviour at all, so the whole class is structurally absent.
 *
 * Keyed on the VALUES of `BLOCK_SCOPES` (the wire strings, e.g.
 * `'ai:write:budgeted'`), not its keys (`AI_WRITE_BUDGETED`).
 */
const KNOWN_BLOCK_SCOPES: ReadonlySet<string> = new Set<string>(Object.values(BLOCK_SCOPES));

/** Whether `scope` is one of the fixed platform block scopes. */
export function isKnownBlockScope(scope: string): boolean {
  return KNOWN_BLOCK_SCOPES.has(scope);
}

/** What an un-grantable `REQUEST_CONSENT` should produce on a dev host. */
export interface UngrantableConsentNotice {
  /**
   * Whether the refusal is surfaced at all. Computed on the UNFILTERED
   * un-grantable set, so a scope outside the known vocabulary still refuses out
   * loud instead of vanishing.
   */
  notify: boolean;
  /**
   * The refused scopes safe to NAME back to the block — the un-grantable subset
   * filtered to the known vocabulary, sorted + deduped. CAN legitimately be
   * EMPTY while `notify` is true.
   */
  scopes: string[];
}

/**
 * Decide what a `REQUEST_CONSENT` that CANNOT be granted should produce.
 *
 * 🔴 THIS MIRRORS THE REAL HOST — `resolveUngrantableConsentNotice` in
 * civitai/civitai's `src/components/AppBlocks/pageBlockHostLogic.ts` (#3733).
 * Both dev hosts route through this one function so `pnpm dev` cannot disagree
 * with production about WHEN the refusal fires or WHAT it names; a dev host that
 * quietly diverges here is how the original bug survived — the developer-visible
 * failure was untestable locally, so nobody exercised it.
 *
 * TWO SETS, NOT ONE, and the split is load-bearing:
 *
 *  - `notify` is decided on the un-grantable set BEFORE any vocabulary filter.
 *    The un-grantable set is the TRIGGER as well as the payload, so filtering it
 *    would make a request for an un-grantable scope the vocabulary doesn't know
 *    produce no message at all — silently deleting the refusal in the name of
 *    sanitising it. That regression is the reason the host's own first cut was
 *    revised, and it is why a test here asserts a garbage-only request STILL
 *    notifies.
 *  - `scopes` is that set filtered to the known vocabulary, because
 *    `rawScopesHint` is whatever the block's own frame posted (markup, junk, a
 *    5 KB string) and the resulting payload is handed to block UI to render.
 *
 * Returns `notify: false` in three cases, and the second is wider than "absent
 * or not an array" — the phrasing the SDK docs used to carry:
 *
 *  1. the hint is absent or not an array;
 *  2. the hint IS an array but holds no non-empty string — `[]`, `['']`,
 *     `[1, 2]` all fall here, so a caller that dutifully passes `scopes: []`
 *     gets the same silence as one that passes nothing;
 *  3. everything requested is already granted or still grantable via consent.
 *
 * The caller then keeps the silent no-op. Without an explicit requested scope
 * proven un-grantable there is no way to tell "not confirmed yet" from "never",
 * and guessing is what produced the contradictory two-message screen.
 *
 * @param rawScopesHint the block's advisory `REQUEST_CONSENT` `payload.scopes` —
 *   UNTRUSTED, arbitrary `unknown`.
 * @param grantedScopes scopes the block's current token already carries.
 * @param grantableScopes scopes this host could still add via a consent
 *   round-trip (the host's `missingScopes`). Empty on a host that can grant
 *   nothing at all — e.g. `createLiveHost`, which has no consent UI to open.
 */
export function resolveUngrantableConsentNotice(
  rawScopesHint: unknown,
  grantedScopes: readonly string[],
  grantableScopes: readonly string[],
): UngrantableConsentNotice {
  if (!Array.isArray(rawScopesHint)) return { notify: false, scopes: [] };
  const requested = rawScopesHint.filter(
    (s): s is string => typeof s === 'string' && s.length > 0,
  );
  if (requested.length === 0) return { notify: false, scopes: [] };
  const granted = new Set<string>(grantedScopes);
  const grantable = new Set<string>(grantableScopes);
  const ungrantable = Array.from(
    new Set(requested.filter((s) => !granted.has(s) && !grantable.has(s))),
  ).sort();
  // Decision on the UNFILTERED set — see above.
  if (ungrantable.length === 0) return { notify: false, scopes: [] };
  return { notify: true, scopes: ungrantable.filter((s) => isKnownBlockScope(s)) };
}

/**
 * Build the `CONSENT_UNAVAILABLE` payload for a notice produced above.
 *
 * Exists so both dev hosts spell the wire shape ONCE — `reason` is a typed
 * literal, not a string a second call site can typo into a value no consumer
 * branches on.
 */
export function consentUnavailablePayload(
  notice: UngrantableConsentNotice,
): ConsentUnavailablePayload {
  return { reason: 'ungrantable', scopes: notice.scopes };
}
