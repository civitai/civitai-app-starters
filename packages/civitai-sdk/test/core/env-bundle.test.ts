import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';
import { build, type Rollup } from 'vite';

// What leaks is a property of the emitted bundle, not of any return value, so
// this bundles the code the way a Vite app does and reads the output.

const ORIGINS = 'https://origins-7f3a91c2.example';
const SECRET = 'secret-4be2d8e61c0f93a7';

const dir = mkdtempSync(join(tmpdir(), 'sdk-env-'));
writeFileSync(
  join(dir, '.env'),
  `VITE_BLOCK_ALLOWED_PARENT_ORIGINS=${ORIGINS}\nVITE_LIVE_BLOCK_TOKEN=${SECRET}\n`,
);
afterAll(() => rmSync(dir, { recursive: true, force: true }));

async function bundle(entry: string): Promise<string> {
  const output = (await build({
    root: dir,
    envDir: dir,
    logLevel: 'silent',
    build: { write: false, minify: false, lib: { entry, formats: ['es'], fileName: 'out' } },
  })) as Rollup.RollupOutput[];
  return output.flatMap((o) => o.output).map((chunk) => ('code' in chunk ? chunk.code : '')).join('\n');
}

describe('reading parent origins from the environment', () => {
  it('bundles the origins it reads and no other variable', async () => {
    const code = await bundle(resolve('src/core/get-transport.ts'));

    expect(code).toContain(ORIGINS);
    expect(code).not.toContain(SECRET);
  });

  it('would see a leak: a computed read drags the whole environment in', async () => {
    const fixture = join(dir, 'computed.ts');
    writeFileSync(
      fixture,
      `export const read = (key: string) => (import.meta as { env?: Record<string, string> }).env?.[key];\n`,
    );

    expect(await bundle(fixture)).toContain(SECRET);
  });
});
