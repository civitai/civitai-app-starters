#!/usr/bin/env node
/**
 * ResourceCard mutation sweep.
 *
 * Breaks one guard at a time, runs the suite, and reports whether a test went
 * red FOR THAT GUARD'S OWN ASSERTION. Committed rather than kept in a scratch
 * dir because it has now produced false verdicts twice, in two different ways,
 * and the rules below are the repair — a reviewer should be able to read them
 * instead of taking a table on faith.
 *
 * ---------------------------------------------------------------------------
 * THE THREE RULES THIS SCRIPT EXISTS TO ENFORCE
 * ---------------------------------------------------------------------------
 *
 * 1. 🔴 SCORE THE TALLY, NEVER THE EXIT CODE. A vitest run that never collected
 *    a test still exits non-zero. Twice that was scored as a KILL:
 *
 *      (a) clearing `node_modules/.vite` between runs wedged the browser tier in
 *          the dependency optimiser — ~1% CPU, zero tests, rc=1;
 *      (b) building the runner command in a way that let the OUTER shell expand
 *          `$(command -v chromium)` sent an EMPTY executable override to
 *          Playwright, which then reached for a bundled `chrome-headless-shell`
 *          that does not exist on NixOS. `Tests no tests`, rc=1, every mutant
 *          "killed", five real CSS mutants scored SURVIVED.
 *
 *    So: a run is only scored if its summary line carries `N passed`/`N failed`.
 *    Otherwise it is retried, then recorded VOID — a verdict of "I do not know",
 *    which is a different thing from SURVIVED. This script resolves the chromium
 *    path itself, once, in its own process, so (b) cannot recur here.
 *
 * 2. 🔴 RUN THE POSITIVE CONTROL, REPEATEDLY. A pristine run before the batch,
 *    after every fourth mutant, and after it. Failure (a) above was only caught
 *    because the control failed the same way the mutants did.
 *
 * 3. 🔴 ANCHOR ON A FULL LITERAL, AND PROVE IT UNIQUE. Every edit must match
 *    exactly once or the mutant is SKIPped — never silently applied to the wrong
 *    occurrence, and never reported as SURVIVED. This is not hypothetical:
 *    `flex: 1 1 auto` went from two occurrences to three inside a single review
 *    round, so a short anchor that was unique when written stopped being unique
 *    while nobody was looking. The report prints `file:line` for every anchor so
 *    the reader can see what was actually mutated.
 *
 * ---------------------------------------------------------------------------
 * USAGE
 * ---------------------------------------------------------------------------
 *
 *   node packages/civitai-blocks-react/scripts/mutation-sweep.mjs [options]
 *
 *     --only M17,M22     run just these ids
 *     --tier unit        restrict to one tier (unit | browser)
 *     --list             print the catalog with anchor line numbers and exit
 *
 * The browser tier needs a Chromium. CI uses Playwright's bundled one; on NixOS
 * run the whole script inside a shell that has `chromium` on PATH and it will
 * pick it up:
 *
 *   nix-shell -p pnpm nodejs_22 chromium --run \
 *     'node packages/civitai-blocks-react/scripts/mutation-sweep.mjs'
 *
 * Override the runners with SWEEP_UNIT_CMD / SWEEP_BROWSER_CMD if needed.
 */
import { spawnSync, execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(PKG, '../..');
const SRC = resolve(PKG, 'src/ui/ResourceCard.tsx');
const STY = resolve(PKG, 'src/ui/styles.ts');

const UNIT_CMD = process.env.SWEEP_UNIT_CMD ?? 'pnpm --filter @civitai/blocks-react test';
const BROWSER_CMD =
  process.env.SWEEP_BROWSER_CMD ?? 'pnpm --filter @civitai/blocks-react test:browser';

/**
 * 🔴 Resolved HERE, in this process, and handed to the child as an env var.
 * Never interpolated into a command string: that is failure (b) above, where an
 * outer shell expanded the substitution before the inner one had chromium on
 * PATH and the override went out empty.
 */
function chromiumPath() {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) {
    return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  }
  try {
    // 🔴 No explicit `shell:` option. Pinning it to `/bin/bash` looks harmless
    // and is wrong on NixOS, where /bin contains ONLY `sh` — execSync then
    // throws ENOENT, the catch swallows it, and the sweep silently falls back to
    // Playwright's bundled browser, which is not installed. That printed
    // `chromium: (bundled / CI)` and turned every browser mutant VOID. Node's
    // default (`/bin/sh`) exists everywhere and `command -v` is POSIX.
    const p = execSync('command -v chromium', { encoding: 'utf8' }).trim();
    return p || undefined;
  } catch {
    return undefined; // CI: fall through to Playwright's bundled browser.
  }
}
const CHROMIUM = chromiumPath();

/** Every anchor is the FULL literal, per rule 3. */
const MUTANTS = [
  { id: 'M1', file: SRC, tiers: ['unit'], guard: 'whitespace-only modelName counts as absent',
    edits: [{ find: "typeof resource.modelName === 'string' ? resource.modelName.trim() : ''",
              replace: "typeof resource.modelName === 'string' ? resource.modelName : ''" }] },
  { id: 'M2', file: SRC, tiers: ['unit'], guard: 'empty/missing modelName -> #<versionId>',
    edits: [{ find: "if (name !== '') return name;", replace: "if (name !== '\\u0000') return name;" }] },
  { id: 'M3', file: SRC, tiers: ['unit'], guard: "never renders '#undefined'",
    edits: [{ find: 'Number.isFinite(resource.versionId) ? `#${resource.versionId}` : UNKNOWN_NAME',
              replace: 'true ? `#${resource.versionId}` : UNKNOWN_NAME' }] },
  { id: 'M4', file: SRC, tiers: ['unit'], guard: 'an unknown modelType is not coerced',
    edits: [{ find: 'return TYPE_LABELS[raw.toLowerCase()] ?? raw;',
              replace: "return TYPE_LABELS[raw.toLowerCase()] ?? 'Checkpoint';" }] },
  { id: 'M5', file: SRC, tiers: ['unit'], guard: 'the modelType match is case-insensitive',
    edits: [{ find: 'TYPE_LABELS[raw.toLowerCase()]', replace: 'TYPE_LABELS[raw]' }] },
  { id: 'M6', file: SRC, tiers: ['unit'], guard: 'a blank modelType renders no badge',
    edits: [{ find: "{typeLabel !== '' ? (", replace: '{typeLabel !== undefined ? (' }] },
  { id: 'M7', file: SRC, tiers: ['unit'], guard: 'variant=card frames even with no image',
    edits: [{ find: "const hasFrame = variant === 'card' || thumbnailUrl != null;",
              replace: 'const hasFrame = thumbnailUrl != null;' }] },
  { id: 'M8', file: SRC, tiers: ['unit'], guard: 'the no-thumbnail copy is frozen',
    edits: [{ find: "const NO_THUMBNAIL_LABEL = 'No preview';",
              replace: "const NO_THUMBNAIL_LABEL = 'Loading…';" }] },
  { id: 'M9', file: SRC, tiers: ['unit'], guard: 'the thumbnail is decorative',
    edits: [{ find: '          alt=""\n', replace: '          alt={name}\n' }] },
  { id: 'M10', file: SRC, tiers: ['unit'], guard: 'empty segments dropped from the label',
    edits: [{ find: "    .filter((part) => part !== '')", replace: '    .filter(() => true)' }] },
  { id: 'M11', file: SRC, tiers: ['unit'], guard: 'the accessible-name order is frozen',
    edits: [{ find: 'return [resourceDisplayName(resource), version, typeLabel, base]',
              replace: 'return [resourceDisplayName(resource), version, base, typeLabel]' }] },
  { id: 'M12', file: SRC, tiers: ['unit'], guard: 'a static card has no tab stop',
    edits: [{ find: '<div data-civitai-ui-resource-hit="" data-testid={ids.hit}>',
              replace: '<div tabIndex={0} data-civitai-ui-resource-hit="" data-testid={ids.hit}>' }] },
  { id: 'M13', file: SRC, tiers: ['unit'], guard: 'disabled blocks onSelect',
    edits: [{ find: '          disabled={disabled}\n', replace: '          disabled={false}\n' }] },
  { id: 'M14', file: SRC, tiers: ['unit'], guard: 'selection is announced to assistive tech',
    edits: [{ find: 'aria-pressed={selected}', replace: 'aria-pressed={false}' }] },
  { id: 'M15', file: SRC, tiers: ['unit'], guard: 'no control nested in the card button (actions)',
    edits: [{ find: '          {body}\n        </button>', replace: '          {body}{actions}\n        </button>' },
            { find: '      {actions != null ? (', replace: '      {false ? (' }] },
  { id: 'M16', file: SRC, tiers: ['unit'], guard: 'the pack stylesheet is injected',
    edits: [{ find: '  useBlocksStyles();\n', replace: '  // useBlocksStyles();\n' }] },
  { id: 'M17', file: STY, tiers: ['unit', 'browser'], guard: 'the card frame keeps a square box',
    edits: [{ find: '  aspect-ratio: 1 / 1;', replace: '  aspect-ratio: auto;' }] },
  { id: 'M18', file: STY, tiers: ['unit', 'browser'], guard: 'a long name stays on one clipped line',
    edits: [{ find: "  white-space: nowrap;\n}\n[data-civitai-ui='resource-card'] [data-civitai-ui-resource-meta]",
              replace: "  white-space: normal;\n}\n[data-civitai-ui='resource-card'] [data-civitai-ui-resource-meta]" }] },
  { id: 'M19', file: STY, tiers: ['unit', 'browser'], guard: 'actions stay inside the card in a row',
    // 🔴 The selector line is part of the anchor on purpose: `flex: 1 1 auto`
    // alone now matches THREE rules in this file (it matched two when this
    // mutant was written).
    edits: [{ find: "[data-civitai-ui='resource-card'][data-variant='row'] [data-civitai-ui-resource-hit] {\n  flex: 1 1 auto;",
              replace: "[data-civitai-ui='resource-card'][data-variant='row'] [data-civitai-ui-resource-hit] {\n  flex: 1 0 auto;" }] },
  { id: 'M20', file: STY, tiers: ['unit', 'browser'], guard: 'the hit area can shrink below its content',
    edits: [{ find: '     long model name blows the card out of its grid cell instead of truncating. */\n  min-width: 0;',
              replace: '     long model name blows the card out of its grid cell instead of truncating. */\n  min-width: auto;' }] },
  { id: 'M21', file: STY, tiers: ['unit', 'browser'], guard: 'the clipped name is ellipsised',
    edits: [{ find: '  line-height: 1.3;\n  flex: 1 1 auto;\n  min-width: 0;\n  overflow: hidden;',
              replace: '  line-height: 1.3;\n  flex: 1 1 auto;\n  min-width: 0;\n  overflow: visible;' }] },
  { id: 'M22', file: SRC, tiers: ['unit', 'browser'], guard: 'the visual selection cue reaches the stylesheet',
    edits: [{ find: "      data-selected={selected ? 'true' : undefined}\n", replace: '      data-selected={undefined}\n' }] },
  { id: 'M23', file: SRC, tiers: ['unit', 'browser'], guard: 'the disabled dimming reaches the stylesheet',
    edits: [{ find: "      data-disabled={disabled ? 'true' : undefined}\n", replace: '      data-disabled={undefined}\n' }] },
  { id: 'M24', file: SRC, tiers: ['unit'], guard: 'data-interactive reaches the root (a CONSUMER hook — this package\'s CSS does not read it)',
    edits: [{ find: "      data-interactive={interactive ? 'true' : undefined}\n", replace: '      data-interactive={undefined}\n' }] },
  { id: 'M25', file: SRC, tiers: ['unit'], guard: 'grid thumbnails are lazy',
    edits: [{ find: '          loading="lazy"\n', replace: '          loading="eager"\n' }] },
  { id: 'M26', file: SRC, tiers: ['unit', 'browser'], guard: 'a failed thumbnail falls back to the placeholder',
    edits: [{ find: '          onError={() => setFailedUrl(thumbnailUrl)}\n', replace: '\n' }] },
  { id: 'M27', file: SRC, tiers: ['unit'], guard: 'a new thumbnail URL is retried, not latched off',
    edits: [{ find: 'const showImage = thumbnailUrl != null && failedUrl !== thumbnailUrl;',
              replace: 'const showImage = thumbnailUrl != null && failedUrl === null;' }] },
  { id: 'M28', file: SRC, tiers: ['unit', 'browser'], guard: 'selection is not carried by colour alone',
    edits: [{ find: '          {selected ? (', replace: '          {false ? (' }] },
  { id: 'M29', file: SRC, tiers: ['unit'], guard: 'the selected glyph is frozen',
    edits: [{ find: "const SELECTED_MARK = '✓';", replace: "const SELECTED_MARK = ' ';" }] },
  { id: 'M30', file: SRC, tiers: ['unit', 'browser'], guard: 'the overlay slot exists and is placed',
    edits: [{ find: "      {overlay != null && variant === 'card' ? (", replace: '      {false ? (' }] },
  { id: 'M31', file: SRC, tiers: ['unit'], guard: 'className reaches the root',
    edits: [{ find: '      className={className}\n', replace: '\n' }] },
  { id: 'M32', file: SRC, tiers: ['unit'], guard: 'style reaches the root',
    edits: [{ find: '      style={style}\n', replace: '\n' }] },
  { id: 'M33', file: SRC, tiers: ['unit'], guard: 'the ref resolves to the root',
    edits: [{ find: '      ref={ref}\n', replace: '\n' }] },
  { id: 'M34', file: STY, tiers: ['browser'], guard: 'the ROOT is the overlay\'s positioned ancestor',
    edits: [{ find: '     distinction is the whole point of the slot. */\n  position: relative;',
              replace: '     distinction is the whole point of the slot. */\n  position: static;' }] },
  { id: 'M35', file: STY, tiers: ['browser'], guard: 'a selected card does not look identical to an unselected one',
    edits: [{ find: "[data-civitai-ui='resource-card'][data-selected='true'] {\n  border-color: var(--civitai-color-primary);",
              replace: "[data-civitai-ui='resource-card'][data-selected='true'] {\n  border-color: var(--civitai-color-border);" }] },
  { id: 'M36', file: STY, tiers: ['browser'], guard: 'the overlay cannot swallow a click meant for the card',
    edits: [{ find: '  z-index: 1;\n  pointer-events: none;', replace: '  z-index: 1;\n  pointer-events: auto;' }] },
  { id: 'M37', file: SRC, tiers: ['unit'], guard: 'the overlay is a SIBLING of the hit, not nested inside its button',
    // The round-1 structure, restored: overlay back inside the thumbnail frame,
    // i.e. inside `body`, i.e. inside the hit <button>.
    edits: [{ find: '        </span>\n      )}\n    </span>\n  ) : null;',
              replace: '        </span>\n      )}\n      {overlay != null ? (\n        <span data-civitai-ui-resource-overlay="" data-testid={ids.overlay}>\n          {overlay}\n        </span>\n      ) : null}\n    </span>\n  ) : null;' },
            { find: "      {overlay != null && variant === 'card' ? (", replace: '      {false ? (' }] },
];

const args = process.argv.slice(2);
const argVal = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};
const only = argVal('--only')?.split(',').map((s) => s.trim());
const tierFilter = argVal('--tier');

const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const PRISTINE = { [SRC]: readFileSync(SRC, 'utf8'), [STY]: readFileSync(STY, 'utf8') };
const BASE = { [SRC]: sha(SRC), [STY]: sha(STY) };
const rel = (p) => p.slice(REPO.length + 1);

/**
 * 🔴 RESTORE ON THE WAY OUT, NOT ONLY IN `finally`. A `finally` covers a thrown
 * error; it does not cover the operator interrupting a 40-minute sweep, and a
 * killed run leaves a MUTATED SOURCE FILE in the working tree. That happened —
 * the run was stopped between mutants and `ref={ref}` stayed deleted from the
 * component, which would have been committed as a real regression if the tree
 * had not been diffed afterwards. Diff the tree after any interrupted sweep
 * regardless: a signal you cannot trap (SIGKILL) still gets past this.
 */
function restoreAll() {
  for (const f of [SRC, STY]) {
    if (readFileSync(f, 'utf8') !== PRISTINE[f]) writeFileSync(f, PRISTINE[f]);
  }
}
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => {
    restoreAll();
    console.log(`\n${sig} — sources restored. Verify with \`git diff\` anyway.`);
    process.exit(130);
  });
}
process.on('uncaughtException', (e) => {
  restoreAll();
  throw e;
});

/** Anchor -> `file:line`, and the occurrence count that decides SKIP. */
function locate(file, find) {
  const s = PRISTINE[file];
  const n = s.split(find).length - 1;
  const line = n === 1 ? s.slice(0, s.indexOf(find)).split('\n').length : null;
  return { count: n, where: line == null ? `${rel(file)}:?` : `${rel(file)}:${line}` };
}

if (args.includes('--list')) {
  for (const m of MUTANTS) {
    console.log(`${m.id.padEnd(4)} ${m.tiers.join('+').padEnd(13)} ${m.guard}`);
    for (const e of m.edits) {
      const { count, where } = locate(m.file, e.find);
      console.log(`     ${where}  (${count}x)  ${JSON.stringify(e.find).slice(0, 96)}`);
    }
  }
  process.exit(0);
}

function runTier(tier) {
  const cmd = tier === 'unit' ? UNIT_CMD : BROWSER_CMD;
  const env = { ...process.env };
  if (tier === 'browser' && CHROMIUM) env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = CHROMIUM;
  const p = spawnSync('bash', ['-c', cmd], { cwd: REPO, env, encoding: 'utf8', timeout: 30 * 60_000 });
  const out = `${p.stdout ?? ''}${p.stderr ?? ''}`;
  const tally = (out.match(/^ +Tests +(.+)$/gm) ?? []).pop()?.replace(/^ +Tests +/, '').trim() ?? '';
  // 🔴 RULE 1: the tally decides, not `p.status`.
  const usable = /\d+ (passed|failed)/.test(tally);
  return {
    usable,
    tally,
    rc: p.status,
    failing: [...new Set((out.match(/^ *[×✗] .+$/gm) ?? []).map((l) => l.replace(/^ *[×✗] /, '').replace(/ \d+ms$/, '')))].slice(0, 8),
    messages: [...new Set((out.match(/AssertionError: .+$/gm) ?? []).map((l) => l.replace(/^AssertionError: /, '')))].slice(0, 8),
  };
}

function runChecked(tier, label) {
  let r;
  for (let attempt = 1; attempt <= 3; attempt++) {
    r = runTier(tier);
    if (r.usable) return r;
    console.log(`         [${label}/${tier}] attempt ${attempt}: NO TALLY (rc=${r.rc}) — instrument, not code; retrying`);
  }
  return r;
}

/** 🔴 RULE 2. */
function control(tag, tiers) {
  for (const tier of tiers) {
    const r = runChecked(tier, `control ${tag}`);
    const ok = r.usable && !r.tally.includes('failed');
    console.log(`CONTROL  ${tag} [${tier}]: ${ok ? 'OK  ' : '🔴 BAD'} ${r.tally || '(none)'}`);
  }
}

const selected = MUTANTS.filter(
  (m) => (!only || only.includes(m.id)) && (!tierFilter || m.tiers.includes(tierFilter))
);
const tiersUsed = [...new Set(selected.flatMap((m) => m.tiers))].filter(
  (t) => !tierFilter || t === tierFilter
);

console.log(`sweep: ${selected.length} mutants, tiers ${tiersUsed.join('+')}`);
console.log(`chromium: ${CHROMIUM ?? '(bundled / CI)'}`);
control('pre', tiersUsed);

let n = 0;
for (const m of selected) {
  const locs = m.edits.map((e) => locate(m.file, e.find));
  const bad = locs.find((l) => l.count !== 1);
  // 🔴 RULE 3: a non-unique anchor is SKIP, which is not SURVIVED.
  if (bad) {
    console.log(`SKIP     ${m.id} :: anchor matched ${bad.count}x at ${bad.where} — NOT a verdict`);
    continue;
  }
  let s = PRISTINE[m.file];
  for (const e of m.edits) s = s.replace(e.find, e.replace);
  writeFileSync(m.file, s);
  const per = {};
  try {
    for (const tier of m.tiers) {
      if (tierFilter && tier !== tierFilter) continue;
      per[tier] = runChecked(tier, m.id);
    }
  } finally {
    writeFileSync(m.file, PRISTINE[m.file]);
  }
  const entries = Object.entries(per);
  const verdict = entries.some(([, r]) => !r.usable)
    ? 'VOID'
    : entries.some(([, r]) => r.tally.includes('failed'))
      ? 'KILLED'
      : 'SURVIVED';
  console.log(`${verdict.padEnd(8)} ${m.id} :: ${m.guard}`);
  console.log(`         anchors: ${locs.map((l) => l.where).join(', ')}`);
  for (const [tier, r] of entries) {
    console.log(`         [${tier}] ${r.tally}`);
    for (const f of r.failing) console.log(`            x ${f}`);
    for (const msg of r.messages) console.log(`            ! ${msg}`);
  }
  if (++n % 4 === 0) control(`after ${m.id}`, tiersUsed);
}

control('post', tiersUsed);
const restored = sha(SRC) === BASE[SRC] && sha(STY) === BASE[STY];
console.log(`\nPRISTINE RESTORED: ${restored}`);
process.exit(restored ? 0 : 1);
