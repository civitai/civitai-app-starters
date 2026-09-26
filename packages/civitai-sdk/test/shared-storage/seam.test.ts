import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { initialize } from '../../src/app/index.js';
import type { SharedStorageClient } from '../../src/shared-storage/index.js';
import { createFakeSharedStorage } from '../support/fake-shared-storage.js';

/**
 * 🔴 THE SEAM NOBODY OWNS.
 *
 * The REST routes are tested on the server side; the fleet apps are tested
 * against their own structural stubs. No suite on either side ever loads BOTH,
 * so two hermetically-clean surfaces can still be broken together. These pin the
 * RELATIONSHIP: each consumer's declared slice, mirrored verbatim, and the one
 * runtime assertion those consumers make on the other side of the seam.
 *
 * The mirror below is a copy, not an import — the fleet apps are separate
 * repositories. It must be updated together with the app it names, and the ledger
 * must fail when it GROWS or SHRINKS, which is why the count is pinned.
 */

/**
 * Mirrors the slice `civitai-app-playable-collections` writes its "Popular"
 * cross-user rail against — the immediate consumer, and the reason this client
 * exists. It needs exactly three of the eleven methods.
 */
interface PopularRailStore {
  list(query?: { prefix?: string; limit?: number; cursor?: string }): Promise<{
    items: Array<{ key: string; value: unknown; count: number; viewerVoted: boolean }>;
    nextCursor?: string;
  }>;
  append(value: { title: string; body?: string; data?: unknown }): Promise<{ key: string }>;
  vote(key: string): Promise<{ count: number }>;
}

/** The ledger. It fails when a slice is ADDED or DROPPED, not only when one stops compiling. */
const CONSUMER_SLICES = ['playable-collections/PopularRailStore'] as const;

/**
 * The compile-time half. A `SharedStorageClient` must satisfy every slice above;
 * one that renamed `items`, dropped `count`, or stopped returning the minted key
 * fails HERE rather than in a fleet app's build.
 */
function satisfiesEveryConsumerSlice(shared: SharedStorageClient): number {
  const asRail: PopularRailStore = shared;
  // Read it, so `noUnusedLocals` cannot quietly delete the assertion.
  return [asRail].length;
}

describe('the shared-storage client ↔ fleet-app seam', () => {
  it('satisfies every consumer slice, and the ledger names exactly one', async () => {
    const app = await initialize({ token: 't', fetch: createFakeSharedStorage().fetch });

    expect(satisfiesEveryConsumerSlice(app.sharedStorage)).toBe(CONSUMER_SLICES.length);
    expect(CONSUMER_SLICES).toHaveLength(1);
  });

  it('🔴 the rail’s own three-call round trip works against the real transport', async () => {
    // The sequence `playable-collections` performs: file a row, vote it up, then
    // read the rail back and find it carrying the vote. Executed here against the
    // REAL client and an ISO-string wire.
    const fake = createFakeSharedStorage({ pageSize: 10, mintKeys: ['01JRAIL'] });
    const app = await initialize({ token: 't', fetch: fake.fetch });
    const shared = app.sharedStorage;

    const { key } = await shared.append({ title: 'A playable deck', data: { cards: 3 } });
    expect(key).toBe('01JRAIL');

    await expect(shared.vote(key)).resolves.toEqual({ count: 1 });

    const { items } = await shared.list();
    expect(items).toHaveLength(1);
    expect(items[0]!.key).toBe(key);
    expect(items[0]!.count).toBe(1);
    expect(items[0]!.viewerVoted).toBe(true);
    // The rail sorts on this; an Invalid Date would compare wrong forever and
    // never throw.
    expect(Number.isNaN(items[0]!.createdAt.getTime())).toBe(false);
    expect(Number.isNaN(items[0]!.updatedAt.getTime())).toBe(false);
  });

  it('🔴 `sharedStorage` and `storage` are DIFFERENT clients on different routes', async () => {
    // The mutation this kills: wiring `sharedStorage` to `createStorageClient`, or
    // to the same BASE. Both would type-check and both would hit the wrong table.
    const seen: string[] = [];
    const fetch = ((input: RequestInfo | URL) => {
      seen.push(new URL(String(input)).pathname);
      // Well-formed enough for both clients to parse.
      return Promise.resolve(
        new Response(JSON.stringify({ items: [], metadata: {}, keys: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }) as typeof globalThis.fetch;

    const app = await initialize({ token: 't', fetch });
    await app.sharedStorage.list();
    await app.storage.list();

    expect(seen).toEqual([
      '/api/v1/blocks/shared-storage/list',
      '/api/v1/blocks/app-storage/list',
    ]);
    expect(app.sharedStorage).not.toBe(app.storage);
  });
});

/**
 * §8.7, mirrored from `test/storage/seam.test.ts` — not a bound re-spelled in the
 * SDK, but a test that it is NOT.
 *
 * The server owns the key-length cap, the prefix cap, the cursor cap, the counts
 * batch ceiling, the reason cap, both list limits and the value byte cap, and it
 * answers 400/413 with its own message when one is hit. A second copy here is the
 * thing that drifts, so the shared-storage module must contain no number at all.
 */
const ALLOWED_NUMBERS = new Set<number>();

/** Every numeric literal in `source`, with comments and string literals removed. */
function numericLiterals(source: string): number[] {
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
  return [...code.matchAll(/(?<![A-Za-z0-9_$.])\d[\d_]*(?:\.\d+)?/g)].map((m) =>
    Number(m[0].replace(/_/g, '')),
  );
}

describe('the shared-storage module re-spells no server bound', () => {
  it('contains no numeric literal at all', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../../src/shared-storage/index.ts', import.meta.url)),
      'utf8',
    );

    const found = numericLiterals(source);
    expect(found.filter((n) => !ALLOWED_NUMBERS.has(n))).toEqual([]);
    // 🔴 This zero is only as good as the next test. The scanner CAN return an
    // empty array for a file it never read, so read it as a claim about the module
    // only once the synthetic case below has shown the scanner non-inert.
    expect(found).toEqual([]);
    // …and that it read THIS file, not an empty one.
    expect(source).toContain("const BASE = 'blocks/shared-storage'");
  });

  it('positive control — the scanner flags a bound if one is ever added', () => {
    const withBounds = [
      "const BASE = 'blocks/shared-storage';",
      '/** the 64-char key cap */',
      '// 64 * 1024 in a comment does not count',
      'const KEY_MAX = 64;',
      'const COUNTS_MAX = 100;',
      'const DEFAULT_LIMIT = 50;',
    ].join('\n');

    expect(numericLiterals(withBounds)).toEqual([64, 100, 50]);
    expect(numericLiterals(withBounds).filter((n) => !ALLOWED_NUMBERS.has(n))).not.toEqual([]);
  });
});
