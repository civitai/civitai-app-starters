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
- **Branch/PR:** #478 MERGED (squash `a65190f`, branch deleted) and #480 `chore(release):
  version packages` MERGED (squash `0ea7b00`). Primary clone sits on `main` behind
  origin/main, with the PRE-EXISTING dirty `pnpm-workspace.yaml` (1 line) and untracked
  `apps/` — still not this work.
- **DONE 2026-09-26 (session 2):** the component-API half of the audit, run INLINE.
  Findings C1–C8 + the structural root cause under Defects — see the reconciliation
  there, which supersedes their disposition.
- **DONE 2026-09-27 (session 3) — the REMEDIATION shipped, not just the audit.** The
  operator asked to reconcile the two packages so the web components supersede the React
  ones, with React downstream, and to audit for dead code. `@civitai/components-react`'s
  `.` entry now re-exports the generated `@lit/react` element bindings; the 22
  hand-written components, `internal/field.tsx` and `styles.ts` are deleted, guarded by a
  new test that fails if anything but a generated binding appears under `src/`.
- **RELEASED and verified against npm directly:** `@civitai/components-react@0.9.0`,
  `@civitai/components@0.8.1`, `@civitai/app-sdk@0.51.2`, `@civitai/blocks-react@0.58.1`,
  `@civitai/theme@0.4.0`. 🔴 **`@civitai/sdk@0.8.0` did NOT publish** — see Open
  investigations. That one is #479's package, not this work's.
- **Dead code removed:** a visual-regression suite that had never run anywhere (no
  `VITE_RUN_VR` in any workflow, no baselines ever committed); an axe sweep duplicating
  the sibling package's (9 unique cases migrated into `@civitai/components`);
  `src/utilities.generated.ts` (~39 kB no consumer could reach — this closes the old
  rank 3); `@civitai/theme` + `@testing-library/*` + `axe-core` from components-react;
  `@civitai/components` from `next-app`, which renders no `data-civitai-ui` markup.
- **Audited:** round 0 + seven delta rounds, all claims blocks on PR #478. Ended when the
  attribution gate fired (`--round 8`, exit 5) on two consecutive comment-only rounds —
  the documented correct outcome, not an override.
- **Deploy/verify:** merges verified by CONTENT on `origin/main` (a squash never makes the
  branch head an ancestor); publishes verified by asking npm, not by reading the workflow.
- clawgate resolve: **exit 5, NOTHING RESOLVED** (0 tasks). An unknown session id answers
  200 with an empty array, so that zero cannot distinguish "touched no task" from "wrong
  id" ⇒ no `clawgate-task:` field, by rule. Not a clean bill of health.

## Next steps (ranked)
1. **Settle and finish `@civitai/sdk@0.8.0`** per the Next probe above — `npm whoami`,
   then `npm stage list @civitai/sdk`, then either re-run Release `36283050923` or
   `npm stage approve`. Repo `civitai/civitai-app-starters`; no files to edit.
   forcing: incident — a merged release did not publish: `origin/main` says `0.8.0`,
   npm says `0.7.0`, and `pnpm assert:published` exits 1. Anyone pinning `^0.8.0`
   cannot install.
2. Decide single ownership of slider + segmented-control + select styling (the #358
   decision the components README points at), then fix F1/F2/F3 from Defects. Those are
   `@civitai/components` vs `@civitai/blocks-react/ui` and are UNAFFECTED by the
   supersession — neither side was deleted. forcing: none
3. Re-point and re-triage C1–C8: the supersession deleted only the *components-react*
   arm of each pair, so most survive against the ELEMENTS (see Defects for which).
   Files: `packages/civitai-blocks-react/src/ui/{Alert,Badge,SegmentedControl,Stack,
   Group,TextInput,Textarea,Select,NumberInput,Slider}.tsx`. forcing: none
4. Fix the stale "8px radius" claim in blocks-react README § W6 (tokens are 4px;
   `styles.ts:30` itself documents the repaint). forcing: none

## Defects (batched)

### 🔴 C1–C8 RECONCILED after the supersession — re-pointed, NOT resolved (2026-09-27)
The supersession deleted `@civitai/components-react`'s hand-written layer, which was one
arm of every C-finding. **That does not close them.** Measured on `origin/main` after the
merge, each divergence survives against the LIT ELEMENT instead:
- **C1 Alert close gate — SURVIVES.** `blocks-react/src/ui/Alert.tsx` still gates on
  `withCloseButton`; `civitai-alert.ts` gates on `closable`. Same silent trap, new pair.
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

## How to verify
- **The supersession shipped:** `npm view @civitai/components-react version` → `0.9.0`;
  `npm view @civitai/components-react@0.9.0 dist.tarball` then inspect — `src/` in the
  repo holds only `index.ts` + `elements/`.
- **The release is incomplete:** from a checkout of `origin/main`,
  `node scripts/assert-published-versions.mjs` → exit 1, naming `@civitai/sdk@0.8.0`.
  🔴 Run it from the REPO ROOT; from elsewhere it refuses with "no publishable package
  found … Refusing to report success for a check that inspected nothing" and that is the
  guard working, not a pass.
- **Re-derive the C-finding reconciliation:** compare
  `packages/civitai-blocks-react/src/ui/Alert.tsx` (`withCloseButton`) against
  `packages/civitai-components/src/elements/civitai-alert.ts` (`closable`); same for
  `Badge.tsx` (`light`) vs `civitai-badge.ts` (`filled`).
- **Full local gate** (build first or `blocks-react` fails on an unresolvable import):
  `pnpm -r --filter './packages/**' build && pnpm test && pnpm test:guards &&
  pnpm check:public-types && pnpm typecheck`, plus
  `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/run/current-system/sw/bin/brave pnpm --filter
  @civitai/components test:browser`. Last measured: node 2647 · guards 235 · browser
  842 + 7 · public-types rc 0.
- ⚠ RETIRED: the session-2 `tsc` silent-divergence probe (expected matrix "exactly 1 error, the negative control") no longer applies — it compared components-react against blocks-react, and the components-react arm is deleted. Re-point it at the ELEMENTS before reusing it; the shape of the control is still good.
- Audit the doc: `python3 ~/workspace/devrc/scripts/handoff-audit.py claudedocs/handoff-ui-component-redundancy-audit.md`
## Open investigations — live diagnosis state

### `@civitai/sdk@0.8.0` is on main but not on npm — staged vs failed is UNSETTLED
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
- **Leading hypothesis:** plain publish failure, NOT staging — the documented staged
  signature is a **2xx** plus `🦋 success packages published successfully`, whereas this
  run got a 503 and printed `packages failed to publish`. That is log evidence, not
  registry evidence, so it is a hypothesis and not a finding.
- **Next probe — needs an npm-authenticated human; I could not run it.** `npm whoami`
  from this machine returns `E401 Unauthorized`, and the guard warns an E401 is an answer
  about the session, not about staging. In order:
  ```bash
  npm whoami                      # E401 => not logged in; stop, the next line lies
  npm stage list @civitai/sdk     # the authoritative answer
  ```
  or read <https://www.npmjs.com/settings/civitai/staged-packages> while logged in as a
  civitai org member (a 404/403 there proves nothing — signed-out and empty look alike).
  **Then:** not staged ⇒ re-run Release run `36283050923`. Staged ⇒
  `npm stage approve <id>` (2FA); never a blind re-run, which the guard says is what
  breaks consumers.
