import type { BlockResourceInfo } from '@civitai/app-sdk/blocks';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
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
//   1b. The three STATE ATTRIBUTES on the root (`data-selected`,
//      `data-disabled`, `data-interactive`). They are inert markup on their own;
//      what makes them mean anything is a stylesheet rule matching them, and
//      only a real browser computes that. An audit measured `data-selected`
//      deleted → unit 1342/1342 and browser 56/56 GREEN, with the selected-state
//      rule silently dead. `aria-pressed` has its own unit guard, so the state
//      stayed correct for assistive tech and vanished for everyone with eyes.
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

  describe('the state attributes actually drive the stylesheet', () => {
    // 🔴 Each of these pairs an attribute the component emits with the rule that
    // reads it. Deleting the attribute leaves both tiers green without them —
    // measured — because the unit tier cannot compute a cascade and no test
    // referenced any of the three.
    it('🔴 data-selected changes the border, and the unselected card is the control', () => {
      render(
        <Cell>
          <ResourceCard variant="card" interactive resource={LORA} onSelect={() => {}} data-testid="off" />
          <ResourceCard
            variant="card"
            interactive
            selected
            resource={LORA}
            onSelect={() => {}}
            data-testid="on"
          />
        </Cell>,
      );
      const off = getComputedStyle(screen.getByTestId('off')).borderTopColor;
      const on = getComputedStyle(screen.getByTestId('on')).borderTopColor;
      expect(off, 'precondition: an unselected card resolves a border colour at all').not.toBe('');
      expect(
        on,
        'data-selected must reach the stylesheet — a selected card cannot look identical to an unselected one',
      ).not.toBe(off);
    });

    it('🔴 data-disabled dims the card', () => {
      render(
        <Cell>
          <ResourceCard variant="card" interactive resource={LORA} onSelect={() => {}} data-testid="off" />
          <ResourceCard
            variant="card"
            interactive
            disabled
            resource={LORA}
            onSelect={() => {}}
            data-testid="on"
          />
        </Cell>,
      );
      expect(getComputedStyle(screen.getByTestId('off')).opacity).toBe('1');
      expect(
        Number(getComputedStyle(screen.getByTestId('on')).opacity),
        'data-disabled must reach the stylesheet',
      ).toBeLessThan(1);
    });

    it('🔴 the interactive arm presents as clickable — a rule keyed on the ELEMENT, not on data-interactive', () => {
      // 🔴 RENAMED AND RE-SCOPED after an audit found the previous title
      // ("data-interactive is what the button-only affordances hang off") wider
      // than what the body pins. It is not true: `grep data-interactive
      // src/ui/styles.ts` returns ZERO — the cursor and focus rules key on
      // `button[data-civitai-ui-resource-hit]`, i.e. the element TYPE. Measured
      // both arms: delete the attribute from the component and drop the
      // attribute assertions, leaving only the cursor ones, and this tier stays
      // 68/68 green; mutate `cursor: pointer` -> `default` and it reddens with
      // its own message. So the two halves observe DIFFERENT things and the old
      // title claimed one covered the other.
      //
      // `data-interactive` is a CONSUMER hook — nothing in this package's own
      // stylesheet reads it — and the guard that pins it is the unit case "the
      // three STATE ATTRIBUTES reach the root". What this case pins is the
      // affordance, and it says so.
      render(
        <Cell>
          <ResourceCard variant="row" resource={LORA} data-testid="static" />
          <ResourceCard variant="row" interactive resource={LORA} onSelect={() => {}} data-testid="live" />
        </Cell>,
      );
      expect(
        getComputedStyle(screen.getByTestId('live-hit')).cursor,
        'an interactive card must present as clickable',
      ).toBe('pointer');
      expect(
        getComputedStyle(screen.getByTestId('static-hit')).cursor,
        'and a static one must not',
      ).not.toBe('pointer');
    });

    it('🔴 the selected mark is a GLYPH, so selection survives a viewer who cannot use the hue', () => {
      // The non-colour half of WCAG 1.4.1. The border test above only proves
      // the two states differ; this proves they differ by something other than
      // colour.
      render(
        <Cell>
          <ResourceCard
            variant="card"
            interactive
            selected
            resource={LORA}
            onSelect={() => {}}
            data-testid="rc"
          />
        </Cell>,
      );
      const mark = screen.getByTestId('rc-selected').getBoundingClientRect();
      expect(mark.width, 'the mark must occupy real space, not be a zero-size node').toBeGreaterThan(0);
      expect(mark.height).toBeGreaterThan(0);
    });
  });

  describe('a thumbnail that fails to load', () => {
    it('🔴 a REAL 404 reaches the placeholder, not an empty grey square', () => {
      // The unit tier fires a synthetic `error` event; only a browser proves the
      // handler is reached by an actual failed fetch.
      render(
        <Cell>
          <ResourceCard
            variant="card"
            resource={LORA}
            thumbnailUrl="/__resource_card_no_such_image_404.png"
            data-testid="rc"
          />
        </Cell>,
      );
      return waitFor(() => {
        expect(
          screen.getByTestId('rc-placeholder').textContent,
          'a dead CDN link must render "No preview", not a blank frame',
        ).toBe('No preview');
      });
    });
  });

  describe('the overlay slot is positioned by the component', () => {
    it('🔴 lands over the thumbnail corner while being a SIBLING of the hit button', () => {
      // The slot's whole value is this combination, and neither half is visible
      // to the unit tier: it must sit ON the frame (a browser-only fact, since
      // the offsets are arithmetic over the hit's padding) while living OUTSIDE
      // the <button> (so it can neither nest a control nor be swallowed by the
      // explicit aria-label). Measured before the slot existed: a consumer's own
      // absolutely-positioned child escaped the card entirely — card bottom 51,
      // child bottom 120 — because the root set no `position`.
      render(
        <Cell>
          <ResourceCard
            variant="card"
            interactive
            resource={LORA}
            onSelect={() => {}}
            overlay={<span data-testid="pill">Added</span>}
            data-testid="rc"
          />
        </Cell>,
      );
      const card = screen.getByTestId('rc').getBoundingClientRect();
      const frame = screen.getByTestId('rc-thumb').getBoundingClientRect();
      const el = screen.getByTestId('rc-overlay');
      const pill = el.getBoundingClientRect();

      expect(
        screen.getByTestId('rc-hit').contains(el),
        'the overlay must be a sibling of the hit button, never a descendant',
      ).toBe(false);
      expect(pill.width, 'the overlay must be laid out, not collapsed').toBeGreaterThan(0);
      expect(pill.top, 'inside the frame vertically').toBeGreaterThanOrEqual(frame.top - 1);
      expect(pill.bottom, 'inside the frame vertically').toBeLessThanOrEqual(frame.bottom + 1);
      expect(pill.left, 'inside the frame horizontally').toBeGreaterThanOrEqual(frame.left - 1);
      expect(pill.right, 'inside the frame horizontally').toBeLessThanOrEqual(frame.right + 1);
      expect(pill.bottom, 'inside the card — this is what used to fail').toBeLessThanOrEqual(
        card.bottom + 1,
      );
    });

    it('🔴 is INERT to pointers, so it cannot swallow a click meant for the card', () => {
      // `pointer-events: none` — the other half of "status, not controls".
      // Asserted as a computed style AND behaviourally, because only a real
      // browser does hit-testing: jsdom dispatches to whatever element you name,
      // so the unit tier cannot see this at all.
      let hits = 0;
      render(
        <Cell>
          <ResourceCard
            variant="card"
            interactive
            resource={LORA}
            onSelect={() => {
              hits += 1;
            }}
            overlay={<span data-testid="pill">Added</span>}
            data-testid="rc"
          />
        </Cell>,
      );
      const el = screen.getByTestId('rc-overlay');
      expect(
        getComputedStyle(el).pointerEvents,
        'a status pill must not intercept pointer events',
      ).toBe('none');

      // Click at the pill's own centre: the element under the cursor must be
      // the card's button, not the pill.
      const r = el.getBoundingClientRect();
      const under = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      expect(
        screen.getByTestId('rc-hit').contains(under as Node),
        'the element under the pill must be the card hit area',
      ).toBe(true);
      (under as HTMLElement).click();
      expect(hits, 'the card still receives the click through the pill').toBe(1);
    });

    it('POSITIVE CONTROL: the same pill in `actions` is NOT overlaid on the frame', () => {
      // Proves the assertions above are a property of the overlay slot rather
      // than of any child anywhere in the card.
      render(
        <Cell>
          <ResourceCard
            variant="card"
            resource={LORA}
            actions={<span data-testid="pill">Added</span>}
            data-testid="rc"
          />
        </Cell>,
      );
      const frame = screen.getByTestId('rc-thumb').getBoundingClientRect();
      const pill = screen.getByTestId('pill').getBoundingClientRect();
      expect(pill.top, 'a flow-slot pill sits BELOW the frame, not on it').toBeGreaterThan(frame.bottom);
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

    it('🔴 and on the SELECTED path too, where the name shares its line with the mark', () => {
      // Every other truncation guard runs on the UNSELECTED path, so the flex
      // wrapper the selected mark introduced was geometrically unguarded.
      // Measured: selecting narrows the name box 206px -> 192px, the name stays
      // on ONE line (16.89px, unchanged) and the card stays at 220px.
      render(
        <Cell>
          <ResourceCard
            variant="card"
            interactive
            selected
            resource={{ ...LORA, modelName: LONG }}
            onSelect={() => {}}
            data-testid="rc"
          />
        </Cell>,
      );
      const name = screen.getByTestId('rc-name');
      const mark = screen.getByTestId('rc-selected').getBoundingClientRect();
      expect(mark.width, 'the mark takes real width off the name line').toBeGreaterThan(0);
      expect(
        name.getBoundingClientRect().height,
        'the name must stay on one line beside the mark, not wrap under it',
      ).toBeLessThan(26);
      expect(name.scrollWidth, 'and still be clipped').toBeGreaterThan(name.clientWidth);
      expect(
        screen.getByTestId('rc').getBoundingClientRect().width,
        'the extra flex wrapper must not blow the card out of its cell',
      ).toBeLessThanOrEqual(CELL + 1);
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
