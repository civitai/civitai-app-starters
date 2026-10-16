import { describe, expect, it } from 'vitest';

import {
  INLINE_MEDIA_DATA_URI_REGEX,
  INLINE_MEDIA_MAX_VISITS,
  INLINE_MEDIA_RAW_BASE64_MIN_CHARS,
  INLINE_MEDIA_RAW_BASE64_REGEX,
  INLINE_MEDIA_TOO_MANY_VALUES,
  PASS_THROUGH_INPUT_BYTES_MAX,
  findInlineMediaPath,
  formatInlineMediaPath,
  inlineMediaMessage,
  isInlineMediaString,
} from '../src/internal/stepInputLimits.js';
import { MOCK_WORKFLOW_BOUNDS } from '../src/internal/mockWorkflowGraph.js';

/**
 * The step-input predicate, mirroring the server's cases. The SERVER is
 * civitai/civitai `src/server/schema/blocks/inline-media.ts` (the inline-media
 * rule) and `src/server/schema/blocks/workflow.schema.ts`
 * (`PASS_THROUGH_INPUT_BYTES_MAX`, and `WORKFLOW_INPUT_BYTES_MAX` defined equal
 * to it).
 */

describe('the mirrored server constants', () => {
  // 🔴 DRIFT GUARD. Literal values and the literal message template, copied from
  // the civitai files named above. If the host moves any of them, these are the
  // lines to change — and the mock host, which reads only the module, follows.
  it('pins the byte cap, the raw-base64 threshold and the value budget', () => {
    expect(PASS_THROUGH_INPUT_BYTES_MAX).toBe(262144);
    expect(INLINE_MEDIA_RAW_BASE64_MIN_CHARS).toBe(4096);
    expect(INLINE_MEDIA_MAX_VISITS).toBe(262144);
    expect(INLINE_MEDIA_TOO_MANY_VALUES).toBe('too-many-values');
  });

  it('pins the two regexes', () => {
    expect(INLINE_MEDIA_DATA_URI_REGEX.source).toBe('^\\s*data:(image|video|audio)\\/');
    expect(INLINE_MEDIA_DATA_URI_REGEX.flags).toBe('i');
    expect(INLINE_MEDIA_RAW_BASE64_REGEX.source).toBe('^[A-Za-z0-9+/]+={0,2}$');
    expect(INLINE_MEDIA_RAW_BASE64_REGEX.flags).toBe('');
  });

  it('pins the message template, whole', () => {
    expect(inlineMediaMessage(['steps', 1, 'input', 'images', 0])).toBe(
      'steps[1].input.images[0] carries inline media (data URI/base64); pass a hosted url instead — ' +
        "for an image, upload it with useImageUpload({ purpose: 'generationSource' }) or pick it with " +
        'useImagePicker and pass the returned url',
    );
  });

  it('derives the workflow summed cap from the same constant', () => {
    expect(MOCK_WORKFLOW_BOUNDS.maxInputBytes).toBe(PASS_THROUGH_INPUT_BYTES_MAX);
  });
});

describe('formatInlineMediaPath', () => {
  it.each([
    [['input', 'images', 0], 'input.images[0]'],
    [['input', 'ImageUrl'], 'input.ImageUrl'],
    [['arguments', 'refs', 1, 2], 'arguments.refs[1][2]'],
    [['steps', 3, 'input', 'a', 'b'], 'steps[3].input.a.b'],
    [[0, 'x'], '[0].x'],
    [[], ''],
  ])('%j → %j', (path, text) => {
    expect(formatInlineMediaPath(path as (string | number)[])).toBe(text);
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
    'explain data:image/png URIs',
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
    ['a newline (MIME line wrapping)', `${'A'.repeat(N / 2)}\n${'A'.repeat(N / 2)}`],
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

describe('findInlineMediaPath — the walk', () => {
  const URI = 'data:image/png;base64,iVBORw0KGgo=';

  it('returns null for plain JSON with no media, including a $ref object', () => {
    expect(
      findInlineMediaPath({
        prompt: 'a cat',
        images: ['https://image.civitai.com/a.png'],
        n: 4,
        ok: true,
        none: null,
        nested: { list: [{ s: 'x' }] },
        ref: { $ref: '$arguments', path: 'image' },
      }),
    ).toBeNull();
  });

  it('names a top-level key', () => {
    expect(findInlineMediaPath({ prompt: 'a cat', ImageUrl: URI })).toEqual(['ImageUrl']);
  });

  it('walks objects', () => {
    expect(findInlineMediaPath({ a: { b: { c: URI } } })).toEqual(['a', 'b', 'c']);
  });

  it('walks arrays, at the index', () => {
    expect(findInlineMediaPath({ images: ['https://x/a.png', 'https://x/b.png', URI] })).toEqual(['images', 2]);
  });

  it('walks arrays of objects and nested arrays', () => {
    expect(findInlineMediaPath({ frames: [{ src: 'ok' }, { src: ['ok', URI] }] })).toEqual([
      'frames',
      1,
      'src',
      1,
    ]);
    expect(findInlineMediaPath({ grid: [['ok'], ['ok', 'A'.repeat(4096)]] })).toEqual(['grid', 1, 1]);
  });

  it('reports the FIRST offender in document order', () => {
    expect(findInlineMediaPath({ z: 'ok', first: URI, second: URI })).toEqual(['first']);
    // Depth-first: the nested hit under the earlier key wins over a later shallow one.
    expect(findInlineMediaPath({ a: { deep: [URI] }, b: URI })).toEqual(['a', 'deep', 0]);
  });

  it('returns the empty path for a string that is itself media', () => {
    expect(findInlineMediaPath(URI)).toEqual([]);
    expect(findInlineMediaPath('hello')).toBeNull();
  });

  it('survives nesting deep enough to overflow a recursive walk', () => {
    let deep: unknown = URI;
    for (let i = 0; i < 100_000; i++) deep = { n: deep };
    const path = findInlineMediaPath(deep);
    expect(Array.isArray(path) && path.length).toBe(100_000);
  });
});

describe('findInlineMediaPath — the value budget', () => {
  const pad = (n: number): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (let i = 0; i < n; i++) out[`k${i}`] = undefined;
    return out;
  };

  it('counts the value itself and each own key: MAX − 1 keys fit, MAX do not', () => {
    expect(findInlineMediaPath(pad(INLINE_MEDIA_MAX_VISITS - 1))).toBeNull();
    expect(findInlineMediaPath(pad(INLINE_MEDIA_MAX_VISITS))).toBe(INLINE_MEDIA_TOO_MANY_VALUES);
  });

  it('counts array elements the same way', () => {
    expect(findInlineMediaPath(new Array(INLINE_MEDIA_MAX_VISITS - 1).fill(0))).toBeNull();
    expect(findInlineMediaPath(new Array(INLINE_MEDIA_MAX_VISITS).fill(0))).toBe(INLINE_MEDIA_TOO_MANY_VALUES);
  });

  it('reports too-many-values, not null, when the media lies past the budget', () => {
    expect(findInlineMediaPath({ ...pad(300_000), photo: 'data:image/png;base64,iVBOR' })).toBe(
      INLINE_MEDIA_TOO_MANY_VALUES,
    );
  });

  it('spends one budget across every field it is passed', () => {
    const budget = { visits: 0 };
    expect(findInlineMediaPath(pad(150_000), budget)).toBeNull();
    expect(findInlineMediaPath(pad(150_000), budget)).toBe(INLINE_MEDIA_TOO_MANY_VALUES);
  });

  it('fails closed on a cyclic object rather than looping forever', () => {
    const a: Record<string, unknown> = { s: 'ok' };
    a.self = a;
    expect(findInlineMediaPath(a)).toBe(INLINE_MEDIA_TOO_MANY_VALUES);
  });
});
