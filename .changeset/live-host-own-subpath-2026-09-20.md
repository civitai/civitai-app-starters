---
'@civitai/blocks-react': minor
---

**BREAKING (minor, 0.x): `createLiveHost` and `LiveHostOptions` move off `@civitai/blocks-react/testing` onto a new `@civitai/blocks-react/live`.** Nothing is deleted; the import path changes (#334).

```diff
-import { createLiveHost, type LiveHostOptions } from '@civitai/blocks-react/testing';
+import { createLiveHost, type LiveHostOptions } from '@civitai/blocks-react/live';
```

That is the whole migration. `./testing` is unchanged otherwise.

### Why

`createLiveHost` is not a mock. It forwards the App-Block postMessage protocol to the **real Civitai backend** over a pasted short-lived dev block token, `blocks.submitWorkflow` included, and a successful generation **debits the token holder's own Buzz**. There is no dry-run mode and no confirmation.

It sat one autocomplete entry from `createMockHost`, with a near-identical signature, in a module the project's own guide described as "test-only helpers". An author writing a test — or copying a `dev:live` snippet, since `dev:live` legitimately uses it — could pick the wrong one and put real `blocks.submitWorkflow` calls on every CI run. The bill is the first signal. **The defect is the adjacency and the name**; no amount of documentation makes `import … from '…/testing'` read as *"this charges you"*. Now the import line carries the warning, and `./testing` can state flatly that everything on it is a mock.

This is #334's closing condition: `createLiveHost` is no longer exported from `@civitai/blocks-react/testing`, and the ledger test asserts that absence *structurally* — it walks `./testing`'s declared exports and fails if any of them resolves into `internal/liveHost.ts`, so re-adding it under a different name does not walk the check.

### 🔴 Known impact — the Go CLI's scaffold template emits a broken import

`civitai/cli`'s `page-money` scaffold template imports the moved symbol at
`internal/scaffold/templates/page-money/src/dev-transport.ts.tmpl:13`:

```ts
import { createLiveHost, resetTransport } from '@civitai/blocks-react/testing';
```

That template pins `"@civitai/blocks-react": "^0.53.0"`, and a caret on `0.x` pins the minor — so `civitai app init` keeps resolving `0.53.x` and **new scaffolds are unaffected until someone bumps that pin**. Whoever bumps it must split that import in the same change (`resetTransport` stays on `/testing`; `createLiveHost` moves to `/live`), or the CLI starts emitting projects that do not typecheck. Same applies to `mock-buzz.ts.tmpl:33` for the sibling `mockParentMessage` removal. Those fixes live outside this repo and are not made here.

Fleet consumers of `createLiveHost` in app source, all four distinct shapes (a full enumeration of all 489 directories under the local `civit` tree, 27 repos, 81 sites — the rest are copies of these):

| site | |
|---|---|
| `starters/civitai-block-starter/src/dev/LiveHarness.tsx:3` | fixed in this PR |
| `civitai-app-panorama-360/src/dev-transport.ts:10` | one-line change |
| `civitai-dogfood-app/*/src/dev-transport.ts:13` (4 sub-apps) | one-line change |
| `dogfood-app/dogfood-2/src/dev-transport.ts:13` | one-line change |

None of them is reachable by this release without a deliberate bump: every `@civitai/blocks-react` range that governs a `./testing` importer anywhere in the fleet is a caret on `0.x` (which pins the minor), an exact pin, or `workspace:`. The one unbounded range in the tree (`>=0.33`, `civitai-app-panorama-360/packages/comfy-run-kit`) is an **optional peer of a sub-package that does not import the subpath at all**.

### What it does NOT do: shrink the install

Measured with `pnpm pack` on both sides of the split — 319 → 323 entries, 1,590,099 B → 1,597,161 B uncompressed — and `liveHost.js` (86,688 B), `pickerOverlay.js` (29,508 B) and `catalog.js` (15,351 B) do not appear in the diff at all: **byte-identical and still in the tarball**. `files` is `["dist"]` and `tsconfig` compiles all of `src/**/*`, so the `exports` map has no bearing whatsoever on what ships; it decides only what a consumer can *name*. The split in fact ADDS 4,447 B of code (`dist/live.*` +6,048, `dist/testing.*` −1,692, `package.json` +91).

**The `/live` split buys safety, not size.** #334 item 3 (get the code out of the tarball — a second package or a second artifact) is still open and is not done here.
