import { describe, expect, it } from 'vitest';

import {
  INLINE_MEDIA_RAW_BASE64_MIN_CHARS,
  PASS_THROUGH_INPUT_BYTES_MAX,
  findInlineMedia,
  isInlineMediaString,
} from '../src/internal/stepInputLimits.js';
import { MOCK_WORKFLOW_BOUNDS } from '../src/internal/mockWorkflowGraph.js';

/**
 * The step-input predicate, mirroring the server's cases. The SERVER is
 * civitai/civitai `src/server/schema/blocks/workflow.schema.ts`:
 * `PASS_THROUGH_INPUT_BYTES_MAX` (and `WORKFLOW_INPUT_BYTES_MAX`, defined equal
 * to it) and the inline-media rule beside it.
 */

describe('the mirrored server constants', () => {
  // 🔴 DRIFT GUARD. Literal values, copied from the civitai file named above.
  // If the host moves either, this is the line to change — and the mock host,
  // which reads only these constants, follows.
  it('pins the byte cap and the raw-base64 threshold to the server values', () => {
    expect(PASS_THROUGH_INPUT_BYTES_MAX).toBe(262144);
    expect(INLINE_MEDIA_RAW_BASE64_MIN_CHARS).toBe(4096);
  });

  it('derives the workflow summed cap from the same constant', () => {
    expect(MOCK_WORKFLOW_BOUNDS.maxInputBytes).toBe(PASS_THROUGH_INPUT_BYTES_MAX);
  });
});

describe('isInlineMediaString — clause (a), a media data URI', () => {
  it.each([
    'data:image/png;base64,iVBORw0KGgo=',
    'data:video/mp4;base64,AAAA',
    'data:audio/wav;base64,UklGR',
    '  data:image/jpeg;base64,/9j/',
    '\n\tdata:image/webp,x',
    'DATA:IMAGE/PNG;base64,x',
    'Data:Video/webm,x',
  ])('flags %j', (value) => {
    expect(isInlineMediaString(value)).toBe(true);
  });

  it.each([
    'data:text/plain;base64,aGVsbG8=',
    'data:application/json,{}',
    'x data:image/png;base64,x',
    'https://image.civitai.com/x/data:image/png',
    'data:imagepng;base64,x',
  ])('does not flag %j', (value) => {
    expect(isInlineMediaString(value)).toBe(false);
  });
});

describe('isInlineMediaString — clause (b), raw base64', () => {
  const N = INLINE_MEDIA_RAW_BASE64_MIN_CHARS;

  it('flags base64 alphabet at exactly the threshold', () => {
    expect(isInlineMediaString('A'.repeat(N))).toBe(true);
  });

  it('does not flag base64 alphabet one character under the threshold', () => {
    expect(isInlineMediaString('A'.repeat(N - 1))).toBe(false);
  });

  it('flags every alphabet character, with one or two `=` of padding', () => {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const body = alphabet.repeat(Math.ceil(N / alphabet.length)).slice(0, N);
    expect(isInlineMediaString(body)).toBe(true);
    expect(isInlineMediaString(`${body.slice(0, -1)}=`)).toBe(true);
    expect(isInlineMediaString(`${body.slice(0, -2)}==`)).toBe(true);
  });

  it('counts the padding toward the threshold', () => {
    expect(isInlineMediaString(`${'A'.repeat(N - 2)}==`)).toBe(true);
    expect(isInlineMediaString(`${'A'.repeat(N - 3)}==`)).toBe(false);
  });

  it.each([
    ['three `=`', `${'A'.repeat(N)}===`],
    ['`=` in the middle', `${'A'.repeat(N / 2)}=${'A'.repeat(N / 2)}`],
    ['a space', `${'A'.repeat(N / 2)} ${'A'.repeat(N / 2)}`],
    ['a newline', `${'A'.repeat(N / 2)}\n${'A'.repeat(N / 2)}`],
    ['a leading space', ` ${'A'.repeat(N)}`],
    ['a URL-safe `-`', `${'A'.repeat(N)}-`],
    ['a `.`', `${'A'.repeat(N)}.`],
    ['only padding', '='.repeat(N)],
  ])('does not flag a long string with %s', (_, value) => {
    expect(isInlineMediaString(value)).toBe(false);
  });

  it('does not flag a long prompt with spaces', () => {
    const prompt = 'a watercolor fox in a misty forest, soft light, '.repeat(200);
    expect(prompt.length).toBeGreaterThan(N);
    expect(isInlineMediaString(prompt)).toBe(false);
  });
});

describe('findInlineMedia — the walk', () => {
  const URI = 'data:image/png;base64,iVBORw0KGgo=';

  it('returns null for plain JSON with no media', () => {
    expect(
      findInlineMedia({
        prompt: 'a cat',
        images: ['https://image.civitai.com/a.png'],
        n: 4,
        ok: true,
        none: null,
        nested: { list: [{ s: 'x' }] },
      }),
    ).toBeNull();
  });

  it('names a top-level key', () => {
    expect(findInlineMedia({ prompt: 'a cat', image: URI })).toBe('image');
  });

  it('walks objects', () => {
    expect(findInlineMedia({ a: { b: { c: URI } } })).toBe('a.b.c');
  });

  it('walks arrays', () => {
    expect(findInlineMedia({ images: ['https://x/a.png', 'https://x/b.png', URI] })).toBe('images[2]');
  });

  it('walks arrays of objects and nested arrays', () => {
    expect(findInlineMedia({ frames: [{ src: 'ok' }, { src: ['ok', URI] }] })).toBe('frames[1].src[1]');
    expect(findInlineMedia({ grid: [['ok'], ['ok', 'A'.repeat(4096)]] })).toBe('grid[1][1]');
  });

  it('reports the FIRST offender in key order', () => {
    expect(findInlineMedia({ z: 'ok', first: URI, second: URI })).toBe('first');
  });

  it('returns the empty path for a string that is itself media, and null for one that is not', () => {
    expect(findInlineMedia(URI)).toBe('');
    expect(findInlineMedia('hello')).toBeNull();
  });

  it('terminates on a cyclic object', () => {
    const a: Record<string, unknown> = { s: 'ok' };
    a.self = a;
    expect(findInlineMedia(a)).toBeNull();
    a.later = URI;
    expect(findInlineMedia(a)).toBe('later');
  });
});
