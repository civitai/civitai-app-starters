/**
 * Guards the TEACHING SURFACE of the two resource pickers against a hardcoded
 * base-model ecosystem.
 *
 * Rule: no `@example` in a shipped source file, and no ```ts / ```tsx example
 * in a shipped doc, may pass `baseModelGroup:` a STRING LITERAL. Deriving it
 * from a value the block actually holds — `checkpoint.baseModel`,
 * `useBlockContext().context.checkpoint?.baseModel` — stays legal, and is the
 * only correct shape.
 *
 * WHY THIS EXISTS
 * ===============
 * `baseModelGroup` is an OPTIONAL FILTER on `useResourcePicker`, not a label:
 * the host HIDES every resource outside the family it is given. Omitting it is
 * an unconstrained pick — the viewer sees everything of that type. The SDK has
 * always implemented exactly that (`useResourcePicker.ts` only puts the key on
 * the wire when it is non-null, and its JSDoc has always said "Omit for an
 * unconstrained pick of the type"), so there was never a default to change.
 *
 * The defect was entirely in what the docs TEACH, and it had a propagation path
 * that made one line expensive:
 *
 *     packages/civitai-blocks-react/README.md  (the `### useX()` tsx fence)
 *       -> generated into developer.civitai.com `apps/reference/hooks`
 *         -> fetched by every AI coding agent building an App Block
 *           -> copied VERBATIM into the app
 *
 * 🔴 WHICH SURFACE THE GENERATOR ACTUALLY READS — the README is PRIMARY and the
 * `@example` JSDoc is only its FALLBACK, which is the opposite of the obvious
 * guess. `<civitai-developer-docs>/scripts/gen-appblocks-hooks.mjs` takes
 * `readme.example || jsdocExample` and stamps the winner into the artifact as
 * `exampleSource`; the generated `public/appblocks/hooks.json` reads
 * `"exampleSource": "readme"` for both pickers. That is why this guard scans
 * BOTH surfaces and neither is optional: the README is what ships today, and
 * the `@example` is what ships the moment a hook's README heading is renamed or
 * its fence dropped.
 *
 * The `@example` read `await open({ resourceType: 'LORA', baseModelGroup:
 * 'SDXL' })`. Weaker models copy an example literally, so apps shipped with the
 * picker pinned to whatever ecosystem the doc happened to name — and every LoRA
 * a viewer owned outside SDXL was invisible to them, which presents as "the
 * picker is empty / broken", not as a wrong filter. The same literal was in
 * `useCheckpointPicker.ts`'s `@example` and in two README examples.
 *
 * The CLI scaffold already did it right — `internal/scaffold/templates/
 * page-money/src/App.tsx.tmpl` passes `baseModelGroup: checkpoint.baseModel`,
 * derived from the checkpoint the viewer actually chose. That is the shape the
 * examples now teach, and this guard is what keeps them teaching it.
 *
 * 🔴 SCOPE — EXAMPLES ONLY, AND DELIBERATELY SO. A literal ecosystem is correct
 * in plenty of non-teaching places and none of them are scanned:
 *   - `test/` — a test asserting the wire payload MUST pass a concrete value.
 *   - `src/internal/` non-example code, the mock host, the picker overlay.
 *   - `CHANGELOG.md` — history quotes the old call and rewriting it would lie.
 *   - `dist/` — generated from `src/`; fixing it there fixes nothing.
 * Prose is not scanned either: `@example` blocks and fenced code are what a
 * model copies. A sentence that merely NAMES an ecosystem is fine.
 *
 * 🔴 KNOWN LIMITS:
 *   - It is a text scan, not a TS parse. It cannot see a literal reached
 *     through a `const ECOSYSTEM = 'SDXL'` one line above the call. That
 *     direction is a real hole, but it is not the shape that shipped, and
 *     closing it would mean type-checking every example fence — which
 *     `typecheck:readme` already does for a different property.
 *   - It keys on the `baseModelGroup:` KEY. A future picker option that filters
 *     the same way under another name is not covered until it is added here.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve, sep } from 'node:path';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Where the sweep looks. Everything a reader or an agent is shown, nothing
 * generated and nothing under test.
 */
const SWEEP_ROOTS = ['packages', 'docs', 'starters'];

/** Directory names the sweep never descends into. */
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git', 'coverage', '.turbo']);

/**
 * Path segments that disqualify a file. `test/` and `tests/` legitimately pass
 * a concrete ecosystem (they assert the wire payload); `dist/` is generated
 * from `src/`, so a hit there is a duplicate of one the sweep already has.
 */
const SKIP_SEGMENTS = new Set(['test', 'tests', '__tests__', 'dist']);

/** CHANGELOGs quote the OLD call as history. Rewriting history to satisfy a guard is a lie. */
const SKIP_BASENAMES = new Set(['CHANGELOG.md']);

const SCANNED_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.md', '.mdx'];

/**
 * The files that MUST yield a picker example. This is the coverage floor's
 * per-file half: a guard that scans a tree can be wired to nothing and report a
 * serene pass, so each of these is asserted to have produced at least one
 * example region. The sweep above is what catches an example added ELSEWHERE —
 * the two halves close different holes.
 */
const REQUIRED_SOURCES = [
  'packages/civitai-blocks-react/src/hooks/useResourcePicker.ts',
  'packages/civitai-blocks-react/src/hooks/useCheckpointPicker.ts',
  'packages/civitai-blocks-react/README.md',
];

/**
 * Coverage floors. Both are counted over the WHOLE SWEEP (`SWEEP_ROOTS`), not
 * over `REQUIRED_SOURCES` — read the next sentence as the decomposition of the
 * sweep, because scoping the prose to the three required files and the
 * assertion to the sweep is exactly how this floor was first set 2 too low.
 *
 * Today the sweep yields 8 picker example regions and 4 `baseModelGroup:` sites:
 *
 *   packages/civitai-blocks-react/README.md                      3 regions / 2 sites
 *   packages/civitai-blocks-react/src/hooks/useResourcePicker.ts  2 / 1
 *   packages/civitai-blocks-react/src/hooks/useCheckpointPicker.ts 1 / 1
 *   packages/civitai-sdk/README.md                                1 / 0
 *   packages/civitai-sdk/api/public-api.md                        1 / 0
 *
 * An unasserted count is indistinguishable from a scanner wired to nothing:
 * without these, deleting every example, renaming a hook file, or a fence
 * extractor that silently stopped matching all read as a PASS. Set EXACTLY at
 * the corpus count so there is no slack to hide a deletion in — the two
 * civitai-sdk regions are inside the floor for that reason. Raising them when
 * examples are added is fine; lowering one means deciding the pickers need less
 * documenting.
 *
 * To re-derive after changing the corpus, raise a floor above the truth and
 * read the number the assertion's own failure message reports — do not count by
 * eye and do not trust the table above, which is prose and can rot.
 */
const MIN_PICKER_EXAMPLES = 8;
const MIN_BASE_MODEL_GROUP_SITES = 4;

/**
 * A code region is a PICKER example if it names one of the picker hooks or uses
 * one of their option keys. `resourceType:` is in the list because the README's
 * secondary example is a bare `open({ resourceType, baseModelGroup })` fragment
 * that does not re-name the hook.
 */
const PICKER_SIGNAL = /useResourcePicker|useCheckpointPicker|resourceType\s*:|baseModelGroup/;

/**
 * A `baseModelGroup:` whose value opens with a quote — i.e. a hardcoded
 * ecosystem. `checkpoint.baseModel` and every other expression do not match, by
 * construction: the character after the colon is what decides.
 */
const HARDCODED_ECOSYSTEM = /baseModelGroup\s*:\s*(['"`])/;

/** Any `baseModelGroup:` at all, for the coverage count. */
const ANY_BASE_MODEL_GROUP = /baseModelGroup\s*:/;

/**
 * Pull the `@example` blocks out of a JS/TS source. A block runs from the
 * `@example` tag to the next block tag (`@param`, `@returns`, a second
 * `@example`, …) or to the end of the comment, whichever comes first.
 */
export function extractJsdocExamples(text) {
  const out = [];
  const commentRe = /\/\*\*[\s\S]*?\*\//g;
  for (const m of text.matchAll(commentRe)) {
    const startLine = text.slice(0, m.index).split('\n').length;
    const body = m[0]
      .split('\n')
      .map((l) => l.replace(/^\s*\/?\*+\/?/, '').replace(/\*\/\s*$/, ''));
    let cur = null;
    body.forEach((line, i) => {
      const tag = line.match(/^\s*@(\w+)/);
      if (tag) {
        if (cur) out.push(cur);
        cur = tag[1] === 'example' ? { line: startLine + i, lines: [] } : null;
        return;
      }
      if (cur) cur.lines.push(line);
    });
    if (cur) out.push(cur);
  }
  return out.map((e) => ({ line: e.line, code: e.lines.join('\n') }));
}

/**
 * Pull fenced ts/tsx/js/jsx code blocks out of markdown. Delimiter-aware: the
 * closing run must be at least as long as the opening one and carry no info
 * string, so a nested example inside a wider fence cannot invert the state for
 * the rest of the file.
 */
export function extractMarkdownFences(text) {
  const lines = text.split('\n');
  const out = [];
  let open = null;
  lines.forEach((line, i) => {
    const fence = line.match(/^\s*(`{3,}|~{3,})\s*([A-Za-z0-9+-]*)\s*$/);
    if (!fence) {
      if (open && open.lines) open.lines.push(line);
      return;
    }
    const [, delim, info] = fence;
    if (!open) {
      if (/^(ts|tsx|typescript|js|jsx|javascript)$/i.test(info)) {
        open = { line: i + 2, delim, lines: [] };
      } else if (info === '') {
        // An info-less opening fence still OPENS a block; it is just not a
        // language we scan. Track it so its contents cannot be read as prose.
        open = { line: i + 2, delim, lines: null };
      }
      return;
    }
    const closes = delim[0] === open.delim[0] && delim.length >= open.delim.length && info === '';
    if (!closes) {
      if (open.lines) open.lines.push(line);
      return;
    }
    if (open.lines) out.push({ line: open.line, code: open.lines.join('\n') });
    open = null;
  });
  return out;
}

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      yield* walk(full);
    } else if (e.isFile()) {
      yield full;
    }
  }
}

function scannedFiles() {
  const out = [];
  for (const root of SWEEP_ROOTS) {
    const abs = join(REPO_ROOT, root);
    try {
      if (!statSync(abs).isDirectory()) continue;
    } catch {
      continue;
    }
    for (const full of walk(abs)) {
      const rel = relative(REPO_ROOT, full);
      const parts = rel.split(sep);
      if (parts.some((p) => SKIP_SEGMENTS.has(p))) continue;
      if (SKIP_BASENAMES.has(parts[parts.length - 1])) continue;
      if (!SCANNED_EXTS.some((ext) => rel.endsWith(ext))) continue;
      out.push(rel);
    }
  }
  return out.sort();
}

/** Every picker example region in the corpus, with where it came from. */
function collectPickerExamples(files) {
  const regions = [];
  for (const rel of files) {
    const text = readFileSync(join(REPO_ROOT, rel), 'utf8');
    if (!PICKER_SIGNAL.test(text)) continue;
    const found = rel.endsWith('.md') || rel.endsWith('.mdx')
      ? extractMarkdownFences(text)
      : extractJsdocExamples(text);
    for (const r of found) {
      if (!PICKER_SIGNAL.test(r.code)) continue;
      regions.push({ file: rel, line: r.line, code: r.code });
    }
  }
  return regions;
}

const FILES = scannedFiles();
const REGIONS = collectPickerExamples(FILES);

test('the extractors and the detector actually fire (negative control)', () => {
  // Guards the INSTRUMENT. Until all three of these go red on a known-bad
  // input, every "no hardcoded ecosystem found" result below is a claim about a
  // broken scanner. The inputs are the REAL pre-fix text, not a toy.
  const preFixJsdoc = [
    '/**',
    ' * Does a thing.',
    ' *',
    ' * @example',
    ' * const { open } = useResourcePicker();',
    " * const picked = await open({ resourceType: 'LORA', baseModelGroup: 'SDXL' });",
    ' */',
    'export function useResourcePicker() {}',
  ].join('\n');
  const jsdoc = extractJsdocExamples(preFixJsdoc);
  assert.equal(jsdoc.length, 1, 'the @example extractor must find the block');
  assert.ok(PICKER_SIGNAL.test(jsdoc[0].code), 'the block must be recognised as a picker example');
  assert.ok(
    HARDCODED_ECOSYSTEM.test(jsdoc[0].code),
    'the detector must flag the pre-fix @example — it is the exact text that shipped',
  );

  const preFixMd = [
    'Some prose.',
    '',
    '```tsx',
    'const { open } = useResourcePicker();',
    "const picked = await open({ resourceType: 'LORA', baseModelGroup: 'SDXL' });",
    '```',
  ].join('\n');
  const fences = extractMarkdownFences(preFixMd);
  assert.equal(fences.length, 1, 'the fence extractor must find the tsx block');
  assert.ok(
    HARDCODED_ECOSYSTEM.test(fences[0].code),
    'the detector must flag the pre-fix README example',
  );

  // And the POSITIVE half of the instrument: the derived form must NOT be
  // flagged, or the guard bans the very shape it exists to teach.
  const derived = "const picked = await open({ resourceType: 'LORA', baseModelGroup: checkpoint.baseModel });";
  assert.ok(ANY_BASE_MODEL_GROUP.test(derived), 'a derived site must still be COUNTED');
  assert.equal(
    HARDCODED_ECOSYSTEM.test(derived),
    false,
    'deriving baseModelGroup from a value must stay legal',
  );
});

test('no picker example hardcodes a base-model ecosystem', () => {
  const offenders = [];
  for (const r of REGIONS) {
    for (const [i, line] of r.code.split('\n').entries()) {
      if (HARDCODED_ECOSYSTEM.test(line)) {
        offenders.push(`${r.file}:${r.line + i} ${line.trim()}`);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    [
      'A picker example passes `baseModelGroup` a hardcoded string.',
      '',
      '`baseModelGroup` is a FILTER: the host HIDES every resource outside the',
      'family you pass. Omit it for an unconstrained pick (the default), or DERIVE',
      'it from the checkpoint the block already holds —',
      '`baseModelGroup: checkpoint.baseModel`, the shape the CLI scaffold uses.',
      '',
      'This matters more than an ordinary doc nit: these examples are GENERATED',
      'into developer.civitai.com apps/reference/hooks — the README fence first,',
      'the `@example` JSDoc as its fallback — which is what',
      'AI coding agents fetch and copy verbatim. A literal here ships apps whose',
      "picker is pinned to one ecosystem and looks empty to everyone else's library.",
      '',
      'See this file’s header.',
    ].join('\n'),
  );
});

test('the scan reached the files that teach the pickers (coverage floor)', () => {
  // Positive control for the sweep: prove each source that documents a picker
  // was READ and produced a region, so a renamed hook file or a fence
  // extractor that stopped matching cannot pass as "clean".
  for (const f of REQUIRED_SOURCES) {
    assert.ok(
      FILES.includes(f),
      `${f} was not reached by the sweep — is SWEEP_ROOTS / SKIP_SEGMENTS stale?`,
    );
    const hits = REGIONS.filter((r) => r.file === f);
    assert.ok(hits.length > 0, `${f} yielded no picker example — is the extractor wired to anything?`);
  }
  assert.ok(
    REGIONS.length >= MIN_PICKER_EXAMPLES,
    `expected >= ${MIN_PICKER_EXAMPLES} picker example regions across the corpus, found ${REGIONS.length}`,
  );

  const sites = REGIONS.flatMap((r) =>
    r.code.split('\n').filter((l) => ANY_BASE_MODEL_GROUP.test(l)),
  );
  assert.ok(
    sites.length >= MIN_BASE_MODEL_GROUP_SITES,
    `expected >= ${MIN_BASE_MODEL_GROUP_SITES} \`baseModelGroup:\` sites inside picker examples, found ${sites.length}. ` +
      'A zero here would make the violation test above vacuously green — it would be ' +
      'asserting that no example passes a literal to a key no example passes at all.',
  );
});

test('@civitai/blocks-react documents the UNCONSTRAINED call as the default', () => {
  // The literal ban alone is satisfied by DELETING every example. This asserts
  // the positive teaching survives: at least one `@civitai/blocks-react`
  // example calls the picker with a resourceType and NO baseModelGroup.
  //
  // 🔴 SCOPED TO blocks-react ON PURPOSE, AND THAT IS WHAT MAKES IT A
  // REGRESSION GUARD RATHER THAN AN INVARIANT ONE. `packages/civitai-sdk/
  // README.md` already carried `openResourcePicker({ resourceType:
  // 'Checkpoint' })` — a compliant unconstrained call on the HOST-side API —
  // so a repo-wide version of this assertion was GREEN at the pre-fix commit
  // and proved nothing. Narrowed to the package whose hooks the generated
  // developer docs are built from, it is red at that commit: every
  // blocks-react picker example there passed a literal.
  const PKG = 'packages' + sep + 'civitai-blocks-react' + sep;
  const unconstrained = REGIONS.filter(
    (r) =>
      r.file.startsWith(PKG) &&
      /resourceType\s*:/.test(r.code) &&
      !ANY_BASE_MODEL_GROUP.test(r.code),
  );
  assert.ok(
    unconstrained.length > 0,
    'no @civitai/blocks-react example shows `open({ resourceType: … })` with no ' +
      'baseModelGroup. That unconstrained call is the correct default and the thing ' +
      'agents copy; a corpus that only ever shows the filtered form teaches the defect again.',
  );
});
