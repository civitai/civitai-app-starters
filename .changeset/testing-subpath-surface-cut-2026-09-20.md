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

Twenty-two of the 24 are internal wiring for the mock/live hosts with no documented contract and no consumer anywhere in the fleet. There is no replacement import path: they are not published. If you depend on one, open an issue rather than reaching into `dist/internal/`.

### Known impact — the two removals that DO have a consumer

**1. `openPickerOverlay`.** `civitai-app-panorama-360` (`src/orch-host.ts:270`, a `await import()` inside `orch` mode) uses the in-harness overlay as a real, network-backed picker UI. Replace it with the host-mediated `useResourcePicker()` / `useCheckpointPicker()` hooks, which is what a non-harness block should be calling anyway. One repo, one site — the single most load-bearing misuse of this subpath in the fleet, and exactly the trap #334 describes.

**2. `mockParentMessage`.** Two consumers, and the second one matters more than the first:

- `dogfood-app/dogfood-2/src/mock-buzz.ts:32` (import), dispatched at `:124`.
- 🔴 **`civitai/cli`'s scaffold template** `internal/scaffold/templates/page-money/src/mock-buzz.ts.tmpl:33`. That template currently pins `"@civitai/blocks-react": "^0.53.0"`, and a caret on `0.x` pins the minor — so `civitai app init` keeps resolving `0.53.x` and new scaffolds are unaffected **until someone bumps that pin**. Whoever bumps it must fix this import in the same change, or the CLI starts emitting projects that do not typecheck.

It was always a two-line `MessageEvent` constructor; inline it:

```ts
function mockParentMessage(data: unknown, origin: string): MessageEvent {
  return new MessageEvent('message', { data, origin, source: null });
}
```

Nothing here breaks on `npm install`. Every `@civitai/blocks-react` range that governs a `./testing` importer anywhere in the fleet is a caret on `0.x`, an exact pin, or `workspace:` — none of them admits this release. The single unbounded range in the tree (`>=0.33`, `civitai-app-panorama-360/packages/comfy-run-kit`) is an **optional peer of a sub-package that does not import this subpath at all**. The break happens on a deliberate bump, and this list is what that upgrader reads.

### The fleet scan behind those numbers

A full enumeration of **all 489 directories** under the local `civit` tree (not a sample), excluding `node_modules`/`dist`/build output: **1,800 files mention the subpath; 382 contain a real import; 10 distinct symbols are imported** (11 counting one that appears only in a README fence). Restricted to real app source — dropping agent worktrees, this monorepo's own clones, and the CLI's `.tmpl` scaffold files — that is **179 files across 27 logical repos**.

| symbol | repos (app source) |
|---|---|
| `createLiveHost` | 27 |
| `resetTransport` | 26 |
| `Harness` | 25 |
| `MockSharedSeed` | 8 |
| `createMockHost` | 7 |
| `MockHostOptions` | 5 |
| `readMockHostUrlOptions` | 3 |
| `HarnessProps` | 1 |
| `mockParentMessage` | 1 (+ the CLI template) |
| `openPickerOverlay` | 1 |

There are **zero** namespace imports (`import * as …`) of this subpath anywhere, so the surface a consumer can be depending on is exactly the named set above.

### Stability, stated rather than invented

Three signals used to disagree: the module header and `AGENTS.md` said "test-only, never in production", a starter and **27 fleet repos** imported it, and it ships in the production tarball. The tarball and the consumers win — it is documented, supported API.

That is #334's *first* branch ("add the missing 41 to the docs"), and only that branch. It is **not** marked `@internal`, and it is **not** given a stability promise stronger than the rest of the package: `./testing` is a normal subpath of a `0.x` package, on the same footing as `.` and `./ui`, where **a minor may break it**. What *is* enforced is narrower and mechanical — the exported symbol *set* cannot change silently. `test/testingSurface.test.ts` fails on growth and on shrinkage, and fails again unless the README section it parses is updated to match. The *shapes* of the mock-host option and result types are explicitly not frozen; the ledger asserts names, not shapes.

### Not fixed by this change — and not fixable by any export-list edit

`./testing` still reaches six `dist` modules no other entry point does — 264,991 B of JS plus 75,464 B of `.d.ts` (`mockHost` 118,590, `liveHost` 86,688, `pickerOverlay` 29,508, `catalog` 15,351, `testing` 10,157, `consent` 4,697) — and they still ship in every install. Cutting the export list moved none of it, and **neither would moving a symbol to a different subpath**: `files` is `["dist"]` and `tsconfig` compiles all of `src/**/*`, so the `exports` map has no effect whatsoever on tarball contents. Only deleting the code or publishing a second artifact moves those bytes. It is tree-shaken out of application bundles, so it is `node_modules` weight, not bundle weight.
