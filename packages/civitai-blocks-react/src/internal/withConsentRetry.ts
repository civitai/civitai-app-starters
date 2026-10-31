import type { ConsentUnavailablePayload } from '@civitai/app-sdk/blocks';

import type { ConsentRetryOptions } from '../hooks/consentRetryOptions.js';
import type { BlockTransport } from '../transport/transport.js';
import { subscribeTyped } from '../transport/transport.js';
import { armConsentRefusalLatch, readConsentRefusalLatch } from './consentRefusalLatch.js';

/**
 * THE ONE PLACE consent prompt-and-retry lives.
 *
 * ## The problem it exists to remove
 *
 * A block calls a capability whose consent-gated scope its token was minted
 * without. The call fails. Before this module every hook re-threw, and the app
 * had to write the prompt-then-retry dance itself:
 *
 * ```ts
 * try {
 *   await submit(body);
 * } catch {
 *   requestConsent({ scopes: ['ai:write:budgeted'] });
 *   // …now watch useBlockToken().scopes, and retry — with the SAME key.
 * }
 * ```
 *
 * Almost nobody wrote it — so a working app looked broken. This module makes
 * prompt-and-retry the DEFAULT, and every consent-gated hook routes through it
 * rather than open-coding its own copy (a predicate duplicated at N call sites
 * is typically wrong at N-1 of them, in the same direction).
 *
 * ## 🔴 THE MONEY RULE — READ THIS BEFORE CHANGING ANYTHING HERE
 *
 * `withConsentRetry` RE-INVOKES A CALLER-SUPPLIED CLOSURE. It does not build
 * the request, and it deliberately cannot: the idempotency key is minted by the
 * caller BEFORE the first attempt and captured in that closure, so both
 * attempts carry the SAME value. `useBuzzWorkflow`'s own docs are explicit —
 * *"A retry is a SECOND reservation unless you reuse the same idempotencyKey…
 * `submit()` mints a fresh key per call by default, so an automatic retry
 * double-reserves."* A version of this helper that took `(body, options)` and
 * re-sent the message itself would mint a second key and double-charge a real
 * person.
 *
 * So the contract for every call site is one line long: **mint the key outside
 * the closure.** `test/withConsentRetry.test.tsx` asserts the literal key value
 * on BOTH wire calls, and that assertion is mutation-checked.
 *
 * ## The predicate: STRUCTURAL, not a string match
 *
 * "Was this a consent failure?" cannot be answered from the error. Almost every
 * bridge in this package reports host-side failure as a FREE-TEXT string the
 * host forwards verbatim (`BUZZ_BALANCE_RESULT`, `PUBLISH_RESULT`,
 * `APP_WORKFLOWS_RESULT`, … all say so in `messages.ts`), so a
 * `/insufficient.scope/i` test would be a guess about server copy that can
 * change without notice — the "spelled rather than structural" guard shape.
 *
 * The test used instead is a property of the TOKEN, read at the moment of
 * failure: **does the token still lack a scope this operation requires?** That
 * is true by definition for every genuine consent failure (a consent gate IS an
 * absent scope) and false for the overwhelming majority of everything else — a
 * rate limit, a 5xx, a malformed body all happen while the token HOLDS the
 * scope, so those re-throw untouched with no prompt and no retry.
 *
 * ⚠️ It is a necessary condition, not a sufficient one. A NON-consent failure
 * that happens while the token is ALSO missing the scope (a 500 on a submit
 * from an un-granted token) will prompt and retry. That is the deliberate
 * direction to be wrong in: the call needed that scope anyway, so the prompt is
 * correct, and the retry is same-key. The inverse — string-matching, and so
 * silently failing to prompt when a host reworded its error — is the failure
 * this shape cannot have.
 *
 * ## The three hard rules
 *
 *  1. **EXACTLY ONE RETRY.** There is no loop, and adding one would be a defect
 *     rather than a tuning choice: a second consent failure means the grant did
 *     not fix the problem, so a third attempt is a third money reservation for
 *     nothing. The second failure propagates to the caller verbatim.
 *  2. **NEVER RETRY THROUGH A `CONSENT_UNAVAILABLE` FOR THE SCOPES IT NAMED.**
 *     That push means the scope was clamped or withheld at mint and NO consent
 *     round-trip in this environment can ever add it, so a retry is a guaranteed
 *     second failure. Read via `readConsentRefusalLatch` — the existing buffer —
 *     rather than a second subscription, so there is one source of truth for
 *     "has the host refused". Checked BEFORE the prompt, and again as the wait's
 *     own losing arm (a refusal that arrives in answer to THIS prompt).
 *
 *     🔴 **THE LATCH READ IS SCOPE-AWARE, NOT TRANSPORT-GLOBAL — see
 *     {@link isRefusalFinalFor}.** The latch is one slot per transport, so
 *     treating any refusal as final disabled prompt-and-retry for EVERY hook and
 *     EVERY scope until the token rotated (~13 min). The justification does not
 *     reach that far: "clamped at mint" is a claim about the REFUSED scopes, and
 *     a retry for a scope the host never refused is not a guaranteed second
 *     failure.
 *
 *     ⚠️ THE WAIT'S LOSING ARM IS NOT SCOPE-CHECKED, deliberately. A
 *     `CONSENT_UNAVAILABLE` arriving *during* the wait ends it whatever it names.
 *     The prompt that opened this wait asked for exactly `missing`, so in
 *     practice a refusal answering it is about those scopes; the only way to be
 *     wrong is a concurrent prompt for a DIFFERENT scope set being refused at the
 *     same moment, and being wrong there costs one needlessly-surfaced original
 *     error — never a spend, never a duplicate write. Scope-checking it would add
 *     a way to be wrong in the OTHER direction (waiting on past a real refusal),
 *     which is the expensive one.
 *  3. **NEVER RETRY AN ABORT, OR A CALLER THAT WENT AWAY DURING THE WAIT.** An
 *     `AbortError` means the caller's component unmounted or its own bound
 *     elapsed — work that was cancelled on purpose must not be silently
 *     resurrected, least of all on a money path.
 *
 *     🔴 **AN UNMOUNT LANDING IN THE 60s WAIT IS THE SAME RULE IN THE TIME
 *     AXIS, and it needs its own check** (`isActive`, below): there is no
 *     in-flight request to abort at that point, so nothing produces an
 *     `AbortError` and the grant drove a second `attempt()` against a component
 *     that no longer exists. On `useTip` that meant a transfer left the viewer's
 *     balance with no UI left to report it — and with the hook's `inFlight` set
 *     already cleared, that second POST was not even abortable.
 *  4. **NEVER RETRY A VIEWER REFUSAL, A SIGN-IN REQUIREMENT, OR A KEYLESS
 *     BRIDGE'S TIMEOUT.** `CreatePostError` and `CollectionFollowError` both
 *     carry `declined === true` when the person dismissed the host's own
 *     per-action confirm — an answer, not a failure; re-opening the dialog they
 *     just closed is nagging. `CreatePostError` also carries
 *     `signInRequired === true`, which is un-retryable for a stronger reason: no
 *     amount of scope granting gives a signed-OUT viewer a session, so the
 *     dialog is one the viewer cannot act on at all and `useRequestSignIn()` is
 *     what they need — 60s sooner. The same two classes carry
 *     `timedOut === true`, and `CreatePostError.timedOut`'s own docs say why it
 *     must not be retried:
 *     *"the write may have LANDED and only the reply failed to arrive — and here
 *     the write is a PUBLIC POST under the viewer's name… never retry
 *     automatically, which is how a duplicate post happens."* Both are keyed on
 *     the properties those classes already single-source, so a third such error
 *     joins the rule by declaring them.
 *
 *     🔴 **THE RULE `timedOut` ENCODES, IN ONE SENTENCE: a timeout is retryable
 *     IFF the call carries an idempotency key.** That is a mechanical property,
 *     not a preference. A timed-out request may have landed server-side; with a
 *     key the server collapses the re-send into the first result, so the retry
 *     is a REPLAY. Without one it is a genuine second write — a second public
 *     post, a second follow. So a hook stamps `timedOut` exactly when its wire
 *     message has no `idempotencyKey` field: `CREATE_POST_FROM_APP` and the
 *     collection-follow bridge do, and they stamp it.
 *
 *     🔴 **WHERE A HOOK STAMPS IT IS PART OF THE RULE, NOT AN IMPLEMENTATION
 *     DETAIL — THE STAMP MUST BE INSIDE THE `attempt` CLOSURE.** Until #500
 *     round 2 `useCreatePostFromApp` applied it in the catch WRAPPED AROUND this
 *     helper, so the raw `RequestTimeoutError` arrived here carrying neither
 *     flag, `isCallerMarkedFinal` returned false, and a `posts:write:self`-less
 *     token got a prompt and a SECOND POST. Rule 4 was unreachable for the one
 *     bridge it was written for, and `flags.timedOut === true` was dead code:
 *     deleting that arm left the whole suite green. A stamp applied outside the
 *     closure is invisible to every rule in this module.
 *
 *     The three money paths — `useBuzzWorkflow.submit`, `useGoodPurchase` and
 *     `useTip` — all mint a key ABOVE the retry and hand the same value to both
 *     attempts, so none of them stamps it and all three retry a timeout. Their
 *     own docs prescribe that same-key retry as the recovery. (`useTip` stamped
 *     it until #500 round 1, which made it the only keyed hook that did not
 *     retry; that inconsistency is what this paragraph exists to have settled.)
 *
 *     ⚠️ An UNMOUNT is a different thing and is covered by rule 3, not this one:
 *     `useTip` and `useGoodPurchase` both name their unmount abort `AbortError`
 *     and leave the bound-elapsed timeout a plain `Error`, so the two arms reach
 *     opposite outcomes here.
 *
 * ## What it CANNOT detect: a scope absent from the MANIFEST
 *
 * A scope the app never declared can never be granted either, and detecting
 * that BEFORE the first attempt is not possible from inside a block today: the
 * manifest is a build-time artifact, `BlockSnapshot` carries no `scopes`
 * declaration (only the token's GRANTED set), and no bridge message exposes
 * one. What covers it at runtime is rule 2 — the host computes its grantable
 * set from the manifest, so an undeclared scope is un-grantable and comes back
 * as `CONSENT_UNAVAILABLE`, which stops the retry. The cost is that this is
 * paid ONE request/refusal round-trip late rather than pre-flight. Making it
 * pre-flight needs the manifest on the wire, which is a host change.
 */

/**
 * How long to wait for the viewer to answer the consent dialog.
 *
 * 🔴 DELIBERATELY NOT `HUMAN_INTERACTION_TIMEOUT_MS` (10 min), and the
 * difference is not a preference — it is a property of the message. Every OTHER
 * human-gated request in this package is a REQUEST the host REPLIES to, so a
 * dismissal arrives as an answer and the 10-minute ceiling only ever bounds a
 * dialog nobody touched. `REQUEST_CONSENT` is FIRE-AND-FORGET: it carries no
 * `requestId`, the host sends nothing on dismiss, and `CONSENT_UNAVAILABLE`
 * covers only the can-NEVER-be-granted case. So "the viewer closed the dialog"
 * and "the viewer has not clicked yet" are THE SAME OBSERVABLE — silence — and
 * whatever this number is, a dismissal costs the caller exactly that long with a
 * promise still pending. At 10 minutes an app that showed a spinner shows it for
 * ten minutes, which is a second way to look broken.
 *
 * 60s is sized for the thing actually being waited on: a person noticing a modal
 * the host just opened and pressing a button in it. Past that, the ORIGINAL
 * error surfaces, the app is responsive again, and a viewer who grants late
 * loses nothing — their next call sees the scope on the token and never enters
 * this path at all.
 *
 * 🔴 NOT CONFIGURABLE, and that is a decision rather than an omission. A public
 * `consentTimeoutMs` shipped on five signatures in the first draft of #500 with
 * no consumer outside this package — its only demonstrated use was shortening
 * this wait inside one test, which fake timers do without widening the API. If
 * a real caller ever needs a different bound, that is the moment to add one.
 */
export const CONSENT_GRANT_WAIT_MS = 60_000;

/**
 * Post a `REQUEST_CONSENT` with a scopes hint.
 *
 * 🔴 Single-sourced with {@link useRequestConsent}, which calls straight into
 * this function. Two spellings of "arm the latch, then send" is exactly the
 * shape that lets one of them forget the arming — and a `CONSENT_UNAVAILABLE`
 * with no listener at the instant it lands falls through the transport's no-op
 * tail and is gone forever (see `consentRefusalLatch.ts`).
 */
export function sendRequestConsent(
  transport: BlockTransport,
  payload?: { scopes?: string[] },
): void {
  // BEFORE the send, always. See the module header of `consentRefusalLatch.ts`.
  armConsentRefusalLatch(transport);
  transport.sendMessage({
    type: 'REQUEST_CONSENT',
    ...(payload ? { payload } : {}),
  });
}

/**
 * Which of `required` the transport's CURRENT token does not carry.
 *
 * Reads the live snapshot every call rather than closing over a value: a
 * `TOKEN_REFRESH` can land at any moment, and the whole point of the wait below
 * is that this answer CHANGES.
 */
export function missingScopes(
  transport: BlockTransport,
  required: readonly string[],
): string[] {
  const held = new Set(transport.getSnapshot().token.scopes);
  return required.filter((scope) => !held.has(scope));
}

/** An error the caller cancelled on purpose — never resurrect one. */
function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

/**
 * An error a hook has explicitly marked un-retryable — the viewer DISMISSED a
 * host confirm (`declined`), there is no session to grant anything to
 * (`signInRequired`), or the bridge timed out with no idempotency key to dedupe a
 * second attempt (`timedOut`). See rule 4: `timedOut` means KEYLESS, not merely
 * "timed out" — a keyed hook's timeout deliberately carries neither flag and IS
 * retried, because the same key makes the re-send a replay.
 *
 * A duck-typed property test rather than `instanceof`, deliberately: the classes
 * that carry these (`CreatePostError`, `CollectionFollowError`) live in
 * `hooks/`, and importing them here to narrow would put an import cycle between
 * the helper and the hooks that call it for no behavioural gain. `=== true`, not
 * truthiness, so nothing accidental qualifies — and a `RequestTimeoutError`,
 * which declares none of these fields, is deliberately NOT caught here: a hook
 * whose timeout is final must say so on its OWN error class, inside the `attempt`
 * closure (rule 4).
 *
 * ⚠️ NOT every un-actionable refusal is listed, and that is deliberate: the
 * `'no images to post'` PAYLOAD refusal has no flag and so still prompts. It is
 * the module header's accepted trade-off — a payload the host rejected is not a
 * property of the token, and the structural predicate cannot tell the two apart
 * without a string match. The three flags here are token/session properties the
 * hook classes already single-source.
 */
function isCallerMarkedFinal(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const flags = err as {
    declined?: unknown;
    timedOut?: unknown;
    signInRequired?: unknown;
  };
  return (
    flags.declined === true || flags.timedOut === true || flags.signInRequired === true
  );
}

/**
 * Does a latched `CONSENT_UNAVAILABLE` make THIS operation's retry pointless?
 *
 * Rule 2, narrowed from "any refusal" to "a refusal about a scope this call
 * needs". Two arms, and the second is the fail-safe one:
 *
 *  - The payload names a NON-EMPTY scope set DISJOINT from `requiredScopes` ⇒
 *    the host refused something else. Not final here. This is the arm that stops
 *    one refusal from switching the feature off across every hook and scope for
 *    the ~13 minutes until the token rotates.
 *  - Anything else — an EMPTY list, or one that intersects `requiredScopes` ⇒
 *    final, exactly as before.
 *
 * 🔴 THE EMPTY CASE MUST STAY FINAL, and `@civitai/app-sdk`'s own
 * `ConsentUnavailablePayload` docs are why: *"`scopes` MAY BE EMPTY… Treat the
 * message itself as the signal and `scopes` as an advisory detail for copy."*
 * The host decides to refuse on the UNFILTERED requested set and then filters the
 * echo to the known `BLOCK_SCOPES` vocabulary, so `[]` means "we are not telling
 * you which", never "none". Reading it as "no scope was refused" would invert the
 * guard on precisely the payload that carries the least information.
 */
function isRefusalFinalFor(
  refusal: ConsentUnavailablePayload,
  requiredScopes: readonly string[],
): boolean {
  const refused = refusal.scopes;
  if (!Array.isArray(refused) || refused.length === 0) return true;
  return requiredScopes.some((scope) => refused.includes(scope));
}

/**
 * Prompt for `missing`, then resolve `true` once the token carries all of them.
 *
 * Resolves `false` — meaning "give up, re-throw the caller's original error" —
 * on either losing arm:
 *   - a `CONSENT_UNAVAILABLE` push (rule 2, answering THIS prompt);
 *   - `timeoutMs` elapsing with no answer (the viewer never engaged).
 *
 * Listeners are installed BEFORE the message goes out. The dev hosts reply on a
 * `setTimeout(0)` and the real host is a full round-trip away, but a host that
 * answered synchronously would otherwise have its answer dropped, and that is a
 * race nobody would reproduce locally.
 */
function awaitConsentGrant(
  transport: BlockTransport,
  missing: readonly string[],
  timeoutMs: number,
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const teardown: Array<() => void> = [];
    let settled = false;
    const settle = (granted: boolean): void => {
      if (settled) return;
      settled = true;
      for (const fn of teardown) fn();
      resolve(granted);
    };

    teardown.push(
      transport.subscribe(() => {
        if (missingScopes(transport, missing).length === 0) settle(true);
      }),
    );
    teardown.push(subscribeTyped(transport, 'CONSENT_UNAVAILABLE', () => settle(false)));
    const timer = setTimeout(() => settle(false), timeoutMs);
    teardown.push(() => clearTimeout(timer));

    // 🔴 The hint MUST be non-empty and hold real scope names or the host sends
    // no refusal at all (`resolveUngrantableConsentNotice` returns `notify:
    // false` for `undefined`, a non-array, `[]`, `['']` and `[1, 2]` alike). A
    // silent host here would mean rule 2's losing arm never fires and this wait
    // could only ever end at the timeout. `missing` is non-empty by the caller's
    // guard, and its members are the hook's own `BLOCK_SCOPES` constants.
    sendRequestConsent(transport, { scopes: [...missing] });

    // The grant could already have landed between the failure and this line
    // (a concurrent call's prompt, say). `subscribe` only fires on CHANGE.
    if (missingScopes(transport, missing).length === 0) settle(true);
  });
}

/**
 * In-flight consent waits, keyed by transport instance and then by the exact
 * scope set being waited on.
 *
 * 🔴 WHY: N CONCURRENT CALLERS ARE N HOOK INSTANCES, so a per-hook `pending` /
 * `loading` gate defuses nothing. A feed of tip buttons tapped three times posted
 * three `REQUEST_CONSENT`s — three host dialogs for one permission — and held
 * three independent 60s waits. The scope set is the natural key: two callers
 * waiting on the same missing scopes are waiting for literally the same event, so
 * one prompt and one wait answer both.
 *
 * 🔴 WHAT THIS MUST NOT COLLAPSE IS THE ATTEMPTS. Only the WAIT is shared. Each
 * caller still runs its own `attempt()` closure carrying its own idempotency key,
 * because three tips are three transfers — sharing a key across them would
 * collapse three payments into one. Pinned in `test/withConsentRetry.test.tsx`
 * ("each keeps its OWN key").
 *
 * A `WeakMap` on the transport so a `resetTransport()` in tests strands nothing,
 * and entries are deleted as they settle so a later call gets a fresh prompt
 * rather than a resolved promise from a previous round.
 */
const inFlightConsentWaits = new WeakMap<BlockTransport, Map<string, Promise<boolean>>>();

/**
 * {@link awaitConsentGrant}, de-duplicated across concurrent callers waiting on
 * the SAME missing scope set. See {@link inFlightConsentWaits}.
 */
function awaitConsentGrantShared(
  transport: BlockTransport,
  missing: readonly string[],
  timeoutMs: number,
): Promise<boolean> {
  // Sorted, so two callers listing the same scopes in a different order share.
  const key = [...missing].sort().join(' ');
  let byScopeSet = inFlightConsentWaits.get(transport);
  if (!byScopeSet) {
    byScopeSet = new Map();
    inFlightConsentWaits.set(transport, byScopeSet);
  }
  const existing = byScopeSet.get(key);
  if (existing) return existing;

  const wait: Promise<boolean> = awaitConsentGrant(transport, missing, timeoutMs).finally(
    () => {
      // Identity-checked: never evict a wait some later call already installed.
      if (byScopeSet.get(key) === wait) byScopeSet.delete(key);
    },
  );
  byScopeSet.set(key, wait);
  return wait;
}

/**
 * Run `attempt`; on a consent-shaped failure, prompt the viewer and run it
 * EXACTLY ONCE more.
 *
 * @param transport the singleton transport (snapshot + consent channel).
 * @param requiredScopes the consent-gated scopes this operation needs. MUST be
 *   real {@link BLOCK_SCOPES} values — they are sent to the host as the
 *   `REQUEST_CONSENT` hint, which is silently ignored unless it holds at least
 *   one non-empty recognised name. An empty array disables the behaviour.
 * @param attempt the operation, re-invoked verbatim on retry. 🔴 Mint any
 *   idempotency key OUTSIDE this closure — see the module header. 🔴 And stamp
 *   any final-error flag (`timedOut`, `declined`, `signInRequired`) INSIDE it,
 *   or rule 4 cannot see it.
 * @param options caller opt-out. One field, `autoRequestConsent` — the 60s wait
 *   is NOT configurable, see {@link CONSENT_GRANT_WAIT_MS}.
 * @param isActive rule 3 in the time axis — read IMMEDIATELY BEFORE the retry,
 *   never cached. A hook passes `() => mountedRef.current`; returning `false`
 *   re-throws the original error instead of re-invoking `attempt`. Optional so a
 *   caller with no component to outlive (a plain function, a test) needs nothing,
 *   and absent means "always active" — the pre-#500-round-2 behaviour.
 */
export async function withConsentRetry<T>(
  transport: BlockTransport,
  requiredScopes: readonly string[],
  attempt: () => Promise<T>,
  options?: ConsentRetryOptions,
  isActive?: () => boolean,
): Promise<T> {
  // `=== false`, not `!options?.autoRequestConsent`: the default is ON, so an
  // absent option and an explicit `true` must behave identically.
  if (options?.autoRequestConsent === false || requiredScopes.length === 0) {
    return attempt();
  }

  try {
    return await attempt();
  } catch (err) {
    // Rules 3 and 4 — the outcomes a retry must not reopen.
    if (isAbort(err) || isCallerMarkedFinal(err)) throw err;

    // 🔴 THE PREDICATE IS ONLY SOUND ONCE `BLOCK_INIT` HAS LANDED. Before it the
    // snapshot is all sentinel empties, so `token.scopes` is `[]` and
    // `missingScopes` reports EVERY required scope as absent — which classifies
    // any pre-init failure (typically the request's own bound elapsing while the
    // message sits in the transport's outbound queue) as consent-shaped. Two
    // costs, and the second is the one a viewer sees: the caller waits the full
    // 60s ON TOP OF its own timeout, and the `REQUEST_CONSENT` is itself QUEUED,
    // so it FLUSHES when init finally lands — a consent dialog opening for a call
    // that failed minutes ago, which nobody asked for.
    //
    // Read at FAILURE time rather than at entry, deliberately: init may well have
    // landed during the attempt, and in that case the token is real and the
    // prompt is legitimate.
    if (!transport.getSnapshot().ready) throw err;

    // The structural predicate. Nothing is missing ⇒ not a consent failure ⇒
    // behaviour is exactly what it was before this module existed.
    const missing = missingScopes(transport, requiredScopes);
    if (missing.length === 0) throw err;

    // Rule 2, first half: a refusal ALREADY on record, for a scope THIS call
    // needs (see `isRefusalFinalFor`). Arm first so the read is against an
    // installed latch (arming is idempotent per transport instance, and only
    // drops state belonging to a transport that is no longer current).
    armConsentRefusalLatch(transport);
    const refusal = readConsentRefusalLatch(transport);
    if (refusal !== null && isRefusalFinalFor(refusal, requiredScopes)) throw err;

    const granted = await awaitConsentGrantShared(
      transport,
      missing,
      CONSENT_GRANT_WAIT_MS,
    );
    // Refused or abandoned — the CALLER'S original error is what surfaces, not
    // a synthetic one about consent. It is the accurate description of what
    // went wrong with the thing they asked for.
    if (!granted) throw err;

    // 🔴 RULE 3, IN THE TIME AXIS — CHECKED HERE, IMMEDIATELY BEFORE THE ONLY
    // LINE THAT COSTS MONEY, NOT EARLIER. The 60s wait is long enough for the
    // caller's component to be gone by now, and nothing else can see that: there
    // is no in-flight request left to abort, so no `AbortError` is ever produced
    // and `isAbort` above cannot fire. Work cancelled on purpose must not be
    // silently resurrected — and a resurrected `tip()` moves Buzz with no UI left
    // to report it.
    if (isActive !== undefined && !isActive()) throw err;

    // Rule 1: the one retry. A failure here propagates untouched.
    return attempt();
  }
}
