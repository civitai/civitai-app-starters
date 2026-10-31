/**
 * The step-count CLAIM LEDGER, single-sourced for its two readers:
 *
 *  - `step-count-prose.test.ts` (the guard) asserts every claim appears in its
 *    file exactly once with the derived values substituted.
 *  - `scripts/sync-orchestrator-catalogs.mjs` (the daily sync bot) REWRITES the
 *    values in exactly these sentences when it adds a step type, so the PR it
 *    opens passes that guard.
 *
 * WHY IT LIVES HERE AND NOT INSIDE THE TEST. Run 37834855058 (2026-10-08): the
 * bot added a step type, rewrote the fixture / catalog / count pin / ledger, did
 * NOT rewrite these sentences, and failed its own `Validate SDK` step on six
 * `claim-count` misses — so no PR opened. A copy of this list inside the script
 * would put the same failure one new claim away: add a sentence to the guard,
 * forget the script, and the next sync is wedged again. One list, two readers.
 *
 * ONLY THE SENTENCES ARE SHARED. Each reader derives the numbers and the gap
 * itself (the guard from the module + the map's AST, the script from the
 * fixture + the map's source text), so the guard never checks the bot's output
 * with the bot's own arithmetic.
 *
 * Plain `.mjs` with no imports because the script runs under bare `node` BEFORE
 * `pnpm install` in that workflow: it cannot reach anything in `node_modules`,
 * and this keeps it loadable without depending on Node's TypeScript stripping.
 *
 * `files` names a file by tag (`steps` = `src/orchestrator/steps.ts`, `readme` =
 * the package `README.md`); each reader maps the tag to its own path.
 */

/**
 * 🔴 WHOLE CLAIMS, NOT NUMBERS. Each entry is the full sentence as it appears
 * in the file, with `{catalog}` / `{mapped}` / `{gapCount}` / `{gapList}` where
 * a derived value goes. Pinning the sentence is what makes the check
 * machine-readable: a reword that keeps a stale number, or a number fix that
 * quietly drops the qualifier ("all 50" for a map that covers 47), both fail.
 *
 * @type {{ id: string, files: ('steps' | 'readme')[], text: string }[]}
 */
export const CLAIMS = [
  {
    id: 'catalog-1',
    files: ['steps'],
    text: '(`WORKFLOW_STEP_TYPES` — {catalog} `$type` names and what each one does)',
  },
  {
    id: 'catalog-2',
    files: ['steps'],
    text: 'of its {catalog} entries, exactly THREE sit under its "Platform internals" heading',
  },
  {
    id: 'catalog-3',
    files: ['readme'],
    text: '`imageUpscaler` among them ({catalog} in total)',
  },
  {
    id: 'catalog-4',
    files: ['readme'],
    text:
      'Note that `WORKFLOW_STEP_TYPES` does **not** mark most of them: of its {catalog} ' +
      'entries exactly three',
  },
  {
    id: 'mapped-1',
    files: ['steps'],
    text: 'The practical consequence: a number of the {mapped} step types below exist to serve',
  },
  {
    id: 'mapped-2',
    files: ['steps'],
    text: 'Enumerated over all {mapped} mapped templates',
  },
  {
    id: 'mapped-3',
    files: ['steps'],
    text: 'The {mapped} wire-name → generated-template rows, UNGUARDED and NOT exported.',
  },
  {
    id: 'mapped-4',
    files: ['steps'],
    text:
      'This is why neither the {mapped} `*Input` types nor the {mapped} `*StepTemplate` ' +
      'types are re-exported one by one',
  },
  {
    id: 'mapped-5',
    files: ['readme'],
    text: 'Discriminated union of all {mapped} mapped templates',
  },
  {
    id: 'mapped-6',
    files: ['readme'],
    text: 'it is `false` for all {mapped} generated templates',
  },
  {
    id: 'mapped-7',
    files: ['readme'],
    text: "Several of the {mapped} exist to serve Civitai's own pipelines",
  },
  {
    id: 'map-coverage-docblock',
    files: ['steps'],
    text: "`$type` → its step-template type, for {mapped} of the catalog's {catalog} step types.",
  },
  {
    id: 'map-coverage-readme-row',
    files: ['readme'],
    text: "`$type` → template type, for {mapped} of the catalog's {catalog} step types.",
  },
  /**
   * 🔴 THE INVARIANT CLAIM. This is the sentence #382 is really about: the docs
   * used to argue totality, the map is partial, and the three uncovered
   * `$type`s were undocumented. Pinned identically in both files so neither can
   * drift from the other, and every number in it is derived — including the
   * NAMES, so a client republish that closes one third of the gap fails here
   * until the prose says so.
   */
  {
    id: 'gap',
    files: ['steps', 'readme'],
    text:
      '`WORKFLOW_STEP_TYPES` documents {catalog} `$type`s; this map covers {mapped}. ' +
      'The {gapCount} with no generated template in the pinned `@civitai/client` are ' +
      '{gapList}, and `WorkflowStepTemplateFor<…>` is a compile error for each of them.',
  },
  {
    id: 'gap-derivation-note',
    files: ['readme'],
    text: 'derives all four numbers ({catalog}, {mapped}, {gapCount}, and the names)',
  },
];
