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
- **IN FLIGHT:** the component-API half of the redundancy audit — subagent failed twice
  and never ran to completion.
- **Deploy/verify:** N/A — nothing shipped. Findings are agent-measured with verbatim
  file:line quotes; NOT independently re-verified (spot-checks in How to verify).
- clawgate resolve: exit 5 NOTHING RESOLVED (0 tasks; positive control answered 1 link
  for a known-good session id, so the board is reachable) ⇒ no clawgate-task field, by rule.

## Next steps (ranked)
1. Finish the component-API audit: props divergence between
   `@civitai/components-react` and `@civitai/blocks-react/ui` for the same component,
   copy-pasted logic (focus management, style injection), dead/unconsumed exports —
   excluding what the parity/contract tests already pin.
   forcing: user — this session's only instruction was "dispatch to audit for
   redundancy", and the component half never ran (subagent died on credits, then a
   re-dispatch returned a misrouted result).
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
- Verified NOT redundant (no action): blocks-react deliberately injects the whole
  components pack (`styles.ts:448` BLOCKS_UI_STYLES, `:474` inject; guarded by
  css-slice.test.ts:455-471); `components-react/src/styles.ts` is 17 lines with zero
  CSS of its own; INTERACTIVE_STYLES measured 11,996 chars — Modal, Collapse and
  ResourceCard are genuinely package-local (no base-sheet counterpart).

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
- Re-price the split decision the README pins: `pnpm measure:css-split` from repo root
  (`MEASURE_CARRIERS=1` for per-package attribution).
- Audit the doc: `python3 ~/workspace/devrc/scripts/handoff-audit.py claudedocs/handoff-ui-component-redundancy-audit.md`
