---
"@civitai/theme": minor
"@civitai/components": minor
"@civitai/components-react": minor
---

Design-system minor release (0.2.0, lockstep) — resolves the three deferred DX items from #181.

**F5 — default light-mode Card hairline (VISIBLE CHANGE).** In light mode `--civitai-color-surface` equals `--civitai-color-body`, so a borderless `Card` was invisible against the page. Cards now render a subtle default hairline (a low-alpha mix of the border token) so a Card *without* `data-with-border` is still visible. `data-with-border="true"` remains the stronger, fully-opaque explicit border. Dark mode already differentiates surface from body and is visually unchanged. **Consumer impact:** any previously-borderless light-mode Card now shows a faint edge — intended, but review if you relied on an edgeless card.

**F6 — new `checkbox` / `radio` / `select` components (new permanent public API).** `@civitai/components` gains `data-civitai-ui="select"` (native `<select>` on the shared `-control` field chrome), `data-civitai-ui="checkbox"` / `"radio"` (themed native inputs — `accent-color` tint + custom sizing/focus-ring/disabled, box+label in a `-choice` row), and `data-civitai-ui="radio-group"` (`role=radiogroup` layout). `@civitai/components-react` adds the matching `Select` / `Checkbox` / `Radio` / `RadioGroup` `forwardRef` bindings. See `MARKUP.md` for the full markup + ARIA contract.

**F7 — richer neutral token ramp.** `@civitai/theme` now exposes the full 10-step Mantine gray ramp as `--civitai-color-gray-0` … `--civitai-color-gray-9` (`colorGray0`…`colorGray9` in the typed export), generated through the token pipeline from the drift-guarded `gray` tuple. Additive — the existing semantic neutrals are unchanged.
