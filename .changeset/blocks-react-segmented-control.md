---
'@civitai/blocks-react': minor
---

Add `SegmentedControl` to the `/ui` component pack — a horizontal view/tab
switcher (`role="tablist"`), the primitive block authors previously hand-rolled
as a Group-of-Buttons. Controlled: `data` (segments) + `value` + `onChange(value)`.
Supports `size` (`sm | md | lg`), `fullWidth` (equal-width segments), per-segment
and whole-control `disabled`, and ArrowLeft/ArrowRight roving selection across the
enabled segments (roving tabindex, focus follows). Zero-dep and auto-themed via the
existing `--ci-color-*` tokens (correct in light + dark).
