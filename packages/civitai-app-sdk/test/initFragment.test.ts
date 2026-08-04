import { describe, expect, it } from 'vitest';

import {
  BLOCK_INIT_FRAGMENT_MARKER_KEY,
  BLOCK_INIT_FRAGMENT_VERSION,
  encodeBlockInitFragment,
  parseBlockInitFragment,
  stripBlockInitFragment,
} from '../src/blocks/initFragment.js';

/**
 * 🔴 THE LITERAL BELOW IS THE WIRE CONTRACT.
 *
 * civitai's host cannot import this module — it consumes the PUBLISHED
 * `@civitai/app-sdk` dist and the encoder ships in a version that is not
 * published when the host change lands — so it carries a mirrored encoder in
 * `src/components/AppBlocks/blockIframeUrl.ts`. The host repo pins this exact
 * same string in `__tests__/blockIframeUrl.test.ts`.
 *
 * If you change the format, BOTH literals must change, and the two repos must
 * ship in the order "decoder first" (an unknown version decodes to `{}`, so an
 * older block simply loses the fast path rather than misreading it).
 */
const WIRE_LITERAL = 'civitai-block=v1&theme=dark&renderMode=iframe&blockInstanceId=bi_abc';

describe('block init fragment — wire format', () => {
  it('encodes to the exact pinned wire literal', () => {
    expect(
      encodeBlockInitFragment({
        theme: 'dark',
        renderMode: 'iframe',
        blockInstanceId: 'bi_abc',
      }),
    ).toBe(WIRE_LITERAL);
  });

  it('decodes the pinned wire literal into all three fields', () => {
    expect(parseBlockInitFragment(`#${WIRE_LITERAL}`)).toEqual({
      theme: 'dark',
      renderMode: 'iframe',
      blockInstanceId: 'bi_abc',
    });
  });

  it('decodes with or without the leading hash', () => {
    expect(parseBlockInitFragment(WIRE_LITERAL)).toEqual(parseBlockInitFragment(`#${WIRE_LITERAL}`));
  });

  it('round-trips every theme/renderMode combination', () => {
    for (const theme of ['light', 'dark'] as const) {
      for (const renderMode of ['iframe', 'inline'] as const) {
        const fields = { theme, renderMode, blockInstanceId: 'bi_1' };
        expect(parseBlockInitFragment(`#${encodeBlockInitFragment(fields)}`)).toEqual(fields);
      }
    }
  });

  it('percent-encodes a blockInstanceId containing reserved characters', () => {
    const encoded = encodeBlockInitFragment({
      theme: 'light',
      renderMode: 'iframe',
      // Not a shape the platform mints, but the encoder must not be able to
      // smuggle extra fragment keys via an unescaped `&`/`=`.
      blockInstanceId: 'a&theme=dark',
    });
    expect(encoded).not.toContain('theme=dark&');
    expect(parseBlockInitFragment(`#${encoded}`)).toEqual({
      theme: 'light',
      renderMode: 'iframe',
      blockInstanceId: 'a&theme=dark',
    });
  });
});

describe('block init fragment — hostile / foreign input decodes to nothing', () => {
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['empty string', ''],
    ['bare hash', '#'],
    // A hash-routed block app's own state. The marker gate is what keeps us
    // from misreading it.
    ["a block app's hash route", '#/settings/profile'],
    ['a scroll anchor', '#section-2'],
    ['our keys with NO marker', '#theme=dark&renderMode=iframe&blockInstanceId=bi_abc'],
    ['an unknown future version', '#civitai-block=v2&theme=dark&blockInstanceId=bi_abc'],
    ['a truncated marker', '#civitai-block=&theme=dark'],
  ])('%s → {}', (_label, input) => {
    expect(parseBlockInitFragment(input as string | null | undefined)).toEqual({});
  });

  it('drops an individually-invalid field but keeps the valid siblings', () => {
    expect(
      parseBlockInitFragment('#civitai-block=v1&theme=chartreuse&renderMode=iframe&blockInstanceId=bi_x'),
    ).toEqual({ renderMode: 'iframe', blockInstanceId: 'bi_x' });

    expect(
      parseBlockInitFragment('#civitai-block=v1&theme=dark&renderMode=telepathy&blockInstanceId=bi_x'),
    ).toEqual({ theme: 'dark', blockInstanceId: 'bi_x' });

    expect(
      parseBlockInitFragment('#civitai-block=v1&theme=dark&renderMode=iframe&blockInstanceId='),
    ).toEqual({ theme: 'dark', renderMode: 'iframe' });
  });

  it('ignores unknown extra keys (a newer host may add fields)', () => {
    expect(
      parseBlockInitFragment(`#${WIRE_LITERAL}&somethingNew=1&anotherThing=hello`),
    ).toEqual({ theme: 'dark', renderMode: 'iframe', blockInstanceId: 'bi_abc' });
  });

  it('exposes the marker key/version it gates on', () => {
    expect(BLOCK_INIT_FRAGMENT_MARKER_KEY).toBe('civitai-block');
    expect(BLOCK_INIT_FRAGMENT_VERSION).toBe('v1');
  });
});

describe('stripBlockInitFragment', () => {
  it('removes every one of our keys', () => {
    expect(stripBlockInitFragment(`#${WIRE_LITERAL}`)).toBe('');
  });

  it("preserves the block app's own fragment keys", () => {
    expect(stripBlockInitFragment(`#${WIRE_LITERAL}&tab=history&page=2`)).toBe(
      'tab=history&page=2',
    );
  });

  it('returns null (nothing to do) when the fragment is not ours', () => {
    expect(stripBlockInitFragment('#/settings/profile')).toBeNull();
    expect(stripBlockInitFragment('#tab=history')).toBeNull();
    expect(stripBlockInitFragment('#civitai-block=v2&theme=dark')).toBeNull();
    expect(stripBlockInitFragment('')).toBeNull();
    expect(stripBlockInitFragment(undefined)).toBeNull();
  });
});
