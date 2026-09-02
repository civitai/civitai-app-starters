---
'@civitai/theme': minor
'@civitai/blocks-react': minor
---

Ship civitai's responsive breakpoint scale as tokens, and the "am I narrow?" question as a hook.

Until now a block author had no branch point at all: the pervasive inline-style idiom in blocks has no way to ask about its own width without hand-rolling a `ResizeObserver` and hard-coding numbers. Both halves of that are now provided.

**`@civitai/theme` — the scale as tokens.**

- New `--civitai-bp-xs` … `--civitai-bp-xl` CSS custom properties, plus `bpXs`…`bpXl` in the generated `tokens` / `tokenVars` maps and a `bp` group in the DTCG export.
- New exports `breakpoints` (numbers — the form a JS width comparison actually needs, since a custom property cannot appear in a `@media`/`@container` condition), `BREAKPOINT_KEYS`, `civitaiBreakpointsSource` and the `BreakpointKey` type.

🔴 **The values are civitai's PX scale, not Mantine's em scale, and the two agree on exactly one key.** `src/utils/breakpoints.json` (mirrored by civitai's Tailwind config and `mantineContainerSizes`) is `xs 480 · sm 768 · md 1024 · lg 1184 · xl 1440`; Mantine's stock em scale — which civitai never overrides and which every Mantine responsive prop uses — is `576 · 768 · 992 · 1200 · 1408`. Only `sm` matches, so a wrong implementation looks right at a glance and a test that pins `sm` alone passes against the wrong scale.

Because of that, the scale is vendored in its own module (`src/breakpoints.source.ts`) with its own drift guard against `breakpoints.json`, and is emitted through the generator as a **literal** token spec that never touches the Mantine theme pipeline — routing it through `mergeMantineTheme` is precisely how an un-overridden key would silently resolve to the em value. `theme.source.ts` was not the right home: it is a byte-faithful copy of civitai's `createTheme({...})` override, and that override defines no `breakpoints` key at all.

**`@civitai/blocks-react` — the question as a hook.**

New `useBlockBreakpoint(ref?)`, plus the pure `resolveBlockTier(width)` and the `BlockBreakpoint` / `BlockSizeTier` types.

```tsx
const bp = useBlockBreakpoint();
<div style={{ display: 'flex', flexDirection: bp.below('sm') ? 'column' : 'row' }}>
  {bp.atLeast('md') && <aside>…</aside>}
</div>
```

- **A container query, not a viewport media query.** It observes an element — by default `document.documentElement`, which inside the block's sandbox iframe *is* the slot the host handed us. Slot width is not monotonic in viewport width (the `model.sidebar_top` slot is ~360px at a 360px viewport and only ~430px at a 1440px one), so `matchMedia` inside the frame answers a question nobody asked. Same reasoning as the host-side `chromeGeometry.ts`.
- **Returns a tier, not a width.** `tier` is `'base' | 'xs' | … | 'xl'` with Tailwind semantics (a tier applies at its breakpoint and above); `atLeast(key)` / `below(key)` are the call-site-shaped comparators. A `ResizeObserver` fires on every pixel, so the hook stores the resolved *tier* and returns a referentially stable object while the tier is unchanged — dragging 200px inside one tier re-renders the block zero times. Exposing the raw width would either force a render per pixel or be a lie, so it is deliberately not returned.
- `measured` distinguishes "not measured yet" from a genuinely narrow block, since an unmeasured width resolves to `'base'`. SSR-safe: with no `ResizeObserver` the hook never touches the DOM.
