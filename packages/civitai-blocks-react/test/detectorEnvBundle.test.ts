import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build, type Rollup } from 'vite';

/**
 * 🔴 BUILD-LEVEL guard for `src/internal/detector.ts`'s env reads.
 *
 * WHY THIS IS NOT A UNIT TEST. The defect this pins is a property of the
 * EMITTED BUNDLE, not of the return value. `readAllowedOriginsFromEnv()`
 * returned exactly the right array both before and after the fix — a unit test
 * asserting on its result passes with the broken code. What was broken was the
 * SHAPE of the read:
 *
 *   const v = import.meta.env?.[key];   // computed key -> Vite cannot analyse
 *
 * Vite substitutes `import.meta.env.SOME_LITERAL` at build time by static
 * analysis. A computed key defeats that, so Vite falls back to inlining the
 * ENTIRE env object at the access site — putting every `VITE_*` variable the
 * block app defined into its production bundle. Reproduced against the
 * published tarball `@civitai/blocks-react@0.55.0`, `dist/internal/detector.js`
 * line 33. See https://github.com/civitai/civitai-app-starters/issues — the
 * `detector.ts` env-leak issue.
 *
 * So this test BUNDLES the detector the way a block app does and asserts on the
 * emitted JavaScript text.
 *
 * WHY `src/` AND NOT `dist/`: CI's blocks-react job runs `test` BEFORE `build`,
 * so `dist/` is not guaranteed to exist here. It costs nothing: `tsc` passes the
 * expression through verbatim (published `dist` line 33 is character-for-
 * character the source expression), and esbuild — which is what transpiles the
 * `.ts` inside this Vite build — strips the `as` cast to the same member chain.
 *
 * THE POSITIVE CONTROL IS NOT OPTIONAL. "sentinel absent" is the kind of
 * assertion that passes when the harness is wired to nothing — an empty bundle,
 * an env var that never reached Vite, a build that silently produced no output.
 * So the second test below bundles a fixture that does the OLD computed-key read
 * and asserts the decoy IS present. If that one ever goes green-by-absence, the
 * first test's pass means nothing.
 */

/**
 * Locate this package's root by walking up from the cwd. `import.meta.url` is
 * NOT usable here: under the happy-dom `unit` project Vitest rewrites it to a
 * non-`file:` URL, so `fileURLToPath` throws. The `existsSync` assertion below
 * is what makes a wrong answer loud instead of vacuous.
 */
function packageRoot(): string {
  let dir = resolve(process.cwd());
  for (;;) {
    const pkg = join(dir, 'package.json');
    if (existsSync(pkg)) {
      try {
        const name: unknown = JSON.parse(readFileSync(pkg, 'utf8')).name;
        if (name === '@civitai/blocks-react') return dir;
      } catch {
        /* keep walking */
      }
    }
    const up = dirname(dir);
    if (up === dir) throw new Error('could not locate @civitai/blocks-react package root');
    dir = up;
  }
}

const DETECTOR_SRC = join(packageRoot(), 'src', 'internal', 'detector.ts');
if (!existsSync(DETECTOR_SRC)) throw new Error(`detector source not found at ${DETECTOR_SRC}`);

// The legitimate values. Distinct per prefix so we can tell which of the three
// literal reads Vite substituted — all three must be, or one of the keys has
// silently stopped being a static member access.
const VITE_ORIGINS = 'https://vite-origin-b1d4e7f2.example';
const NEXT_ORIGINS = 'https://next-origin-c9a2f5e8.example';
const PUBLIC_ORIGINS = 'https://public-origin-d3e8b6c1.example';

// The decoys. These are the "other" env vars a real block app has — the ones
// that must NEVER be dragged into its bundle. The values are 128-bit-ish random
// hex with a fixed prefix: they cannot occur by coincidence in bundler output,
// and they share no substring with any legitimate value above, so neither
// assertion can pass or fail for the other's reason.
const DECOY_VITE = 'DECOY_SENTINEL_4f81ca90e7b2d365';
const DECOY_NEXT = 'DECOY_SENTINEL_a027d4e9f16b8c5a';
const DECOY_PUBLIC = 'DECOY_SENTINEL_9b3e7150d8a4c62f';

const ENV_UNDER_TEST: Record<string, string> = {
  VITE_BLOCK_ALLOWED_PARENT_ORIGINS: VITE_ORIGINS,
  NEXT_PUBLIC_BLOCK_ALLOWED_PARENT_ORIGINS: NEXT_ORIGINS,
  PUBLIC_BLOCK_ALLOWED_PARENT_ORIGINS: PUBLIC_ORIGINS,
  // Stand-ins for `VITE_LIVE_BLOCK_TOKEN` and friends.
  VITE_TOTALLY_UNRELATED_SECRET: DECOY_VITE,
  NEXT_PUBLIC_TOTALLY_UNRELATED_SECRET: DECOY_NEXT,
  PUBLIC_TOTALLY_UNRELATED_SECRET: DECOY_PUBLIC,
};

let workdir: string;
const savedEnv = new Map<string, string | undefined>();

beforeAll(() => {
  workdir = mkdtempSync(join(tmpdir(), 'civitai-detector-bundle-'));
  // Vite's `loadEnv` folds prefixed `process.env` entries into `import.meta.env`,
  // which is how a CI/host-provided variable reaches a block app's build.
  for (const [k, v] of Object.entries(ENV_UNDER_TEST)) {
    savedEnv.set(k, process.env[k]);
    process.env[k] = v;
  }
});

afterAll(() => {
  for (const [k, v] of savedEnv) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  if (workdir) rmSync(workdir, { recursive: true, force: true });
});

/** Bundles `entrySource` with Vite configured the way a block app's build is. */
async function bundle(name: string, entrySource: string): Promise<string> {
  const entry = join(workdir, `${name}.ts`);
  writeFileSync(entry, entrySource);
  const result = (await build({
    configFile: false,
    logLevel: 'error',
    root: workdir,
    envDir: workdir,
    // A block app built with Vite only ever sees `VITE_`. The other two prefixes
    // are added so this one build also proves the `NEXT_PUBLIC_`/`PUBLIC_`
    // literal reads are statically substitutable — the property that a computed
    // key destroys. Widening the prefix list is the only way to observe those
    // two keys through Vite at all.
    envPrefix: ['VITE_', 'NEXT_PUBLIC_', 'PUBLIC_'],
    build: {
      write: false,
      minify: false,
      lib: { entry, formats: ['es'], fileName: name },
      rollupOptions: {
        // Keep the bundle to first-party code: the SDK's blocks contract has
        // nothing to do with this guard and resolving it here would only add
        // noise (and unrelated strings) to the text we assert on.
        external: (id) => id.startsWith('@civitai/'),
        // Tree-shaking could legally delete a never-called env read. The whole
        // point is to inspect the read, so keep it.
        treeshake: false,
      },
    },
  })) as Rollup.RollupOutput[];

  const chunk = result[0]?.output?.find((o) => o.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error(`no chunk emitted for ${name}`);
  return chunk.code;
}

describe('detector env reads survive bundling without leaking the env object', () => {
  let code: string;
  let bytes = 0;

  beforeAll(async () => {
    code = await bundle(
      'entry-detector',
      // `globalThis` assignment, not a bare call: it makes the result observably
      // used so nothing can argue the read away.
      `import { readAllowedOriginsFromEnv } from ${JSON.stringify(DETECTOR_SRC)};\n` +
        `(globalThis as Record<string, unknown>).__origins = readAllowedOriginsFromEnv();\n`,
    );
    bytes = Buffer.byteLength(code, 'utf8');
    // eslint-disable-next-line no-console -- the byte count is the reachability
    // evidence for this guard; a zero-byte bundle would make "sentinel absent"
    // trivially true, so the number belongs in the test output.
    console.log(`[detector bundle] emitted ${bytes} bytes`);
  });

  it('produces a non-empty bundle that really contains the detector (reachability)', () => {
    // Without this, every "sentinel absent" assertion below could pass vacuously.
    expect(bytes).toBeGreaterThan(200);
    expect(code).toContain('readAllowedOriginsFromEnv');
  });

  it('statically substitutes all three literal env keys (positive control)', () => {
    // Each of these proves Vite ANALYSED that read rather than deferring it to
    // runtime. If a key regresses to a computed access, its literal value stops
    // appearing here and the whole env object starts appearing instead.
    expect(code).toContain(VITE_ORIGINS);
    expect(code).toContain(NEXT_ORIGINS);
    expect(code).toContain(PUBLIC_ORIGINS);
  });

  it('does NOT inline unrelated env vars into the bundle', () => {
    expect(code).not.toContain(DECOY_VITE);
    expect(code).not.toContain(DECOY_NEXT);
    expect(code).not.toContain(DECOY_PUBLIC);
  });

  it('emits no whole-`import.meta.env` object access', () => {
    // The structural companion to the string assertions above: the fallback Vite
    // reaches for is inlining the env record, which shows up as the record's own
    // built-in keys sitting in the output next to the app's variables.
    expect(code).not.toContain('"BASE_URL"');
  });
});

describe('positive control: the old computed-key read DOES leak', () => {
  it('inlines the whole env object, decoy included, when the key is computed', async () => {
    // This is `readEnv()` as published in @civitai/blocks-react@0.55.0,
    // transcribed verbatim from `dist/internal/detector.js:31-48`.
    const code = await bundle(
      'entry-control',
      `function readEnv(key: string): string | undefined {\n` +
        `  try {\n` +
        `    const fromImportMeta = (import.meta as { env?: Record<string, string | undefined> }).env?.[key];\n` +
        `    if (fromImportMeta) return fromImportMeta;\n` +
        `  } catch {}\n` +
        `  return undefined;\n` +
        `}\n` +
        `(globalThis as Record<string, unknown>).__origins = readEnv('VITE_BLOCK_ALLOWED_PARENT_ORIGINS');\n`,
    );
    const bytes = Buffer.byteLength(code, 'utf8');
    // eslint-disable-next-line no-console -- see the note on the counterpart above.
    console.log(`[control bundle] emitted ${bytes} bytes`);
    expect(bytes).toBeGreaterThan(200);

    // If THIS goes green-by-absence the harness cannot see a leak at all, and
    // the "does NOT inline" test above is meaningless.
    expect(code).toContain(DECOY_VITE);
    expect(code).toContain('"BASE_URL"');
  });
});
