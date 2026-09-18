/**
 * Tests for scripts/check-peer-floor.mjs — the peer-floor derivation guard.
 *
 * 🔴 WHAT THESE EXIST FOR. The first revision of that script could not run at
 * all on a correct checkout: it resolved `tsc` at `<repo>/node_modules/.bin/tsc`,
 * where pnpm's isolated linker never puts one (`typescript` is a per-package
 * devDependency; the root `.bin` holds `changeset` and nothing else). Every
 * invocation threw ENOENT, and because a spawn ENOENT leaves `err.stdout` and
 * `err.stderr` `undefined`, the captured output was empty, the control symbol
 * was absent, and the script exited through the CONTROL's message — reporting a
 * type-checking fault instead of a missing binary, after paying for a real
 * registry install. It was caught by review, not by a test, which is the gap
 * this file closes.
 *
 * These run OFFLINE and touch no registry. The script's two network arms are
 * exercised by `pnpm check:peer-floor` itself (nightly, in
 * `published-starter-smoke`); what is covered here is every part that has
 * actually been wrong: binary resolution, range parsing, and symbol extraction.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  importedSymbols,
  parseFloor,
  tscBin,
} from '../../scripts/check-peer-floor.mjs';

const PEER = '@civitai/app-sdk';

/** A throwaway src/ tree, so extraction is tested on inputs we control. */
function fixtureSrc(files) {
  const dir = mkdtempSync(join(tmpdir(), 'peer-floor-guard-'));
  for (const [name, contents] of Object.entries(files)) {
    const full = join(dir, name);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, contents, 'utf8');
  }
  return dir;
}

describe('tscBin', () => {
  test('resolves to a tsc that EXISTS in this checkout', () => {
    const bin = tscBin();
    // The regression, stated as an assertion: a bare 'tsc' fallback means no
    // candidate path matched, which is exactly the state that made every run
    // fail with a misleading message.
    assert.notEqual(
      bin,
      'tsc',
      'tscBin() fell through to PATH — no workspace tsc was found. On a pnpm install ' +
        'the root node_modules/.bin has no tsc; the package-local path is the one that exists.',
    );
    assert.ok(
      existsSync(bin),
      `tscBin() returned ${bin}, which does not exist`,
    );
  });
});

describe('parseFloor', () => {
  test('reads a single >= floor', () => {
    assert.equal(parseFloor('>=0.40.0 <1.0.0'), '0.40.0');
  });

  test('REFUSES a compound range instead of silently taking the first >=', () => {
    // This exact string used to print "(floor 0.40.0)" and exit 0 — a clean PASS
    // for a range that still admits the 0.29.x versions #309 was about.
    assert.throws(
      () => parseFloor('>=0.40.0 <0.41.0 || >=0.29.0 <0.30.0'),
      /alternatives/,
      'a `||` range must be refused, not resolved to its first floor',
    );
  });

  test('refuses two >= floors in one range', () => {
    assert.throws(() => parseFloor('>=0.40.0 >=0.29.0'), /more than one/);
  });

  for (const range of [
    '^0.40.0',
    '~0.40.0',
    '>0.39.0',
    '0.40.0 - 0.99.0',
    '*',
  ]) {
    test(`refuses a range with no >= endpoint: ${range}`, () => {
      assert.throws(() => parseFloor(range), /cannot read a >= floor/);
    });
  }
});

describe('importedSymbols', () => {
  test('finds a plain named import', () => {
    const dir = fixtureSrc({
      'a.ts': `import { Alpha } from '${PEER}/blocks';\n`,
    });
    try {
      const got = importedSymbols(dir);
      assert.deepEqual([...got.get(`${PEER}/blocks`).value], ['Alpha']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('🔴 finds a RE-EXPORT, which an import-only pattern misses', () => {
    // `export type { X } from '<peer>'` puts the peer's symbol in this package's
    // emitted .d.ts exactly as an import does, so a consumer breaks identically.
    // A live instance existed in src/index.ts, and one of its symbols appeared
    // nowhere else — so it was absent from the probe entirely.
    const dir = fixtureSrc({
      'index.ts': `export type { OnlyReExported } from '${PEER}/blocks';\n`,
    });
    try {
      const got = importedSymbols(dir);
      assert.deepEqual([...got.get(`${PEER}/blocks`).type], ['OnlyReExported']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('🔴 registers a SUBPATH reached only by a STAR form — all three spellings', () => {
    // A star form carries no symbol names to check, but the subpath still has to
    // RESOLVE, and registering it is what gets it installed and probed.
    //
    // `export * as NS from` is here because it was the one this regex missed:
    // the first draft matched `export *` only when `from` followed immediately,
    // so the `as NS` spelling was silently invisible — a coverage gap inside the
    // hunk written to close coverage gaps.
    const dir = fixtureSrc({
      'a.ts': `export * from '${PEER}/star-export';\n`,
      'b.ts': `import * as SDK from '${PEER}/star-import';\n`,
      'c.ts': `export * as NS from '${PEER}/star-export-as';\n`,
    });
    try {
      const got = importedSymbols(dir);
      for (const sub of ['star-export', 'star-import', 'star-export-as']) {
        assert.ok(
          got.has(`${PEER}/${sub}`),
          `star form for ${sub} was not registered`,
        );
      }
      // It registers the subpath, and contributes NO symbol names.
      assert.equal(got.get(`${PEER}/star-export`).value.size, 0);
      assert.equal(got.get(`${PEER}/star-export`).type.size, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('🔴 registers a SUBPATH reached only by a bare side-effect import', () => {
    // It names no symbols but still has to resolve. Without this the subpath is
    // never installed, never resolved and never checked at any version.
    const dir = fixtureSrc({ 'index.ts': `import '${PEER}/safe-storage';\n` });
    try {
      const got = importedSymbols(dir);
      assert.ok(
        got.has(`${PEER}/safe-storage`),
        'bare subpath import was not registered',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('keeps type-only and value imports APART', () => {
    // The probe reproduces each symbol in the position it is imported in. If
    // this collapsed, `verbatimModuleSyntax` would trip TS1484 on every ordinary
    // type and report the entire surface as missing at every version.
    const dir = fixtureSrc({
      'a.ts': `import { aValue, type aType } from '${PEER}/blocks';\n`,
      'b.ts': `import type { bType } from '${PEER}/blocks';\n`,
    });
    try {
      const got = importedSymbols(dir).get(`${PEER}/blocks`);
      assert.deepEqual([...got.value], ['aValue']);
      assert.deepEqual([...got.type].sort(), ['aType', 'bType']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('ignores an identifier that merely matches, outside an import clause', () => {
    const dir = fixtureSrc({
      'a.ts': `const NotImported = 1;\nexport { NotImported };\n`,
    });
    try {
      assert.equal(importedSymbols(dir).size, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('the REAL package surface is non-empty — a blind probe is not a passing probe', () => {
    const got = importedSymbols();
    const total = [...got.values()].reduce(
      (n, b) => n + b.value.size + b.type.size,
      0,
    );
    assert.ok(
      total > 20,
      `expected a substantial symbol surface, got ${total}`,
    );
  });
});
