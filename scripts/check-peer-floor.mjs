#!/usr/bin/env node
/**
 * check-peer-floor.mjs
 * --------------------
 * Verifies that `@civitai/blocks-react`'s DECLARED `@civitai/app-sdk` peer
 * floor is the version that actually supplies every symbol blocks-react
 * imports from the peer.
 *
 * WHY THIS EXISTS. A peer range is metadata: npm/pnpm check it, nothing checks
 * it against the code. blocks-react 0.49.0–0.51.0 declared `>=0.29.0 <1.0.0`
 * while importing `effectiveBrowsingCeiling`, which first exists in app-sdk
 * 0.39.0. The range was SATISFIED, so no install warned; the failure landed at
 * module evaluation in a consumer's test run as
 * `SyntaxError: ... does not provide an export named 'effectiveBrowsingCeiling'`.
 * On one consumer that read as **27 of 43 test files collecting zero tests —
 * 292 tests silently stopped running while the summary line reported no
 * failures**. Filed as #309.
 *
 * 🔴 AND THE NUMBER IN THAT ISSUE WAS ITSELF WRONG, which is the reason this is
 * a script and not a hand-written constant. #309's stated closing condition was
 * "a floor >= 0.39.0". Measured with this probe, blocks-react 0.51.0 at
 * app-sdk 0.39.0 is still missing FOUR symbols — `BlockCreatePostRequest`,
 * `BlockCreatePostResult`, `BlockCreatePostHostError`, `BlockPostSource` — which
 * arrive in 0.40.0. A fix that landed the issue's own number would have
 * satisfied the issue and stayed broken. Do not hand-maintain this floor; run
 * this.
 *
 * WHAT IT DOES. Two arms, because one of them is the other's control:
 *
 *   AT the declared floor F — installs `@civitai/app-sdk@F` into a throwaway
 *   directory, generates a consumer that imports EVERY symbol blocks-react
 *   imports from the peer, and typechecks it. Any `TS2305 has no exported
 *   member` means the declared floor is TOO LOW, and the message names the
 *   symbols. This is the arm that would have caught #309.
 *
 *   BELOW the declared floor (the previous published version) — the same probe
 *   must report AT LEAST ONE missing symbol. This is a POSITIVE CONTROL: a
 *   probe that reports nothing at F is indistinguishable from a probe wired to
 *   nothing (a bad temp dir, a failed install, a tsconfig that resolves the
 *   workspace copy instead of the installed one). It ALSO catches a floor
 *   pinned needlessly high, which costs consumers upgrades for no reason.
 *
 * Both arms additionally carry a synthetic `__ThisSymbolDoesNotExist__` import,
 * so a run that somehow typechecks nothing at all still fails loudly.
 *
 * COST / WHEN TO RUN. It performs two real npm installs, so it is NOT part of
 * `pnpm test`. Run it on demand, and whenever blocks-react starts importing a
 * new symbol from the peer:  `pnpm check:peer-floor`
 *
 * LIMITS, stated plainly:
 *   - It checks the symbols blocks-react imports BY NAME from `@civitai/app-sdk*`.
 *     A symbol reached some other way (a deep re-export, a runtime string) is
 *     invisible to it.
 *   - It checks TYPE resolution. A symbol that exists at F with a DIFFERENT
 *     shape than blocks-react expects is caught only if that shape difference
 *     produces a diagnostic in this generated consumer, which imports but does
 *     not exercise each symbol.
 *   - It verifies the floor, not the ceiling. `<1.0.0` is not checked.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const PKG_DIR = join(REPO, 'packages', 'civitai-blocks-react');
const PEER = '@civitai/app-sdk';
const CONTROL_SYMBOL = '__ThisSymbolDoesNotExist__';

const fail = (msg) => {
  console.error(`\n❌ ${msg}\n`);
  process.exit(1);
};

/** Every .ts/.tsx file under a directory. */
function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

/**
 * The named symbols blocks-react imports from the peer, keyed by subpath.
 *
 * Deliberately NOT a regex over the whole file for identifiers: only `import
 * { … } from '<peer…>'` clauses count, so a local name that merely matches is
 * never included.
 */
function importedSymbols() {
  const bySubpath = new Map();
  const clause = new RegExp(
    `import\\s+(?:type\\s+)?\\{([^}]*)\\}\\s*from\\s*['"](${PEER}[^'"]*)['"]`,
    'gs',
  );
  for (const file of sourceFiles(join(PKG_DIR, 'src'))) {
    const text = readFileSync(file, 'utf8');
    for (const [, names, subpath] of text.matchAll(clause)) {
      const set = bySubpath.get(subpath) ?? new Set();
      for (const raw of names.split(',')) {
        const name = raw
          .replace(/^\s*type\s+/, '')
          .replace(/\s+as\s+[\s\S]*$/, '')
          .trim();
        if (name) set.add(name);
      }
      bySubpath.set(subpath, set);
    }
  }
  return bySubpath;
}

/** Published versions of the peer, oldest first. */
function publishedVersions() {
  const raw = execFileSync('npm', ['view', PEER, 'versions', '--json'], { encoding: 'utf8' });
  return JSON.parse(raw);
}

function compareSemver(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

/**
 * Install the peer at `version` and typecheck a consumer importing every
 * symbol. Returns the symbols the installed copy does NOT export.
 */
function missingSymbolsAt(version, bySubpath) {
  const dir = mkdtempSync(join(tmpdir(), `peer-floor-${version}-`));
  try {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'peer-floor-probe', private: true, type: 'module' }, null, 2),
    );
    writeFileSync(
      join(dir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'Bundler',
          strict: true,
          skipLibCheck: true,
          noEmit: true,
          types: [],
        },
        include: ['src/**/*.ts'],
      }),
    );
    mkdirSync(join(dir, 'src'));
    let i = 0;
    for (const [subpath, names] of bySubpath) {
      const lines = [...names, CONTROL_SYMBOL].map((n) => `  ${n},`).join('\n');
      writeFileSync(join(dir, 'src', `probe-${i++}.ts`), `import {\n${lines}\n} from '${subpath}';\n`);
    }

    execFileSync('npm', ['install', '--no-audit', '--no-fund', '--silent', `${PEER}@${version}`], {
      cwd: dir,
      stdio: 'pipe',
    });

    const installed = JSON.parse(
      readFileSync(join(dir, 'node_modules', ...PEER.split('/'), 'package.json'), 'utf8'),
    ).version;
    if (installed !== version) {
      fail(`asked for ${PEER}@${version} but got ${installed} — the probe measured the wrong thing`);
    }

    const tsc = join(REPO, 'node_modules', '.bin', 'tsc');
    let output = '';
    try {
      execFileSync(tsc, ['-p', 'tsconfig.json', '--pretty', 'false'], { cwd: dir, encoding: 'utf8' });
    } catch (err) {
      output = `${err.stdout ?? ''}${err.stderr ?? ''}`;
    }

    const missing = [...output.matchAll(/has no exported member '([^']+)'/g)].map((m) => m[1]);
    if (!missing.includes(CONTROL_SYMBOL)) {
      fail(
        `the synthetic control symbol did not report at ${PEER}@${version}. The probe is not ` +
          `type-checking anything, so its verdict is about the harness, not the package.\n\n${output}`,
      );
    }
    return missing.filter((m) => m !== CONTROL_SYMBOL);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------

const declared = JSON.parse(readFileSync(join(PKG_DIR, 'package.json'), 'utf8')).peerDependencies?.[
  PEER
];
if (!declared) fail(`packages/civitai-blocks-react declares no ${PEER} peer range`);

const floorMatch = declared.match(/>=\s*(\d+\.\d+\.\d+)/);
if (!floorMatch) fail(`cannot read a >= floor out of the declared range "${declared}"`);
const floor = floorMatch[1];

const bySubpath = importedSymbols();
const total = [...bySubpath.values()].reduce((n, s) => n + s.size, 0);
if (total === 0) fail(`found no named imports from ${PEER} in blocks-react's src — probe is blind`);
console.log(
  `blocks-react imports ${total} symbol(s) from ${PEER} across ${bySubpath.size} subpath(s)`,
);
console.log(`declared peer range: ${declared}  (floor ${floor})`);

const versions = publishedVersions();
if (!versions.includes(floor)) fail(`declared floor ${floor} is not a published version of ${PEER}`);
const below = versions.filter((v) => compareSemver(v, floor) < 0).pop();

const missingAtFloor = missingSymbolsAt(floor, bySubpath);
if (missingAtFloor.length > 0) {
  fail(
    `THE DECLARED FLOOR IS TOO LOW.\n\n` +
      `  ${PEER}@${floor} does not export ${missingAtFloor.length} symbol(s) blocks-react imports:\n` +
      missingAtFloor.map((m) => `    - ${m}`).join('\n') +
      `\n\n  A consumer whose app-sdk satisfies this range still fails at module evaluation,\n` +
      `  and the install warns about nothing. Raise the floor in\n` +
      `  packages/civitai-blocks-react/package.json until this check passes.`,
  );
}
console.log(`✓ ${PEER}@${floor} exports every imported symbol`);

if (!below) {
  console.log(`(no published version below ${floor} — skipping the too-high control)`);
} else {
  const missingBelow = missingSymbolsAt(below, bySubpath);
  if (missingBelow.length === 0) {
    fail(
      `THE DECLARED FLOOR IS HIGHER THAN IT NEEDS TO BE.\n\n` +
        `  ${PEER}@${below} — the published version immediately below the declared floor —\n` +
        `  already exports every symbol blocks-react imports, so the floor excludes a version\n` +
        `  that would have worked and costs consumers an upgrade for nothing.\n\n` +
        `  This arm is also the probe's positive control: if it ever reports nothing because\n` +
        `  the harness is broken rather than because the package is complete, the check above\n` +
        `  is equally meaningless.`,
    );
  }
  console.log(
    `✓ ${PEER}@${below} (below the floor) is missing ${missingBelow.length} symbol(s) — ` +
      `floor is not too high, and the probe demonstrably reports`,
  );
}

console.log(`\n✅ peer floor ${floor} is correct for blocks-react ${JSON.parse(readFileSync(join(PKG_DIR, 'package.json'), 'utf8')).version}`);
