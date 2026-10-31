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

/**
 * 🔴 THE ONE ARTEFACT IN THIS PACKAGE NOTHING MECHANICAL HAS EVER READ.
 *
 * `BREAKING.md`'s porting section has now carried THREE framings of the same
 * paragraph, two of which were factually wrong, and every one of them shipped past
 * a fully green suite — measured: before this block, no test and no script in the
 * repo read `BREAKING.md` at all. Prose review was the only guard, and it failed
 * three times in a row. `api/public-api.md` has a script that reads it; this file
 * had nothing.
 *
 * So the load-bearing claims are pinned here, mechanically.
 *
 * 🔴 WHOLE NORMALISED STRINGS, NOT KEYWORDS. A word-level assertion is walkable by
 * rewording, which is precisely how this paragraph went wrong three times — each
 * rewrite kept the vocabulary and inverted the meaning. Pinning the sentence means
 * the claim is machine-readable.
 *
 * ⚠ ACCEPTED COST, STATED PLAINLY: a purely cosmetic reword of that section will
 * now fail this test. That is the point, not a defect. Changing a pinned sentence
 * is a claim change and must be a deliberate edit here too — at which point the
 * author has to look at the retraction record and see which framings are already
 * retracted, which is the whole mechanism.
 */

/** Collapse markdown hard-wrapping so a pinned sentence is one comparable string. */
function normalisedProse(source: string): string {
  return source.replace(/\s+/g, ' ').trim();
}

/**
 * The claims. Each entry is a WHOLE sentence or clause from the porting section,
 * normalised — not a keyword, and not a regex that a reword would still satisfy.
 */
const PINNED_CLAIMS = {
  'credential+CORS already handled':
    '**The credential and the CORS declaration are already handled — for both, by code that exists.**',
  'no token plumbing, no CORS, no manifest':
    'So there is no token plumbing, no CORS work and no manifest change to do.',
  'CORS mechanism is tier-dependent':
    '⚠ **The CORS mechanism differs by trust tier, though neither tier costs you any work.**',
  'the remaining work is four call-site items':
    'The work that actually remains is four items, and it is all at the call sites:',
  'not every failure is an ApiError':
    '🔴 **But not every failure is an `ApiError`.**',
  'retraction record exists and is scoped':
    '⚠ **This paragraph has had three framings; two claims are retracted.**',
  'retracted framing (a)':
    '**(a)** *"a second client for these same routes"* — **false**',
  'retracted framing (b)':
    '**(b)** *"budget for the token/CORS work"* — **false**',
  'the transport claim is NOT retracted':
    '🔴 The *transport* change is NOT retracted — this document still asserts it, above.',
} as const;

describe("BREAKING.md's porting section is pinned, because prose review failed it three times", () => {
  const read = () =>
    normalisedProse(
      readFileSync(fileURLToPath(new URL('../../BREAKING.md', import.meta.url)), 'utf8'),
    );

  it('🔴 carries every load-bearing claim, verbatim', () => {
    const prose = read();

    // Positive control FIRST: prove the guard is reading the intended file at all.
    // Without this, every assertion below is also satisfied by an empty string
    // being searched for nothing — the zero that looks like a pass.
    expect(prose).toContain('### Porting off the bridge:');
    expect(prose.length).toBeGreaterThan(1000);

    const missing = Object.entries(PINNED_CLAIMS)
      .filter(([, claim]) => !prose.includes(normalisedProse(claim)))
      .map(([label]) => label);
    expect(missing).toEqual([]);
  });

  it('🔴 positive control — the matcher FAILS on a reworded claim', () => {
    // The mutation this test performs on itself: take the real prose, reword one
    // pinned claim the way a well-meaning editor would, and confirm the guard
    // notices. Without this, the assertion above could be vacuously true.
    const prose = read();
    const reworded = prose.replace(
      normalisedProse(PINNED_CLAIMS['no token plumbing, no CORS, no manifest']),
      'So there is nothing extra to configure.',
    );

    // The reword actually landed — otherwise the "detected" result below would be
    // about a string that was never changed.
    expect(reworded).not.toBe(prose);
    expect(reworded).not.toContain(
      normalisedProse(PINNED_CLAIMS['no token plumbing, no CORS, no manifest']),
    );

    // …and a claim NOT reworded is still found, so the matcher is discriminating
    // rather than simply always-false on a mutated document.
    expect(reworded).toContain(normalisedProse(PINNED_CLAIMS['retracted framing (b)']));
  });

  it('🔴 the retraction record names both retracted framings and spares the transport claim', () => {
    const prose = read();

    // A guard on the STATE of the record, not on the word "retracted": both
    // quoted framings present, and the transport carve-out present with them. A
    // fourth framing that dropped the record would fail here.
    expect(prose).toContain(normalisedProse(PINNED_CLAIMS['retracted framing (a)']));
    expect(prose).toContain(normalisedProse(PINNED_CLAIMS['retracted framing (b)']));
    expect(prose).toContain(
      normalisedProse(PINNED_CLAIMS['the transport claim is NOT retracted']),
    );

    // 🔴 And the retraction must stay NARROW. An earlier version stamped the
    // composite "the port is a transport change; budget for the token/CORS work"
    // false, which retracted a claim the document still makes. That exact
    // over-reaching quotation must not come back.
    expect(prose).not.toContain('the port is a transport change; budget for the token/CORS work');
  });

  it('🔴 lists exactly four remaining items, numbered', () => {
    const raw = readFileSync(fileURLToPath(new URL('../../BREAKING.md', import.meta.url)), 'utf8');
    const section = raw.slice(raw.indexOf('The work that actually remains is four items'));
    const items = [...section.matchAll(/^(\d)\. \*\*/gm)].map((m) => m[1]);

    // Pinned so the list fails when it GROWS or SHRINKS, not only when one item
    // is reworded — the prose says "four", so four is the machine-checked number.
    expect(items.slice(0, 4)).toEqual(['1', '2', '3', '4']);
    expect(section).toContain('4. **Audit every `limit` you pass**');
    // Positive control on the item matcher: it really does find numbered items,
    // so the equality above is not comparing two empty lists.
    expect(items.length).toBeGreaterThanOrEqual(4);
  });
});

