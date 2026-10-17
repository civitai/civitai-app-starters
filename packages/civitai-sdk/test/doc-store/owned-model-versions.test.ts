import { describe, expect, it } from 'vitest';

import { StorageError } from '../../src/doc-store/index.js';
import { createFakeStorage, type FakeStorageOptions } from '../../src/testing.js';

/**
 * A collection's manifest `ownedModelVersions` rule (civitai/civitai#6132), as the
 * fake enforces it.
 *
 * 🔴 NOT CONTRACT-PINNED: the vendored storage contract has no case for this rule
 * yet, so these expectations are ported from the server source on civitai `main`
 * (`src/server/services/apps/doc-store-ownership.ts` and the call site in
 * `doc-store-api.ts`) and nothing re-checks them against the server when it changes.
 *
 * Fixture ids are pairwise distinct and none equals a bound the rule names (1,
 * 2147483647), so a mutant that hardcodes either cannot pass by coincidence.
 */

const SCOPES = ['apps:storage', 'apps:storage:publish'];
const ALICE_OWNS = 4_317;
const ALICE_ALSO_OWNS = 5_903;
const BOB_OWNS = 6_271;
const NOBODY_OWNS = 7_789;
const INT4_MAX = 2_147_483_647;

const COLLECTIONS = {
  workflows: {
    visibility: 'shared',
    write: 'own',
    ownedModelVersions: ['/workflow/modelVersionId', '/baseVersionId'],
  },
  plain: { visibility: 'shared', write: 'own' },
  // `length` is an own property of an array: a step through one must still find nothing.
  lists: { visibility: 'shared', write: 'own', ownedModelVersions: ['/tags/length'] },
};

function make(extra: Partial<FakeStorageOptions> = {}, collections: Record<string, unknown> = COLLECTIONS) {
  return createFakeStorage({
    manifest: { scopes: SCOPES, storage: { collections } },
    viewer: { username: 'alice', id: 910_001, modelVersions: ALICE_MODEL_VERSIONS },
    ...extra,
  });
}

/**
 * Alice "owns" the out-of-range values too, so each one is refused by the value
 * check itself — were the fake to skip that check, ownership would accept them.
 */
const ALICE_MODEL_VERSIONS = [ALICE_OWNS, ALICE_ALSO_OWNS, INT4_MAX, 0, -ALICE_OWNS, ALICE_OWNS + 0.5, INT4_MAX + 1];

const bob = { username: 'bob', id: 910_002, modelVersions: [BOB_OWNS] };

const refusal = (p: Promise<unknown>) =>
  p.then(
    () => {
      throw new Error('expected a refusal');
    },
    (e: unknown) => {
      expect(e).toBeInstanceOf(StorageError);
      return e as StorageError;
    },
  );

/** The whole refusal, so a wrong status, code, field or extra detail all fail. */
const refused = async (p: Promise<unknown>) => {
  const e = await refusal(p);
  return [e.status, e.code, e.details];
};
const NOT_OWNED = (pointer: string) => [403, 'resource_not_owned', { pointer }];

describe('ownedModelVersions: the manifest', () => {
  it.each([
    ['a private collection', { visibility: 'private', ownedModelVersions: ['/v'] }],
    ['a write:"none" collection', { visibility: 'shared', write: 'none', counters: ['p'], ownedModelVersions: ['/v'] }],
    ['no pointers', { visibility: 'shared', write: 'own', ownedModelVersions: [] }],
    ['five pointers', { visibility: 'shared', write: 'own', ownedModelVersions: ['/a', '/b', '/c', '/d', '/e'] }],
    ['a duplicate', { visibility: 'shared', write: 'own', ownedModelVersions: ['/a', '/a'] }],
    ['an array index', { visibility: 'shared', write: 'own', ownedModelVersions: ['/items/0'] }],
    ['five segments', { visibility: 'shared', write: 'own', ownedModelVersions: ['/a/b/c/d/e'] }],
    ['a 65-character segment', { visibility: 'shared', write: 'own', ownedModelVersions: [`/${'v'.repeat(65)}`] }],
    ['not a list', { visibility: 'shared', write: 'own', ownedModelVersions: '/v' }],
  ])('a declaration on %s is refused when the fake is created', (_what, decl) => {
    expect(() => make({}, { later: decl })).toThrow(/storage\.collections\.later\.ownedModelVersions: /);
  });

  it('1 and 4 pointers, at the segment-length and depth bounds, are accepted', () => {
    expect(() =>
      make({}, {
        one: { visibility: 'shared', write: 'own', ownedModelVersions: ['/v'] },
        four: {
          visibility: 'shared',
          write: 'own',
          ownedModelVersions: ['/a', '/_b/c', '/d/e/f/G9', `/${'v'.repeat(64)}`],
        },
      }),
    ).not.toThrow();
  });
});

describe('ownedModelVersions: a write', () => {
  it('accepts the writer\'s own versions, on create and on put, at every declared field', async () => {
    const workflows = make().storage.collection('workflows');
    const data = { workflow: { modelVersionId: ALICE_OWNS }, baseVersionId: ALICE_ALSO_OWNS };
    await expect(workflows.create(data)).resolves.toMatchObject({ data });
    await expect(workflows.put('w', data)).resolves.toMatchObject({ key: 'w', data });
  });

  it('allows a declared field that is absent, or reached only through an array or a non-object', async () => {
    const fake = make();
    const workflows = fake.storage.collection('workflows');
    await expect(workflows.put('none', { title: 'no ids at all' })).resolves.toBeTruthy();
    await expect(workflows.put('arr', { workflow: [{ modelVersionId: NOBODY_OWNS }] })).resolves.toBeTruthy();
    await expect(workflows.put('str', { workflow: 'modelVersionId' })).resolves.toBeTruthy();
    await expect(workflows.put('nul', { workflow: null })).resolves.toBeTruthy();
    await expect(fake.storage.collection('lists').put('l', { tags: ['a', 'b', 'c'] })).resolves.toBeTruthy();
  });

  it('refuses another viewer\'s version and one nobody owns, naming the field', async () => {
    const workflows = make().storage.collection('workflows');
    expect(await refused(workflows.put('w', { workflow: { modelVersionId: BOB_OWNS } }))).toEqual(
      NOT_OWNED('/workflow/modelVersionId'),
    );
    expect(await refused(workflows.create({ baseVersionId: NOBODY_OWNS }))).toEqual(NOT_OWNED('/baseVersionId'));
  });

  it.each([
    ['0', 0],
    ['a negative id', -ALICE_OWNS],
    ['a fraction', ALICE_OWNS + 0.5],
    ['a numeric string', String(ALICE_OWNS)],
    ['null', null],
    ['an object', { id: ALICE_OWNS }],
    ['past the integer range', INT4_MAX + 1],
  ])('refuses %s at a declared field, however it is owned', async (_what, value) => {
    const workflows = make().storage.collection('workflows');
    expect(await refused(workflows.put('w', { baseVersionId: value }))).toEqual(NOT_OWNED('/baseVersionId'));
  });

  it('accepts the largest integer id when the writer owns it', async () => {
    await expect(make().storage.collection('workflows').put('w', { baseVersionId: INT4_MAX })).resolves.toBeTruthy();
  });

  it('checks every value before any ownership, as the server does', async () => {
    // The first pointer holds an id the writer does not own, the second a non-id:
    // the server rejects the non-id first, so `details.pointer` is the second.
    const workflows = make().storage.collection('workflows');
    const data = { workflow: { modelVersionId: BOB_OWNS }, baseVersionId: 'x' };
    expect(await refused(workflows.put('w', data))).toEqual(NOT_OWNED('/baseVersionId'));
  });

  it('is checked against the viewer writing: each viewer owns only their own', async () => {
    const fake = make();
    const asBob = fake.as({ viewer: bob }).storage.collection('workflows');
    await expect(asBob.put('b', { baseVersionId: BOB_OWNS })).resolves.toBeTruthy();
    expect(await refused(asBob.put('b2', { baseVersionId: ALICE_OWNS }))).toEqual(NOT_OWNED('/baseVersionId'));
  });

  it('a viewer with no `modelVersions` owns none', async () => {
    const fake = make({ viewer: { username: 'carol' } });
    expect(await refused(fake.storage.collection('workflows').put('c', { baseVersionId: ALICE_OWNS }))).toEqual(
      NOT_OWNED('/baseVersionId'),
    );
  });

  it('a collection that declares no rule accepts any id', async () => {
    await expect(make().storage.collection('plain').put('p', { baseVersionId: NOBODY_OWNS })).resolves.toBeTruthy();
  });

  it('answers 403 on the wire, in the store\'s envelope', async () => {
    const fake = make();
    await fake.storage.collection('workflows').put('w', { baseVersionId: NOBODY_OWNS }).catch(() => undefined);
    const call = fake.calls.at(-1)!;
    expect(call.status).toBe(403);
    expect(call.response).toEqual({
      code: 'resource_not_owned',
      message: 'the model version at this field is not one the author owns',
      error: 'the model version at this field is not one the author owns',
      details: { pointer: '/baseVersionId' },
    });
  });
});

describe('ownedModelVersions: where it runs among the other checks', () => {
  it('before the moderation scan', async () => {
    const workflows = make().storage.collection('workflows');
    const data = { baseVersionId: NOBODY_OWNS, note: 'contract-blocked-term' };
    expect(await refused(workflows.put('w', data))).toEqual(NOT_OWNED('/baseVersionId'));
    // The control: with an owned id, the same text reaches the scanner.
    expect((await refusal(workflows.put('w', { ...data, baseVersionId: ALICE_OWNS }))).code).toBe('content_rejected');
  });

  it('before the trust gate', async () => {
    const fake = make({ viewer: { username: 'newbie', trusted: false, modelVersions: [ALICE_OWNS] } });
    const workflows = fake.storage.collection('workflows');
    expect(await refused(workflows.put('w', { baseVersionId: NOBODY_OWNS }))).toEqual(NOT_OWNED('/baseVersionId'));
    // The control: with an owned id, the trust gate is what refuses.
    expect((await refusal(workflows.put('w', { baseVersionId: ALICE_OWNS }))).code).toBe('not_eligible');
  });

  it('before authorship: a viewer overwriting someone else\'s document is told about the id first', async () => {
    const fake = make();
    await fake.storage.collection('workflows').put('w', { baseVersionId: ALICE_OWNS });
    const asBob = fake.as({ viewer: bob }).storage.collection('workflows');
    expect(await refused(asBob.put('w', { baseVersionId: ALICE_OWNS }))).toEqual(NOT_OWNED('/baseVersionId'));
    // The control: with an id bob owns, the next refusal is the authorship one.
    expect((await refusal(asBob.put('w', { baseVersionId: BOB_OWNS }))).code).toBe('not_author');
  });

  it('spends no write budget and no rejection', async () => {
    const fake = make({ enforceRateLimits: true, now: () => Date.parse('2031-01-01T00:00:00.000Z') });
    const workflows = fake.storage.collection('workflows');
    for (let i = 0; i < 25; i++) {
      expect(await refused(workflows.put(`r${i}`, { baseVersionId: NOBODY_OWNS }))).toEqual(NOT_OWNED('/baseVersionId'));
    }
    // A full burst of ten still fits: neither the burst nor the rejection bucket moved.
    for (let i = 0; i < 10; i++) await workflows.put(`ok${i}`, { baseVersionId: ALICE_OWNS });
    expect((await refusal(workflows.put('ok10', {}))).details).toEqual({ bucket: 'shared-write', retryAfter: 360 });
  });
});
