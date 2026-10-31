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
- 🔴 **THE ARC IS CLOSED 2026-09-27 (session 4). Verdict: ADDRESSED.** The frozen
  closing-condition offered FIXED **or** FILED; it is satisfied by FILED. The three
  cross-package stylesheet drift findings are now issues, each carrying re-measured
  file:line evidence and its own `## Closing condition`:
  **#482 (F1 SegmentedControl) · #483 (F2 Slider) · #484 (F3 Select)**. The single-ownership
  decision those three converge on is #358 and is the operator's call — it was never part of
  this arc's condition, which is why filing closes it rather than waiting.
- **Rank 2 DONE — the two falsified public issues are corrected.** #328 was commented and
  **retitled** off the dead "34 identical names" framing onto the surviving comparison
  (`blocks-react/ui` vs the `<civitai-*>` elements); #357 was commented — its blocks-react
  half is untouched and it stays open as filed. Both comments carry the measurements and a
  `## Closing condition`.
- **Branch/PR:** #478 MERGED (`a65190f`) and #480 MERGED (`0ea7b00`). 🔴 **This doc still has
  never been on mainline** — it lives only on `docs/handoff-ui-component-redundancy-audit`
  via **PR #473, still OPEN**. Primary clone sits on `main` behind origin/main with the
  PRE-EXISTING dirty `pnpm-workspace.yaml` (1 line) and untracked `apps/` — still not this work.
- **DONE 2026-09-26 (session 2):** the component-API half of the audit, run INLINE. Findings
  C1–C8 + the structural root cause under Defects — ⚠ read the C1 RETRACTION there before
  re-filing anything from that list.
- **DONE 2026-09-27 (session 3) — the REMEDIATION shipped.** `@civitai/components-react`'s `.`
  entry re-exports the generated `@lit/react` element bindings; the 22 hand-written components,
  `internal/field.tsx` and `styles.ts` are deleted, guarded by a test that fails if anything
  but a generated binding appears under `src/`.
- 🔴 **DONE 2026-09-27 (session 4) — THE RELEASE IS COMPLETE. All six packages agree.**
  `@civitai/sdk@0.8.0` was **NOT staged**; a plain E503 publish failure, cured by re-running
  the failed job of Release `36283050923` (attempt 2 `completed/success`, tag pushed, assert
  green). Verified by RESOLVING in a clean dir, with `@0.99.0` as the ETARGET control. Live
  matrix all OK: app-sdk 0.51.2 · sdk 0.8.0 · blocks-react 0.58.1 · theme 0.4.0 ·
  components 0.8.1 · components-react 0.9.0.
- **DONE 2026-09-27 (session 4) — the arc audited ask-by-ask.** All three sessions resolved and
  every operator-typed message read: opencode `ses_f2483102dffewgcn50h0EisEia` (6 typed),
  Claude `e13c3ec0-3ff4-4226-b81c-9021398cb37a` (7 typed), Claude
  `82a9c2bd-6abd-4188-809b-5e7fe61b59fe` (this one). Everything the operator asked to SHIP
  shipped; the audit's own output was the gap, and filing closed it.
- **Dead code removed:** a visual-regression suite that had never run anywhere; an axe sweep
  duplicating the sibling package's (9 unique cases migrated into `@civitai/components`);
  `src/utilities.generated.ts`; `@civitai/theme` + `@testing-library/*` + `axe-core` from
  components-react; `@civitai/components` from `next-app`.
- **Audited:** round 0 + seven delta rounds, all claims blocks on PR #478. Ended when the
  attribution gate fired (`--round 8`, exit 5) on two consecutive comment-only rounds.
- **Deploy/verify:** merges verified by CONTENT on `origin/main`; publishes verified by
  RESOLVING, never by reading a version string.
- clawgate resolve: **exit 5, NOTHING RESOLVED** (0 tasks). An unknown session id answers 200
  with an empty array, so that zero cannot distinguish "touched no task" from "wrong id" ⇒ no
  `clawgate-task:` field, by rule. Not a clean bill of health.

## Next steps (ranked)
🔴 **The arc is CLOSED — nothing below is another round of it.** The stylesheet work now
lives in #482/#483/#484 and is tracked there, not here. Both items below are honest opt-outs:
nothing external is asking for either, so a session drawing from this queue should skip them.
1. **Merge PR #473** so this doc reaches mainline. Measured cost of it not being there:
   `resume-state.sh` returned `NO SUCH FILE` and reconciled NOTHING; `find-session.py --arc`
   exited unmeasured; `handoff_search` printed `in_scope_docs == indexed_docs == 489`, i.e.
   never indexed. ⚠ Merging fixes only the file-not-found half — see Gotchas on the repo-handle
   gap, which merging does NOT fix. forcing: none
2. **Close Dependabot #270 and #272.** Verified moot: `origin/main`'s
   `packages/civitai-components-react/package.json` has zero `axe`, `@axe-core/*`,
   `@testing-library/*` or `@civitai/theme` entries — the devDeps they bump are gone.
   forcing: none

## Defects (batched)

### 🔴 C1–C8 RECONCILED after the supersession — re-pointed, NOT resolved (2026-09-27)
The supersession deleted `@civitai/components-react`'s hand-written layer, which was one
arm of every C-finding. **That does not close them.** Measured on `origin/main` after the
merge, each divergence survives against the LIT ELEMENT instead:
- ~~**C1 Alert close gate — SURVIVES.** Same silent trap, new pair.~~ 🔴 **RETRACTED
  2026-09-27 — THIS OVERSTATED IT, and the retraction is now public on #328.** Measured: the
  element gates on `this.closable` (`civitai-alert.ts:101`), default `false` (`:85`); blocks
  gates on `withCloseButton` (`Alert.tsx:65`), default `false` (`:39`). **Both sides now
  require an explicit boolean**, so the original trap — the DELETED components-react arm
  rendering the button whenever `onClose != null`, making `<Alert onClose={fn}>` dismissible
  on one surface and a dead end on the other — has no surface left to occur on. What survives
  is a prop RENAME (`closable` vs `withCloseButton`, `closeLabel` vs `closeButtonLabel`),
  which is loud. Do not re-file this as a silent divergence.
- **C8 Badge default — SURVIVES.** `civitai-badge.ts` constructor sets
  `this.variant = 'filled'`; `blocks-react/src/ui/Badge.tsx` defaults `variant = 'light'`.
- **C2/C3 SegmentedControl — SURVIVE, and are now a TWO-way split, not three.**
  `blocks-react/src/ui/SegmentedControl.tsx` still hardcodes `role="tablist"`/`role="tab"`
  with no `aria-controls` and handles only ArrowLeft/ArrowRight; the element is
  `radiogroup`/`radio` with all six nav keys. The mode-switched components-react arm that
  used to sit between them is gone.
- **C5 `toLength` — SURVIVES UNCHANGED.** Still defined verbatim in BOTH
  `blocks-react/src/ui/Stack.tsx` and `Group.tsx`; this was always intra-package.
- **C6 field chrome — SURVIVES UNCHANGED.** All five of blocks-react's field components
  still hand-roll `useId()` + id derivation + describedBy; the abstraction that was
  deleted was components-react's, which is the wrong side.
- **C4 `gap` / C7 Slider read-out — RE-POINTED.** Both were components-react vs
  blocks-react; the surviving comparison is element vs blocks-react and needs re-measuring
  before being re-filed.
- **RESOLVED outright:** only the *structural* root cause — "no test loads both surfaces"
  — because there is no longer a second React surface to load.

### Closed by the supersession
- Old rank 3, `dist/utilities.generated.js` shipping unreachable: the SOURCE is deleted
  and `build-utilities.ts` no longer emits it. The `files[]` exclusion STAYS as
  belt-and-braces — `tsc` does not clean `dist/`, and dropping the line re-packs stale
  artifacts from an incremental tree (verified with `npm pack --dry-run`).

### Original audit findings — CARRIED FORWARD VERBATIM (Defects is a REPLACE bucket)
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

- **The operator chose the breaking shape knowingly.** Three options were put up (stage it
  non-breaking / SSR-first / full supersession now); they picked full supersession and
  accepted the SSR regression. `@lit/react` assigns props as properties from effects,
  which never run on the server, so wrappers emit bare tags that hydrate in. Do not
  "fix" this without re-opening that decision; the remedy is `@lit-labs/ssr` + declarative
  shadow DOM, which is net-new infra.
- 🔴 **A release landed MID-PR and took the version number.** #472 published 0.8.0 while
  #478 was open, so the supersession became 0.9.0 and `<Text>` went from an unpublished
  removal to a PUBLISHED one. 16 prose references had to be retargeted. Expect this again:
  read the CURRENT published version before writing any version into prose.
- 🔴 **A conflicting PR silently stops CI.** When #478 went `CONFLICTING`, GitHub could not
  compute a merge commit and `pull_request` workflows did not run at all — 3 checks
  instead of 20, and the API reported `0 pending`. Assert the expected SET (20 here), never
  the pending count.
- 🔴 **Disjoint files are not safety.** `main`'s new `civitai-text.browser.test.ts`
  imported `src/utilities.generated.js`, which this PR deleted. Both sides green alone,
  red together, in files that never appeared in one diff. Gate on the MERGED tree.
- 🔴 **`xargs -0 command grep` returns 127, not matches** — `command` is a shell builtin
  xargs cannot exec, and the empty output reads as a clean zero. It produced a false
  "no consumers" reading here. Use plain `grep` under xargs.
- 🔴 **Backticks in a `git commit -m '...'` string are command-substituted by zsh** — one
  message actually RAN `pnpm test:guards` and embedded its output. Use `-F <file>`.
- **Lessons the audit ladder produced, each measured:** *rescaling a derived number is not
  re-deriving it* (46/99 → 50/107 preserved a structural omission; the real denominator
  was 349); *verifying the negative is not verifying the positive* (two sentences were
  rewritten off a confirmed "the React export is gone" and asserted element behaviour that
  did not exist); *deleting a count can delete a boundary* (removing a number from a
  comment left "every block below" annexing 28 unrelated cases).
- **Browser tests DO run on this host**, contrary to an earlier reading: the flake's nix
  pins Playwright browser builds 1228/1243 while `playwright@1.60.0` wants 1223, but
  `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/run/current-system/sw/bin/brave` works.
  `vitest.config.ts`'s own `nix-shell -p chromium` advice does NOT (glibc failure).
- **Dependabot #270 and #272** bump `@axe-core/playwright` and `axe-core` — devDeps this
  work REMOVED from components-react. They are now stale; close or let them rebase.
- **~350 leaked headless Brave processes** under `/tmp/audit-pr718-r4 (deleted)` belong to
  a DIFFERENT PR's audit. Left untouched — a `-f` pattern kill would reach sibling agents.

- 🔴 **`npm whoami` is PERMANENTLY E401 on this workbench, so `npm stage list` can NEVER answer
  staged-vs-failed here.** Re-measured 2026-09-27: `whoami` → `E401 Unauthorized`,
  `npm stage list @civitai/sdk` → `E401 Unable to authenticate`. Do not spend a session on that
  probe again. The local instruments are the GIT TAG (above) and the re-run itself; the only
  authenticated route is a human reading npmjs.com/settings/civitai/staged-packages.
- 🔴 **`$CIVITAI` is `/home/zach/workspace/civit/civitai` — a DIFFERENT repo.
  `civitai-app-starters` is in NONE of the four `$DEVRC`/`$HOMELAB`/`$DATAPACKET`/`$CIVITAI`
  handles**, so `find-session.py --arc` and `handoff_search` cannot resolve this repo's handoff
  docs *even after PR #473 merges*. Merging #473 fixes the file-not-found half only. Arc
  resolution here has to be done by keyword: `find-session.py --all-time --all --json
  "<doc-slug>"` found all three sessions (hits 103/58/12) plus three passing mentions (3/2/1).
- 🔴 **`extract_user_msgs.py` reads `~/.claude/projects` ONLY, so it reports an opencode session
  as "NO transcript on this host" when the session is right there in
  `~/.local/share/opencode/opencode-stable.db`.** Read it directly, read-only:
  `sqlite3 file:<db>?mode=ro` → `message`/`part` tables joined on `message_id`, `role='user'`,
  parts where `type='text'`. That recovered session 1's 6 typed messages from 80 records.
- **zsh no-word-splitting bit a version-matrix loop.** `nm=$(...multi-word...)`, then
  `set -- $nm` does NOT split in zsh, so a six-package main-vs-npm comparison printed six
  bogus `MISMATCH` rows with empty values. Parse each field with its own command substitution.
  The tell was the controls: every row failed identically, which a real drift never does.
- **Re-measured line numbers (the doc's F1/F2 coordinates had drifted):** on `origin/main`,
  `components.css` segmented-control is `:673`, slider `:622-663`; the focus-ring declaration
  `outline: 2px solid var(--civitai-color-primary)` repeats **4× in components.css + 3× in
  styles.ts = 7**, and `@civitai/theme` still defines **zero** `--civitai-focus-*` tokens.
  `toLength` is still one copy each in `src/ui/Stack.tsx` and `src/ui/Group.tsx`.
- **Rank 4 of the old list is still live:** `packages/civitai-blocks-react/README.md:1224`
  still advertises "8px radius" while `src/ui/styles.ts:30` documents "radius 8px→4px".

- 🔴 **A `gh issue create` whose `--body-file` argument is a SHELL VARIABLE is BLOCKED, and the
  block is correct.** The closing-condition gate cannot evaluate `$SP/f1.md`, so it refuses
  rather than failing open — a gate that passed an unreadable body would be walkable by
  changing the call's SHAPE instead of its content. Pass a **literal** path, `--body '<md>'`,
  or a heredoc. Cost here: one refused call per issue until the bodies grew a
  `## Closing condition` heading with a `Checked by:` line, which they should have had anyway.
- 🔴 **Filing can satisfy a closing condition that reads like it demands a fix — read the
  `or`.** This arc's condition was *"either FIXED by single-ownership consolidation or FILED as
  GitHub issues carrying their file:line evidence"*, and three sessions treated it as blocked
  on the #358 ownership decision. It was not: the FILED arm needed no decision from anyone and
  closed a four-session arc in one pass. When a condition offers two arms, check which arm is
  actually unblocked before reporting the arc as open.
- 🔴 **An audit finding can get WEAKER when the code changes, and the reconciliation that
  re-points it is where that gets missed.** Session 3's reconciliation carried C1 forward as
  "SURVIVES — same silent trap, new pair". Measured this session: both surviving sides require
  an explicit boolean, so the trap needs the DELETED arm to exist and what remains is a loud
  prop rename. The re-pointing pass checked that *a* divergence still existed and not that the
  *hazard* did. Retracted in Defects and publicly on #328.

## How to verify
- 🔴 **The arc's closing condition, as a command:** all three F-findings are filed, open, and
  carry file:line evidence —
  ```bash
  for n in 482 483 484; do
    gh issue view $n --repo civitai/civitai-app-starters --json number,state,title,body \
      --jq '"#\(.number) \(.state) — refs=\((.body|[scan("(components\\.css|styles\\.ts|Stack\\.tsx|Slider\\.tsx|SegmentedControl\\.tsx):[0-9]+")]|length)) cc=\(.body|test("## Closing condition"))"'
  done
  ```
  Measured 2026-09-27: `#482 OPEN refs=4`, `#483 OPEN refs=8`, `#484 OPEN refs=9`, all
  `cc=true`. ⚠ The regex undercounts — many refs are a bare `:673` after a filename — so read
  it as a floor, not a census.
- **The release is COMPLETE:** from a checkout of `origin/main`, at the REPO ROOT,
  `node scripts/assert-published-versions.mjs` → exit 0, six packages confirmed. 🔴 From
  elsewhere it refuses with "no publishable package found … Refusing to report success for a
  check that inspected nothing" — the guard working, not a pass.
- **The publish resolves, not just reads:** in an empty dir with a stub `package.json`,
  `npm install --prefer-online --package-lock-only @civitai/sdk@0.8.0`, then read
  `package-lock.json` for `node_modules/@civitai/sdk -> 0.8.0`. Control: `@0.99.0` must
  ETARGET and write no lockfile. A clean dir is required — a stale lockfile answers
  `up to date` and proves nothing.
- **The supersession shipped:** `npm view @civitai/components-react version` → `0.9.0`;
  `git ls-tree -r --name-only origin/main -- packages/civitai-components-react/src/` is
  `index.ts` + `elements/` only (49 files).
- **Full local gate** (build first or `blocks-react` fails on an unresolvable import):
  `pnpm -r --filter './packages/**' build && pnpm test && pnpm test:guards &&
  pnpm check:public-types && pnpm typecheck`, plus
  `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/run/current-system/sw/bin/brave pnpm --filter
  @civitai/components test:browser`. Last measured: node 2647 · guards 235 · browser 842 + 7 ·
  public-types rc 0.
- Audit the doc: `python3 ~/workspace/devrc/scripts/handoff-audit.py claudedocs/handoff-ui-component-redundancy-audit.md`
## Open investigations — live diagnosis state

### ~~`@civitai/sdk@0.8.0` is on main but not on npm — staged vs failed is UNSETTLED~~ RESOLVED 2026-09-27 — NOT staged; see the RESOLVED block at the end of this section
🔴 **Retired. Its measurements below are kept as the pre-fix baseline; its Next probe was
DELETED because it cannot be run — `npm whoami` is permanently E401 on this workbench, so
`npm stage list` can never answer here.** What this block got wrong was treating the
authenticated registry read as the *only* discriminator: an absent git tag settles it
locally, and the re-run is itself a safe discriminator when one package remains.
- as-of: 2026-09-26
- **Symptom + exact repro:** `npm view @civitai/sdk version` → `0.7.0`, while
  `origin/main:packages/civitai-sdk/package.json` says `0.8.0`. Reproduce the full
  verdict with `node scripts/assert-published-versions.mjs` from a checkout of
  `origin/main` (exit 1).
- **Observed (with values):** Release run `36283050923` on `0ea7b00` ended
  `completed/failure`. Its log:
  `npm error code E503` · `npm error 503 Service Unavailable - PUT
  https://registry.npmjs.org/@civitai%2fsdk`, then
  `🦋 error packages failed to publish:` and the job's own last line
  `Publish command exited with code 1, but some packages were published:
  @civitai/components@0.8.1, @civitai/…`.
  `npm view @civitai/sdk@0.8.0` → `E404 No match found for version 0.8.0`;
  `npm view @civitai/sdk versions` ends at `0.7.0`.
  `assert-published-versions.mjs` prints OK for the other five and
  `@civitai/sdk@0.8.0 -> HTTP 404 after 5 attempt(s)`.
- **Ruled out:** *registry lag* — the guard re-checks each version for 12s (5 × 3000ms,
  cache-busted) and still 404s. `via: measurement`.
- **Ruled out:** *a defect in #478* — the two packages this work touches both published,
  and the failing PUT names `@civitai/sdk`, which #478 does not modify. `via: command`.
- **NOT ruled out, and this is the open question:** whether npm **STAGED** `0.8.0` or the
  publish simply failed. 🔴 The guard states outright that it **cannot** tell, because it
  reads the registry anonymously and *"an anonymous 404 is byte-identical for a publish
  that failed and for a version npm STAGED instead of publishing"*. An earlier reading in
  this session treated the E404 as proof of "absent"; **that was wrong and is retracted.**
  The two causes need OPPOSITE fixes: a failed publish is fixed by re-running the Release
  workflow; a staged version makes every re-run return
  `E409 Cannot publish over previously staged version` and only a human with 2FA can clear
  it. `RELEASING.md` § "Staged publishing" documents the deadlock.
- **Leading hypothesis — CONFIRMED 2026-09-27:** plain publish failure, NOT staging. The
  documented staged signature is a **2xx** plus `🦋 success packages published successfully`,
  whereas this run got a 503 and printed `packages failed to publish`. It was log evidence
  only when written; the re-run and the absent git tag turned it into a finding.
- ~~**Next probe**~~ **DELETED — it was unrunnable.** It asked for `npm whoami` then
  `npm stage list @civitai/sdk` from this machine; both return E401 and always will. The
  replacement discriminators are in the RESOLVED block at the end of this section.

### RESOLVED 2026-09-27 — `@civitai/sdk@0.8.0` was NOT staged: a plain E503 publish failure, cured by re-running the failed job
- as-of: 2026-09-27
- 🔴 **This SUPERSEDES the block below titled "`@civitai/sdk@0.8.0` is on main but not on npm —
  staged vs failed is UNSETTLED". Its Next probe is VOID — do not run it**, and its framing
  "never a blind re-run" is refined rather than refuted: see the discriminator below.
- **What closed it:** `gh run rerun 36283050923 --failed` → attempt 2 `completed/success`,
  publish step `🦋 success packages published successfully` + `🦋 New tag: @civitai/sdk@0.8.0`
  at 02:03:58Z, assert step green. `npm view @civitai/sdk version` → `0.8.0`.
- **Ruled out — STAGING.** A staged publish would have E409'd (`Cannot publish over previously
  staged version`) forever; the re-run published first try. `via: command`.
- 🔴 **NEW registry-independent discriminator, positive-controlled: THE GIT TAG.** Before the
  re-run, `git ls-remote --tags origin` showed all five published packages' tags PRESENT
  (`components@0.8.1`, `components-react@0.9.0`, `app-sdk@0.51.2`, `blocks-react@0.58.1`,
  `theme@0.4.0`) and `@civitai/sdk@0.8.0` **ABSENT**. The documented staged signature pushes
  the tag anyway (2026-09-03: changesets printed success and pushed all four tags while the
  registry held two), so an absent tag says `changeset publish` never counted it as published.
  The five siblings are the positive control proving the tag-push path worked in that run.
  `via: measurement`.
- **Ruled out — propagation.** The assert ran a **590s** window (`release.yml:233-234`
  `PUBLISH_CHECK_TRIES=60`/`DELAY=10000`) and 404'd; still `0.7.0` 69 min post-run. ⚠ The
  superseded block's "12s (5 × 3000ms)" was the SCRIPT DEFAULT, not what ran. `via: measurement`.
- **The precondition that made the re-run informed rather than blind** — record it, it is the
  reusable part: exactly ONE package remained (other five matched main, with absent- and
  present-version controls both firing); `@civitai/sdk`'s only dependency is
  `@civitai/orchestration-client@0.2.0-beta.101`, no first-party workspace deps; and nothing
  live hard-pins `0.8.0` — `@civitai/components`' peer is `>=0.1.0 <1.0.0` **and optional**,
  satisfied by the then-live `0.7.0`. With no other half to strand, an E409 would have been
  harmless and informative.
