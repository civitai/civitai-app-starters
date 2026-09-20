#!/usr/bin/env node
/**
 * What does the per-component CSS split actually save?
 *
 * PROVENANCE — the method (and most of the code) is lifted from the
 * bundle-cost measurement on `feat/civitai-elements-phase1`
 * (`packages/civitai-elements/scripts/measure-bundle.mjs`). That script asked a
 * three-way question about custom elements; this one keeps only the two rows
 * that matter here, and replaces its computed slices with the REAL artifacts
 * `@civitai/components` now emits.
 *
 * THE QUESTION
 * ============
 * `blocks-react/ui`'s Button imports `useBlocksStyles`, whose injection
 * concatenates the theme tokens + the ENTIRE `@civitai/components` sheet +
 * `INTERACTIVE_STYLES` into one string. A Button-only bundle therefore also
 * carries SegmentedControl, Toast, Tooltip, NumberInput and fifteen others.
 * `@civitai/components` now ships per-component slices — so: what would
 * `useBlocksStyles()` importing only Button's slice cost instead?
 *
 * 🔴 This measures a path that is NOT taken. `blocks-react` is deliberately
 * unchanged, because injecting the whole pack is a DOCUMENTED contract
 * (MARKUP.md): rendering any one `/ui` component styles hand-written
 * `data-civitai-ui="…"` markup elsewhere on the page. Whether to break that
 * for the bytes is the decision this number informs — see issue #358.
 *
 * ── METHOD ────────────────────────────────────────────────────────────────
 * For each scenario: write a tiny ESM entry importing exactly one symbol,
 * bundle with esbuild (minify, ESM, browser, react/react-dom external — apps
 * already ship React), report output bytes + gzip.
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
const BUTTON_DEDUPED = (() => {
  const button = slice('button');
  const loader = slice('loader');
  // Splice loader's section into button's sheet: everything from its section
  // marker to the closing `}` of the layer.
  const marker = loader.indexOf('  /* ----- Loader ----- */');
  const close = loader.lastIndexOf('}');
  if (marker === -1 || close === -1) throw new Error('[measure] loader slice shape unexpected');
  const buttonClose = button.lastIndexOf('}');
  return button.slice(0, buttonClose) + loader.slice(marker, close) + button.slice(buttonClose);
})();

const CONTROL_OVERRIDES = {
  naive: {
    components: () => `export const componentsCss = ${JSON.stringify(BUTTON_NAIVE)};\n`,
    interactive: (src, path) => blankConst(src, 'INTERACTIVE_STYLES', path),
  },
  deduped: {
    components: () => `export const componentsCss = ${JSON.stringify(BUTTON_DEDUPED)};\n`,
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
  { id: 'A. blocks-react/ui Button — un-split BASELINE (shipped today)', source: BUTTON_ENTRY },
  {
    id: 'B. same Button, per-component CSS — slices CONCATENATED (naive)',
    source: BUTTON_ENTRY,
    control: CONTROL_OVERRIDES.naive,
  },
  {
    id: 'C. same Button, per-component CSS — slices MERGED (deduped)',
    source: BUTTON_ENTRY,
    control: CONTROL_OVERRIDES.deduped,
  },
  {
    id: '— blocks-react/ui ALL components (barrel), for scale',
    source: "import * as U from '@civitai/blocks-react/ui';\nglobalThis.__k = U;\n",
  },
];

const out = mkdtempSync(join(tmpdir(), 'civitai-measure-'));

async function bundle(scenario, plugins) {
  const entry = join(blocksPkg, `__measure-${Math.random().toString(36).slice(2)}.mjs`);
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
      absWorkingDir: blocksPkg,
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
    const control = s.control ?? null;
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
  `\nesbuild ${esbuild.version} — minify, ESM, browser, react/react-dom external.\n` +
    'JS/CSS split is a stub-differential: each row is bundled twice, the second\n' +
    'time with every CSS string constant blanked. CSS = full - stubbed.\n' +
    'Rows B and C are REAL builds of the REAL `dist/css/*.css` artifacts this\n' +
    'repo now emits, asserted lossless against src/components.css at build time.\n' +
    'They model a `blocks-react` change that is deliberately NOT made — see the\n' +
    'MARKUP.md whole-pack contract and issue #358.'
);

if (process.env.MEASURE_JSON) {
  writeFileSync(process.env.MEASURE_JSON, JSON.stringify(results, null, 2));
}
