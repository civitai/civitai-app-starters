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
 * 🔴 WHAT THE DETECTOR CATCHES. It is a text scan, but not a per-line one: the
 * key match is found in a COMMENT-STRIPPED copy of the region and the value
 * expression after it is read across newlines to the next depth-0 `,` `;` `}`
 * `)` `]`. So all of these are caught, and each of them is a shape an agent
 * actually writes:
 *
 *     baseModelGroup: 'SDXL'                              one-liner
 *     baseModelGroup:\n  'SDXL',                          value on the next line
 *     baseModelGroup: ctx.checkpoint?.baseModel ?? 'SDXL'  nullish fallback
 *     baseModelGroup: flux ? 'Flux1' : 'SDXL'              ternary
 *     baseModelGroup: ('SDXL')  /  String('SDXL')          wrapped
 *     'baseModelGroup': 'SDXL'                             QUOTED key
 *     baseModelGroup: `SDXL`                               un-interpolated template
 *
 * The nullish-fallback row is the one that matters most: `checkpoint?.baseModel
 * ?? 'SDXL'` is exactly what gets written to handle the no-checkpoint case, and
 * it re-pins every such viewer to SDXL — the original defect, in the shape a
 * per-line `baseModelGroup:\s*['"]` regex cannot see. The multi-line row matters
 * because the fix that introduced this guard also introduced the multi-line
 * object shape into the README, so the old detector could not see its own corpus.
 *
 * Deliberately NOT flagged, because they are the correct shape:
 *
 *     baseModelGroup: checkpoint.baseModel                 derived
 *     baseModelGroup: `${checkpoint.baseModel}`            derived (interpolated)
 *     baseModelGroup: checkpoint.baseModel,  // e.g. 'SDXL'   literal in a comment
 *
 * 🔴 KNOWN LIMITS:
 *   - It is a text scan, not a TS parse, so it cannot see a literal reached
 *     through INDIRECTION — `const ECOSYSTEM = 'SDXL'` a line above the call, or
 *     a helper that returns one (`pickFamily()`). Both measured to pass. That
 *     direction is a real hole, but it is not the shape that shipped, and closing
 *     it would mean type-checking every example fence — which `typecheck:readme`
 *     already does for a different property. (Concatenation, `'SD' + 'XL'`, IS
 *     caught — it is in the value expression, so the quoted-string rule below
 *     finds it. Measured, and asserted in the F2 test; an earlier draft of this
 *     bullet listed it as a miss and was wrong.)
 *   - ANY quoted string inside the value expression counts as a pin, so
 *     `baseModelGroup: ctx['checkpoint'].baseModel` would be a false positive.
 *     That direction is deliberate: a false positive is a visible failure a
 *     reader fixes in one edit, a false negative ships the defect. No example in
 *     the corpus takes that shape.
 *   - The value expression is read across at most 3 newlines, so a picker option
 *     object spread over more than that could hide a literal in its tail.
 *   - The comment stripper is a character scanner, not a lexer: it knows
 *     strings, template literals and both comment forms, but not regex literals.
 *     An UNBALANCED apostrophe in code (`<div>don't</div>`) makes it skip to
 *     end-of-line, so a `//` comment later on THAT line is not stripped — a
 *     false POSITIVE, i.e. a visible failure. A regex literal containing a
 *     comment opener could go the other way; neither shape occurs in the corpus.
 *   - It keys on the `baseModelGroup` KEY. A future picker option that filters
 *     the same way under another name is not covered until it is added here.
 *   - An UNCLOSED fence now swallows the rest of its file, because that is what
 *     CommonMark says it does — the cost of the fix above, paid deliberately.
 *     Measured at the time: 100 of 100 ts/tsx fences in the sweep corpus are
 *     extracted, so no file in it is malformed that way; a new one would show up
 *     as this guard losing regions, which the floors below catch.
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
 * Today the sweep yields 12 picker example regions and 4 `baseModelGroup:` sites:
 *
 *   packages/civitai-blocks-react/README.md                      5 regions / 2 sites
 *   packages/civitai-blocks-react/src/hooks/useResourcePicker.ts  3 / 1
 *   packages/civitai-blocks-react/src/hooks/useCheckpointPicker.ts 2 / 1
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
 *
 * ⚠️ These two numbers did NOT move when the ```bash-fence blindness in
 * `extractMarkdownFences` was fixed, and that is a fact about the corpus, not
 * evidence the fix was inert: the fix made 15 previously-invisible ts/tsx fences
 * readable (measured 15 → 0 over this sweep), and none of those 15 happens to
 * name a picker or a picker option, so no new REGION qualified. The next example
 * added behind an install snippet will be the one that moves them.
 */
const MIN_PICKER_EXAMPLES = 12;
const MIN_BASE_MODEL_GROUP_SITES = 4;

/**
 * A code region is a PICKER example if it names one of the picker hooks or uses
 * one of their option keys. `resourceType:` is in the list so a bare
 * `open({ resourceType, baseModelGroup })` fragment that does not re-name the
 * hook still qualifies — every example in the corpus happens to name its hook
 * today, so this arm is reach rather than current coverage, and dropping it
 * would move no count while quietly narrowing the guard.
 */
const PICKER_SIGNAL = /useResourcePicker|useCheckpointPicker|resourceType\s*:|baseModelGroup/;

/**
 * `baseModelGroup` used as an object KEY — bare (`baseModelGroup:`) or quoted
 * (`'baseModelGroup':`). The optional-group backreference is what makes one
 * pattern cover both: when the group does not participate, `\1` matches the
 * empty string. The lookbehind stops `myBaseModelGroup:` counting.
 */
const BASE_MODEL_GROUP_KEY = /(?<![\w$])(['"])?baseModelGroup\1\s*:/g;

/** How far past the key the value expression may run, in newlines. */
const VALUE_MAX_LINES = 3;

/**
 * Blank out `//` and `/* *\/` comments so a literal QUOTED IN A COMMENT is not
 * read as a call site. Only the comment bytes become spaces — newlines survive,
 * so every offset still maps to the same line, and string/template contents are
 * left untouched because that is where the literals we hunt actually live.
 */
export function stripComments(code) {
  const out = code.split('');
  const n = code.length;
  let i = 0;
  while (i < n) {
    const c = code[i];
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      i++;
      while (i < n) {
        if (code[i] === '\\') { i += 2; continue; }
        if (code[i] === quote) { i++; break; }
        // An unterminated single/double-quoted string cannot span a line; bail
        // rather than swallowing the rest of the region as string content.
        if (quote !== '`' && code[i] === '\n') break;
        i++;
      }
      continue;
    }
    if (c === '/' && code[i + 1] === '/') {
      while (i < n && code[i] !== '\n') out[i++] = ' ';
      continue;
    }
    if (c === '/' && code[i + 1] === '*') {
      while (i < n && !(code[i] === '*' && code[i + 1] === '/')) {
        if (code[i] !== '\n') out[i] = ' ';
        i++;
      }
      if (i < n) { out[i] = ' '; out[i + 1] = ' '; i += 2; }
      continue;
    }
    i++;
  }
  return out.join('');
}

/**
 * Read the VALUE expression that follows a `baseModelGroup:` key, starting at
 * `from`. Stops at the next `,` `;` `}` `)` `]` that is not nested inside
 * brackets or a string, or after `VALUE_MAX_LINES` newlines — so a value on the
 * line BELOW the key is read, and a truncated snippet cannot run on forever.
 */
function valueExpression(code, from) {
  const out = [];
  let depth = 0;
  let newlines = 0;
  let i = from;
  while (i < code.length) {
    const c = code[i];
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      out.push(c);
      i++;
      while (i < code.length) {
        out.push(code[i]);
        if (code[i] === '\\') { i++; if (i < code.length) out.push(code[i]); i++; continue; }
        if (code[i] === quote) { i++; break; }
        i++;
      }
      continue;
    }
    if (c === '(' || c === '[' || c === '{') { depth++; out.push(c); i++; continue; }
    if (c === ')' || c === ']' || c === '}') {
      if (depth === 0) break;
      depth--;
      out.push(c);
      i++;
      continue;
    }
    if (depth === 0 && (c === ',' || c === ';')) break;
    if (c === '\n' && ++newlines > VALUE_MAX_LINES) break;
    out.push(c);
    i++;
  }
  return out.join('');
}

/**
 * Does a value expression PIN the ecosystem to a literal? Any `'…'` or `"…"`
 * does — including one reached through `??`, a ternary, parentheses or a call.
 * A template literal counts only when it carries NO `${…}`: an interpolated one
 * is a derived value, which is the shape the docs are supposed to teach.
 */
function pinsEcosystem(value) {
  if (/'[^'\n]*'|"[^"\n]*"/.test(value)) return true;
  const tpl = value.match(/`([^`]*)`/);
  return Boolean(tpl && !tpl[1].includes('${'));
}

/**
 * Every hardcoded-ecosystem site in one code region, as
 * `{ lineOffset, text }` — `lineOffset` is 0-based from the region's first line
 * and `text` is the flattened `baseModelGroup: <value>`, so a multi-line
 * offender still reports as one readable line.
 */
export function findHardcodedEcosystem(code) {
  const clean = stripComments(code);
  const out = [];
  for (const m of clean.matchAll(BASE_MODEL_GROUP_KEY)) {
    const value = valueExpression(clean, m.index + m[0].length);
    if (!pinsEcosystem(value)) continue;
    out.push({
      lineOffset: clean.slice(0, m.index).split('\n').length - 1,
      text: `baseModelGroup:${value}`.replace(/\s+/g, ' ').trim(),
    });
  }
  return out;
}

/**
 * How many `baseModelGroup` option sites a region has, for the coverage count.
 * Counts KEYS, not lines — a quoted key counts, and two on one line count twice.
 */
export function countBaseModelGroupSites(code) {
  return [...stripComments(code).matchAll(BASE_MODEL_GROUP_KEY)].length;
}

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

/** Info strings whose contents the sweep reads. Everything else is tracked but not read. */
const SCANNED_FENCE_INFO = /^(ts|tsx|typescript|js|jsx|javascript)$/i;

/**
 * Pull fenced ts/tsx/js/jsx code blocks out of markdown. Delimiter-aware: the
 * closing run must be at least as long as the opening one and carry no info
 * string, so a nested example inside a wider fence cannot invert the state for
 * the rest of the file.
 *
 * 🔴 EVERY fence OPENS A BLOCK, whatever its info string — that is the whole
 * correctness condition, and getting it wrong is not a niche case but the
 * commonest README shape there is. A ```bash / ```json / ```html / ```diff
 * fence used to fall through both branches and never be recorded as open; its
 * own bare closing fence then matched the "info-less opener" branch and opened a
 * PHANTOM untracked block, which swallowed the next real ts/tsx pair whole. An
 * install snippet above a code example was enough: measured over this sweep's
 * corpus, 15 ts/tsx fences — including this package's own README quick-start,
 * swallowed by the ```bash install block above it — were invisible to the
 * scanner, so a literal in any of them passed as clean. The regression case is
 * in the negative-control test below; keep it.
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
      // `lines: null` = tracked but not read. A fence in a language we do not
      // scan must STILL be tracked, or its closing fence reads as an opener.
      open = { line: i + 2, delim, lines: SCANNED_FENCE_INFO.test(info) ? [] : null };
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
  assert.equal(
    findHardcodedEcosystem(jsdoc[0].code).length,
    1,
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
  assert.equal(
    findHardcodedEcosystem(fences[0].code).length,
    1,
    'the detector must flag the pre-fix README example',
  );

  // And the POSITIVE half of the instrument: the derived form must NOT be
  // flagged, or the guard bans the very shape it exists to teach.
  const derived = "const picked = await open({ resourceType: 'LORA', baseModelGroup: checkpoint.baseModel });";
  assert.equal(countBaseModelGroupSites(derived), 1, 'a derived site must still be COUNTED');
  assert.deepEqual(
    findHardcodedEcosystem(derived),
    [],
    'deriving baseModelGroup from a value must stay legal',
  );
});

test('a fence in an unscanned language does not blind the extractor (F1 regression)', () => {
  // THE COMMONEST README SHAPE: an install snippet, then a code example. The
  // ```bash fence used to fall through both branches of the opener test and
  // never be recorded; its bare closer then opened a PHANTOM block that
  // swallowed the ```tsx pair below it, so the violation inside was INVISIBLE
  // and the whole guard reported a serene pass. Watched to fail before the fix:
  // with the ```bash block removed the violation fired, with it present it did
  // not — same tsx block, same literal.
  const withBash = [
    '## Install',
    '',
    '```bash',
    'npm i @civitai/blocks-react',
    '```',
    '',
    '## Quick start',
    '',
    '```tsx',
    'const { open } = useResourcePicker();',
    "const picked = await open({ resourceType: 'LORA', baseModelGroup: 'SDXL' });",
    '```',
  ].join('\n');
  const fences = extractMarkdownFences(withBash);
  assert.equal(fences.length, 1, 'the tsx block must be extracted even behind a ```bash fence');
  assert.equal(
    findHardcodedEcosystem(fences[0].code).length,
    1,
    'the literal inside the tsx block behind a ```bash fence must be flagged',
  );

  // Same for the other unscanned info strings this corpus actually uses, and for
  // an odd NUMBER of them — one leading fence pair is enough to shift the state.
  for (const info of ['sh', 'json', 'jsonc', 'html', 'diff', 'text', 'yaml']) {
    const md = ['```' + info, 'noise', '```', '', '```ts', "open({ baseModelGroup: 'SDXL' });", '```'].join('\n');
    const f = extractMarkdownFences(md);
    assert.equal(f.length, 1, `a \`\`\`${info} fence must not swallow the ts block after it`);
    assert.equal(
      findHardcodedEcosystem(f[0].code).length,
      1,
      `a literal after a \`\`\`${info} fence must be flagged`,
    );
  }

  // And the property that made the old code look reasonable must survive: a
  // NESTED example inside a WIDER fence still cannot invert the state.
  const nested = ['````md', '```tsx', "open({ baseModelGroup: 'SDXL' });", '```', '````', '', '```ts', 'const ok = 1;', '```'].join('\n');
  assert.deepEqual(
    extractMarkdownFences(nested).map((r) => r.code),
    ['const ok = 1;'],
    'a 3-backtick pair nested inside a 4-backtick fence is literal content, not a block',
  );
});

test('the detector sees the reintroduction spellings, and not the legitimate ones (F2)', () => {
  // Each row is a shape measured to be MISSED by the previous per-line
  // `baseModelGroup:\s*['"]` regex. The nullish-fallback row is the important
  // one: it is what gets written to handle "no checkpoint yet", and it re-pins
  // every such viewer to SDXL — the original defect wearing a different hat.
  const caught = [
    ["baseModelGroup: 'SDXL'", 'one-liner'],
    ["baseModelGroup:\n  'SDXL',", 'value on the next line'],
    ['baseModelGroup: ctx.checkpoint?.baseModel ?? "SDXL",', 'nullish fallback'],
    ["baseModelGroup: flux ? 'Flux1' : 'SDXL',", 'ternary'],
    ["baseModelGroup: ('SDXL'),", 'parenthesised'],
    ["baseModelGroup: String('SDXL'),", 'wrapped in a call'],
    ["'baseModelGroup': 'SDXL',", 'quoted key'],
    ['baseModelGroup: `SDXL`,', 'un-interpolated template literal'],
    ["baseModelGroup: checkpoint?.baseModel || 'SDXL',", 'logical-or fallback'],
    ["await open({\n  resourceType: 'LORA',\n  baseModelGroup:\n    'SDXL',\n});", 'multi-line object, value on its own line'],
    ["baseModelGroup: 'SD' + 'XL',", 'concatenation — caught, unlike variable indirection'],
  ];
  for (const [code, label] of caught) {
    assert.ok(
      findHardcodedEcosystem(code).length >= 1,
      `MISSED a hardcoded ecosystem (${label}): ${JSON.stringify(code)}`,
    );
    assert.ok(countBaseModelGroupSites(code) >= 1, `not even COUNTED (${label}): ${JSON.stringify(code)}`);
  }

  const legal = [
    ['baseModelGroup: checkpoint.baseModel,', 'derived from a property'],
    ['baseModelGroup: `${checkpoint.baseModel}`,', 'derived through an interpolated template'],
    ["baseModelGroup: checkpoint.baseModel,   // e.g. 'SDXL'", 'literal only in a trailing comment'],
    ["/* baseModelGroup: 'SDXL' is the bug */\nbaseModelGroup: checkpoint.baseModel,", 'literal only in a block comment'],
    ['baseModelGroup: ctx.checkpoint?.baseModel ?? undefined,', 'undefined fallback'],
    ['baseModelGroup: group,', 'derived from a variable'],
  ];
  for (const [code, label] of legal) {
    assert.deepEqual(
      findHardcodedEcosystem(code),
      [],
      `FALSE POSITIVE (${label}): ${JSON.stringify(code)}`,
    );
  }

  // The two INDIRECTION holes the header's KNOWN LIMITS names, pinned so that
  // bullet stays a measurement rather than a belief. These are NOT "legal" —
  // they are documented misses. If one starts being caught, the bullet is what
  // needs updating, not this list.
  for (const [code, label] of [
    ["const ECOSYSTEM = 'SDXL';\nbaseModelGroup: ECOSYSTEM,", 'literal via a const'],
    ['baseModelGroup: pickFamily(),', 'literal via a helper call'],
  ]) {
    assert.deepEqual(
      findHardcodedEcosystem(code),
      [],
      `a DOCUMENTED KNOWN HOLE now fires (${label}) — good news, but the header's ` +
        `KNOWN LIMITS bullet listing it as a miss is now wrong: ${JSON.stringify(code)}`,
    );
  }

  // The quoted key must reach the coverage count too — it did not before, so a
  // corpus written that way could drive the site floor to zero and make the
  // violation test vacuous.
  assert.equal(countBaseModelGroupSites("{ 'baseModelGroup': x, baseModelGroup: y }"), 2);
  // …and a near-miss identifier must NOT.
  assert.equal(countBaseModelGroupSites('myBaseModelGroup: 1'), 0);

  // Multi-line offenders report the line the KEY is on, flattened to one line.
  assert.deepEqual(findHardcodedEcosystem("a,\nbaseModelGroup:\n  'SDXL',\n"), [
    { lineOffset: 1, text: "baseModelGroup: 'SDXL'" },
  ]);
});

test('no picker example hardcodes a base-model ecosystem', () => {
  const offenders = [];
  for (const r of REGIONS) {
    for (const hit of findHardcodedEcosystem(r.code)) {
      offenders.push(`${r.file}:${r.line + hit.lineOffset} ${hit.text}`);
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

  const sites = REGIONS.reduce((n, r) => n + countBaseModelGroupSites(r.code), 0);
  assert.ok(
    sites >= MIN_BASE_MODEL_GROUP_SITES,
    `expected >= ${MIN_BASE_MODEL_GROUP_SITES} \`baseModelGroup:\` sites inside picker examples, found ${sites}. ` +
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
      countBaseModelGroupSites(r.code) === 0,
  );
  assert.ok(
    unconstrained.length > 0,
    'no @civitai/blocks-react example shows `open({ resourceType: … })` with no ' +
      'baseModelGroup. That unconstrained call is the correct default and the thing ' +
      'agents copy; a corpus that only ever shows the filtered form teaches the defect again.',
  );
});
