import { describe, expect, it } from 'vitest';

import { StorageError } from '../../src/doc-store/index.js';
import { createFakeStorage, type FakeStorageOptions } from '../../src/testing.js';

/**
 * A collection's manifest `schema` (civitai/civitai#7491), as the fake enforces it: the JSON
 * Schema subset every document's `data` must match, refused 400 `schema_violation` naming the
 * first failing JSON pointer.
 *
 * PARTLY CONTRACT-PINNED: the vendored contract's "a collection schema" case runs against the
 * fake in `contract.test.ts`. Everything else here is ported from the server's own tests on
 * #7491 (`doc-store-schema.test.ts`, `doc-store.functional.ts`,
 * `block-manifest-validator.storage.test.ts`, `doc-store-api.contract.test.ts`), with their
 * literal pointers, keywords and messages, so nothing re-checks it against the server when it
 * changes.
 */

const SCOPES = ['apps:storage', 'apps:storage:publish'];

/** The server functional suite's NOTE_SCHEMA: bounds and names distinct from every other literal. */
const NOTE_SCHEMA = {
  type: 'object',
  required: ['title'],
  additionalProperties: false,
  properties: {
    title: { type: 'string', minLength: 2, maxLength: 7 },
    tags: { type: 'array', items: { enum: ['x', 'y'] } },
    'a/b~c': { type: 'integer' },
  },
};

function make(collections: Record<string, unknown>, extra: Partial<FakeStorageOptions> = {}) {
  return createFakeStorage({ manifest: { scopes: SCOPES, storage: { collections } }, ...extra });
}

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

/** The whole refusal, so a wrong status, code, message or detail all fail. */
const refused = async (p: Promise<unknown>) => {
  const e = await refusal(p);
  return { status: e.status, code: e.code, message: e.message, details: e.details };
};
const VIOLATION = (collection: string, pointer: string, keyword: string, reason: string) => ({
  status: 400,
  code: 'schema_violation',
  message: `document does not match the schema of collection ${collection} at ${JSON.stringify(pointer)}: ${reason}`,
  details: { collection, pointer, keyword },
});

describe('collection schema: the manifest', () => {
  const AT = 'storage.collections.cards.schema';
  const SUPPORTED =
    'type, properties, required, additionalProperties, items, enum, const, minLength, maxLength, pattern, minimum, maximum, minItems, maxItems, description';

  it.each<[string, unknown, string]>([
    [
      'a keyword outside the subset',
      { properties: { when: { type: 'string', format: 'date-time' } } },
      `${AT}.properties.when uses the schema keyword "format", which is not supported — the supported keywords are ${SUPPORTED}`,
    ],
    ['a schema that is not an object', [NOTE_SCHEMA], `${AT} must be a schema object`],
    [
      'a pattern with no maxLength',
      { pattern: '^[a-z]+$' },
      `${AT}.pattern needs a maxLength of at most 1000 on the same schema — a pattern only ever runs against a bounded string`,
    ],
    [
      'a pattern that does not compile',
      { pattern: '([a-z]', maxLength: 30 },
      `${AT}.pattern is not a valid regular expression (JavaScript syntax with the "u" flag)`,
    ],
    [
      'minLength above maxLength',
      { minLength: 9, maxLength: 4 },
      `${AT}.minLength (9) is greater than maxLength (4), so nothing could match`,
    ],
    [
      '17 patterns',
      { properties: Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`p${i}`, { pattern: '^x', maxLength: 5 }])) },
      `${AT} declares 17 patterns — a collection schema may declare at most 16`,
    ],
    [
      'over 16384 bytes of JSON',
      { type: 'object', description: 'd'.repeat(16_351) },
      `${AT} is 16385 bytes of JSON — a collection schema may be at most 16384 bytes`,
    ],
    [
      'schemas nested 17 deep',
      Array.from({ length: 16 }).reduce<Record<string, unknown>>((s) => ({ items: s }), { type: 'string' }),
      `${AT}${'.items'.repeat(16)} is nested too deeply — a collection schema may nest at most 16 schemas`,
    ],
  ])('refuses %s when the fake is created, with the server\'s text', (_what, schema, message) => {
    expect(() => make({ cards: { visibility: 'private', schema } })).toThrow(message);
  });

  it('caps the patterns of the whole manifest at 32, counting every site, over the collections that parse', () => {
    const withPatterns = (prefix: string, n: number, same = false) => ({
      visibility: 'private',
      schema: {
        type: 'object',
        properties: Object.fromEntries(
          Array.from({ length: n }, (_, i) => [`p${i}`, { pattern: same ? '^same' : `^${prefix}${i}`, maxLength: 9 }]),
        ),
      },
    });
    expect(() => make({ c0: withPatterns('a', 16), c1: withPatterns('b', 16) })).not.toThrow();
    expect(() => make({ c0: withPatterns('a', 16), c1: withPatterns('b', 16), c2: withPatterns('c', 5) })).toThrow(
      'storage.collections declare 37 patterns across their schemas — a manifest may declare at most 32 in all',
    );
    // The same source 33 times is 33 patterns: sites, not distinct sources.
    expect(() =>
      make({ c0: withPatterns('a', 11, true), c1: withPatterns('b', 11, true), c2: withPatterns('c', 11, true) }),
    ).toThrow('storage.collections declare 33 patterns across their schemas');
    // c0 is refused on its own (17 > 16), so only c1 and c2 count: 32, under the cap.
    let message = '';
    try {
      make({ c0: withPatterns('a', 17), c1: withPatterns('b', 16), c2: withPatterns('c', 16) });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain('storage.collections.c0.schema declares 17 patterns');
    expect(message).not.toContain('across their schemas');
  });

  it('refuses a schema on a write "none" collection', () => {
    expect(() => make({ plays: { visibility: 'shared', write: 'none', counters: ['plays'], schema: {} } })).toThrow(
      'storage.collections.plays.schema does not apply to write "none" — no document body is ever written to that collection, so a schema would check nothing',
    );
  });

  it('accepts every keyword of the subset, at the bounds: 16 deep, 16 patterns, exactly 16384 bytes', () => {
    const deep16 = Array.from({ length: 15 }).reduce<Record<string, unknown>>((s) => ({ items: s }), { type: 'string' });
    expect(() =>
      make({
        notes: { visibility: 'private', schema: NOTE_SCHEMA },
        shared: { visibility: 'shared', write: 'own', schema: { type: 'object' } },
        deep: { visibility: 'private', schema: deep16 },
        many: {
          visibility: 'private',
          schema: { properties: Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`p${i}`, { pattern: '^x', maxLength: 5 }])) },
        },
        big: { visibility: 'private', schema: { type: 'object', description: 'd'.repeat(16_350) } },
      }),
    ).not.toThrow();
  });
});

describe('collection schema: a write', () => {
  it('accepts a conforming create and put, where a violating body is refused', async () => {
    const notes = make({ notes: { visibility: 'private', schema: NOTE_SCHEMA } }).storage.collection('notes');
    const data = { title: 'Lamp', tags: ['x', 'y'], 'a/b~c': 3 };
    await expect(notes.put('n1', data)).resolves.toMatchObject({ data });
    await expect(notes.create({ title: 'Moth' })).resolves.toMatchObject({ version: 1 });
    // Control: the same collection does check.
    expect((await refusal(notes.put('n2', { title: 'Lamp', tags: ['z'] }))).code).toBe('schema_violation');
  });

  it.each<[Record<string, unknown>, string, string, string]>([
    [{ title: 'Lamp', tags: ['x', 'q'] }, '/tags/1', 'enum', "must be one of the schema's enum values"],
    [{ tags: [] }, '/title', 'required', 'is required'],
    [{ title: 'Lamp', 'a/b~c': 1.5 }, '/a~1b~0c', 'type', 'expected integer, got number'],
    [{ title: 'L' }, '/title', 'minLength', 'must be at least 2 characters'],
    [{ title: 'Lanterns' }, '/title', 'maxLength', 'must be at most 7 characters'],
    // Own keys in ascending order: `aaa` is reached before `zzz`.
    [{ zzz: 1, title: 'Lamp', aaa: 2 }, '/aaa', 'additionalProperties', 'is not a property the schema allows'],
  ])('refuses %j at the first failing pointer, and stores nothing', async (data, pointer, keyword, reason) => {
    const notes = make({ notes: { visibility: 'private', schema: NOTE_SCHEMA } }).storage.collection('notes');
    expect(await refused(notes.put('n1', data))).toEqual(VIOLATION('notes', pointer, keyword, reason));
    await expect(notes.get('n1')).resolves.toBeNull();
  });

  it('an update that would leave the document invalid is refused, and the stored version is kept', async () => {
    const notes = make({ notes: { visibility: 'private', schema: NOTE_SCHEMA } }).storage.collection('notes');
    await notes.put('n1', { title: 'Lamp', tags: ['x'] });
    // A put replaces the whole body: what a client-side merge that dropped `title` sends.
    expect((await refused(notes.put('n1', { tags: ['x', 'y'] }))).details).toEqual({
      collection: 'notes',
      pointer: '/title',
      keyword: 'required',
    });
    await expect(notes.get('n1')).resolves.toMatchObject({ version: 1, data: { title: 'Lamp', tags: ['x'] } });
  });

  it('a collection with no schema accepts every body the schema refuses', async () => {
    const fake = make({
      notes: { visibility: 'private', schema: NOTE_SCHEMA },
      plain: { visibility: 'private' },
    });
    for (const [i, data] of [{ title: 'Lamp', tags: ['q'] }, { tags: [] }, { title: 9, extra: { deep: [1] } }].entries()) {
      expect((await refusal(fake.storage.collection('notes').put(`k${i}`, data))).code).toBe('schema_violation');
      await expect(fake.storage.collection('plain').put(`k${i}`, data)).resolves.toMatchObject({ data });
    }
  });

  it('does not check counters or marks', async () => {
    const fake = make({
      board: { visibility: 'shared', write: 'own', counters: ['views'], marks: ['vote'], schema: { required: ['body'] } },
    });
    const board = fake.storage.collection('board');
    await board.put('b1', { body: 'hi' });
    await expect(board.increment('b1', 'views', 3)).resolves.toEqual({ value: 3 });
    await expect(board.mark('b1', 'vote')).resolves.toEqual({ marked: true, count: 1 });
    // Control: a document write to the same collection is checked.
    expect((await refusal(board.put('b1', {}))).code).toBe('schema_violation');
  });

  it('answers 400 on the wire, in the store\'s envelope, naming the root as the server does', async () => {
    const fake = make({ decks: { visibility: 'private', schema: { type: 'array' } } });
    await fake.storage.collection('decks').put('d', {}).catch(() => undefined);
    const call = fake.calls.at(-1)!;
    const message = 'document does not match the schema of collection decks at "" (the document root): expected array, got object';
    expect(call.status).toBe(400);
    expect(call.response).toEqual({
      code: 'schema_violation',
      message,
      error: message,
      details: { collection: 'decks', pointer: '', keyword: 'type' },
    });
  });

  it('bounds a long pointer in the message but keeps it whole in details', async () => {
    const key = 'k'.repeat(300);
    const notes = make({ notes: { visibility: 'private', schema: { properties: { [key]: { type: 'string' } } } } });
    const e = await refusal(notes.storage.collection('notes').put('n', { [key]: 1 }));
    expect(e.details?.pointer).toBe(`/${key}`);
    expect(e.message).toBe(
      `document does not match the schema of collection notes at "/${'k'.repeat(199)}…": expected string, got number`,
    );
  });
});

/** The evaluator's semantics (the server's `doc-store-schema.test.ts`), through a write. */
describe('collection schema: semantics', () => {
  it.each<[string, Record<string, unknown>, Record<string, unknown>, [string, string] | null]>([
    ['integer accepts 4', { properties: { n: { type: 'integer' } } }, { n: 4 }, null],
    ['integer refuses 4.5', { properties: { n: { type: 'integer' } } }, { n: 4.5 }, ['/n', 'type']],
    ['number includes integers', { properties: { n: { type: 'number' } } }, { n: 4 }, null],
    ['null is its own type', { properties: { n: { type: 'object' } } }, { n: null }, ['/n', 'type']],
    ['an array is not an object', { properties: { n: { type: 'object' } } }, { n: [] }, ['/n', 'type']],
    ['a type list', { properties: { n: { type: ['string', 'null'] } } }, { n: null }, null],
    ['minLength ignores a number', { properties: { n: { minLength: 3 } } }, { n: 1 }, null],
    ['maximum ignores a string', { properties: { n: { maximum: 3 } } }, { n: 'zzzz' }, null],
    ['const with an object, any key order', { properties: { n: { const: { a: 1, b: [2] } } } }, { n: { b: [2], a: 1 } }, null],
    ['const with an extra key', { properties: { n: { const: { a: 1 } } } }, { n: { a: 1, c: 0 } }, ['/n', 'const']],
    ['enum with null', { properties: { n: { enum: ['p', null] } } }, { n: null }, null],
    ['enum is not loose', { properties: { n: { enum: [1] } } }, { n: '1' }, ['/n', 'enum']],
    ['3 emoji are 3 characters', { properties: { s: { maxLength: 3 } } }, { s: '😀😀😀' }, null],
    ['4 emoji are not', { properties: { s: { maxLength: 3 } } }, { s: '😀😀😀😀' }, ['/s', 'maxLength']],
    ['pattern is unanchored', { properties: { s: { pattern: 'b+', maxLength: 9 } } }, { s: 'abbc' }, null],
    ['pattern refuses', { properties: { s: { pattern: '^b+$', maxLength: 9 } } }, { s: 'abbc' }, ['/s', 'pattern']],
    ['pattern uses the u flag', { properties: { s: { pattern: '^\\u{1F600}$', maxLength: 9 } } }, { s: '😀' }, null],
    ['maxLength is reported before pattern', { properties: { s: { pattern: '^b+$', maxLength: 2 } } }, { s: 'abbc' }, ['/s', 'maxLength']],
    ['minimum is inclusive', { properties: { n: { minimum: 2 } } }, { n: 2 }, null],
    ['below minimum', { properties: { n: { minimum: 2 } } }, { n: 1.9 }, ['/n', 'minimum']],
    ['minItems', { properties: { l: { minItems: 2 } } }, { l: [1] }, ['/l', 'minItems']],
    ['maxItems', { properties: { l: { maxItems: 1 } } }, { l: [1, 2] }, ['/l', 'maxItems']],
    ['items: the first failing element', { properties: { l: { items: { type: 'string' } } } }, { l: ['a', 'b', 3, 4] }, ['/l/2', 'type']],
    ['required in declared order', { required: ['zeta', 'alpha'] }, {}, ['/zeta', 'required']],
    [
      'additionalProperties schema checks only undeclared keys',
      { properties: { a: { type: 'string' } }, additionalProperties: { type: 'number' } },
      { a: 'x', b: 'y' },
      ['/b', 'type'],
    ],
    ['additionalProperties true', { properties: {}, additionalProperties: true }, { q: 1 }, null],
    [
      'a property named constructor is declared, not inherited',
      { properties: { constructor: { type: 'string' } }, additionalProperties: false },
      { constructor: 'x' },
      null,
    ],
    [
      'an undeclared constructor key is extra',
      { properties: { a: {} }, additionalProperties: false },
      { constructor: 'x' },
      ['/constructor', 'additionalProperties'],
    ],
    [
      'a nested pointer escapes ~ and /',
      { properties: { 'm~/n': { properties: { 'p/q': { type: 'boolean' } } } } },
      { 'm~/n': { 'p/q': 0 } },
      ['/m~0~1n/p~1q', 'type'],
    ],
  ])('%s', async (_label, schema, data, expected) => {
    const cards = make({ cards: { visibility: 'private', schema } }).storage.collection('cards');
    const outcome = await cards.put('c', data).then(
      () => null,
      (e: unknown) => {
        if (!(e instanceof StorageError) || e.code !== 'schema_violation') throw e;
        return [e.details?.pointer, e.details?.keyword];
      },
    );
    expect(outcome).toEqual(expected);
  });
});

describe('collection schema: where it runs among the other checks', () => {
  const BOARD = {
    board: {
      visibility: 'shared',
      write: 'own',
      ownedModelVersions: ['/versionId'],
      schema: { type: 'object', required: ['body'], properties: { body: { type: 'string', maxLength: 18 } } },
    },
  };
  const tooLong = 'x'.repeat(19);

  it('before the trust gate: an untrusted viewer gets schema_violation, not not_eligible', async () => {
    const board = make(BOARD, { viewer: { username: 'newbie', trusted: false } }).storage.collection('board');
    expect((await refusal(board.create({}))).code).toBe('schema_violation');
    // Control: a conforming body from the same viewer reaches the trust gate.
    expect((await refusal(board.create({ body: 'ok' }))).code).toBe('not_eligible');
  });

  it('before the moderation scan', async () => {
    const board = make(BOARD).storage.collection('board');
    expect((await refusal(board.create({ body: tooLong, note: 'contract-blocked-term' }))).code).toBe('schema_violation');
    // Control: the same text in a conforming body reaches the scanner.
    expect((await refusal(board.create({ body: 'ok', note: 'contract-blocked-term' }))).code).toBe('content_rejected');
  });

  it('before the owned-model-version check', async () => {
    const board = make(BOARD).storage.collection('board');
    expect((await refusal(board.create({ body: tooLong, versionId: 4_317 }))).code).toBe('schema_violation');
    // Control: a conforming body reaches the ownership check (the viewer owns no versions).
    expect((await refusal(board.create({ body: 'ok', versionId: 4_317 }))).code).toBe('resource_not_owned');
  });

  it('spends no write budget and no rejection', async () => {
    const fake = make(BOARD, { enforceRateLimits: true, now: () => Date.parse('2031-01-01T00:00:00.000Z') });
    const board = fake.storage.collection('board');
    for (let i = 0; i < 25; i++) expect((await refusal(board.put(`r${i}`, { body: tooLong }))).code).toBe('schema_violation');
    // A full burst of ten still fits: neither the burst nor the rejection bucket moved.
    for (let i = 0; i < 10; i++) await board.put(`ok${i}`, { body: 'ok' });
    expect((await refusal(board.put('ok10', { body: 'ok' }))).details).toEqual({ bucket: 'shared-write', retryAfter: 360 });
  });
});
