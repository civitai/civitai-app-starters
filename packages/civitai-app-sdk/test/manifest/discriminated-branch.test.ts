/**
 * `preferDiscriminatedBranch` on SYNTHETIC schemas.
 *
 * The canonical has exactly one `oneOf` (pinned in
 * `canonical-derivation.test.ts`), and its shape cannot reach most of this
 * function: an `allOf` guard ahead of it means an unmatched discriminator never
 * gets as far as a member's error, and nothing nests. These cases build the
 * shapes it cannot — a bare discriminated `oneOf`, `anyOf`, two instances of
 * one composition, a composition inside a member, and the compositions that
 * must be LEFT ALONE — and run real Ajv errors through the selection.
 */
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import { preferDiscriminatedBranch } from '../../src/manifest/discriminatedBranch.js';

/** Same Ajv options as `defineBlock`'s own compile. */
function errorsOf(schema: Record<string, unknown>, data: unknown) {
  const ajv = new Ajv2020({ allErrors: true, strict: false, logger: false, verbose: true });
  const validate = ajv.compile(schema);
  if (validate(data)) throw new Error('fixture must be INVALID against its schema');
  return validate.errors ?? [];
}

/** `keyword @ instancePath ← the schemaPath tail`, enough to tell two errors apart. */
function pick(schema: Record<string, unknown>, data: unknown) {
  const errors = errorsOf(schema, data);
  const picked = preferDiscriminatedBranch(errors);
  return {
    errors,
    error: picked?.error,
    at: picked ? `${picked.error.keyword} @ ${picked.error.instancePath} ← ${picked.error.schemaPath}` : undefined,
    discriminator: picked?.discriminator,
  };
}

const circle = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'r'],
  properties: { kind: { const: 'circle' }, r: { type: 'number' } },
};
const rect = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'w', 'h'],
  properties: {
    kind: { const: 'rect' },
    w: { type: 'number' },
    h: { type: 'number' },
    size: { type: 'object', additionalProperties: false, properties: { unit: { type: 'string' } } },
  },
};
const shapeSchema = (keyword: 'oneOf' | 'anyOf') => ({
  type: 'object',
  properties: {
    shape: { [keyword]: [circle, rect] },
    shapes: { type: 'array', items: { [keyword]: [circle, rect] } },
  },
});

describe.each(['oneOf', 'anyOf'] as const)('preferDiscriminatedBranch: a discriminated %s', (keyword) => {
  const schema = shapeSchema(keyword);

  it('CONTROL: the plain first error is the FIRST member’s, whatever the instance says', () => {
    const { errors } = pick(schema, { shape: { kind: 'rect', w: 3 } });
    expect(errors[0]!.schemaPath).toBe(`#/properties/shape/${keyword}/0/required`);
  });

  it('reports the error from the member the discriminator names', () => {
    const { at, discriminator } = pick(schema, { shape: { kind: 'rect', w: 3 } });
    expect(at).toBe(`required @ /shape ← #/properties/shape/${keyword}/1/required`);
    expect(discriminator).toEqual({ key: 'kind', value: 'rect' });
  });

  it('reports an unknown key against the named member, not the first', () => {
    const { at, discriminator } = pick(schema, { shape: { kind: 'rect', w: 3, h: 7, r: 5 } });
    expect(at).toBe(`additionalProperties @ /shape ← #/properties/shape/${keyword}/1/additionalProperties`);
    expect(discriminator).toEqual({ key: 'kind', value: 'rect' });
  });

  it('a value NO member names: the first error wins, unchanged', () => {
    const { errors, error, discriminator } = pick(schema, { shape: { kind: 'triangle' } });
    expect(error).toBe(errors[0]);
    expect(discriminator).toBeUndefined();
  });

  it('an error NESTED inside the named member is reported without naming the member', () => {
    const { at, discriminator } = pick(schema, {
      shape: { kind: 'rect', w: 3, h: 7, size: { unit: 'px', bogus: 1 } },
    });
    expect(at).toBe(
      `additionalProperties @ /shape/size ← #/properties/shape/${keyword}/1/properties/size/additionalProperties`,
    );
    expect(discriminator).toBeUndefined();
  });

  it('two instances of one composition are scoped separately', () => {
    // [0] names no member, so its own first error must survive; only [1]'s
    // errors are filtered. A selection keyed on the schema path alone would
    // skip [0]'s member-0 errors because [1] did not choose member 0.
    const { errors, error } = pick(schema, { shapes: [{ kind: 'triangle' }, { kind: 'rect', w: 3 }] });
    expect(error).toBe(errors[0]);
    expect(errors[0]!.instancePath).toBe('/shapes/0');

    const second = pick(schema, { shapes: [{ kind: 'circle', r: 5 }, { kind: 'rect', w: 3 }] });
    expect(second.at).toBe(`required @ /shapes/1 ← #/properties/shapes/items/${keyword}/1/required`);
  });
});

describe('preferDiscriminatedBranch: compositions it must leave alone', () => {
  const firstWins = (schema: Record<string, unknown>, data: unknown) => {
    const { errors, error, discriminator } = pick(schema, data);
    expect(errors.length).toBeGreaterThan(1); // more than one candidate, or "first" proves nothing
    expect(error).toBe(errors[0]);
    expect(discriminator).toBeUndefined();
  };

  it('members with no shared const property', () => {
    firstWins({ oneOf: [{ type: 'string' }, { type: 'number' }] }, true);
  });

  it('a const on only SOME members', () => {
    firstWins(
      {
        oneOf: [
          { type: 'object', required: ['r'], properties: { kind: { const: 'circle' } } },
          { type: 'object', required: ['w'], properties: { kind: { type: 'string' } } },
        ],
      },
      { kind: 'circle' },
    );
  });

  it('two members pinning the SAME const (nothing to choose between)', () => {
    firstWins(
      {
        anyOf: [
          { type: 'object', required: ['r'], properties: { kind: { const: 'circle' } } },
          { type: 'object', required: ['d'], properties: { kind: { const: 'circle' } } },
        ],
      },
      { kind: 'circle' },
    );
  });

  it('a non-object instance', () => {
    firstWins({ oneOf: [circle, rect] }, 'rect');
  });

  it('an empty error list yields undefined', () => {
    expect(preferDiscriminatedBranch([])).toBeUndefined();
  });
});

describe('preferDiscriminatedBranch: a composition inside a member', () => {
  const fill = {
    oneOf: [
      { type: 'object', additionalProperties: false, properties: { mode: { const: 'solid' }, color: {} } },
      { type: 'object', additionalProperties: false, properties: { mode: { const: 'none' } } },
    ],
  };
  const withFill = (member: { properties: Record<string, unknown> }) => ({
    ...member,
    properties: { ...member.properties, fill },
  });
  // BOTH outer members carry the inner composition, so the inner one fails
  // (and names `solid`) under the outer member the instance did NOT choose too.
  const schema = { type: 'object', properties: { shape: { oneOf: [withFill(circle), withFill(rect)] } } };

  it('skips the inner member’s error under the outer member that was not chosen', () => {
    const { errors, at, discriminator } = pick(schema, {
      shape: { kind: 'rect', w: 3, h: 7, fill: { mode: 'solid', bogus: 1 } },
    });
    // CONTROL: the inner composition did fail under outer member 0 as well.
    expect(errors.map((e) => e.schemaPath)).toContain(
      '#/properties/shape/oneOf/0/properties/fill/oneOf/0/additionalProperties',
    );
    expect(at).toBe(
      'additionalProperties @ /shape/fill ← #/properties/shape/oneOf/1/properties/fill/oneOf/0/additionalProperties',
    );
    // Named after the INNERMOST composition the error sits on.
    expect(discriminator).toEqual({ key: 'mode', value: 'solid' });
  });
});
