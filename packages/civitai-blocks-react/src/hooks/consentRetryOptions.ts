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
 * Every consent-gated call reaches these two fields through this ONE
 * declaration — `SubmitWorkflowOptions`, `GoodPurchaseOptions` and `TipOptions`
 * EXTEND it (they have money fields of their own); `estimate()` and
 * `createPost()` take it directly. A predicate — or an option name — open-coded
 * at N sites is typically wrong at N-1 of them.
 */
export interface ConsentRetryOptions {
  /**
   * Whether a consent-gated failure should automatically open the host's
   * consent dialog and, on grant, retry the call ONCE.
   *
   * **Defaults to `true`** — the good behaviour is the default one. Set `false`
   * to get the pre-0.61 behaviour: the original error is re-thrown unchanged
   * and nothing is prompted.
   *
   * 🔴 THE RETRY REUSES THE FIRST ATTEMPT'S IDEMPOTENCY KEY on every money path
   * that has one (`submit`, `purchase`, `tip`). That is what makes it safe: a
   * retry with a FRESH key is a SECOND reservation against the viewer's Buzz.
   * See `internal/withConsentRetry.ts`.
   */
  autoRequestConsent?: boolean;
  /**
   * How long to wait for the viewer to answer the consent dialog before giving
   * up and re-throwing the ORIGINAL error. Defaults to 60 000 ms
   * (`CONSENT_GRANT_WAIT_MS`).
   *
   * ⚠️ Deliberately NOT the package's 10-minute `HUMAN_INTERACTION_TIMEOUT_MS`.
   * `REQUEST_CONSENT` is fire-and-forget — the host sends NOTHING when the
   * viewer dismisses the dialog — so a dismissal and "hasn't clicked yet" are
   * the same silence, and this bound is what a dismissal costs the caller in
   * pending-promise time. See `internal/withConsentRetry.ts` for the full
   * reasoning.
   *
   * A grant resolves the wait the instant the host pushes the re-minted token,
   * and a `CONSENT_UNAVAILABLE` refusal resolves it immediately too — the bound
   * only ever bites on silence.
   */
  consentTimeoutMs?: number;
}
