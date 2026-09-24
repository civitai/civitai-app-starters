import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { initialize } from '../../src/app/index.js';
import type { StorageClient } from '../../src/storage/index.js';
import { createFakeAppStorage } from '../../src/testing.js';

/**
 * 🔴 THE SEAM NOBODY OWNS.
 *
 * The REST routes are tested on the server side; the fleet apps are tested
 * against their own structural stubs. No suite on either side ever loads BOTH,
 * so two hermetically-clean surfaces can still be broken together. These pin
 * the RELATIONSHIP: each consumer's declared slice, mirrored verbatim, and the
 * one runtime assertion those consumers make on the other side of the seam.
 *
 * The mirrors below are copies, not imports — the fleet apps are separate
 * repositories. They must be updated together with the app they name, and the
 * ledger must fail when it GROWS or SHRINKS, which is why the count is pinned.
 */

/**
 * Mirrors `civitai-app-gen-matrix/src/history.ts` — `HistoryStorage`, the slice
 * `loadHistory` and `evictBeyondRetention` are written against.
 */
interface HistoryStorage {
  get<T = unknown>(key: string): Promise<T | null>;
  set<T = unknown>(key: string, value: T): Promise<unknown>;
  delete(key: string): Promise<unknown>;
  list(opts?: { prefix?: string; limit?: number; cursor?: string }): Promise<{
    keys: { key: string; updatedAt: Date }[];
    nextCursor?: string;
  }>;
}

/**
 * Mirrors `civitai-app-custom-generators/src/lib/drafts.ts` — `DraftStore`. Note
 * it declares `delete` as `{ ok: true; deleted: boolean }`, so this slice pins
 * the delete reply's shape as well as the list's.
 */
interface DraftStore {
  get<T = unknown>(key: string): Promise<T | null>;
  set<T = unknown>(key: string, value: T): Promise<{ ok: true; sizeBytes?: number }>;
  delete(key: string): Promise<{ ok: true; deleted: boolean }>;
  list(opts?: {
    prefix?: string;
    limit?: number;
    cursor?: string;
  }): Promise<{ keys: Array<{ key: string }>; nextCursor?: string }>;
}

/** Mirrors `civitai-app-playable-collections/src/lib/browse-prefs.ts` — `BrowsePrefsStore`. */
interface BrowsePrefsStore {
  get<T = unknown>(key: string): Promise<T | null>;
  set<T = unknown>(key: string, value: T): Promise<unknown>;
}

/**
 * The compile-time half. A `StorageClient` must satisfy every slice above; one
 * that stopped promising a `Date`, or changed `delete`'s reply, fails HERE
 * rather than in a fleet app's build.
 */
const CONSUMER_SLICES = [
  'gen-matrix/HistoryStorage',
  'custom-generators/DraftStore',
  'playable-collections/BrowsePrefsStore',
] as const;

function satisfiesEveryConsumerSlice(storage: StorageClient): number {
  const asHistory: HistoryStorage = storage;
  const asDrafts: DraftStore = storage;
  const asPrefs: BrowsePrefsStore = storage;
  // Read them, so `noUnusedLocals` cannot quietly delete the assertions.
  return [asHistory, asDrafts, asPrefs].length;
}

describe('the client ↔ fleet-app seam', () => {
  it('satisfies every consumer slice, and the ledger names exactly three', async () => {
    const app = await initialize({ token: 't', fetch: createFakeAppStorage().fetch });

    expect(satisfiesEveryConsumerSlice(app.storage)).toBe(CONSUMER_SLICES.length);
    // Pinned so the ledger fails when a slice is added OR dropped, not only when
    // one stops compiling.
    expect(CONSUMER_SLICES).toHaveLength(3);
  });

  it('🔴 `.getTime()` on a listed entry returns the seeded millisecond', async () => {
    // The assertion `gen-matrix/src/history.test.ts` makes on the other side of
    // the seam, executed here against the REAL transport and an ISO-string wire.
    const updatedAt = new Date('2026-05-06T07:08:09.010Z');
    const fake = createFakeAppStorage({ seed: [{ key: 'm:1', value: { n: 1 }, updatedAt }] });
    const app = await initialize({ token: 't', fetch: fake.fetch });

    const { keys } = await app.storage.list({ prefix: 'm:' });

    expect(keys).toHaveLength(1);
    expect(keys[0]!.updatedAt).toBeInstanceOf(Date);
    expect(keys[0]!.updatedAt.getTime()).toBe(updatedAt.getTime());
    // The `gen-matrix` render path sorts on this; an Invalid Date would compare
    // wrong forever and never throw.
    expect(Number.isNaN(keys[0]!.updatedAt.getTime())).toBe(false);
  });
});

/**
 * §8.7 — not a bound re-spelled in the SDK, but a test that it is NOT.
 *
 * The server owns the key-length cap, the per-value cap, both quota ceilings and
 * the default page size, and answers 400/413 with its own message when one is
 * hit. A second copy here is the thing that drifts, so the storage module must
 * contain no number except the HTTP statuses it branches on.
 */
const ALLOWED_NUMBERS = new Set([413]);

/** Every numeric literal in `source`, with comments and string literals removed. */
function numericLiterals(source: string): number[] {
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""');
  return [...code.matchAll(/(?<![A-Za-z0-9_$.])\d[\d_]*(?:\.\d+)?/g)].map((m) =>
    Number(m[0].replace(/_/g, '')),
  );
}

describe('the storage module re-spells no server bound', () => {
  it('contains no number but the status it branches on', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../../src/storage/index.ts', import.meta.url)),
      'utf8',
    );

    const found = numericLiterals(source);
    expect(found.filter((n) => !ALLOWED_NUMBERS.has(n))).toEqual([]);
    // Positive control on the ZERO above: the scanner really does find numbers.
    expect(found).toEqual([413]);
  });

  it('positive control — the scanner flags a bound if one is ever added', () => {
    const withBounds = [
      "const BASE = 'blocks/app-storage';",
      '/** the 200-char key cap */',
      '// 64 * 1024 in a comment does not count',
      'const KEY_MAX = 200;',
      'const VALUE_CAP = 64 * 1024;',
      'const DEFAULT_LIMIT = 50;',
    ].join('\n');

    expect(numericLiterals(withBounds)).toEqual([200, 64, 1024, 50]);
    expect(numericLiterals(withBounds).filter((n) => !ALLOWED_NUMBERS.has(n))).not.toEqual([]);
  });
});
