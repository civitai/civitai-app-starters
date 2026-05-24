/**
 * Unit coverage for the validation arms of `civitai init` — the parts that
 * don't shell out to `npx tiged`. The full end-to-end flow (tiged clone +
 * manifest patch) is exercised manually for now; bringing in a `tiged`
 * mock for CI would require either a network-isolation harness or a real
 * GitHub round-trip, neither of which earns its keep at this point.
 *
 * What's covered here:
 * - The blockId / slot / contentRating validation happens BEFORE any
 *   filesystem write, so bad inputs short-circuit without touching disk.
 */
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { initCommand } from '../src/commands/init.js';

describe('initCommand input validation', () => {
  let originalCwd: string;
  let workDir: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    workDir = mkdtempSync(resolve(tmpdir(), 'civitai-init-test-'));
    process.chdir(workDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(workDir, { recursive: true, force: true });
  });

  it('rejects an existing destination without touching it', async () => {
    const { mkdirSync } = await import('node:fs');
    mkdirSync(resolve(workDir, 'taken'));
    await expect(initCommand({ destination: 'taken' })).rejects.toThrow(/already exists/);
  });

  it.each([
    ['UPPERCASE'],
    ['ab'],
    ['has spaces'],
    ['has_underscore'],
    ['x'.repeat(65)],
  ])('rejects invalid blockId "%s" without creating the destination', async (blockId) => {
    await expect(initCommand({ destination: 'should-not-exist', blockId })).rejects.toThrow(
      /must match/,
    );
    expect(existsSync(resolve(workDir, 'should-not-exist'))).toBe(false);
  });

  it('rejects unknown slot without creating the destination', async () => {
    await expect(
      initCommand({ destination: 'no-create', blockId: 'my-block', slot: 'profile.header' }),
    ).rejects.toThrow(/not a known slot/);
    expect(existsSync(resolve(workDir, 'no-create'))).toBe(false);
  });

  it('rejects unknown content rating', async () => {
    await expect(
      initCommand({ destination: 'no-create', blockId: 'my-block', contentRating: 'mature' }),
    ).rejects.toThrow(/content-rating/);
    expect(existsSync(resolve(workDir, 'no-create'))).toBe(false);
  });
});
