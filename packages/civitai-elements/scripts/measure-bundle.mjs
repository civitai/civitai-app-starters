#!/usr/bin/env node
/**
 * Bundle-cost measurement for the design-system spike.
 *
 * THE QUESTION — restated after round 0 of review, because the ORIGINAL
 * question was the wrong one.
 *
 * The first version of this script asked "what does one Button cost from
 * `@civitai/blocks-react/ui` vs from `@civitai/elements`?" and answered
 * 52,568 B vs 21,309 B. That comparison is real but it does NOT isolate the
 * variable it was used to argue about. Decomposed:
 *
 *     blocks-react/ui Button   50,150 B of CSS   +  2,421 B of JS
 *     @civitai/elements/button 10,151 B of CSS   + 11,158 B of JS
 *
 * The whole win is the CSS column, and the CSS column has nothing to do with
 * custom elements. `blocks-react/ui`'s Button imports `useBlocksStyles` from
 * `./styles.js`, whose `BLOCKS_UI_STYLES` concatenates the theme tokens, the
 * ENTIRE `@civitai/components` sheet and `INTERACTIVE_STYLES` into one string
 * constant — so a bundle containing only a Button also contains the CSS for
 * SegmentedControl, Toast, Tooltip, NumberInput and fifteen others. Splitting
 * that string per component is a bundling fix available WITHOUT a new package,
 * without Lit, and without a new contract.
 *
 * So this script now measures THREE scenarios, not two, and splits each into a
 * JS column and a CSS column:
 *
 *   A. `blocks-react/ui` Button — the un-split baseline, as shipped today.
 *   B. the CONTROL: the same React Button, same component code, same tokens,
 *      with `@civitai/components`' sheet sliced per component so only Button's
 *      and Loader's rules are in the graph. No new package, no Lit, no custom
 *      element. This is what "fix the CSS bundling in place" costs.
 *   C. `@civitai/elements/button` — the custom element.
 *
 * B is a real build of real sliced CSS, produced by `sliceComponentsCss()`
 * below from the real `src/components.css`, and proven lossless: the
 * concatenation of every slice is asserted byte-identical to the source sheet
 * before any measurement runs. It is modelled with an esbuild plugin rather
 * than by refactoring `@civitai/components`, because the point is the NUMBER —
 * whether the refactor is worth doing is the decision the number informs.
 *
 * ── METHOD ────────────────────────────────────────────────────────────────
 * For each scenario: write a tiny ESM entry importing exactly one symbol,
 * bundle with esbuild (minify, ESM, browser, react/react-dom external — apps
 * already ship React), report output bytes + gzip.
 *
 * The JS/CSS split is a STUB-DIFFERENTIAL: every scenario is bundled twice,
 * the second time with a plugin that blanks the CSS string constants named in
 * `CSS_CARRIERS`. `css = full - stubbed`, `js = stubbed`. The plugin asserts
 * that each declared constant was found exactly once and actually shrank —
 * a stub that silently matched nothing would report css=0 and read as "this
 * scenario has no CSS", which is the failure mode this guard exists for.
 *
 * All scenarios are bundled identically, so the numbers are comparable to each
 * other; ABSOLUTE numbers depend on esbuild's settings.
 *
 * Run: pnpm --filter @civitai/elements measure
 * Requires: every workspace package built first (`pnpm -r build`).
 */
import { gzipSync } from 'node:zlib';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// esbuild is a devDependency of THIS package, so the bare specifier resolves.
// (It used to be an execFileSync of a hardcoded
// `node_modules/.pnpm/esbuild@0.28.1/...` path, which a version bump breaks.)
import * as esbuild from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, '..');
const repoRoot = join(pkgRoot, '..', '..');
const componentsPkg = join(repoRoot, 'packages', 'civitai-components');
const blocksPkg = join(repoRoot, 'packages', 'civitai-blocks-react');
const componentsReactPkg = join(repoRoot, 'packages', 'civitai-components-react');

/* ──────────────────────────────────────────────────────────────────────────
 * The control: slice `@civitai/components`' sheet per component.
 * ────────────────────────────────────────────────────────────────────────── */

const LAYER_OPEN = '@layer civitai.components {\n';
/** `  /* ----- Button ----- *\/` — the section markers already in the sheet. */
const SECTION_RE = /^ {2}\/\* ----- (.+?) ----- \*\/$/gm;

/**
 * Split `src/components.css` into a shared preamble plus one chunk per
 * `/* ----- Name ----- *\/` section.
 *
 * Returns `{ header, base, tail, sections }` where `sections` is an ordered
 * array of `{ title, text }`. Reassembling header + LAYER_OPEN + base +
 * every section's text + tail must reproduce the input EXACTLY; the caller
 * asserts that (see `assertLossless`). Without that assertion a slicer that
 * dropped a section would make the control look smaller than it is, which is
 * precisely the direction that would flatter the conclusion.
 */
function sliceComponentsCss(css) {
  const open = css.indexOf(LAYER_OPEN);
  if (open === -1) throw new Error('[slice] @layer opener not found in components.css');
  const header = css.slice(0, open);
  const body = css.slice(open + LAYER_OPEN.length);
  const close = body.lastIndexOf('}');
  if (close === -1) throw new Error('[slice] @layer closer not found in components.css');
  const inner = body.slice(0, close);
  const tail = body.slice(close);

  const marks = [];
  SECTION_RE.lastIndex = 0;
  for (let m = SECTION_RE.exec(inner); m; m = SECTION_RE.exec(inner)) {
    marks.push({ title: m[1], at: m.index });
  }
  if (marks.length === 0) throw new Error('[slice] no `/* ----- X ----- */` sections found');

  const base = inner.slice(0, marks[0].at);
  const sections = marks.map((mark, i) => ({
    title: mark.title,
    text: inner.slice(mark.at, i + 1 < marks.length ? marks[i + 1].at : inner.length),
  }));
  return { header, base, tail, sections };
}

/** Compose a sheet from a subset of sections (always including the base rule). */
function composeSheet(split, titles) {
  const chosen = split.sections.filter((s) => titles.some((t) => sectionMatches(s.title, t)));
  const missing = titles.filter((t) => !split.sections.some((s) => sectionMatches(s.title, t)));
  if (missing.length) throw new Error(`[slice] no section matches ${missing.join(', ')}`);
  return split.header + LAYER_OPEN + split.base + chosen.map((s) => s.text).join('') + split.tail;
}

/**
 * Section titles name GROUPS (`TextInput / Textarea / NumberInput / Select`),
 * and carry issue refs (`Checkbox / Radio (issue #181 F6)`). Match on the
 * slash-separated words with any parenthetical/em-dash suffix stripped.
 */
function sectionMatches(title, wanted) {
  return title
    .split('/')
    .map((p) => p.replace(/\(.*$/, '').replace(/—.*$/, '').trim())
    .includes(wanted);
}

/** Reassembly must be byte-identical or every control number below is void. */
function assertLossless(split, original) {
  const all = composeSheet(
    split,
    split.sections.flatMap((s) =>
      s.title.split('/').map((p) => p.replace(/\(.*$/, '').replace(/—.*$/, '').trim())
    )
  );
  if (all !== original) {
    throw new Error(
      `[slice] LOSSY: reassembled sheet is ${all.length} B, source is ${original.length} B. ` +
        'The per-component split is not a faithful partition of the stylesheet; ' +
        'every control measurement derived from it would be wrong.'
    );
  }
}

const COMPONENTS_CSS_PATH = join(componentsPkg, 'src', 'components.css');
const componentsCssSource = readFileSync(COMPONENTS_CSS_PATH, 'utf8');
const split = sliceComponentsCss(componentsCssSource);
assertLossless(split, componentsCssSource);

/**
 * Button's slice. `Loader` is in it because `ui/Button.tsx` imports `<Loader>`
 * for its `loading` state — a per-component split does not mean "one component"
 * in the bundle, it means the TRANSITIVE component set, and pretending
 * otherwise would understate the control.
 */
const BUTTON_SLICE = composeSheet(split, ['Button', 'Loader']);

/**
 * esbuild plugin implementing the control. Two overrides, both narrow:
 *   - `@civitai/components`' generated sheet module returns only the Button
 *     slice, which is what `import { buttonCss } from '@civitai/components/css/button'`
 *     would resolve to after the refactor;
 *   - `blocks-react`'s `ui/styles.js` has `INTERACTIVE_STYLES` blanked, since
 *     none of its rules (Modal / Select / Slider / Collapse / SegmentedControl /
 *     ResourceCard) are Button's and a split would not pull them in.
 * Both overrides assert they fired.
 */
const CONTROL_OVERRIDES = {
  /** What `@civitai/components/css/button` would resolve to after the split. */
  components: () => `export const componentsCss = ${JSON.stringify(BUTTON_SLICE)};\n`,
  /**
   * `blocks-react`'s own `INTERACTIVE_STYLES` (Modal / Select / Slider /
   * Collapse / SegmentedControl / ResourceCard) holds no Button rule, so a
   * per-component split drops all of it from a Button-only bundle.
   */
  interactive: (src, path) => blankConst(src, 'INTERACTIVE_STYLES', path),
};

/* ──────────────────────────────────────────────────────────────────────────
 * JS/CSS decomposition — the stub-differential.
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Every module in the graph that holds CSS in a string constant, the names of
 * those constants, and which control override (if any) applies to it.
 *
 * One plugin owns BOTH jobs on purpose. esbuild gives a path to the first
 * plugin whose `onLoad` matches, so a separate control plugin and stub plugin
 * would fight over `styles.generated.js`: the control would win, the stub would
 * never run on it, and row B's sliced CSS would be counted in the JS column.
 * That is a wrong number that looks entirely plausible.
 */
const CSS_CARRIERS = [
  { key: 'tokens', filter: /civitai-theme[/\\]dist[/\\]tokens\.generated\.js$/, consts: ['tokensCss'] },
  {
    key: 'components',
    filter: /civitai-components[/\\]dist[/\\]styles\.generated\.js$/,
    consts: ['componentsCss'],
  },
  {
    key: 'interactive',
    filter: /civitai-blocks-react[/\\]dist[/\\]ui[/\\]styles\.js$/,
    consts: ['INTERACTIVE_STYLES'],
  },
  { key: 'elements', filter: /civitai-elements[/\\]dist[/\\]generated[/\\][a-z-]+\.css\.js$/, consts: null },
];

/**
 * Replace `export const NAME = <string-or-template-literal>;` with an empty
 * string, or every `export const *Css = "…";` in a generated module when
 * `names` is null. Throws if a named constant is not found exactly once —
 * a silent no-op here would be scored as "this file holds no CSS".
 */
function blankConst(src, name, path) {
  // The generated modules are `export const X = "…";` (JSON.stringify'd, so a
  // single logical line with no raw newlines). `ui/styles.js` uses a template
  // literal with no interpolation (its own comment forbids `${`).
  const dq = new RegExp(`((?:export )?const ${name} = )"(?:[^"\\\\]|\\\\.)*"`, 'g');
  const tpl = new RegExp('((?:export )?const ' + name + ' = )`[^`]*`', 'g');
  let hits = 0;
  let out = src.replace(dq, (_, head) => {
    hits += 1;
    return `${head}""`;
  });
  out = out.replace(tpl, (_, head) => {
    hits += 1;
    return `${head}""`;
  });
  if (hits !== 1) {
    throw new Error(
      `[stub] expected exactly 1 occurrence of const ${name} in ${path}, found ${hits}. ` +
        'The JS/CSS split cannot be trusted with an unmatched stub.'
    );
  }
  return out;
}

function blankAllCssConsts(src, path) {
  let hits = 0;
  const out = src.replace(
    /((?:export )?const [A-Za-z0-9_]*[Cc]ss = )"(?:[^"\\]|\\.)*"/g,
    (_, head) => {
      hits += 1;
      return `${head}""`;
    }
  );
  if (hits === 0) throw new Error(`[stub] no *Css string constant found in ${path}`);
  return out;
}

/**
 * The one plugin that owns every CSS-carrying module.
 *
 * @param {object} opts
 * @param {boolean} opts.control  apply the per-component-split overrides (row B)
 * @param {boolean} opts.stub     blank all remaining CSS (the differential's second build)
 * @param {Array}   opts.report   mutated: one entry per carrier actually loaded
 */
function cssPlugin({ control = false, stub = false, report }) {
  const fired = new Set();
  return {
    name: 'civitai-css',
    setup(build) {
      // Reset per BUILD, not per plugin instance.
      build.onStart(() => fired.clear());
      for (const carrier of CSS_CARRIERS) {
        build.onLoad({ filter: carrier.filter }, (args) => {
          const src = readFileSync(args.path, 'utf8');
          let out = src;
          let overridden = false;
          if (control && CONTROL_OVERRIDES[carrier.key]) {
            out = CONTROL_OVERRIDES[carrier.key](src, args.path);
            overridden = true;
          }
          if (stub) {
            // An override may already have emptied the constant (the
            // `interactive` case); blanking it a second time would trip
            // blankConst's exactly-once guard on a `""` that is already blank.
            const before = out;
            out = carrier.consts
              ? carrier.consts.reduce(
                  (acc, n) => (hasNonEmptyConst(acc, n) ? blankConst(acc, n, args.path) : acc),
                  out
                )
              : blankAllCssConsts(out, args.path);
            if (out.length >= before.length && !overridden) {
              throw new Error(
                `[stub] blanking ${args.path} removed nothing (${before.length} -> ${out.length}). ` +
                  'A stub that changes nothing reports css=0 for a file full of CSS.'
              );
            }
          }
          fired.add(carrier.key);
          report.push({ key: carrier.key, path: args.path, removed: src.length - out.length });
          return { contents: out, loader: 'js' };
        });
      }
      build.onEnd(() => {
        if (control) {
          for (const key of Object.keys(CONTROL_OVERRIDES)) {
            if (!fired.has(key)) {
              throw new Error(
                `[control] the "${key}" override never fired. The control scenario would ` +
                  'silently measure the UNSPLIT baseline and report it as the split one.'
              );
            }
          }
        }
      });
    },
  };
}

/** Is `const NAME = "…"` present with a NON-empty value? */
function hasNonEmptyConst(src, name) {
  return new RegExp(`(?:export )?const ${name} = (?:"(?:[^"\\\\]|\\\\.)+"|\`[^\`]+\`)`).test(src);
}

/* ──────────────────────────────────────────────────────────────────────────
 * Scenarios.
 * ────────────────────────────────────────────────────────────────────────── */

const SCENARIOS = [
  {
    id: 'A. blocks-react/ui Button (un-split BASELINE)',
    cwd: blocksPkg,
    source: "import { Button } from '@civitai/blocks-react/ui';\nglobalThis.__k = Button;\n",
  },
  {
    id: 'B. blocks-react/ui Button, CSS SPLIT IN PLACE (control)',
    cwd: blocksPkg,
    source: "import { Button } from '@civitai/blocks-react/ui';\nglobalThis.__k = Button;\n",
    control: true,
  },
  {
    id: 'C. @civitai/elements/button (custom element)',
    cwd: pkgRoot,
    source: "import { CivitaiButton } from '@civitai/elements/button';\nglobalThis.__k = CivitaiButton;\n",
  },
  {
    id: '— components-react Button (un-split)',
    cwd: componentsReactPkg,
    source: "import { Button } from '@civitai/components-react';\nglobalThis.__k = Button;\n",
  },
  {
    id: '— elements/button + elements/stack',
    cwd: pkgRoot,
    source:
      "import { CivitaiButton } from '@civitai/elements/button';\nimport { CivitaiStack } from '@civitai/elements/stack';\nglobalThis.__k = [CivitaiButton, CivitaiStack];\n",
  },
  {
    id: '— elements ALL FOUR (barrel)',
    cwd: pkgRoot,
    source: "import * as E from '@civitai/elements';\nglobalThis.__k = E;\n",
  },
  {
    id: '— blocks-react/ui ALL (barrel)',
    cwd: blocksPkg,
    source: "import * as U from '@civitai/blocks-react/ui';\nglobalThis.__k = U;\n",
  },
];

const out = mkdtempSync(join(tmpdir(), 'civitai-measure-'));

/** Bundle one entry with the given extra plugins; return the output buffer. */
async function bundle(scenario, plugins) {
  const entry = join(scenario.cwd, `__measure-${Math.random().toString(36).slice(2)}.mjs`);
  const outfile = join(out, `bundle-${Math.random().toString(36).slice(2)}.js`);
  writeFileSync(entry, scenario.source);
  try {
    await esbuild.build({
      entryPoints: [entry],
      bundle: true,
      minify: true,
      format: 'esm',
      platform: 'browser',
      external: ['react', 'react-dom', 'react/jsx-runtime'],
      absWorkingDir: scenario.cwd,
      outfile,
      logLevel: 'silent',
      plugins,
    });
  } finally {
    rmSync(entry, { force: true });
  }
  const buf = readFileSync(outfile);
  rmSync(outfile, { force: true });
  return buf;
}

const results = [];
try {
  for (const s of SCENARIOS) {
    const control = s.control === true;
    const fullReport = [];
    const full = await bundle(s, [cssPlugin({ control, stub: false, report: fullReport })]);
    const stubReport = [];
    const stubbed = await bundle(s, [cssPlugin({ control, stub: true, report: stubReport })]);
    if (stubReport.length === 0) {
      throw new Error(
        `[stub] scenario "${s.id}" loaded no CSS carrier at all. Either the carrier ` +
          'registry is stale or the scenario genuinely ships no CSS; both need a human.'
      );
    }
    if (full.length <= stubbed.length) {
      throw new Error(
        `[stub] scenario "${s.id}": stubbed bundle (${stubbed.length} B) is not smaller than ` +
          `the full one (${full.length} B). The differential would report css<=0.`
      );
    }
    results.push({
      id: s.id,
      bytes: full.length,
      gzip: gzipSync(full, { level: 9 }).length,
      js: stubbed.length,
      css: full.length - stubbed.length,
    });
  }
} finally {
  rmSync(out, { recursive: true, force: true });
}

const baseline = results[0];
const w = Math.max(...results.map((r) => r.id.length));
const head =
  'scenario'.padEnd(w) +
  'total'.padStart(10) +
  'JS'.padStart(10) +
  'CSS'.padStart(10) +
  'gzip'.padStart(10) +
  'vs A'.padStart(9);
console.log(head);
console.log('-'.repeat(head.length));
for (const r of results) {
  console.log(
    r.id.padEnd(w) +
      String(r.bytes).padStart(10) +
      String(r.js).padStart(10) +
      String(r.css).padStart(10) +
      String(r.gzip).padStart(10) +
      `${((r.bytes / baseline.bytes) * 100).toFixed(1)}%`.padStart(9)
  );
}

console.log(
  '\nJS/CSS split is a stub-differential: each row is bundled twice, the second\n' +
    'time with every CSS string constant blanked. CSS = full - stubbed.\n' +
    'Row B is a REAL build of REAL sliced CSS (the slice is asserted lossless\n' +
    'against src/components.css before anything is measured) — no new package,\n' +
    'no Lit, no custom element. It is the control for the claim that the\n' +
    'baseline-vs-element gap is caused by the architecture.'
);

if (process.env.MEASURE_JSON) {
  writeFileSync(process.env.MEASURE_JSON, JSON.stringify(results, null, 2));
}
