# @civitai/components-react

Thin React bindings over [`@civitai/components`](../civitai-components) —
`forwardRef` wrappers that render the framework-agnostic `data-civitai-ui`
markup and auto-inject the stylesheet + `--civitai-*` tokens. Presentational
only; this is **not** a replacement for `@civitai/blocks-react` (which stays the
home of the transport hooks + block-authoring components).

```tsx
import { Button, TextInput, Alert } from '@civitai/components-react';

<Button variant="filled" onClick={onGenerate}>Generate</Button>
<TextInput label="Prompt" error={err} />
<Alert color="success" title="Saved">Your changes are live.</Alert>
<Badge color="success" variant="light">ready</Badge>
```

`Badge` takes an optional `color` (`info | success | warning | error`, mirroring
`Alert`); omit it for the default primary accent.

Components: `Button, TextInput, Textarea, NumberInput, Card, Stack, Group,
Alert, Loader, Badge`. Each renders the exact markup documented in
[`@civitai/components/MARKUP.md`](../civitai-components/MARKUP.md).

## Elements

React bindings for every `<civitai-*>` custom element, built on
[`@lit/react`](https://lit.dev/docs/frameworks/react/). Props and their types
come from the element class, refs point at the element itself, and values are
assigned as **properties** — which is what React 19 gets wrong on its own, and
why these exist at all.

```tsx
import { CivitaiButton } from '@civitai/components-react/elements/civitai-button';
import { CivitaiTag } from '@civitai/components-react/elements/civitai-tag';

<CivitaiButton variant="outline" onClick={run}>Generate</CivitaiButton>
<CivitaiTag name="wolf" confidence={0.82} onVote={(e) => save(e.detail)} />
```

Import a binding by name and you get that element and nothing else. The
`@civitai/components-react/elements` barrel is the convenient path and registers
all 32.

Handlers receive the **DOM event**, not an extracted value —
`onChange={(e) => e.target.value}`, `onVote={(e) => e.detail}`. The bindings are
generated from the elements manifest; a parity test fails if a committed file
stops matching, and two more fail if the event map names an event no element
fires, or misses one that an element does.

**Server rendering** is best-effort: property assignment happens in effects,
which do not run on the server, so the wrapper emits a bare tag and the element
fills in after hydration. The tag written directly in JSX keeps its attributes
server-side and the elements reflect them, so that is the path to use where
server output matters.

## The point of this package

It proves the **dual-consumption** claim: the `html-vs-react-parity` browser
test renders each component both as React and as hand-written HTML with the same
`data-*` attributes, then asserts **identical** `getComputedStyle()` in light
and dark. Passing means external authors can ship plain HTML that looks
byte-identical to the React path.

## Tests

- `pnpm --filter @civitai/components-react test` — happy-dom unit suite (markup
  + ARIA contract).
- `pnpm --filter @civitai/components-react test:browser` — real headless
  Chromium: HTML-vs-React computed-style parity (light + dark) + axe a11y, plus
  an opt-in visual-regression layer (`VITE_RUN_VR=1`).

On NixOS, point Playwright at a system Chromium:
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=$(nix-shell -p chromium --run 'command -v chromium') pnpm --filter @civitai/components-react test:browser`.
