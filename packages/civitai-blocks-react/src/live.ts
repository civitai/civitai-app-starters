/**
 * `@civitai/blocks-react/live` — THE REAL BACKEND. THIS SPENDS REAL BUZZ.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 Nothing here is a mock and nothing here is a sandbox. `createLiveHost`│
 * │ forwards the App-Block postMessage protocol to the REAL Civitai backend │
 * │ over a pasted short-lived dev block token, `blocks.submitWorkflow`      │
 * │ included. A successful generation DEBITS THE TOKEN HOLDER'S OWN BUZZ.   │
 * │ There is no dry-run mode and no confirmation. The dev token's per-call  │
 * │ budget and the per-user daily cap bound it server-side; that is all.    │
 * │                                                                        │
 * │ It exists for ONE caller: a `pnpm dev:live` harness. It must never      │
 * │ appear in a test suite. The free one is `createMockHost`, and it is on  │
 * │ a DIFFERENT subpath — `@civitai/blocks-react/testing`.                  │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * WHY THIS SUBPATH EXISTS (#334). `createLiveHost` used to be exported from
 * `@civitai/blocks-react/testing`, one autocomplete entry from `createMockHost`,
 * with near-identical signatures and nothing distinguishing them — in a module
 * the project's own guide called "test-only helpers". An author writing a test,
 * or copying a `dev:live` snippet, could pick the wrong one and put real
 * `blocks.submitWorkflow` calls on every CI run. The bill is the first signal.
 *
 * The defect was the ADJACENCY and the NAME, not the byte count: a
 * money-spending client is not a test helper, and no amount of documentation
 * makes `import … from '.../testing'` read as "this charges you". Moving it here
 * means the import line itself carries the warning. It does NOT make the package
 * smaller — see README § "What this subpath costs you"; `files` is `["dist"]`,
 * so the code ships either way.
 *
 * THE WHOLE SURFACE IS ENUMERATED IN EXACTLY ONE PLACE — README § "The `/live`
 * subexport" — and `test/testingSurface.test.ts` pins a ledger to this module
 * and to that README section. Do not restate the list here.
 *
 * STABILITY: a normal published subpath of a `0.x` package, on the same footing
 * as `.`, `./ui` and `./testing`; a minor may break it. What is enforced is that
 * the symbol SET cannot change silently.
 */

export { createLiveHost, type LiveHostOptions } from './internal/liveHost.js';
