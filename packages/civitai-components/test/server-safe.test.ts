/**
 * Every entry point must IMPORT cleanly with no DOM. Registration already
 * no-ops without `customElements`, but a class body referencing a missing
 * global throws while the module is still being evaluated.
 */
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const entries = ['elements', 'sdk']
  .flatMap((dir) =>
    readdirSync(join(here, '..', 'src', dir))
      .filter((name) => name.endsWith('.define.ts') || name === 'register.ts' || name === 'register-site.ts')
      .map((name) => join(dir, name))
  )
  .sort();

describe('server-safe imports', () => {
  it('has an entry point for every element, so this guard cannot silently shrink', () => {
    expect(entries.length).toBeGreaterThanOrEqual(30);
  });

  it('runs in an environment with no DOM', () => {
    expect(typeof HTMLElement).toBe('undefined');
  });

  it.each(entries)('%s imports with no DOM', async (name) => {
    await expect(import(join(here, '..', 'src', name))).resolves.toBeDefined();
  });
});
