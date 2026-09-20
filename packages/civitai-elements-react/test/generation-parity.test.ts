/**
 * `src/generated/jsx.ts` must match what `scripts/gen-jsx-types.mjs` would
 * produce right now from `@civitai/elements`' committed `custom-elements.json`.
 *
 * The file is committed so a fresh clone and a `tsc`-only consumer work with no
 * codegen step — which means it can silently go stale: add a `@fires` to an
 * element, regenerate the manifest, forget this, and React consumers get types
 * for an element that no longer matches. Nothing else in the build notices.
 *
 * This assertion used to live in `@civitai/elements`, next to a generator that
 * wrote across the package boundary into this one. Both moved here, so this
 * package generates, tests and builds its own source.
 *
 * The generator is run against a TEMP output directory rather than the working
 * tree: a test that overwrites a tracked source file and restores it in a
 * `finally` leaves that file corrupted on any crash, and this repo is worked in
 * by several sessions at once.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const generatorPath = join(pkgRoot, 'scripts', 'gen-jsx-types.mjs');
const committedPath = join(pkgRoot, 'src', 'generated', 'jsx.ts');
const manifestPath = join(pkgRoot, '..', 'civitai-elements', 'custom-elements.json');

let scratch: string;

/** Run the real generator into `outDir`, optionally against `manifest`. */
function generate(outDir: string, manifest = manifestPath): string {
  execFileSync(process.execPath, [generatorPath], {
    cwd: pkgRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      CIVITAI_GEN_JSX_OUTDIR: outDir,
      CIVITAI_GEN_JSX_MANIFEST: manifest,
    },
  });
  return readFileSync(join(outDir, 'jsx.ts'), 'utf8');
}

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'civitai-jsx-parity-'));
});
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe('the generated JSX types match the manifest', () => {
  it('regenerating jsx.ts produces no diff', () => {
    const out = join(scratch, 'current');
    expect(generate(out)).toBe(readFileSync(committedPath, 'utf8'));
  });

  it('the generator is SENSITIVE to the manifest (positive control)', () => {
    // Without this, "no diff" would also be the result of a generator that
    // emitted a constant, or that ignored its input entirely. Rename a tag in
    // a temp copy of the manifest and require the output to move.
    const raw = readFileSync(manifestPath, 'utf8');
    expect(raw).toContain('"civitai-button"');
    const mutantManifest = join(scratch, 'mutant-manifest.json');
    writeFileSync(mutantManifest, raw.replaceAll('"civitai-button"', '"civitai-buttonx"'));

    const out = join(scratch, 'mutant');
    const mutated = generate(out, mutantManifest);
    expect(mutated).not.toBe(readFileSync(committedPath, 'utf8'));
    expect(mutated).toContain('civitai-buttonx');
  });
});
