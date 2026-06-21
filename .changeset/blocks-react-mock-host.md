---
'@civitai/blocks-react': minor
---

Add `createMockHost()` + a React `<Harness>` (a.k.a. `<MockHostProvider>`) to the `@civitai/blocks-react/testing` subpath.

`createMockHost()` is a framework-agnostic, test-and-dev-only fake of the civitai.com embedding host. It patches `window.parent.postMessage`, dispatches a configurable `BLOCK_INIT`, and answers the full block protocol — `REQUEST_TOKEN`, the lazy-consent `REQUEST_CONSENT` → `TOKEN_REFRESH` round-trip, `ESTIMATE_WORKFLOW`, `SUBMIT_WORKFLOW`, `POLL_WORKFLOW` (processing ×N → succeeded with image + cost), `OPEN_BUZZ_PURCHASE`, `OPEN_CHECKPOINT_PICKER`, and `OPEN_RESOURCE_PICKER` (canned picks). It is driven by an options object (`viewer`, `consentGranted`, `failMode`, `cannedPicks`, `pollsUntilDone`, `cost`, `theme`, `context`, + forward-compat `domain`/`maturity`) and also honors the dev URL toggles (`?viewer/?consent/?fail/?theme/?pick/?pickCkpt`). It returns an `{ install(): uninstall }` handle so it works from node/jsdom/happy-dom tests as well as a browser dev harness.

`<Harness>` is a thin React wrapper that installs the mock host on mount (cleanup on unmount) and optionally renders the on-screen message-log panel.

This replaces the ~250-line hand-rolled per-block harness. Test/dev-only — no change to the block runtime API or money/transport semantics. The existing `resetTransport` / `mockParentMessage` testing exports are unchanged.
