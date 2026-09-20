#!/usr/bin/env node
/**
 * Bundle-cost measurement for the design-system spike.
 *
 * THE QUESTION: what does importing ONE Button cost an app, and how does
 * `@civitai/elements` compare with the two React packages it replaces?
 *
 * Method: for each scenario, write a tiny ESM entry that imports exactly one
 * symbol, bundle it with esbuild (minify, ESM, browser, react/react-dom
 * external — apps already ship React), and report the byte count of the output
 * plus its gzip size. All scenarios are bundled identically, so the numbers are
 * comparable to each other; the ABSOLUTE numbers depend on esbuild's settings
 * and are only meaningful as a ratio.
 *
 * Run: pnpm --filter @civitai/elements measure
 * Requires: every workspace package built first (`pnpm -r build`).
 */
import { execFileSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, '..');
const repoRoot = join(pkgRoot, '..', '..');

const ESBUILD = join(
  repoRoot,
  'node_modules/.pnpm/esbuild@0.28.1/node_modules/esbuild/bin/esbuild'
);

/**
 * Entries are written INSIDE a package directory so node resolution finds that
 * package's own node_modules. `cwd` says which one.
 */
const SCENARIOS = [
  {
    id: 'blocks-react/ui Button (BASELINE)',
    cwd: join(repoRoot, 'packages', 'civitai-blocks-react'),
    source: "import { Button } from '@civitai/blocks-react/ui';\nglobalThis.__k = Button;\n",
  },
  {
    id: 'components-react Button',
    cwd: join(repoRoot, 'packages', 'civitai-components-react'),
    source: "import { Button } from '@civitai/components-react';\nglobalThis.__k = Button;\n",
  },
  {
    id: 'elements/button',
    cwd: pkgRoot,
    source: "import { CivitaiButton } from '@civitai/elements/button';\nglobalThis.__k = CivitaiButton;\n",
  },
  {
    id: 'elements/button + stack',
    cwd: pkgRoot,
    source:
      "import { CivitaiButton } from '@civitai/elements/button';\nimport { CivitaiStack } from '@civitai/elements/stack';\nglobalThis.__k = [CivitaiButton, CivitaiStack];\n",
  },
  {
    id: 'elements ALL FOUR (barrel)',
    cwd: pkgRoot,
    source: "import * as E from '@civitai/elements';\nglobalThis.__k = E;\n",
  },
  {
    id: 'blocks-react/ui ALL (barrel)',
    cwd: join(repoRoot, 'packages', 'civitai-blocks-react'),
    source: "import * as U from '@civitai/blocks-react/ui';\nglobalThis.__k = U;\n",
  },
];

const out = mkdtempSync(join(tmpdir(), 'civitai-measure-'));
const results = [];

try {
  for (const s of SCENARIOS) {
    const entry = join(s.cwd, `__measure-${Math.random().toString(36).slice(2)}.mjs`);
    const bundle = join(out, 'bundle.js');
    writeFileSync(entry, s.source);
    try {
      execFileSync(
        ESBUILD,
        [
          entry,
          '--bundle',
          '--minify',
          '--format=esm',
          '--platform=browser',
          '--external:react',
          '--external:react-dom',
          '--external:react/jsx-runtime',
          `--outfile=${bundle}`,
        ],
        { cwd: s.cwd, stdio: ['ignore', 'ignore', 'pipe'] }
      );
    } finally {
      rmSync(entry, { force: true });
    }
    const buf = readFileSync(bundle);
    results.push({ id: s.id, bytes: buf.length, gzip: gzipSync(buf, { level: 9 }).length });
  }
} finally {
  rmSync(out, { recursive: true, force: true });
}

const baseline = results[0];
const w = Math.max(...results.map((r) => r.id.length));
console.log('scenario'.padEnd(w) + '   minified      gzip     vs baseline');
console.log('-'.repeat(w + 38));
for (const r of results) {
  const ratio = (r.bytes / baseline.bytes) * 100;
  console.log(
    r.id.padEnd(w) +
      String(r.bytes).padStart(11) +
      String(r.gzip).padStart(10) +
      `${ratio.toFixed(1)}%`.padStart(16)
  );
}

if (process.env.MEASURE_JSON) {
  writeFileSync(process.env.MEASURE_JSON, JSON.stringify(results, null, 2));
}
