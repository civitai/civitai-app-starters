/**
 * `:host-context()` has never shipped in Firefox. A runtime probe cannot see
 * that we USED it — only that a browser lacks it — so the source is the guard.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return walk(path);
    return /\.(ts|css)$/.test(path) && !path.endsWith('.generated.ts') ? [path] : [];
  });

describe('cross-browser CSS discipline', () => {
  it('no element style reaches for :host-context()', () => {
    const offenders = walk(srcDir).filter((file) =>
      readFileSync(file, 'utf8').includes(':host-context(')
    );
    expect(offenders, 'Firefox has never shipped :host-context()').toEqual([]);
  });
});
