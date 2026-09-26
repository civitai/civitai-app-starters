---
'@civitai/app-sdk': patch
---

README: the `BLOCK_SCOPES` row claimed **15** block scope strings. There are
**13**, and the number is now gone rather than corrected.

Documentation only — no API, type or behaviour change. The README ships inside
the published tarball and reaches the npm package page and IDE hover, so a stale
hand-typed figure there is a defect a consumer reads.

The true value was derived from three independent authorities, which agree
exactly (same 13 strings, same set):

- `BLOCK_SCOPE_TO_OAUTH_BIT` in civitai/civitai
  (`src/shared/constants/block-scope.constants.ts`), whose keys are the type
  `BlockScopeString` — the server-side source of truth;
- this package's own `BLOCK_SCOPES` (`src/blocks/scopes.ts`);
- the vendored canonical schema at the `./schemas/app-block/v1.json` subpath,
  whose `properties.scopes.items.enum` is what actually validates a manifest.

**No figure is quoted in its place, deliberately.** A count in README prose is
unguarded by every check in this repo — `pnpm typecheck:readme` typechecks
snippets, not assertions about the code — so it rots silently and is then read
as authoritative. This particular count has moved repeatedly (scopes were added
*and* retired: `catalog:read`, `media:read:owned` and `block:settings:*` were all
declared and then removed, each leaving a NOTE in the server constant), which is
why the remedy is a claim that stays true across those changes. The row now
points the reader at `BLOCK_SCOPES` itself, which is the enumerable surface and
is drift-checked against the canonical schema by CI.

> Not fixed here, and out of scope for a README change: the JSDoc on
> `BLOCK_SCOPE_PATTERN` in `packages/civitai-app-sdk/src/blocks/scopes.ts` says
> "the 12 values in {@link BLOCK_SCOPES}" — a third stale figure, in source, on a
> comment that ships to consumers via the emitted `.d.ts` and therefore reaches
> IDE hover too.
