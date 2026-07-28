---
"@civitai/components": minor
"@civitai/components-react": minor
---

Add five new UI primitives so App Blocks stop hand-rolling them: **Slider**,
**SegmentedControl / Tabs**, **Toast**, **Tooltip**, and **Image**.

Each ships in both consumption forms — framework-agnostic
`data-civitai-ui="…"` markup (styled by `@civitai/components`, contract in
`MARKUP.md`, all rules inside `@layer civitai.components`, token-driven via
`--civitai-*`) and an ergonomic `forwardRef` React binding in
`@civitai/components-react`. The interactive ones carry real behavior in the
React binding:

- **Slider** (`data-civitai-ui="slider"`) — themed native `<input type="range">`
  with label/description/error field wiring, invalid state, and an optional live
  value read-out (also mirrored to `aria-valuetext` for screen readers).
- **SegmentedControl / Tabs** (`data-civitai-ui="segmented-control"` +
  `TabPanel`) — WAI-ARIA **roving tabindex** + **arrow-key / Home / End
  navigation** (selection follows focus) in two role modes: `'toggle'` (default)
  = `role="radiogroup"`/`role="radio"` for a panel-less value switch, and
  `'tabs'` = `role="tablist"`/`role="tab"` with `aria-controls` ⇄
  `aria-labelledby` tab-panel semantics.
- **Toast** (`ToastProvider` + `useToast`, presentational `Toast`,
  `data-civitai-ui="toast-region"`) — an `aria-live` notification host with a
  queue, auto-dismiss timers, and intent colors.
- **Tooltip** (`data-civitai-ui="tooltip"`) — a hover/focus `role="tooltip"`
  bubble with `aria-describedby` wiring and real Escape-to-dismiss (a
  `data-dismissed` flag overrides the CSS reveal even while hovered/focused).
- **Image** (`data-civitai-ui="image"`) — a media container with a token
  placeholder background, `object-fit` control, and broken-image fallback
  driven by `data-status`.

Covered by probe-oracle styling anchors, HTML⇄React computed-style parity, and
axe a11y checks (keyboard nav for SegmentedControl, `aria-live` for Toast).
