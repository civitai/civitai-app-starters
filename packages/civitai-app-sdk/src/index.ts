/**
 * `@civitai/app-sdk` — the ROOT barrel.
 *
 * ## What the root is, stated once (#377)
 *
 * The root is **the aggregate of the four browser-and-server-safe OAuth-app
 * subpaths**, and nothing else:
 *
 *   `./oauth` + `./scopes` + `./cookies` + `./orchestrator`
 *
 * Exactly those four, and ALL of each. `test/export-surface.test.ts` asserts
 * set equality in both directions, so the root can neither miss a symbol one of
 * them exports nor gain one that none of them does. Before #377 it could do
 * both: `src/index.ts` re-exported `types.ts` directly, leaving `OAuthTokens`,
 * `OAuthTokenResponse` and `OAuthClientConfig` reachable from the root ONLY —
 * 3 of 68 symbols with a different reachability from all their siblings, by
 * accident rather than by decision. `./oauth` now re-exports `types.ts`, which
 * fixes it additively: the root's surface did not change.
 *
 * ## The five subpaths deliberately NOT in the root, and why
 *
 * "Reachable two ways" is a cost, but an absent export is a worse one, so the
 * bar for staying out is a concrete harm to the importer. Each of these clears
 * it:
 *
 *  - **`./blocks`** — importing it RUNS `./safe-storage` for its side effect
 *    (repairing `localStorage`/`sessionStorage` at an opaque origin). Folding
 *    119 symbols and that side effect into the root would make every OAuth app
 *    that writes `import { exchangeCode } from '@civitai/app-sdk'` pay for the
 *    Civitai-Apps contract it does not use. Blocks and OAuth apps are disjoint
 *    audiences; see this package's README.
 *  - **`./safe-storage`** — the same side effect, and its whole point is being
 *    imported FOR it (`import '@civitai/app-sdk/safe-storage'`). A side effect
 *    on the root barrel is not something a consumer can opt out of.
 *  - **`./orchestrator/steps`** — type-only, and its declarations name
 *    `@civitai/client`, an OPTIONAL peer. On the root it would make that peer
 *    effectively mandatory for everyone (see the `comment-peerDependencies`
 *    block in package.json for why it must not be).
 *  - **`./manifest`** — NODE ONLY. Needs `node:fs` and the optional peer `ajv`.
 *  - **`./vite`** — NODE ONLY. Optional peers `ajv` (runtime) and `vite`
 *    (types).
 *
 * The ledger in `test/export-surface.test.ts` carries one of these reasons per
 * `exports` key and fails when the key set GROWS or SHRINKS — so a sixth
 * subpath cannot arrive without a stated reason to exist, and a deleted one
 * cannot leave a stale reason behind.
 *
 * ## One known name collision, deliberate
 *
 * `BuzzAccountType` is declared TWICE, with DIFFERENT unions: the root/`./oauth`
 * one is the full set of Civitai Buzz pools, the `./blocks` one is narrowed to
 * the three a block can actually see. Same name, two subpaths, two types — see
 * the note on `BuzzAccountType` in `src/blocks/types.ts`. It is pinned as an
 * expected divergence rather than merged, because either union would be wrong
 * for the other audience; renaming either is a breaking change.
 */
export * from './oauth/index.js';
export * from './scopes/index.js';
export * from './cookies/index.js';
export * from './orchestrator/index.js';
