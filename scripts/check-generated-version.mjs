#!/usr/bin/env node
/**
 * check-generated-version.mjs
 * ---------------------------
 * COMMITTED-vs-package.json guard for generated artifacts that embed their own
 * package version.
 *
 * `@civitai/components` commits `src/version.generated.ts`, written by
 * `scripts/build-css.ts` from `package.json`, and stamps that constant onto
 * every registered element. The package's own suite already asserts the pair
 * (`test/css-integrity.test.ts`, "the stamped element version matches
 * package.json") — and that assertion CANNOT FAIL IN CI, because the
 * `design-system` job builds the package before it tests it and the build
 * rewrites the file. It compares a value regenerated seconds earlier against
 * the version it was generated from, which reads as coverage while providing
 * none.
 *
 * The drift it could not see: `0.8.1` stayed committed from #492's version bump
 * to `0.9.0`, green the whole way, surfacing only as a red suite for developers
 * running the tests in a checkout they had not built.
 *
 * So this check reads the file as TEXT and never imports it, needs no install
 * and no build, and must run BEFORE any build step to mean anything. The
 * release-time half of the fix is `release:version` (root package.json), which
 * regenerates the artifact in the same step as `changeset version`; this is the
 * backstop that also catches a hand-edited version.
 *
 * CORPUS: every `packages/<pkg>/src/version.generated.ts`, each compared
 * against its OWN `packages/<pkg>/package.json`. Generic on purpose — the next
 * package to generate a version constant is covered without touching this file.
 *
 * FAILS (exit 1) when:
 *   - a committed VERSION literal differs from its package.json version; or
 *   - no `version.generated.ts` exists anywhere in `packages/` — a zero-file
 *     corpus makes a PASS meaningless, so an empty corpus is a failure, not a
 *     silent success; or
 *   - a corpus file exists but no `VERSION = "…"` can be parsed out of it (the
 *     generator's output shape changed and this parser went blind).
 *
 * `--self-test` proves the comparison can go BOTH ways on synthetic input, so a
 * green run is a statement about the repo rather than about a check wired to
 * nothing. Same convention as `check-shipped-sourcemaps.mjs --self-test`.
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGES = join(REPO_ROOT, 'packages');
const ARTIFACT = join('src', 'version.generated.ts');

/**
 * Pull the VERSION string literal out of a generated module's SOURCE.
 * Returns null when the shape is not what the generator emits — which this
 * script treats as a failure, never as "no version to check".
 */
function parseVersionLiteral(source) {
  const m = /^\s*export\s+const\s+VERSION\s*=\s*(['"])(.*?)\1\s*;?\s*$/m.exec(source);
  return m ? m[2] : null;
}

/** One verdict per corpus file. `ok` false is a failure; `detail` explains it. */
function compare({ pkgName, declared, committed }) {
  if (committed == null) {
    return {
      ok: false,
      detail: `${pkgName}: could not parse a \`VERSION = "…"\` literal out of ${ARTIFACT} — the generator's output shape changed and this check went blind`,
    };
  }
  if (committed !== declared) {
    return {
      ok: false,
      detail:
        `${pkgName}: committed ${ARTIFACT} says ${JSON.stringify(committed)}, ` +
        `package.json says ${JSON.stringify(declared)} — regenerate it with ` +
        `\`pnpm --filter ${pkgName} generate\` and commit the result`,
    };
  }
  return { ok: true, detail: `${pkgName}: ${committed}` };
}

function collect() {
  const rows = [];
  for (const entry of readdirSync(PACKAGES, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(PACKAGES, entry.name);
    const artifact = join(dir, ARTIFACT);
    if (!existsSync(artifact)) continue;
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    rows.push({
      pkgName: pkg.name,
      declared: pkg.version,
      committed: parseVersionLiteral(readFileSync(artifact, 'utf8')),
    });
  }
  return rows;
}

function selfTest() {
  const cases = [
    {
      what: 'in sync ⇒ ok',
      row: { pkgName: '@x/a', declared: '1.2.3', committed: '1.2.3' },
      expectOk: true,
    },
    {
      what: 'committed behind ⇒ FAIL (the drift this exists for)',
      row: { pkgName: '@x/a', declared: '0.9.0', committed: '0.8.1' },
      expectOk: false,
    },
    {
      what: 'committed ahead ⇒ FAIL (equality, not ordering)',
      row: { pkgName: '@x/a', declared: '0.8.1', committed: '0.9.0' },
      expectOk: false,
    },
    {
      what: 'unparseable artifact ⇒ FAIL, never a silent skip',
      row: { pkgName: '@x/a', declared: '1.0.0', committed: null },
      expectOk: false,
    },
  ];
  let bad = 0;
  for (const c of cases) {
    const got = compare(c.row).ok;
    const verdict = got === c.expectOk ? 'ok' : 'WRONG';
    if (verdict === 'WRONG') bad++;
    console.log(`  ${verdict.padEnd(5)} ${c.what}`);
  }
  // The parser is half the instrument, so it gets its own both-ways pair.
  const parsed = parseVersionLiteral('export const VERSION = "4.5.6";\n');
  if (parsed !== '4.5.6') {
    console.log(`  WRONG parser did not read a well-formed literal (got ${JSON.stringify(parsed)})`);
    bad++;
  } else {
    console.log('  ok    parser reads a well-formed literal');
  }
  const notParsed = parseVersionLiteral('export const SOMETHING_ELSE = "4.5.6";\n');
  if (notParsed !== null) {
    console.log(`  WRONG parser matched a non-VERSION export (got ${JSON.stringify(notParsed)})`);
    bad++;
  } else {
    console.log('  ok    parser refuses a non-VERSION export');
  }
  if (bad) {
    console.error(`\ncheck-generated-version --self-test: ${bad} case(s) WRONG`);
    process.exit(1);
  }
  console.log('\ncheck-generated-version --self-test: all cases behaved as expected');
}

function main() {
  if (process.argv.includes('--self-test')) {
    selfTest();
    return;
  }

  const rows = collect();

  // A zero-file corpus would PASS every assertion below while measuring
  // nothing — the reassuring zero. Fail instead.
  if (rows.length === 0) {
    console.error(
      `check-generated-version: found NO packages/*/${ARTIFACT} — either the artifact moved or ` +
        `this script is looking in the wrong place. A pass over an empty corpus is not evidence.`,
    );
    process.exit(1);
  }

  const results = rows.map(compare);
  for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.detail}`);

  const failed = results.filter((r) => !r.ok);
  console.log(`\nchecked ${results.length} generated version artifact(s), ${failed.length} stale`);
  if (failed.length) {
    console.error(
      '\nA committed generated artifact is out of step with its package.json. This is NOT caught ' +
        "by the package's own parity test: CI builds before it tests, and the build regenerates " +
        'the file.',
    );
    process.exit(1);
  }
}

main();
