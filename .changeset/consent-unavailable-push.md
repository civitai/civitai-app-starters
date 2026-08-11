---
'@civitai/app-sdk': minor
'@civitai/blocks-react': minor
---

Add the `CONSENT_UNAVAILABLE` host→block push, and make both dev hosts emit it.

The host now tells a block when a `REQUEST_CONSENT` can NEVER be granted
(civitai/civitai #3733): the scope was clamped or withheld at mint, so no
consent round-trip in that environment will ever add it. Until this release the
SDK had no such message, so the signal was un-consumable by a typed block — the
host posted it and nothing on the block side could branch on it, leaving the
developer-visible bug it was meant to fix exactly where it was: an app's own UI
saying "Confirm in the Civitai dialog. If you dismissed it, click Generate
again" next to a host toast saying the permission is unavailable. Two
contradictory messages on one screen, and the misleading one is where the
developer is looking.

`@civitai/app-sdk`

- New `CONSENT_UNAVAILABLE` variant on `ParentToBlockMessage` carrying
  `{ reason, scopes }`, plus the exported `ConsentUnavailablePayload` /
  `ConsentUnavailableReason` types. Host-INITIATED with no `requestId` —
  documented and shaped like `TOKEN_REFRESH` / `THEME_CHANGE`, deliberately NOT
  a `*_RESULT` reply, because `REQUEST_CONSENT` carries nothing to correlate one
  against.
- 🔴 **`scopes` can legitimately be `[]`.** The host decides to refuse on its own
  UNFILTERED un-grantable set, then filters the names it puts on the wire to the
  known block-scope vocabulary — the request's `scopes` hint is untrusted block
  input and this payload is rendered by block UI. A request naming nothing the
  platform recognises therefore produces a real refusal carrying `scopes: []`.
  The refusal is the signal; the names are advisory. A consumer that branches on
  `scopes.length > 0` silently drops the message it subscribed for.

`@civitai/blocks-react`

- **New `useConsentUnavailable()` hook** — the typed consumption path, following
  the house pattern for an unsolicited host push. It returns
  `{ refusal, reset }`, where `refusal` is a `ConsentUnavailablePayload | null`.
  Without it the only public route was
  `getTransport().onMessage('CONSENT_UNAVAILABLE', (p: unknown) => …)` plus a
  hand-written `as ConsentUnavailablePayload` cast — an UNCHECKED cast, so the
  message was *nameable* but not safely *consumable*, and a payload shape change
  would compile straight through it in every block. The hook stores the payload
  unconditionally (no `scopes.length` gate — see above) and unsubscribes on
  unmount. `ConsentUnavailablePayload` is re-exported here so a React consumer
  needs only one import.
- 🔴 **A refusal is BUFFERED across mounts, so one that arrives while no
  consumer is mounted is not dropped.** The transport hands an unsolicited push
  only to handlers registered at the instant it arrives, so a refusal that landed
  before `useConsentUnavailable()` mounted — the requester and the consumer being
  different components, or the consumer conditionally rendered — was gone, and a
  dropped refusal puts back the two-message screen this change exists to remove.
  `requestConsent()` arms the buffer as it sends (a refusal can only follow a
  request), and a mounting hook seeds from it. The buffer holds at most the
  latest refusal, is discarded once the block token changes — a refusal is a
  claim about *that* token's scopes, and the grant path re-mints — and is cleared
  by `reset()`, so the documented "Try again" button is not undone by the next
  mount. A `REQUEST_CONSENT` posted through the raw transport does not arm it.
- 🔴 **The push is UNCORRELATED and stays that way.** `REQUEST_CONSENT` carries
  no `requestId`, so every mounted `useConsentUnavailable()` observes every
  refusal and there is no reliable filter — `scopes` is advisory and may
  legitimately be `[]`, so it cannot serve as a correlation key. Blocks with two
  independent requesters should keep a request and its refusal UI in one
  component. Now stated on the hook and in the README.
- 🔴 **`requestConsent()` MUST be called with `scopes` CONTAINING A REAL SCOPE
  NAME for a refusal to arrive.** The argument is optional in the signature and
  genuinely optional for the GRANT path, but `resolveUngrantableConsentNotice`
  returns "no notice" unless the hint is an array holding at least one non-empty
  string — `undefined`, a non-array, `[]`, `['']` and `[1, 2]` all produce
  silence, in the real host and in both dev hosts. So even
  `requestConsent({ scopes: [] })` gets nothing back. Earlier drafts of this doc
  said "absent or not an array", which is narrower than the code. Now documented
  accurately on the hook, in `useRequestConsent`'s docstring, and in the README.
- The dev `<Harness>` consent readout is now THREE-state
  (`granted` / `withheld` / `ungrantable`, plus `granted+ungrantable`). It was a
  boolean derived from `consentGranted` alone, so `?consent=ungrantable` — which
  leaves that flag undefined — rendered **withheld**, i.e. *"not granted yet,
  try again"*: the exact message this whole change exists to replace, shown next
  to a block correctly reporting the refusal.
- `isValidConsentUnavailable` + its `payloadValidatorFor` entry. The mapping is
  the load-bearing half — that switch's `default:` arm returns `null` (a
  STRUCTURAL PASS), so a guard written without the case leaves the push
  unvalidated at the trust boundary. The guard deliberately ACCEPTS an empty
  `scopes` array; written the obvious way ("a non-empty array of strings") it
  would silently drop the exact message described above.
- **Both dev hosts now emit it**, so a refusal handler is reachable in
  `pnpm dev` / `pnpm dev:live` instead of only in production — the same
  untestable-locally gap that let the original bug ship and survive.
  `createMockHost` gains `consentGrantable` (default `true`, so existing
  behaviour is unchanged); set it `false`, flip it live with
  `setScenario({ consentGrantable: false })`, or use `?consent=ungrantable` in
  the harness URL. `createLiveHost` — which can grant nothing, ever — now posts
  the refusal alongside its existing console warning.
- Both hosts route through ONE shared decision that mirrors the real host's
  `resolveUngrantableConsentNotice`, so dev and production cannot drift on when
  the refusal fires or what it names. The benign case (a block re-requesting a
  scope it already holds) stays silent in both channels: a permission-unavailable
  state rendered over a permission that works is worse than saying nothing.

Back-compat, both directions — purely additive. An older SDK has no branch for
the message and falls through the transport's no-op tail, so deployed blocks are
unaffected; a newer block against a host that never sends it just never sees a
refusal, which is today's behaviour. Nothing awaits the message, so there is no
timeout to hit.
