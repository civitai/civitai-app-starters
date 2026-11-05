---
'@civitai/components-react': minor
---

Export the event `detail` types — `MenuSelectDetail`, `ReactionDetail`,
`TagVoteDetail` — from the root barrel and from each single-binding path.

**Why.** These names were already in this package's PUBLISHED signatures and
exported by none of its entry points. `0.9.0`'s
`dist/elements/civitai-menu.d.ts` reads:

```ts
export declare const CivitaiMenu: ReactWebComponent<CivitaiMenuElement, {
  onSelect: EventName<CustomEvent<MenuSelectDetail>>;
}>;
```

…with `MenuSelectDetail` reachable only from `@civitai/components/civitai-menu`.
So a consumer writing `onSelect={(e) => …}` who wanted to name that argument's
type — hoist the handler, store the value, thread it through a reducer — had to
add `@civitai/components` as a **second direct dependency purely for a type**,
even though `@civitai/components-react` already depends on it and already names
the type in the signature the consumer is reading. The tell that this was
friction and not theory: this package's own browser test imported `TagVoteDetail`
from `@civitai/components/civitai-tag`, because there was nowhere else to get it.

`@civitai/components`' own root barrel does not re-export them either — it is 12
lines of `injectStyles` and `COMPONENT_NAMES` — so the per-element subpath was
the only route, and a consumer had to know which element file a type lived in.

**What changed.** The GENERATOR, `scripts/build-react-bindings.ts` (via
`scripts/bindings.ts`), which owns every file under `src/`. A binding that names
a `detail` type now re-exports it, and the barrel re-exports the presentational
ones. The `detailTypes(tag)` helper is derived from the existing `EVENTS` map, so
there is no second list to drift: adding `{ detail: 'FooDetail' }` to `EVENTS`
puts `FooDetail` on the surface automatically.

**Nothing at runtime changes.** Both are `export type`, which `tsc` erases — the
emitted `dist/elements/index.js` is byte-for-byte what it was, so the barrel
registers the same elements and pulls in the same specifiers. The existing
`entry-points.test.ts` invariant (the root and the barrel reach the SAME external
specifiers) is untouched, and an SDK-bound binding's detail types would stay out
of the barrel like the binding itself.

**Guards.** Two in `test/entry-points.test.ts`, reading the BUILT `.d.ts` because
a type-only export is erased from `dist/**/*.js` and a check over the JS is
structurally blind to it: the root names every presentational `detail` type, and
each single-binding entry names its own. Both derive the expectation from
`detailTypes`, so they fail when a detail type is added to `EVENTS` without
reaching the surface. Watched RED at `origin/main`'s generated output —
`expected [ 'CivitaiActionButton', …(44) ] to include 'MenuSelectDetail'` — with
the positive control (45 names walked, `CivitaiButton` among them) passing, so
the red is a gap in the surface rather than a parser wired to nothing.

`test/menu.browser.test.tsx` is the behavioural half, since a structural check on
a `.d.ts` cannot tell that `detail` really carries `value`: it builds a dropdown
out of `CivitaiMenu` / `CivitaiMenuItem` / `CivitaiMenuLabel` imported from the
ROOT, and asserts `onSelect` delivers `{ value: 'prompt' }`. Mutation-checked —
hardcoding the dispatched `detail` kills it on that assertion.

Additive: no existing export, prop, event or behaviour changes.
