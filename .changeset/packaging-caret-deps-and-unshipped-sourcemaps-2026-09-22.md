---
'@civitai/app-sdk': patch
'@civitai/blocks-react': patch
'@civitai/components': patch
'@civitai/components-react': patch
'@civitai/theme': patch
---

Publish first-party deps as caret ranges instead of exact pins, and stop shipping sourcemaps that cannot resolve their sources (#374, #376).

**#374 — exact inter-package pins duplicated `@civitai/theme` and `@civitai/components`.**
`@civitai/components`, `@civitai/components-react` and `@civitai/blocks-react` declared
their first-party deps as `workspace:*`. pnpm rewrites the workspace protocol at pack
time, and `*` publishes an **exact** pin — measured off the real tarballs:
`@civitai/components@0.4.2` shipped `"@civitai/theme": "0.3.1"`, not `"^0.3.1"`.

Two exact pins from two different releases can never intersect, so co-installing
adjacent releases produced duplicate physical copies. Measured outside this workspace
with a real `npm install --package-lock-only` over a closed registry built from the
actual packed tarballs — an app on `@civitai/components-react@0.4.0` that also pulls
`@civitai/blocks-react@0.56.1`:

    before   @civitai/theme       0.3.0 (nested) + 0.3.1  — 2 copies
             @civitai/components  0.4.0 (nested) + 0.4.2  — 2 copies
    after    @civitai/theme       0.3.1                   — 1 copy
             @civitai/components  0.4.2                   — 1 copy

That is not only bloat. `injectTokens()` is DOM-marker idempotent and **first copy
wins**, so the first token bump that changes a *value* would have shipped stale tokens
underneath new component CSS — silently, and only in the duplicated install.

The three manifests now use `workspace:^`, which publishes `^<version>`.

**Scope of the fix, stated rather than implied.** `^` on a `0.x` version locks the
minor, so this removes duplication across patch-adjacent releases only. Measured at
the second point too: an app on `@civitai/components-react@0.3.1` (theme `0.2.1`)
alongside `@civitai/blocks-react@0.56.1` (theme `0.3.1`) still resolves 2 copies,
before and after. That is correct and deliberate — a `0.x` minor is a breaking change
under this repo's own convention, so those two releases genuinely disagree about which
theme they need, and widening the range to `>=x.y.z <1.0.0` would trade a duplicate
copy for an incompatible pairing of component CSS with theme tokens.

One consequence worth knowing at release time: because `^0.3.1` already admits
`0.3.2`, `changeset version` no longer cascades a re-release of every dependent on a
theme patch bump (verified against both manifest shapes — with `workspace:*` a theme
`0.3.1 → 0.3.2` bump dragged `@civitai/components` and `@civitai/components-react` to
`0.4.3`; with `workspace:^` it leaves them at `0.4.2`).

**#376 — every shipped sourcemap dangled.**
All five packages build with `sourceMap` + `declarationMap`, so `dist/` fills with
`*.js.map` and `*.d.ts.map` whose `sources` point at `../src/*.ts`. No package lists
`src` in `files`. Measured off the real packed file lists at the previous state: **270
shipped maps, 270 dangling source references, zero resolvable** — `@civitai/blocks-react`
160, `@civitai/app-sdk` 46, `@civitai/components-react` 48, `@civitai/theme` 12,
`@civitai/components` 4. A consumer's devtools loaded each map and then had nothing to
show.

The maps are now excluded from the tarballs (`"!dist/**/*.map"`) and still emitted into
`dist/`, where they are *not* dangling — inside this repo `src` sits right beside them,
so go-to-definition from a starter still lands in the real `.ts`. **No consumer
debuggability is lost, because there was none.** Shipping `src` instead was measured
and rejected: `packages/civitai-blocks-react/src` alone is 879,895 B, in a package
whose design constraint is that every app inherits its install graph.

Tarball delta across the five packages: **−114,574 B gzipped, −580,786 B unpacked**
(`@civitai/blocks-react` alone: −77,441 B gzipped, −413,492 B unpacked).

Enforced going forward by `scripts/check-shipped-sourcemaps.mjs` (`pnpm
check:shipped-sourcemaps`), which reads the real packed file list and every real map's
`sources` rather than grepping for the `files` entry — so shipping `src` or inlining
`sourcesContent` satisfies it equally.
