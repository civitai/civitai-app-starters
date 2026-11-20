/**
 * Shared, PUBLIC options for the SDK's automatic consent prompt-and-retry.
 *
 * Declared here rather than beside the mechanics in
 * `internal/withConsentRetry.ts` for one structural reason: `src/index.ts` may
 * not reach a module under `internal/` (#378, enforced by
 * `tests/guards/blocks-react-entry-directory-names.test.mjs`, which follows
 * re-export edges transitively). A caller has to be able to SPELL this type in
 * its own signatures, so the type is public and the mechanics stay private.
 *
 * Every consent-gated call reaches this field through the ONE declaration here
 * — `SubmitWorkflowOptions`, `GoodPurchaseOptions` and `TipOptions` EXTEND it
 * (they have money fields of their own); `createPost()` takes it directly. A
 * predicate — or an option name — open-coded at N sites is typically wrong at
 * N-1 of them.
 *
 * 🔴 ONE FIELD, DELIBERATELY. A second, `consentTimeoutMs`, was cut in #500
 * round 1: it had no consumer outside this package and its only demonstrated
 * use was shortening the 60s wait inside a TEST. A test seam does not belong on
 * five public signatures — the test now uses fake timers instead, and the wait
 * bound is the non-public `CONSENT_GRANT_WAIT_MS`. Adding a knob here commits
 * the package to it forever; do not add one without a caller that needs it.
 */
export interface ConsentRetryOptions {
  /**
   * Whether a consent-gated failure should automatically open the host's
   * consent dialog and, on grant, retry the call ONCE.
   *
   * **Defaults to `true`** — the good behaviour is the default one. Set `false`
   * to get the pre-1.0 behaviour: the original error is re-thrown unchanged
   * and nothing is prompted.
   *
   * 🔴 THE RETRY REUSES THE FIRST ATTEMPT'S IDEMPOTENCY KEY on every money path
   * that has one (`submit`, `purchase`, `tip`). That is what makes it safe: a
   * retry with a FRESH key is a SECOND reservation against the viewer's Buzz.
   * See `internal/withConsentRetry.ts`.
   */
  autoRequestConsent?: boolean;
}
