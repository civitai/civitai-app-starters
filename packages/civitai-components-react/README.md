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
```

Components: `Button, TextInput, Textarea, NumberInput, Card, Stack, Group,
Alert, Loader, Badge`. Each renders the exact markup documented in
[`@civitai/components/MARKUP.md`](../civitai-components/MARKUP.md).

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
