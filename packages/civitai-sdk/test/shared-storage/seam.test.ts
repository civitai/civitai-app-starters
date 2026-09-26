import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { initialize } from '../../src/app/index.js';
import { createFakeSharedStorage } from '../support/fake-shared-storage.js';

/**
 * 🔴 THERE IS NO CONSUMER-SLICE MIRROR HERE, AND THAT IS DELIBERATE.
 *
 * Its sibling `test/storage/seam.test.ts` mirrors three fleet apps' declared
 * slices, because those apps really do consume `@civitai/sdk`'s per-viewer
 * storage. **No app consumes this client yet.** An earlier draft of this file
 * mirrored a `PopularRailStore` from `civitai-app-playable-collections` and
 * claimed this surface unblocked its rail; that claim was false. Measured in that
 * repo's `package.json`: its Civitai deps are `@civitai/app-sdk` and
 * `@civitai/blocks-react` — it does **not** depend on `@civitai/sdk` at all. It is
 * blocked on being PORTED, and the port is what needs this surface to already
 * exist; the surface does not unblock anything today.
 *
 * A mirror of a slice nobody declares is worse than no mirror: it reads as
 * coverage of a relationship while pinning nothing, and it would have frozen a
 * shape (`vote`, now deliberately app-layer) that this client does not even carry.
 *
 * 🔴 So: when the first app is ported onto `app.sharedStorage`, add its declared
 * slice here and pin the ledger count, exactly as the per-viewer seam test does.
 * Until then the guards below pin the two relationships that ARE real — the route
 * namespaces the two clients own, and the bounds this module must not re-spell.
 */

describe('the shared-storage client ↔ per-viewer client seam', () => {
  it('🔴 `sharedStorage` and `storage` are DIFFERENT clients on different routes', async () => {
    // The mutation this kills: wiring `sharedStorage` to `createStorageClient`, or
    // to the same BASE. Both would type-check and both would hit the wrong table —
    // one of them the viewer's PRIVATE store, from a cross-user code path.
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

  it('the five methods work end to end against the real transport', async () => {
    // A round trip over the `fetch` seam: file a row, read it back by key, edit
    // it, see the edit in a listing, then withdraw it.
    const fake = createFakeSharedStorage({ pageSize: 10, mintKeys: ['01JROW'] });
    const app = await initialize({ token: 't', fetch: fake.fetch });
    const shared = app.sharedStorage;

    const { key } = await shared.append({ title: 'first', data: { n: 1 } });
    expect(key).toBe('01JROW');

    const fetched = await shared.get(key);
    expect(fetched?.value).toEqual({ title: 'first', data: { n: 1 } });
    // Both stamps are real Dates; a caller sorts on these and an Invalid Date
    // would compare wrong forever without ever throwing.
    expect(Number.isNaN(fetched!.createdAt.getTime())).toBe(false);
    expect(Number.isNaN(fetched!.updatedAt.getTime())).toBe(false);

    await expect(shared.update(key, { title: 'second' })).resolves.toEqual({ ok: true });
    const { items } = await shared.list();
    expect(items.map((i) => i.value)).toEqual([{ title: 'second' }]);

    await expect(shared.withdraw(key)).resolves.toEqual({ ok: true, deleted: true });
    await expect(shared.get(key)).resolves.toBeNull();
  });
});

/**
 * §8.7, mirrored from `test/storage/seam.test.ts` — not a bound re-spelled in the
 * SDK, but a test that it is NOT.
 *
 * The server owns the key-length cap, the prefix cap, the cursor cap, both list
 * limits and the value byte cap, and it answers 400/413 with its own message when
 * one is hit. A second copy here is the thing that drifts, so the shared-storage
 * module must contain no number at all.
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

  it('🔴 the module names none of the six deliberately-absent ops', () => {
    // A guard on the STATE, not on a word: the six op names must not appear as
    // route strings in the module at all, so a method added back cannot slip in
    // while this file still claims a five-method surface.
    const source = readFileSync(
      fileURLToPath(new URL('../../src/shared-storage/index.ts', import.meta.url)),
      'utf8',
    );

    for (const op of ['vote', 'unvote', 'counts', 'top', 'increment', 'report']) {
      expect(source).not.toContain(`'${op}'`);
    }
    // Positive control: the five that ARE wrapped do appear as route strings, so
    // the assertion above is not vacuously true of every string.
    for (const op of ['list', 'item', 'append', 'update', 'withdraw']) {
      expect(source).toContain(`'${op}'`);
    }
  });

  it('positive control — the scanner flags a bound if one is ever added', () => {
    const withBounds = [
      "const BASE = 'blocks/shared-storage';",
      '/** the 64-char key cap */',
      '// 64 * 1024 in a comment does not count',
      'const KEY_MAX = 64;',
      'const DEFAULT_LIMIT = 50;',
    ].join('\n');

    expect(numericLiterals(withBounds)).toEqual([64, 50]);
    expect(numericLiterals(withBounds).filter((n) => !ALLOWED_NUMBERS.has(n))).not.toEqual([]);
  });
});
