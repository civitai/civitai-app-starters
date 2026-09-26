# @civitai/components-react

React bindings for the `<civitai-*>` custom elements published by
[`@civitai/components`](../civitai-components).

The custom elements **are** the design system. This package is strictly
downstream of them: every export is an [`@lit/react`](https://lit.dev/docs/frameworks/react/)
wrapper generated from an element class, so props and their types come from the
element, refs point at the element itself, and values are assigned as
**properties** — which is what React 19 gets wrong on its own, and why these
exist at all. There is no second implementation to drift against.

Presentational only; this is **not** a replacement for `@civitai/blocks-react`
(which stays the home of the transport hooks + block-authoring components).

```tsx
import { CivitaiButton, CivitaiCard, CivitaiTextInput } from '@civitai/components-react';

<CivitaiCard withBorder padding="lg">
  <CivitaiTextInput label="Prompt" description="What to generate" />
  <CivitaiButton variant="filled" onClick={onGenerate}>Generate</CivitaiButton>
</CivitaiCard>
```

Zero setup: the elements are self-styling (shadow DOM, `:host` rules reading
`--civitai-*`) and inject the `@civitai/theme` tokens into the document
themselves on first mount. No stylesheet to import, no provider to mount.

Handlers receive the **DOM event**, not an extracted value —
`onChange={(e) => e.currentTarget.value}`, `onVote={(e) => e.detail}`. Field
elements re-dispatch the native `change`, which commits on blur/Enter exactly
as a native input does.

## Entry points

The root barrel re-exports every **presentational** binding, and importing it
registers all of them. Import a single binding by path when bundle size
matters — that pulls in its element and nothing else:

```tsx
import { CivitaiButton } from '@civitai/components-react/elements/civitai-button';
import { CivitaiTag } from '@civitai/components-react/elements/civitai-tag';
```

Two bindings act as the viewer through `@civitai/sdk` and are deliberately
**out of the barrel**, so that dependency never enters the graph implicitly.
Import them by path:

```tsx
import { CivitaiSignInButton } from '@civitai/components-react/elements/civitai-sign-in-button';
```

The bindings are generated from the elements manifest. A parity test fails if a
committed file stops matching a fresh generation, two more fail if the event map
names an event no element fires or misses one an element does, and a further
guard fails if anything that is not a generated binding appears under `src/`.

## Server rendering

**Best-effort.** `@lit/react` assigns props as properties from effects, which do
not run on the server, so a wrapper emits a bare tag and the element fills in
after hydration. Where server output matters, write the `<civitai-*>` tag
directly in JSX — attributes survive server-side and the elements reflect them
— or keep SEO-critical copy in ordinary HTML.

This is the accepted cost of collapsing the React layer onto the elements; it
is why the `next-app` starter marks its demo `'use client'` and keeps its
headings in plain markup.

## Tests

- `pnpm --filter @civitai/components-react test` — node suite: generation
  parity, the event map, entry-point shape, and the guard that keeps this
  package downstream (nothing but generated bindings under `src/`).
- `pnpm --filter @civitai/components-react test:browser` — real headless
  Chromium: the binding mechanics (property assignment, refs, typed custom
  events, shadow-root `change` retargeting) and an axe a11y sweep over every
  component family in light and dark, plus an opt-in visual-regression layer
  (`VITE_RUN_VR=1`).

On NixOS, point Playwright at a system Chromium:
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=$(nix-shell -p chromium --run 'command -v chromium') pnpm --filter @civitai/components-react test:browser`.
