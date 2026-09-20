---
'@civitai/blocks-react': minor
---

**BREAKING (minor, 0.x): `@civitai/blocks-react/testing` drops 24 of its 46 exports.** The subpath is now 5 values + 17 types, documented in the README, and pinned by a ledger test that fails when the set grows *or* shrinks (#334).

`AGENTS.md` described this subpath as two "test-only helpers" and named a file that does not exist (`src/testing.ts`; it is `src/testing.tsx`). It actually exported 46 symbols, 41 of them undocumented anywhere — including `createLiveHost`, which is not a mock: it forwards the App-Block postMessage protocol to the **real Civitai backend** and a successful generation **spends the token holder's real Buzz**. Thirty-four of the 46 came from `src/internal/` under names generic enough to collide with a consumer's own (`DEFAULT_LIMIT`, `fetchCatalog`, `buildCatalogUrl`, `openPickerOverlay`).

### What it exports now

**Values (5)** — `resetTransport`, `createMockHost`, `readMockHostUrlOptions`, `Harness`, `createLiveHost`.

**Types (17)** — `HarnessProps`, `LiveHostOptions`, `MockHost`, `MockHostOptions`, `MockHostScenarioPatch`, `MockHostFailMode`, `MockGenerationScenario`, `MockBuzzScenario`, `MockBuzzBalance`, `MockBuzzHandle`, `MockStorageScenario`, `MockSharedScenario`, `MockSharedSeed`, `MockCannedImageScan`, `CostSpec`, `ImageSpec`, `CannedPick` — the transitive closure that makes those five values nameable.

### Removed — diff your imports against this list

The catalog client (16):
`buildCatalogUrl`, `fetchCatalog`, `modelToCard`, `responseToPage`, `edgeThumb`, `cardToCheckpoint`, `cardToResource`, `filterCardsByFamily`, `CATALOG_API_BASE`, `CATALOG_API_BASE_BLOCKS`, `DEFAULT_LIMIT`, `CatalogQuery`, `CatalogCard`, `CatalogPage`, `CatalogResult`, `CatalogModelType`.

The in-harness picker overlay (4):
`openPickerOverlay`, `PickerOverlayHandle`, `PickerSelection`, `OpenPickerOptions`.

Other (4):
`decodeBlockTokenPayload`, `disallowedAccountError`, `mockParentMessage`, `MockHostProvider` (it was an alias of `Harness` — use `Harness`).

All 24 are internal wiring for the mock/live hosts with no documented contract. There is no replacement import path: they are not published. If you depend on one, open an issue rather than reaching into `dist/internal/`.

**Known impact:** one app in the fleet uses `openPickerOverlay` as a real, network-backed picker UI (`civitai-app-panorama-360`, `src/orch-host.ts`). It is pinned to `^0.35.2`, so this release cannot reach it without a deliberate bump — but that bump will need the overlay replaced with the host-mediated `useResourcePicker()`/`useCheckpointPicker()` hooks, which is what a real (non-harness) block should be calling anyway.

### Stability contract, now written down

`./testing` is **public and semver-protected, exactly like `.` and `./ui`.** Three signals used to disagree — the module header and `AGENTS.md` said "test-only, never in production", a starter and five fleet apps imported it, and it ships in the production tarball. The tarball and the consumers win: it is supported API, and removing or narrowing anything on it is a breaking change that ships with a changeset naming the symbol. `test/testingSurface.test.ts` is the ledger that enforces it; `pnpm typecheck:readme` now resolves the subpath against the built `.d.ts`.

### Not fixed by this change

`./testing` still pulls ~265 KB of `dist` JavaScript (`mockHost`, `liveHost`, `pickerOverlay`, `catalog`, `consent`) that no other entry point reaches, and that still ships in every install. Cutting the export list moved none of it: `createMockHost` and `createLiveHost` are what reach those modules, and both are staying. It is tree-shaken out of application bundles, so it is `node_modules` weight, not bundle weight. Removing it needs the code out of the tarball — a separate package or a second published artifact — not a shorter export list.
