/**
 * The typed-JSX gate. This package ships nothing BUT types, so a compile is
 * the only thing that can test it.
 *
 * Two fixtures, and both halves are load-bearing:
 *   - `fixtures/ok.tsx`  — correct usage; must compile clean.
 *   - `fixtures/bad.tsx` — one deliberate error per line; EVERY marked line
 *     must produce a diagnostic.
 *
 * Without the negative control, `ok.tsx` compiling proves nothing: if the
 * `JSX.IntrinsicElements` augmentation failed to apply, TypeScript falls back
 * to treating an unknown lowercase-with-dash tag as `any` in some configs, and
 * everything "passes" while nothing is checked. The bad fixture is the
 * measurement that the types are really in the compilation.
 *
 * The assertion is per-LINE, not "the file has errors": a single error on one
 * line would otherwise satisfy a file-level check while six other guarantees
 * silently evaporated.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, '..');
const tsc = join(pkgRoot, 'node_modules', '.bin', 'tsc');

interface Diag {
  file: string;
  line: number;
  code: string;
}

const configs: string[] = [];

/**
 * Typecheck ONE fixture and return its per-line diagnostics.
 *
 * 🔴 Two traps this had to be rebuilt around, both hit on the first attempt:
 *
 * 1. The generated tsconfig must live INSIDE the package. A config in /tmp
 *    that `extends` the package's tsconfig re-resolves that config's own
 *    relative `exclude` (which lists `test`) against the temp directory, and
 *    the fixture was excluded — `TS18003: No inputs were found`. `files` is
 *    used rather than `include` because `exclude` does not apply to `files`.
 *
 * 2. `tsc` reports config-level failures WITHOUT a `file(line,col):` prefix,
 *    so the per-line regex matched none of them and the function returned an
 *    empty array. Zero diagnostics then read as "compiled clean" — the bad
 *    fixture appeared to pass and the good one appeared to be checked, when
 *    in truth NOTHING was compiled. The throw below is what makes a zero from
 *    this function mean something.
 */
function check(fixture: string): Diag[] {
  const config = join(pkgRoot, 'node_modules', `.tsconfig-fixture-${fixture.replace(/\W/g, '')}.json`);
  configs.push(config);
  writeFileSync(
    config,
    JSON.stringify({
      extends: '../tsconfig.json',
      compilerOptions: {
        noEmit: true,
        declaration: false,
        declarationMap: false,
        sourceMap: false,
        rootDir: '..',
      },
      include: [],
      files: [`../test/fixtures/${fixture}`],
    })
  );
  let out = '';
  try {
    out = execFileSync(tsc, ['-p', config, '--pretty', 'false'], {
      cwd: pkgRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    out = `${err.stdout ?? ''}${err.stderr ?? ''}`;
  }
  const configError = /^error (TS\d+):(.*)$/m.exec(out);
  if (configError) {
    throw new Error(
      `tsc failed before typechecking ${fixture} — the run measured nothing: ${configError[0]}`
    );
  }
  return [...out.matchAll(/^(.+?)\((\d+),\d+\): error (TS\d+)/gm)].map((m) => ({
    file: m[1] as string,
    line: Number(m[2]),
    code: m[3] as string,
  }));
}

afterAll(() => {
  for (const c of configs) rmSync(c, { force: true });
});

describe('generated JSX types', () => {
  it('POSITIVE CONTROL: the harness can see errors at all', () => {
    // Report the pair, never the zero alone: a clean `ok.tsx` is only evidence
    // once this shows the same pipeline producing a non-zero count.
    const bad = check('bad.tsx');
    expect(bad.length).toBeGreaterThanOrEqual(7);
  });

  it('correct usage compiles clean', () => {
    expect(check('ok.tsx')).toEqual([]);
  });

  it('every @expect-error line really errors', () => {
    const src = readFileSync(join(pkgRoot, 'test', 'fixtures', 'bad.tsx'), 'utf8').split('\n');
    // A marker sits on the line BEFORE the offending JSX element.
    const expected = src
      .map((l, i) => (l.includes('@expect-error') ? i + 2 : 0))
      .filter((n) => n > 0);

    // Guard the guard: a fixture that lost its markers would make the loop
    // below vacuous.
    expect(expected.length).toBeGreaterThanOrEqual(7);

    const diagnostics = check('bad.tsx');
    const erroredLines = new Set(diagnostics.map((d) => d.line));
    const missed = expected.filter((n) => !erroredLines.has(n));
    expect(missed, `lines expected to error but compiled clean: ${missed.join(', ')}`).toEqual([]);
  });

  it('the bad fixture errors ONLY where marked', () => {
    // Otherwise a fixture full of unrelated syntax errors would satisfy the
    // test above without any of the type guarantees holding.
    const src = readFileSync(join(pkgRoot, 'test', 'fixtures', 'bad.tsx'), 'utf8').split('\n');
    const expected = new Set(
      src.map((l, i) => (l.includes('@expect-error') ? i + 2 : 0)).filter((n) => n > 0)
    );
    const stray = check('bad.tsx')
      .map((d) => d.line)
      .filter((n) => !expected.has(n));
    expect([...new Set(stray)]).toEqual([]);
  });
});

describe('the generated surface covers the manifest', () => {
  it('declares an intrinsic for every tagged element', () => {
    const manifest = JSON.parse(
      readFileSync(join(pkgRoot, '..', 'civitai-elements', 'custom-elements.json'), 'utf8')
    ) as { modules: { declarations?: { tagName?: string; customElement?: boolean }[] }[] };
    const tags = manifest.modules
      .flatMap((m) => m.declarations ?? [])
      .filter((d) => d.customElement && d.tagName)
      .map((d) => d.tagName as string);

    expect(tags.length).toBeGreaterThan(0);
    const jsx = readFileSync(join(pkgRoot, 'src', 'generated', 'jsx.ts'), 'utf8');
    for (const tag of tags) expect(jsx).toContain(`${JSON.stringify(tag)}:`);
  });

  it('never emits a camelCase handler for a non-React-registered event', () => {
    // The measured trap: `onCivitaiFoo` listens for `CivitaiFoo`, which nothing
    // dispatches. Only React-registered names may be spelled camelCase.
    const jsx = readFileSync(join(pkgRoot, 'src', 'generated', 'jsx.ts'), 'utf8');
    const handlers = [...jsx.matchAll(/"(on[A-Za-z-]+)"\?:/g)].map((m) => m[1] as string);
    expect(handlers.length).toBeGreaterThan(0);
    const allowedCamel = new Set(['onChange', 'onInput', 'onClick', 'onFocus', 'onBlur']);
    for (const h of handlers) {
      const rest = h.slice(2);
      if (rest[0] === rest[0]?.toUpperCase()) {
        expect(allowedCamel.has(h), `${h} is camelCase but not a React-registered event`).toBe(true);
      }
    }
  });
});
