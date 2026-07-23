---
"@civitai/blocks-react": minor
---

🎨 **VISIBLE REPAINT — `@civitai/blocks-react/ui` migrated onto the published design system** (civitai/civitai-app-starters#185).

The `/ui` component pack no longer bundles its own private `--ci-*` token palette or the CSS for its 10 presentational components. It now **delegates** to the published design-system packages **`@civitai/theme` + `@civitai/components` (0.1.2)** — added as runtime dependencies — and keeps only the 5 interactive components' CSS in-package (Modal / Select / Slider / Collapse / SegmentedControl), repointed onto the `--civitai-*` tokens. `injectBlocksStyles()` now injects three separately-marked `<style>`s (theme tokens + components CSS + the interactive-5 sheet); each has its own idempotency marker so they compose cleanly in the sandbox iframe.

**This changes how live App Blocks LOOK.** The design-system tokens differ from the retired `--ci-*` palette — the visible deltas are:

- **Corner radius 8px → 4px** (all buttons, inputs, cards, alerts, modal, segmented control).
- **Success green → teal** (light `#2f9e44` → `#299C7A`, dark `#51cf66` → `#326D5C`) — Button/Badge `color="success"`, Alert `color="success"`.
- **Dark primary `#228be6` → `#1971C2`** (filled buttons/badges + accents in dark theme).
- **Dark hover direction reverses** (`colorPrimaryHover` `#339af0` → `#1864AB`): filled buttons/badges now **darken** on hover in dark mode instead of brightening.
- **SegmentedControl track `#f4f4f5` → `#fefefe`** (in light; the active pill now separates from the track by shadow, not background).
- Smaller error / warning / info / border / text / font-stack shifts.

**Why minor (pre-1.0 breaking signal):** this is a behavioral break — the visual repaint plus the `--ci-*` → `--civitai-*` inline-var rename (any block author who overrode `--ci-color-primary` etc. directly must update to `--civitai-color-primary`). Per this repo's pre-1.0 convention a **minor** is the breaking signal; flag for the maintainer if you'd rather cut a **major** to shout it louder.

**Rollout is per-app, NOT instant.** Block CSS is bundled **per-app**, so publishing this package repaints a given block **only when that block's author bumps `@civitai/blocks-react` and redeploys** — the repaint rolls out gradually, app by app. **Rollback = pin the previous `@civitai/blocks-react` version** in the affected app and redeploy.

**Public API preserved.** All `/ui` components keep their props and markup contract. The Badge `color` prop still accepts any CSS color string (kept the inline `--civitai-color-primary` override rather than mapping to `@civitai/components`' new `data-color`, which only covers the 4 named intents).
