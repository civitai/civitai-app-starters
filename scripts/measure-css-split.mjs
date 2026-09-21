#!/usr/bin/env node
/**
 * What does the per-component CSS split actually save?
 *
 * PROVENANCE — the method (and most of the code) is lifted from the
 * bundle-cost measurement on `feat/civitai-elements-phase1`
 * (`packages/civitai-elements/scripts/measure-bundle.mjs`). That script asked a
 * three-way question about custom elements; this one keeps only the rows that
 * matter here, and replaces its computed slices with the REAL artifacts
 * `@civitai/components` now emits.
 *
 * THE QUESTION
 * ============
 * `blocks-react/ui`'s Button imports `useBlocksStyles`, whose injection
 * concatenates the theme tokens + the ENTIRE `@civitai/components` sheet +
 * `INTERACTIVE_STYLES` into one string. A Button-only bundle therefore also
 * carries SegmentedControl, Toast, Tooltip, NumberInput and fifteen others.
 * `@civitai/components` now BUILDS per-component slices (internal artifacts,
 * not exported) — so: what would `useBlocksStyles()` importing only Button's
 * slice cost instead?
 *
 * 🔴 RETIRES WHEN #358 CLOSES. This script exists to feed exactly one open
 * decision, and #358 cites `pnpm measure:css-split` as its reproduction step.
 * When that issue is resolved either way, delete this file and the root
 * `measure:css-split` script — a measurement kept past the question it answers
 * is upkeep with no reader.
 *
 * 🔴 EVERY ROW BUT `A` MEASURES A PATH NO SHIPPED CODE TAKES. B, C, D and E
 * all replace `componentsCss` wholesale, which requires shipped code to import
 * the per-component slices — and none does; only this script and
 * `test/css-slice.test.ts` read them. `blocks-react` is deliberately
 * unchanged, because injecting the whole pack is a DOCUMENTED contract
 * (MARKUP.md): rendering any one `/ui` component styles hand-written
 * `data-civitai-ui="…"` markup elsewhere on the page. Whether to break that
 * for the bytes is the decision these numbers inform — see issue #358. Row A
 * is the only row that is a bundle anything ships.
 *
 * ── 🔴 TWO SHEETS ARE IN PLAY. ONLY ONE OF THEM IS SLICED. ────────────────
 * A `blocks-react/ui` Button bundle carries CSS from TWO packages:
 *
 *   `componentsCss`      — `@civitai/components`' whole sheet. THIS is what
 *                          this repo now slices; rows B/C and D/E all replace
 *                          it with Button's + Loader's real slices.
 *   `INTERACTIVE_STYLES` — `@civitai/blocks-react`'s OWN sheet, for the
 *                          components that have no `@civitai/components`
 *                          counterpart (Modal, Select, Slider, Collapse,
 *                          SegmentedControl, ResourceCard). It is NOT one of
 *                          the `dist/css/*.css` artifacts, it is NOT touched
 *                          by the `@civitai/components` split, and a Button
 *                          bundle carries all ~12 KB of it either way.
 *
 * So there are two different questions, and this script answers BOTH rather
 * than one number that quietly answers the wrong one. 🔴 THE ROWS ARE LABELLED
 * BY WHICH PACKAGE'S SHEET IS SLICED — not by what ships, because apart from A
 * none of them ships:
 *
 *   ROWS B, C — ONLY `@civitai/components`' sheet is sliced. `INTERACTIVE_STYLES`
 *               is left fully intact. These rows ISOLATE what this repo's split
 *               contributes on its own. They are not a bundle any code
 *               produces: no shipped code imports the slices.
 *   ROWS D, E — BOTH sheets sliced — the above PLUS a second split of
 *               `INTERACTIVE_STYLES` in `blocks-react` (modelled at its FLOOR:
 *               blanked entirely, since a Button renders none of the six
 *               components that sheet styles). No code in this repo implements
 *               it. This pair is the closer model of what issue #358 is
 *               deciding — a per-component `useBlocksStyles()` would naturally
 *               slice `INTERACTIVE_STYLES` too — and it is also the pair
 *               comparable to PR #346's custom-element row, which never imports
 *               `blocks-react`'s `ui/styles` at all and so carries no
 *               `INTERACTIVE_STYLES` by nature. Quoting D/E as the COMPONENTS
 *               split's saving credits this repo with deleting another
 *               package's stylesheet; that is what B/C are for.
 *
 * ── METHOD ────────────────────────────────────────────────────────────────
 * For each scenario: feed esbuild a tiny ESM entry (via `stdin`, resolved from
 * `packages/civitai-blocks-react/`) importing exactly one symbol, bundle it
 * (minify, ESM, browser, react/react-dom external — apps already ship React),
 * report output bytes + gzip.
 *
 * The JS/CSS split is a STUB-DIFFERENTIAL: every scenario is bundled twice,
 * the second time with a plugin that blanks the CSS string constants named in
 * `CSS_CARRIERS`. `css = full - stubbed`, `js = stubbed`. The plugin asserts
 * that each declared constant was found exactly once and actually shrank — a
 * stub that silently matched nothing would report css=0 and read as "this
 * scenario has no CSS", which is the failure mode this guard exists for. The
 * control overrides assert they fired, for the mirror-image reason: an
 * override that never ran would measure the UNSPLIT baseline and report it as
 * the split one.
 *
 * All scenarios are bundled identically, so the numbers are comparable to each
 * other; ABSOLUTE numbers depend on esbuild's settings and version.
 *
 * Run: pnpm build && pnpm measure:css-split
 */
import { gzipSync } from 'node:zlib';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as esbuild from 'esbuild';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const componentsPkg = join(repoRoot, 'packages', 'civitai-components');
const blocksPkg = join(repoRoot, 'packages', 'civitai-blocks-react');

/** Read one of the per-component artifacts the build writer now emits. */
function slice(slug) {
  return readFileSync(join(componentsPkg, 'dist', 'css', `${slug}.css`), 'utf8');
}

/**
 * Button's CSS, two ways.
 *
 * `Loader` is in both because `ui/Button.tsx` imports `<Loader>` for its
 * `loading` state — a per-component split does not mean "one component" in the
 * bundle, it means the TRANSITIVE component set, and pretending otherwise
 * would understate the control.
 *
 *   NAIVE  — the two shipped slices concatenated, which is what the simplest
 *            possible refactor of `ui/styles.ts` produces. Each slice is a
 *            standalone sheet, so the file header, the `@layer` wrapper and
 *            the shared `[data-civitai-ui]` base rule appear TWICE.
 *   DEDUPED — one sheet carrying both sections, which is what an injector that
 *            merges slices produces. The floor for this approach.
 */
const BUTTON_NAIVE = slice('button') + slice('loader');

/**
 * The lone `/* ----- Name ----- *\/` marker in a standalone slice.
 *
 * Found by SHAPE, never by the title's English. An earlier revision searched
 * the literal string `'  /* ----- Loader ----- *\/'`, which reintroduced
 * exactly the prose coupling `slice-css.ts` deleted when it moved slug
 * derivation off titles and onto selectors: reword the marker and this script
 * starts throwing "slice shape unexpected", blaming the slicer for a comment
 * edit. The count assertion is what keeps the shape claim honest — a slice is
 * defined to carry exactly one section.
 */
function loneSectionMarkerIndex(sheet, slug) {
  const re = /^ {2}\/\* ----- .+? ----- \*\/$/gm;
  const hits = [];
  for (let m = re.exec(sheet); m; m = re.exec(sheet)) hits.push(m.index);
  if (hits.length !== 1) {
    throw new Error(
      `[measure] dist/css/${slug}.css carries ${hits.length} section markers, expected exactly 1. ` +
        'A slice is a standalone sheet holding one section; this one is not, so splicing two ' +
        'slices together would produce a sheet that is not the deduped case being measured.'
    );
  }
  return hits[0];
}

const BUTTON_DEDUPED = (() => {
  const button = slice('button');
  const loader = slice('loader');
  // Splice loader's section into button's sheet: everything from its section
  // marker to the closing `}` of the layer.
  const marker = loneSectionMarkerIndex(loader, 'loader');
  const close = loader.lastIndexOf('}');
  if (close === -1) throw new Error('[measure] loader slice has no @layer closer');
  const buttonClose = button.lastIndexOf('}');
  return button.slice(0, buttonClose) + loader.slice(marker, close) + button.slice(buttonClose);
})();

/** Replace `componentsCss` with Button's real slices, one of the two ways. */
const SLICED_COMPONENTS = {
  naive: () => `export const componentsCss = ${JSON.stringify(BUTTON_NAIVE)};\n`,
  deduped: () => `export const componentsCss = ${JSON.stringify(BUTTON_DEDUPED)};\n`,
};

/**
 * 🔴 Read the docblock's "TWO SHEETS" section before quoting any of these.
 *
 * `COMPONENTS_ONLY` slices ONE of the two sheets — `@civitai/components`', the
 * one this repo cuts into `dist/css/*.css`. `INTERACTIVE_STYLES` is
 * deliberately absent from these overrides, so `blocks-react`'s own ~12 KB
 * sheet stays in the bundle exactly as it ships today.
 *
 * `PLUS_BLOCKS_SPLIT` slices BOTH — it adds a SECOND, UNIMPLEMENTED split,
 * `blocks-react` slicing `INTERACTIVE_STYLES` per component too, modelled at
 * its floor by blanking the constant, because a Button renders none of the six
 * components that sheet styles. Nothing in this repo does this.
 *
 * Neither group is a bundle any current code produces — both replace
 * `componentsCss` wholesale, and no shipped code imports the slices.
 */
const COMPONENTS_ONLY = {
  naive: { components: SLICED_COMPONENTS.naive },
  deduped: { components: SLICED_COMPONENTS.deduped },
};

const PLUS_BLOCKS_SPLIT = {
  naive: {
    components: SLICED_COMPONENTS.naive,
    interactive: (src, path) => blankConst(src, 'INTERACTIVE_STYLES', path),
  },
  deduped: {
    components: SLICED_COMPONENTS.deduped,
    interactive: (src, path) => blankConst(src, 'INTERACTIVE_STYLES', path),
  },
};

/**
 * Every module in the graph that holds CSS in a string constant, the names of
 * those constants, and which control override (if any) applies to it.
 *
 * One plugin owns BOTH jobs on purpose. esbuild gives a path to the first
 * plugin whose `onLoad` matches, so a separate control plugin and stub plugin
 * would fight over `styles.generated.js`: the control would win, the stub would
 * never run on it, and the control row's sliced CSS would be counted in the JS
 * column. That is a wrong number that looks entirely plausible.
 */
const CSS_CARRIERS = [
  {
    key: 'tokens',
    filter: /civitai-theme[/\\]dist[/\\]tokens\.generated\.js$/,
    consts: ['tokensCss'],
  },
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
];

/**
 * Replace `export const NAME = <string-or-template-literal>;` with an empty
 * string. Throws if the constant is not found exactly once — a silent no-op
 * here would be scored as "this file holds no CSS".
 */
function blankConst(src, name, path) {
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

/** Is `const NAME = "…"` present with a NON-empty value? */
function hasNonEmptyConst(src, name) {
  return new RegExp(`(?:export )?const ${name} = (?:"(?:[^"\\\\]|\\\\.)+"|\`[^\`]+\`)`).test(src);
}

/**
 * The one plugin that owns every CSS-carrying module.
 *
 * @param {object} opts
 * @param {object|null} opts.control  per-component-split overrides, or null
 * @param {boolean} opts.stub         blank all remaining CSS (differential pass 2)
 * @param {Array}   opts.report       mutated: one entry per carrier actually loaded
 */
function cssPlugin({ control = null, stub = false, report }) {
  const fired = new Set();
  return {
    name: 'civitai-css',
    setup(build) {
      build.onStart(() => fired.clear());
      for (const carrier of CSS_CARRIERS) {
        build.onLoad({ filter: carrier.filter }, (args) => {
          const src = readFileSync(args.path, 'utf8');
          let out = src;
          let overridden = false;
          if (control && control[carrier.key]) {
            out = control[carrier.key](src, args.path);
            overridden = true;
          }
          if (stub) {
            // An override may already have emptied the constant (the
            // `interactive` case); blanking it a second time would trip
            // blankConst's exactly-once guard on a `""` that is already blank.
            const before = out;
            out = carrier.consts.reduce(
              (acc, n) => (hasNonEmptyConst(acc, n) ? blankConst(acc, n, args.path) : acc),
              out
            );
            if (out.length >= before.length && !overridden) {
              throw new Error(
                `[stub] blanking ${args.path} removed nothing (${before.length} -> ${out.length}). ` +
                  'A stub that changes nothing reports css=0 for a file full of CSS.'
              );
            }
          }
          fired.add(carrier.key);
          // `removed` is UTF-16 code units of MODULE source (String.length), not
          // bytes and not stylesheet bytes — see the MEASURE_CARRIERS note below.
          report.push({ key: carrier.key, path: args.path, removed: src.length - out.length });
          return { contents: out, loader: 'js' };
        });
      }
      build.onEnd(() => {
        if (!control) return;
        for (const key of Object.keys(control)) {
          if (!fired.has(key)) {
            throw new Error(
              `[control] the "${key}" override never fired. The control scenario would ` +
                'silently measure the UNSPLIT baseline and report it as the split one.'
            );
          }
        }
      });
    },
  };
}

const BUTTON_ENTRY = "import { Button } from '@civitai/blocks-react/ui';\nglobalThis.__k = Button;\n";

const SCENARIOS = [
  {
    id: 'A. blocks-react/ui Button — NEITHER sheet sliced (ships today)',
    source: BUTTON_ENTRY,
  },
  {
    id: "B. only @civitai/components' sheet sliced — CONCATENATED",
    source: BUTTON_ENTRY,
    control: COMPONENTS_ONLY.naive,
  },
  {
    id: "C. only @civitai/components' sheet sliced — MERGED (deduped)",
    source: BUTTON_ENTRY,
    control: COMPONENTS_ONLY.deduped,
  },
  {
    id: "D. BOTH sheets sliced (also blocks-react's own) — CONCATENATED",
    source: BUTTON_ENTRY,
    control: PLUS_BLOCKS_SPLIT.naive,
  },
  {
    id: "E. BOTH sheets sliced (also blocks-react's own) — MERGED",
    source: BUTTON_ENTRY,
    control: PLUS_BLOCKS_SPLIT.deduped,
  },
  {
    id: '— blocks-react/ui ALL components (barrel), for scale',
    source: "import * as U from '@civitai/blocks-react/ui';\nglobalThis.__k = U;\n",
  },
];

const out = mkdtempSync(join(tmpdir(), 'civitai-measure-'));

/**
 * Bundle one scenario.
 *
 * The entry is passed via `stdin` with `resolveDir: blocksPkg` rather than
 * written to a file. An earlier revision wrote `__measure-<rand>.mjs` INTO
 * `packages/civitai-blocks-react/` — a TRACKED directory — and deleted it in a
 * `finally`. A `finally` does not run on SIGKILL or a power cut, so that left
 * an untracked `.mjs` no `.gitignore` covers, one `git add` away from being
 * committed. `stdin` resolves imports from `resolveDir` exactly as a real file
 * in that directory would, and writes nothing.
 */
async function bundle(scenario, plugins) {
  const outfile = join(out, `bundle-${Math.random().toString(36).slice(2)}.js`);
  await esbuild.build({
    stdin: {
      contents: scenario.source,
      resolveDir: blocksPkg,
      sourcefile: 'measure-entry.mjs',
      loader: 'js',
    },
    bundle: true,
    minify: true,
    format: 'esm',
    platform: 'browser',
    external: ['react', 'react-dom', 'react/jsx-runtime'],
    absWorkingDir: blocksPkg,
    outfile,
    logLevel: 'silent',
    plugins,
  });
  const buf = readFileSync(outfile);
  rmSync(outfile, { force: true });
  return buf;
}

const results = [];
try {
  for (const s of SCENARIOS) {
    const control = s.control ?? null;
    const fullReport = [];
    const full = await bundle(s, [cssPlugin({ control, stub: false, report: fullReport })]);
    // 🔴 The control that separates rows B/C from D/E. `MEASURE_CARRIERS=1`
    // prints, per row, how much each carrier's override took off that carrier's
    // MODULE SOURCE. The claim "B and C leave INTERACTIVE_STYLES intact" is
    // otherwise only readable off the SOURCE of the override table, and a
    // reader quoting the table has no way to check it. Expected:
    // `interactive: removed 0` on A/B/C and the barrel, non-zero on D/E only.
    //
    // ZERO-vs-NON-ZERO is the load-bearing part, and it is exact. The magnitude
    // is NOT a byte count and NOT a count of stylesheet bytes: it is
    // `String.length` on the module text, i.e. UTF-16 code units, and the
    // `components` override replaces the whole module rather than one constant,
    // so its number carries the module's JS wrapper and JSON string escaping
    // too. Measured on the current tree: `components: 26695` units is a 26,752-
    // byte module delta over 25,778 bytes of actual sheet, and
    // `interactive: 11999` units is 12,013 bytes. Do not quote these as bytes.
    if (process.env.MEASURE_CARRIERS) {
      console.error(
        `[carriers] ${s.id}\n           ` +
          fullReport
            .map((r) => `${r.key}: removed ${r.removed} UTF-16 units of module source`)
            .join('\n           ')
      );
    }
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
  `\nesbuild ${esbuild.version} — minify, ESM, browser, react/react-dom external.\n` +
    'JS/CSS split is a stub-differential: each row is bundled twice, the second\n' +
    'time with every CSS string constant blanked. CSS = full - stubbed.\n' +
    '\n' +
    '🔴 ROW A IS THE ONLY BUNDLE ANY CURRENT CODE PRODUCES. B/C/D/E all replace\n' +
    '`componentsCss` wholesale, which needs shipped code to import the slices —\n' +
    'and none does; only this script and the test suite read them. blocks-react\n' +
    'injects the whole pack, deliberately: see the MARKUP.md whole-pack contract\n' +
    'and issue #358. What is real about B/C/D/E is the CSS in them — all four are\n' +
    'builds of the REAL `dist/css/*.css` artifacts this repo emits, asserted\n' +
    'lossless against src/components.css at build time.\n' +
    '\n' +
    '🔴 B/C vs D/E IS NOT A DETAIL — they differ in WHICH SHEET IS SLICED:\n' +
    "  B, C  only @civitai/components' sheet. blocks-react keeps its own ~12 KB\n" +
    '        INTERACTIVE_STYLES sheet, which this repo does not touch and does\n' +
    "        not slice. These rows ISOLATE this package's own contribution.\n" +
    '  D, E  BOTH sheets — the above PLUS a SECOND, unimplemented split of\n' +
    "        blocks-react's own INTERACTIVE_STYLES, modelled at its floor\n" +
    '        (blanked — a Button renders none of the six components it styles).\n' +
    '        No code in this repo does this. This pair is the closer model of\n' +
    '        what #358 is deciding (a per-component useBlocksStyles() would\n' +
    '        slice INTERACTIVE_STYLES too), and the pair comparable to PR #346,\n' +
    '        whose custom element never imports `ui/styles` and so carries no\n' +
    '        INTERACTIVE_STYLES by nature.\n' +
    `  The gap between them is ${results[1].bytes - results[3].bytes} B — it belongs to the blocks-react half of\n` +
    '  that change, NOT to the components split.'
);

if (process.env.MEASURE_JSON) {
  writeFileSync(process.env.MEASURE_JSON, JSON.stringify(results, null, 2));
}
