import type { BlockResourceInfo } from '@civitai/app-sdk/blocks';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ResourceCard } from '../src/ui/ResourceCard.js';

// 🔴 THIS FILE EXISTS BECAUSE THE UNIT TIER CANNOT SEE GEOMETRY.
//
// happy-dom does no layout: every `getBoundingClientRect()` is 0×0, `scrollWidth`
// and `clientWidth` are both 0, and `aspect-ratio` / `min-width: 0` / `overflow:
// hidden` are inert strings in a stylesheet nothing evaluates. So the two
// properties this component's CSS actually buys are STRUCTURALLY invisible to
// the 1342-test unit suite:
//
//   1. `aspect-ratio: 1 / 1` on the card's thumbnail frame. Deleting it leaves
//      the unit tier green — the placeholder <span> is still in the DOM, and
//      the unit test can only assert that. In a browser the frame collapses to
//      one line of 11px text and the tile is a sliver. That line matters more
//      here than in most components: `BlockResourceInfo` has NO image field, so
//      "no thumbnail" is the COMMON case, not the edge one.
//
//   2. `min-width: 0` on the hit area and text column. A flex item defaults to
//      `min-width: auto`, which refuses to shrink below its content, so without
//      it a long model name does not ellipsis — it widens the card out of its
//      grid cell and pushes the actions slot off the end. Again invisible to
//      happy-dom, which reports every width as 0 and so cannot tell a truncated
//      name from an overflowing one.
//
// Every assertion below is paired with a POSITIVE CONTROL, so a green result
// means "this tier can observe the property AND the property holds" rather than
// "this tier says yes to everything".

const LORA: BlockResourceInfo = {
  versionId: 987654,
  modelId: 55521,
  modelName: 'Detail Tweaker',
  versionName: 'Rev2',
  baseModel: 'SDXL 1.0',
  modelType: 'LORA',
};

/** A grid cell narrow enough that a long name MUST overflow it. */
const CELL = 220;

function Cell({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div style={{ width: CELL }}>{children}</div>;
}

afterEach(() => {
  cleanup();
  document.querySelectorAll('style[data-civitai-blocks-ui]').forEach((el) => el.remove());
});

describe('ResourceCard — geometry, in a real browser', () => {
  describe('a card with NO thumbnail keeps its box', () => {
    it('🔴 the frame is square and full-height, not a collapsed sliver', () => {
      render(
        <Cell>
          <ResourceCard variant="card" resource={LORA} data-testid="rc" />
        </Cell>,
      );
      const frame = screen.getByTestId('rc-thumb').getBoundingClientRect();
      expect(frame.width, 'the thumbnail frame must fill the tile width').toBeGreaterThan(150);
      expect(
        Math.abs(frame.height - frame.width),
        'aspect-ratio 1/1 must hold — a collapsed frame is the failure this pins',
      ).toBeLessThanOrEqual(1);
    });

    it('POSITIVE CONTROL: the same text in an unstyled box is ~one line tall', () => {
      // Proves the assertion above is a property of THIS component's CSS rather
      // than something the tier or the container would give any element.
      render(
        <Cell>
          <div data-testid="plain">No preview</div>
        </Cell>,
      );
      const plain = screen.getByTestId('plain').getBoundingClientRect();
      expect(plain.width).toBeGreaterThan(150);
      expect(plain.height, 'an unstyled box is a text line, not a square').toBeLessThan(40);
    });

    it('a card WITH a thumbnail keeps the same square frame', () => {
      // The frame's box must not depend on whether the caller happened to have
      // an image — otherwise a mixed grid renders ragged rows.
      render(
        <Cell>
          <ResourceCard
            variant="card"
            resource={LORA}
            thumbnailUrl="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"
            data-testid="rc"
          />
        </Cell>,
      );
      const frame = screen.getByTestId('rc-thumb').getBoundingClientRect();
      expect(Math.abs(frame.height - frame.width)).toBeLessThanOrEqual(1);
    });
  });

  describe('a long name truncates instead of blowing the card out of its cell', () => {
    // 🔴 WITH SPACES, deliberately. The first version of this fixture was
    // `'Hyperdetailed'.repeat(12)` — one 156-character unbreakable word, which
    // overflows its box under `white-space: normal` exactly as it does under
    // `nowrap`. Measured: mutating `white-space: nowrap` → `normal` SURVIVED
    // both tiers against that fixture. A breakable name is what makes the
    // single-line assertion below able to see the difference.
    const LONG = 'Hyper detailed cinematic portrait enhancer for realistic skin and hair v4';

    it('🔴 the name stays on ONE clipped line, and the card stays inside its grid cell', () => {
      render(
        <Cell>
          <ResourceCard variant="card" resource={{ ...LORA, modelName: LONG }} data-testid="rc" />
        </Cell>,
      );
      const name = screen.getByTestId('rc-name');
      // Ordered so the assertion that NAMES the rule fires first: a mutant that
      // drops `nowrap` should die to the nowrap message, not to a downstream one.
      expect(
        name.getBoundingClientRect().height,
        'white-space:nowrap must hold — a wrapped name is three lines tall, not one',
      ).toBeLessThan(26);
      expect(
        name.scrollWidth,
        'a long name must overflow its own box (i.e. be clipped), not widen the card',
      ).toBeGreaterThan(name.clientWidth);
      expect(
        screen.getByTestId('rc').getBoundingClientRect().width,
        'min-width:0 must let the flex items shrink — otherwise the card exceeds its cell',
      ).toBeLessThanOrEqual(CELL + 1);
    });

    it('POSITIVE CONTROL: the SAME text unstyled DOES wrap to several lines', () => {
      // Proves the single-line assertion above is a property of this
      // component's CSS: the fixture is genuinely breakable, so an element
      // without `nowrap` wraps it. Without this control, "height < 26" could
      // pass simply because the text never had anywhere to wrap.
      render(
        <Cell>
          <div data-testid="plain" style={{ fontSize: 13 }}>{LONG}</div>
        </Cell>,
      );
      expect(
        screen.getByTestId('plain').getBoundingClientRect().height,
        'the fixture must be wrappable, or the nowrap assertion is vacuous',
      ).toBeGreaterThan(30);
    });

    it('POSITIVE CONTROL: a SHORT name is not clipped', () => {
      // Without this, "scrollWidth > clientWidth" cannot distinguish real
      // truncation from a name element that is always zero-width.
      render(
        <Cell>
          <ResourceCard variant="card" resource={LORA} data-testid="rc" />
        </Cell>,
      );
      const name = screen.getByTestId('rc-name');
      expect(name.clientWidth).toBeGreaterThan(0);
      expect(name.scrollWidth).toBeLessThanOrEqual(name.clientWidth);
    });

    it('🔴 the clipped name is ELLIPSISED, not hard-cut', () => {
      // 🔴 A COMPUTED-STYLE check, deliberately labelled as one. Nothing in a
      // headless browser can assert that the "…" glyph was painted — there is
      // no geometry that distinguishes a hard clip from an ellipsis. What this
      // CAN establish is that the declarations reach the element, and that is
      // not nothing: mutating `overflow: hidden` → `visible` on the name
      // SURVIVED every geometry assertion in this file (measured), because
      // scrollWidth still exceeds clientWidth either way. `text-overflow` is
      // inert without `overflow: hidden`, so the pair has to be asserted
      // together or the ellipsis silently becomes a hard cut.
      render(
        <Cell>
          <ResourceCard variant="card" resource={{ ...LORA, modelName: LONG }} data-testid="rc" />
          <div data-testid="plain">{LONG}</div>
        </Cell>,
      );
      const name = getComputedStyle(screen.getByTestId('rc-name'));
      expect(name.overflow, 'text-overflow is inert unless overflow is hidden').toBe('hidden');
      expect(name.textOverflow, 'a clipped name must end in an ellipsis, not a hard cut').toBe(
        'ellipsis',
      );
      // POSITIVE CONTROL: an element the rule does NOT match reports the
      // defaults, so the two assertions above are reading a real cascade rather
      // than a value every element happens to have.
      const plain = getComputedStyle(screen.getByTestId('plain'));
      expect(plain.overflow).toBe('visible');
      expect(plain.textOverflow).toBe('clip');
    });

    it('🔴 in a row, a long name does not push the actions slot off the end', () => {
      // `flex: none` on the actions plus `min-width: 0` on the hit. Without
      // either, the Remove control a viewer needs is pushed outside the card and
      // clipped away by the card's own `overflow: hidden`.
      render(
        <Cell>
          <ResourceCard
            variant="row"
            resource={{ ...LORA, modelName: LONG }}
            actions={<button data-testid="remove">Remove</button>}
            data-testid="rc"
          />
        </Cell>,
      );
      const card = screen.getByTestId('rc').getBoundingClientRect();
      const actions = screen.getByTestId('rc-actions').getBoundingClientRect();
      expect(actions.width, 'the actions slot must keep its intrinsic width').toBeGreaterThan(0);
      expect(
        actions.right,
        'the actions slot must stay inside the card, not be pushed past its right edge',
      ).toBeLessThanOrEqual(card.right + 1);
      expect(card.width).toBeLessThanOrEqual(CELL + 1);
    });
  });
});
