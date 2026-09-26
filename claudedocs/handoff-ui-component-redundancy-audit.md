# Handoff: ui-component-redundancy-audit — 2026-09-26

## Run this first — the index, one command
```bash
cairn recall --repo /home/zach/workspace/civit/civitai-app-starters
```
Terse pointers this doc does not carry, curated by past sessions and outliving it.
🔴 RECALL, NOT LIVE OBSERVATION — every line is a pointer to VERIFY, never a current
reading, and it may describe a gotcha already fixed. `scope-absent`/`scope-empty` means
nothing is recorded yet: ordinary, not an error, and not a clean bill of health.
Non-blocking: if it exits non-zero, print the stderr line and carry on.

## Goal
Map the monorepo's three UI component layers for the user (what each component is and
which package owns it), then audit them for redundancy — duplicated CSS, drift between
packages, dead code. Read-only session; the deliverable is the findings below, not code.
- **closing-condition:** `check` — the three cross-package CSS drift findings (F1
  SegmentedControl, F2 Slider, F3 Select) are either FIXED by single-ownership
  consolidation or FILED as GitHub issues carrying their file:line evidence;
  a verdict of ADDRESSED closes this arc, otherwise name the one item still open.

## State now
- **Branch/PR:** none — read-only session; no commits, no PR. Primary clone sits on
  `main` behind origin/main by 7, with PRE-EXISTING dirty `pnpm-workspace.yaml` (1 line)
  and untracked `apps/` — not this session's work.
- **DONE this session:** explained the three UI layers (`@civitai/components` attribute
  CSS + ~46 Lit elements, `@civitai/components-react` bindings, `@civitai/blocks-react/ui`
  pack); confirmed the web components question (~46 `<civitai-*>` Lit elements, contract
  in `custom-elements.json`); ran the CSS-redundancy audit — findings under Defects.
- **DONE 2026-09-26 (session 2):** the component-API half — ran INLINE, not via subagent
  (the two prior dispatch failures are under Gotchas). Findings C1–C8 + the structural
  root cause under Defects. Evidence is first-hand file:line reads plus a `tsc` probe
  for the two silent-divergence claims (control matrix in How to verify).
- **IN FLIGHT:** nothing. Both halves of the audit are complete; what remains is
  REMEDIATION (Next steps), which is a separate single-ownership decision (#358).
- **Deploy/verify:** N/A — nothing shipped. Findings are agent-measured with verbatim
  file:line quotes; NOT independently re-verified (spot-checks in How to verify).
- clawgate resolve: exit 5 NOTHING RESOLVED (0 tasks; positive control answered 1 link
  for a known-good session id, so the board is reachable) ⇒ no clawgate-task field, by rule.

## Next steps (ranked)
1. File C1/C2/C3/C7 (the four behavioural divergences from the now-complete
   component-API audit — all a11y- or correctness-affecting) as GitHub issues, or fix
   them under the same single-ownership decision as F1–F3. forcing: none — they are
   recorded below with file:line evidence, so nothing is lost by waiting for #358.
2. Decide single ownership of slider + segmented-control + select styling (the #358
   decision the components README points at), then fix F1/F2/F3 from Defects.
   forcing: none
3. Stop shipping the unnameable `dist/utilities.generated.js` (19,549 B in the tarball,
   no `./utilities` export key): add `"!dist/utilities.generated.*"` to `files` or
   export it deliberately. forcing: none
4. Fix the stale "8px radius" claim in blocks-react README § W6 (tokens are 4px;
   styles.ts:30 itself documents the repaint). forcing: none

## Defects (batched)
Audit findings from the completed CSS-redundancy audit (read-only subagent, 2026-09-26),
ranked drift > duplication > self-duplication > vestigial:
- F1 SegmentedControl drift — base
  `packages/civitai-components/src/components.css:649-704` vs
  `packages/civitai-blocks-react/src/ui/styles.ts:382-438`; 10+ divergent values
  (wrapper padding 4px vs 3px; background segmented-bg vs surface-2; segment radius
  calc−1px vs calc−3px; sizes sm 26/10/12 vs 24/12/13, md 30/14/13 vs 30/16/14,
  lg 38/18/15 vs 38/20/16; selected color --civitai-color-text via aria-selected vs
  --civitai-color-primary via data-active — SegmentedControl.tsx:124-125 sets BOTH
  attributes so both rules match; disabled 0.5 vs 0.55; focus offset 2px vs 1px).
  styles.ts:60-61 claims the selectors are DISJOINT so the two never conflict — false
  for this component. Blocks rules are unlayered, base rules sit in
  `@layer civitai.components`, so blocks wins every conflict while non-conflicting
  base declarations still compose; the composed render is a mixture of both designs.
- F2 Slider drift — `components.css:588-638` vs `styles.ts:70-161`: wrapper gap 6px
  vs 4px; value readout 13px/600 (sheet) vs 13px/500 (blocks); base
  `input[type=range]` `appearance:none` (615-626) defeats blocks' `accent-color`;
  focus offset 4px vs 2px. styles.ts:73-74 docstring says the wrapper rule is scoped
  to text-input/textarea/number-input — components.css:121-128 also scopes select and
  598-602 styles the slider wrapper.
- F3 Select wrapper duplication — `styles.ts:75-80` byte-identical to
  `components.css:121-128`; pure duplicate, no drift yet.
- Self-duplication inside packages: alert↔toast close buttons 9/9 identical
  declarations (`components.css:429-440` vs `:762-773`; body/title pairs also
  identical); focus ring `outline: 2px solid var(--civitai-color-primary)` repeated
  7× (4× components.css: 224-228, 627-630, 696-699, 708-711; 3× styles.ts: 158-161,
  267-270, 428-431) with no `--civitai-focus-*` token in @civitai/theme; shadow-DOM
  styles are hand-maintained parity copies of the sheet with NO guard
  (`civitai-badge.ts:36-79` ≡ sheet 474-519; `choice-styles.ts:4-54` ≡ 198-238;
  `field-base.ts:12-71` ≡ 129-184; `civitai-segmented-control.ts` carries a THIRD
  copy of the segment sizes 30/26/38).
- Vestigial: `dist/utilities.generated.js` ships in the published tarball with no
  export key — the same pattern the repo already fixed for `dist/css` (test
  css-slice.test.ts:333-391).
- Stale doc: blocks-react README § W6 (~line 1198) still advertises "8px radius";
  styles.ts:30 itself documents "radius 8px→4px".
### Component-API half (C1–C8, session 2, measured inline 2026-09-26)
Scope: the 13 components that exist in BOTH React surfaces (Alert, Badge, Button, Card,
Group, Loader, NumberInput, SegmentedControl, Select, Slider, Stack, Textarea,
TextInput). Ranked SILENT-divergence > a11y/contract > duplication.

🔴 The organising distinction is LOUD vs SILENT. Most API differences between the two
surfaces are LOUD — blocks-react's controlled `value`/`onChange(value)` model vs
components-react's native React events means `tsc` REJECTS a naive port. Those are a
deliberate API choice, not a hazard. The findings below are the SILENT ones: code that
compiles clean against BOTH surfaces and behaves differently at runtime.

- 🔴 **C1 `<Alert onClose={fn}>` is silently NON-DISMISSIBLE in blocks-react.**
  components-react renders the dismiss button whenever `onClose != null`
  (`civitai-components-react/src/Alert.tsx`, `{onClose != null ? <button …` with
  `closeLabel = 'Dismiss'`). blocks-react gates rendering on a SEPARATE prop —
  `civitai-blocks-react/src/ui/Alert.tsx:39` `withCloseButton = false`, `:65`
  `{withCloseButton ? (` — and merely CALLS `onClose` at `:70`. So the same JSX yields a
  dismissible alert on one surface and a dead-end alert on the other, with no type
  error (proven: tsc probe, 0 errors both arms). The a11y label also diverges in name
  AND default: `closeLabel`/`'Dismiss'` vs `closeButtonLabel`/`'Close alert'` (`:41`) —
  that half IS loud (excess-property error).
- 🔴 **C2 SegmentedControl ARIA role model — blocks-react is the outlier of THREE, and
  emits `role="tab"` with no panel.** The other two layers agree with each other:
  the Lit element `civitai-components/src/elements/civitai-segmented-control.ts:177,189`
  is `role="radiogroup"`/`role="radio"`+`aria-checked`; components-react
  `src/SegmentedControl.tsx:140,157,160` is mode-switched — `radiogroup` by DEFAULT,
  `tablist`/`tab` only via `mode="tabs"`, and only then with `aria-controls`.
  blocks-react `src/ui/SegmentedControl.tsx:108,122,124` HARDCODES `role="tablist"` /
  `role="tab"` / `aria-selected` and passes **no `aria-controls`** — a tab owning no
  tabpanel. The repo's own in-tree authority says this is the wrong pattern for the
  panel-less view-switcher case that blocks actually use it for: components-react
  `SegmentedControl.tsx:9-14` documents `radiogroup` as "the correct pattern" for a
  panel-less value switch, and the Lit element at `:21` records WHY it cannot do tabs
  ("a tab's `aria-controls` is an IDREF, and an IDREF cannot reach a panel" across the
  shadow boundary). No `mode` escape hatch exists on the blocks side.
- 🔴 **C3 SegmentedControl keyboard nav — blocks-react implements 2 of the 6 keys the
  other two layers implement**, i.e. three independent roving-tabindex implementations
  of one WAI-ARIA pattern, one of them partial. Lit element `:17`
  `NAV_KEYS = ['ArrowRight','ArrowLeft','ArrowUp','ArrowDown','Home','End']` with
  wrapping (`:148`, `:158-162`); components-react `SegmentedControl.tsx:114` the same
  six, wrapping, `:70` "BOTH modes implement the WAI-ARIA roving tabindex". blocks-react
  `src/ui/SegmentedControl.tsx:83` handles **only** `ArrowRight`/`ArrowLeft` — no
  Up/Down, no Home/End — while its own docstring `:33-35` advertises the `role="tablist"`
  primitive. Keyboard users of a block hit a control that is missing half the pattern.
- 🔴 **C4 the `gap` PRESET tokens are silently inert in blocks-react.** components-react
  types `gap` as the preset union (`src/Stack.tsx:5` `export type Gap = 'sm'|'md'|'lg'`)
  and emits it as an ATTRIBUTE for the sheet to match (`Stack.tsx:19`, `Group.tsx:18`
  `data-gap={gap}`). blocks-react types it as `string | number` (`src/ui/Stack.tsx:7`)
  and writes it INLINE through `toLength` (`:14-17`, `:33` `gap: toLength(gap)`). Because
  `string` accepts `'md'`, **`<Stack gap="md">` type-checks against BOTH** (proven: tsc
  probe, 0 errors) — but on the blocks side it becomes the inline declaration `gap: md`,
  which is not a valid `<length>`. ⚠ SCOPE: I measured the COMPILE step, not a browser
  render; that an invalid value is dropped by CSSOM is spec, not something I observed
  here. The reverse direction (`gap={12}`) IS loud — it is the negative control that
  fired in the probe.
- **C5 `toLength` is copy-pasted verbatim inside ONE directory** — `src/ui/Stack.tsx:14-17`
  and `src/ui/Group.tsx:16-19`, character-identical, no shared import. Mechanically
  confirmed as the only two copies in the tree (`find … | xargs grep -ln 'function
  toLength'` → exactly those two files). One rule, two places.
- **C6 field chrome: ONE abstraction on one surface, FIVE hand-rolled copies on the
  other.** components-react factors it into `src/internal/field.tsx` — `useFieldIds`
  (`:25`), `describedBy` (`:32`), `FieldChrome` (`:45`), `ChoiceChrome` (`:102`) —
  consumed by 6 controls. blocks-react re-implements the identical wiring inline in
  FIVE files: TextInput (`:47-52`), Textarea (`:55-60`), Select (`:71-76`), NumberInput
  (`:76-81`), Slider (`:66-71`) — each doing its own `useId()`, its own
  `` `${id}-desc` ``/`` `-err` `` id derivation, its own describedBy join, and its own
  label/asterisk/description/error JSX. They have ALREADY drifted from one another —
  see C7, which is exactly the N−1 disagreement an open-coded predicate produces.
- 🔴 **C7 the Slider value read-out violates the design system's OWN markup contract,
  invisibly.** `civitai-components/MARKUP.md:241` and its example at `:261` specify
  **`<output data-civitai-ui-slider-value for="ID">`**; components-react complies
  (`src/Slider.tsx:84` `<output htmlFor={ids.inputId} data-civitai-ui-slider-value>`).
  blocks-react emits `<span data-civitai-ui-slider-value>{value}</span>`
  (`src/ui/Slider.tsx:94`) — not an `<output>`, no `for` association. It LOOKS correct
  because both sheets select on the ATTRIBUTE, not the element
  (`components.css:609`, `blocks .../ui/styles.ts:143`), so the styling is identical
  while the implicit `role="status"` live region and the control association are gone.
- **C8 `<Badge>` default variant diverges** — `'filled'`
  (`civitai-components-react/src/Badge.tsx:24`) vs `'light'`
  (`civitai-blocks-react/src/ui/Badge.tsx:48`), across an IDENTICAL `BadgeVariant`
  union (`'filled'|'light'|'outline'` on both). Same markup, different default render,
  no type error. Lowest severity of the silent set — cosmetic, not behavioural.

🔴 **Structural root cause — NO test loads both surfaces, so C1–C8 are invisible to a
fully green suite.** Each package's parity test is scoped to ONE surface and compares it
to an EXTERNAL oracle, never to its sibling: components-react's
`html-vs-react-parity.browser.test.tsx` compares its own HTML arm to its own React arm;
blocks-react's `ui-token-parity.browser.test.tsx` compares blocks-react's computed styles
to LITERAL `@civitai/theme` token hexes (its header states this scope explicitly).
Mechanical check: zero files under any `packages/*/test/` import `components-react`
alongside the blocks surface. Both tests are good at what they pin — and both are
structurally blind to prop names, prop DEFAULTS, ARIA roles, key handling and element
choice, which is every finding above. Note also that ui-token-parity already ledgers
intended VISUAL differences as `[approved delta]`; C1–C8 are the behavioural divergences
that have no such ledger and no owner.

- Verified NOT redundant (no action): blocks-react deliberately injects the whole
  components pack (`styles.ts:448` BLOCKS_UI_STYLES, `:474` inject; guarded by
  css-slice.test.ts:455-471); `components-react/src/styles.ts` is 17 lines with zero
  CSS of its own; INTERACTIVE_STYLES measured 11,996 chars — Modal, Collapse and
  ResourceCard are genuinely package-local (no base-sheet counterpart).
- Verified NOT redundant, component-API half (checked and CLEAN — do not re-audit):
  **style injection is properly delegated, not duplicated** — blocks-react's
  `injectBlocksStyles` calls `@civitai/components`' own `injectComponentsStyles` for
  tokens + presentational CSS and only adds its own marked `<style>` for the
  interactive-5 (`src/ui/styles.ts`, the `injectBlocksStyles` body), and
  `components-react/src/styles.ts` is 17 lines that merely re-export `injectStyles`.
  **No dead component files** — every `.tsx` in BOTH `civitai-components-react/src/`
  and `civitai-blocks-react/src/ui/` is named in its own `index.ts` (checked
  mechanically per-file; zero unexported on either side).
  **`aria-required` does NOT drift** — present on the control in 6 components-react
  files and all 5 blocks-react field components.
  **`data-civitai-ui-range` is not a contract violation** — it is blocks-private and
  styled only by blocks' own sheet; BOTH surfaces deliberately keep the range input off
  `data-civitai-ui-control` (components-react `Slider.tsx:23`, `MARKUP.md:246`).
  **The controlled-vs-native prop-model split is LOUD** (tsc rejects a port), so it is
  an API choice, not a silent hazard — see the LOUD/SILENT note above C1.

## Gotchas / decisions / dead-ends
- Subagent dispatch failure modes hit this session: the general agent died once on
  OpenRouter credits ("requested up to 32000 tokens, but can only afford 5811"), and
  re-dispatches returned a MISROUTED result — an env-var survey matching nothing in
  the prompt. Do not trust a resumed/misrouted task result that is off-topic; either
  re-dispatch with a leaner prompt or run the audit inline.
- The three UI layers are DELIBERATE parallel surfaces enforced by parity tests
  (html-vs-react computed-style parity, contract tests, entry-point tests). The
  existence of parallel layers is not redundancy; flag only divergence, copy-pasted
  logic, bypassed patterns and dead code.
- The primary clone is SHARED and must never be committed to directly (AGENTS.md):
  any fix from the next steps goes through a throwaway worktree off origin/main.
- Clawgate: this session resolved to NO task (exit 5 with positive control). Never
  mint a task to fill the field; authoring is its own interviewed flow.

## How to verify
- Spot-check F1: read `packages/civitai-components/src/components.css:649-704`
  alongside `packages/civitai-blocks-react/src/ui/styles.ts:382-438` and
  `packages/civitai-blocks-react/src/ui/SegmentedControl.tsx:124-125`.
- Byte-check F3: diff the declarations at `components.css:121-128` against
  `styles.ts:75-80`.
- **Re-run the C1/C4 silent-divergence probe (the load-bearing measurement).** Both
  packages must be BUILT first (the probe reads `dist/`, which is what consumers get).
  Put a `.readme-snippets-tmp/` dir (already gitignored) inside
  `packages/civitai-blocks-react/` — that location is what makes `react` resolve under
  pnpm — holding a `tsconfig.json` (`jsx: react-jsx`, `moduleResolution: bundler`,
  `strict`, `noEmit`, `skipLibCheck`) and a `probe.tsx` importing
  `'../../civitai-components-react/dist/index.js'` and `'../dist/ui/index.js'`, then
  asserting `<Alert onClose={()=>{}}>`, `<Stack gap="md">` on BOTH surfaces plus the
  NEGATIVE CONTROL `<CR.Stack gap={12}>`. Run
  `./node_modules/.bin/tsc -p .readme-snippets-tmp/tsconfig.json` from the package dir
  and **COUNT the `error TS` lines, do not read the exit code**.
  🔴 Expected matrix, measured 2026-09-26: **exactly 1 error**, and it is the negative
  control (`probe.tsx(14,29): error TS2322: Type 'number' is not assignable to type
  'Gap | undefined'`). The 1 proves the instrument can go red; the 0 on the four claim
  lines is the finding. A run reporting 0 errors TOTAL means the probe is wired to
  nothing (stale/missing `dist`) — not that the divergence is gone. Delete the dir
  afterwards.
- Spot-check C2/C3 (no build needed): read `role=`/`aria-` and the keydown handler in
  all three at once — `civitai-components/src/elements/civitai-segmented-control.ts:17,177,189`,
  `civitai-components-react/src/SegmentedControl.tsx:9-14,114,140,157,160`, and
  `civitai-blocks-react/src/ui/SegmentedControl.tsx:83,108,122,124`.
- Re-price the split decision the README pins: `pnpm measure:css-split` from repo root
  (`MEASURE_CARRIERS=1` for per-package attribution).
- Audit the doc: `python3 ~/workspace/devrc/scripts/handoff-audit.py claudedocs/handoff-ui-component-redundancy-audit.md`
