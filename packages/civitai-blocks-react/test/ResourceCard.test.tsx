import type { BlockResourceInfo } from '@civitai/app-sdk/blocks';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ResourceCard, resourceDisplayName } from '../src/ui/ResourceCard.js';

afterEach(() => {
  cleanup();
  document.querySelectorAll('style[data-civitai-blocks-ui]').forEach((el) => el.remove());
});

// 🔴 Every field is PAIRWISE DISTINCT, and distinct from every constant the
// assertions name. A fixture whose fields collide cannot see a mutant that
// renders the wrong one: `modelName: 'SDXL'` with `baseModel: 'SDXL'` makes
// "the name is right" and "the base model is right" the same assertion, and a
// swap survives a fully green suite.
const CHECKPOINT: BlockResourceInfo = {
  versionId: 128713,
  modelId: 4384,
  modelName: 'DreamShaper',
  versionName: 'Eight',
  baseModel: 'SD 1.5',
  modelType: 'Checkpoint',
};

const LORA: BlockResourceInfo = {
  versionId: 987654,
  modelId: 55521,
  modelName: 'Detail Tweaker',
  versionName: 'Rev2',
  baseModel: 'SDXL 1.0',
  modelType: 'LORA',
};

describe('ResourceCard', () => {
  // -------------------------------------------------------------------------
  // 🔴 THE FROZEN NAME. The reason this component exists in /ui rather than
  // being copied a fourth time.
  // -------------------------------------------------------------------------
  describe('the name fallback is frozen — an unnamed resource is never blank', () => {
    // 🔴 `BlockResourceInfo.modelName` is typed `string` (REQUIRED), and the
    // type is optimistic: `civitai-app-model-benchmarking` writes
    // `modelName ?? '#'+versionId` in its own source, i.e. a first-party block
    // has already seen it absent at runtime. A card rendering an empty string
    // is indistinguishable from a broken card.
    it('🔴 an EMPTY modelName falls back to #<versionId>, not to nothing', () => {
      render(
        <ResourceCard
          variant="row"
          resource={{ ...LORA, modelName: '' }}
          data-testid="rc"
        />,
      );
      expect(
        screen.getByTestId('rc-name').textContent,
        'an empty modelName must render #<versionId>, never an empty name line',
      ).toBe('#987654');
    });

    it('🔴 a MISSING modelName does too — the type says required, reality disagrees', () => {
      // The cast is the point of this case: it reproduces the runtime shape the
      // type forbids and the consuming block defends against anyway.
      const missing = {
        versionId: 442211,
        modelId: 991,
        versionName: 'Rev2',
        baseModel: 'SDXL 1.0',
        modelType: 'LORA',
      } as unknown as BlockResourceInfo;
      render(<ResourceCard variant="row" resource={missing} data-testid="rc" />);
      expect(
        screen.getByTestId('rc-name').textContent,
        'a modelName absent at runtime must render #<versionId>',
      ).toBe('#442211');
    });

    it('🔴 WHITESPACE-ONLY counts as absent — it renders as nothing at all', () => {
      render(
        <ResourceCard variant="row" resource={{ ...LORA, modelName: '   ' }} data-testid="rc" />,
      );
      expect(
        screen.getByTestId('rc-name').textContent,
        'a whitespace-only modelName must be treated as absent',
      ).toBe('#987654');
    });

    it('POSITIVE CONTROL: a real name is rendered verbatim and NOT replaced by the id', () => {
      // Without this the three cases above cannot distinguish "the fallback
      // works" from "the id is rendered unconditionally".
      render(<ResourceCard variant="row" resource={LORA} data-testid="rc" />);
      expect(screen.getByTestId('rc-name').textContent).toBe('Detail Tweaker');
    });

    it('a name with surrounding whitespace is trimmed, not rendered padded', () => {
      render(
        <ResourceCard
          variant="row"
          resource={{ ...LORA, modelName: '  Detail Tweaker  ' }}
          data-testid="rc"
        />,
      );
      expect(screen.getByTestId('rc-name').textContent).toBe('Detail Tweaker');
    });

    it('🔴 INVARIANT GUARD (no observed instance): a non-numeric versionId does not render "#undefined"', () => {
      // Unlike the modelName cases above this is not a regression fix — no host
      // has been seen omitting `versionId`. It is here because the alternative
      // to a guard is the literal string "#undefined" on screen.
      const broken = { ...LORA, modelName: '', versionId: undefined } as unknown as BlockResourceInfo;
      render(<ResourceCard variant="row" resource={broken} data-testid="rc" />);
      expect(
        screen.getByTestId('rc-name').textContent,
        'a resource with neither a name nor a usable id must not render "#undefined"',
      ).toBe('Unknown resource');
    });

    it('the helper is exported, so a caller composing its own label agrees with the card', () => {
      expect(resourceDisplayName(CHECKPOINT)).toBe('DreamShaper');
      expect(resourceDisplayName({ ...CHECKPOINT, modelName: '' })).toBe('#128713');
    });
  });

  // -------------------------------------------------------------------------
  // 🔴 THE FROZEN TYPE LABEL.
  // -------------------------------------------------------------------------
  describe('the LoRA/Checkpoint distinction is frozen', () => {
    it('normalises the host\'s LORA to the readable "LoRA"', () => {
      render(<ResourceCard variant="row" resource={LORA} data-testid="rc" />);
      expect(screen.getByTestId('rc-type').textContent).toBe('LoRA');
    });

    it('renders a Checkpoint as "Checkpoint"', () => {
      render(<ResourceCard variant="row" resource={CHECKPOINT} data-testid="rc" />);
      expect(screen.getByTestId('rc-type').textContent).toBe('Checkpoint');
    });

    it('the match is CASE-INSENSITIVE, and covers the LoRA-family adapters', () => {
      for (const [modelType, expected] of [
        ['lora', 'LoRA'],
        ['LoRA', 'LoRA'],
        ['LoCon', 'LoRA'],
        ['LyCORIS', 'LoRA'],
        ['DoRA', 'LoRA'],
        ['checkpoint', 'Checkpoint'],
        ['CHECKPOINT', 'Checkpoint'],
      ] as const) {
        cleanup();
        render(<ResourceCard variant="row" resource={{ ...LORA, modelType }} data-testid="rc" />);
        expect(screen.getByTestId('rc-type').textContent, `modelType ${modelType}`).toBe(expected);
      }
    });

    it('🔴 an UNKNOWN type is rendered VERBATIM — never coerced into a known label', () => {
      // A Controlnet or an embedding announced as "Checkpoint" is a confident
      // lie about what the viewer is generating with. The raw string is merely
      // unpolished.
      render(
        <ResourceCard variant="row" resource={{ ...LORA, modelType: 'Controlnet' }} data-testid="rc" />,
      );
      expect(
        screen.getByTestId('rc-type').textContent,
        'an unrecognised modelType must render verbatim, not as Checkpoint or LoRA',
      ).toBe('Controlnet');
    });

    it('🔴 a BLANK type renders NO pill — an empty badge is chrome that means nothing', () => {
      render(<ResourceCard variant="row" resource={{ ...LORA, modelType: '' }} data-testid="rc" />);
      expect(
        screen.queryByTestId('rc-type'),
        'a blank modelType must omit the badge entirely rather than render an empty one',
      ).toBeNull();
      // POSITIVE CONTROL: the same card WITH a type does render one, so the
      // assertion above is not passing because the badge never renders.
      cleanup();
      render(<ResourceCard variant="row" resource={LORA} data-testid="rc" />);
      expect(screen.queryByTestId('rc-type')).not.toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // 🔴 NO IMAGE FIELD. Measured against the SDK type, not assumed.
  // -------------------------------------------------------------------------
  describe('a missing thumbnail is the NORMAL case, not an edge case', () => {
    it('🔴 variant="card" WITHOUT a thumbnail still renders the frame, with the frozen copy', () => {
      // `BlockResourceInfo` carries no image field — the host's picker does not
      // return one — so two of the three known consumers have no thumbnail at
      // all. A card that renders nothing here collapses to a text sliver.
      render(<ResourceCard variant="card" resource={LORA} data-testid="rc" />);
      expect(screen.getByTestId('rc-thumb'), 'the card frame must exist with no image').toBeTruthy();
      expect(
        screen.getByTestId('rc-placeholder').textContent,
        'the no-thumbnail copy is frozen: "No preview"',
      ).toBe('No preview');
      expect(screen.getByTestId('rc-thumb').querySelector('img')).toBeNull();
    });

    it('variant="card" WITH a thumbnail renders the image in the same frame', () => {
      render(
        <ResourceCard
          variant="card"
          resource={LORA}
          thumbnailUrl="https://image.example/preview.jpg"
          data-testid="rc"
        />,
      );
      const img = screen.getByTestId('rc-thumb').querySelector('img')!;
      expect(img.getAttribute('src')).toBe('https://image.example/preview.jpg');
      expect(screen.queryByTestId('rc-placeholder')).toBeNull();
    });

    it('🔴 the thumbnail is DECORATIVE — alt="" and aria-hidden, so the name is read once', () => {
      render(
        <ResourceCard
          variant="card"
          resource={LORA}
          thumbnailUrl="https://image.example/preview.jpg"
          data-testid="rc"
        />,
      );
      const img = screen.getByTestId('rc-thumb').querySelector('img')!;
      expect(img.getAttribute('alt'), 'a decorative thumbnail must carry alt=""').toBe('');
      expect(img.getAttribute('aria-hidden')).toBe('true');
    });

    it('variant="row" omits the frame when there is no thumbnail, and shows it when there is', () => {
      // The row is a compact line; an empty 36px "No preview" tile on every row
      // of a selected-resources list is noise, not information.
      render(<ResourceCard variant="row" resource={LORA} data-testid="rc" />);
      expect(screen.queryByTestId('rc-thumb')).toBeNull();

      cleanup();
      render(
        <ResourceCard
          variant="row"
          resource={LORA}
          thumbnailUrl="https://image.example/preview.jpg"
          data-testid="rc"
        />,
      );
      expect(screen.getByTestId('rc-thumb').querySelector('img')).not.toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Interactivity is a PROP, not something a caller re-derives.
  // -------------------------------------------------------------------------
  describe('interactive vs static', () => {
    it('🔴 interactive renders exactly ONE button, and it is the card', () => {
      render(
        <ResourceCard variant="card" interactive resource={LORA} onSelect={() => {}} data-testid="rc" />,
      );
      const hit = screen.getByTestId('rc-hit');
      expect(hit.tagName, 'an interactive card must be a <button>').toBe('BUTTON');
      expect(hit.getAttribute('type')).toBe('button');
    });

    it('🔴 STATIC renders no button and no tab stop at all', () => {
      // A list of already-chosen resources must not put N dead focus stops
      // between a keyboard user and the control they want (which lives in
      // `actions`).
      render(<ResourceCard variant="row" resource={LORA} data-testid="rc" />);
      const hit = screen.getByTestId('rc-hit');
      expect(hit.tagName, 'a static card must not be a <button>').toBe('DIV');
      expect(hit.getAttribute('tabindex'), 'a static card must not be focusable').toBeNull();
      expect(hit.getAttribute('role')).toBeNull();
      expect(screen.getByTestId('rc').querySelectorAll('button').length).toBe(0);
    });

    it('fires onSelect on click', () => {
      const onSelect = vi.fn();
      render(
        <ResourceCard variant="card" interactive resource={LORA} onSelect={onSelect} data-testid="rc" />,
      );
      fireEvent.click(screen.getByTestId('rc-hit'));
      expect(onSelect).toHaveBeenCalledTimes(1);
    });

    it('🔴 disabled does NOT fire onSelect', () => {
      const onSelect = vi.fn();
      render(
        <ResourceCard
          variant="card"
          interactive
          disabled
          resource={LORA}
          onSelect={onSelect}
          data-testid="rc"
        />,
      );
      expect((screen.getByTestId('rc-hit') as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(screen.getByTestId('rc-hit'));
      expect(onSelect, 'a disabled card must not fire onSelect').not.toHaveBeenCalled();
    });

    it('🔴 `selected` is announced as a TOGGLE, not spelled into visible text', () => {
      const { rerender } = render(
        <ResourceCard
          variant="card"
          interactive
          resource={LORA}
          onSelect={() => {}}
          data-testid="rc"
        />,
      );
      expect(
        screen.getByTestId('rc-hit').getAttribute('aria-pressed'),
        'an unselected interactive card must be aria-pressed="false"',
      ).toBe('false');

      rerender(
        <ResourceCard
          variant="card"
          interactive
          selected
          resource={LORA}
          onSelect={() => {}}
          data-testid="rc"
        />,
      );
      expect(
        screen.getByTestId('rc-hit').getAttribute('aria-pressed'),
        'a selected interactive card must be aria-pressed="true"',
      ).toBe('true');
    });
  });

  // -------------------------------------------------------------------------
  // 🔴 THE FROZEN ACCESSIBLE NAME.
  // -------------------------------------------------------------------------
  describe('the accessible name is composed in one fixed order', () => {
    it('🔴 pinned WHOLE — name, version, type, base model', () => {
      // Not a substring check. The visible tile reads as
      // "Detail TweakerLoRARev2SDXL 1.0" if left to raw content, so this label
      // is what a screen-reader user actually gets; pinning a fragment lets the
      // rest drift.
      render(
        <ResourceCard variant="card" interactive resource={LORA} onSelect={() => {}} data-testid="rc" />,
      );
      expect(
        screen.getByTestId('rc-hit').getAttribute('aria-label'),
        'the accessible name is frozen as "<name>, <version>, <type>, <baseModel>"',
      ).toBe('Detail Tweaker, Rev2, LoRA, SDXL 1.0');
    });

    it('LEADS with the visible name, satisfying WCAG 2.5.3 (Label in Name)', () => {
      render(
        <ResourceCard variant="card" interactive resource={CHECKPOINT} onSelect={() => {}} data-testid="rc" />,
      );
      const visible = screen.getByTestId('rc-name').textContent!;
      const label = screen.getByTestId('rc-hit').getAttribute('aria-label')!;
      expect(label.startsWith(visible)).toBe(true);
      expect(screen.getByRole('button', { name: label })).toBeTruthy();
    });

    it('🔴 an unnamed resource still gets a NAME — never an unlabelled button', () => {
      render(
        <ResourceCard
          variant="card"
          interactive
          resource={{ ...LORA, modelName: '' }}
          onSelect={() => {}}
          data-testid="rc"
        />,
      );
      expect(
        screen.getByTestId('rc-hit').getAttribute('aria-label'),
        'a nameless resource must still produce an accessible name built from its id',
      ).toBe('#987654, Rev2, LoRA, SDXL 1.0');
    });

    it('🔴 ABSENT segments are DROPPED, not rendered as empty gaps', () => {
      render(
        <ResourceCard
          variant="card"
          interactive
          resource={{ ...LORA, versionName: '', baseModel: '' }}
          onSelect={() => {}}
          data-testid="rc"
        />,
      );
      const label = screen.getByTestId('rc-hit').getAttribute('aria-label')!;
      expect(label, 'empty segments must be filtered out of the accessible name').toBe(
        'Detail Tweaker, LoRA',
      );
      expect(label).not.toMatch(/,\s*,/);
    });

    it('a STATIC card carries no aria-label — there is no control to name', () => {
      render(<ResourceCard variant="row" resource={LORA} data-testid="rc" />);
      expect(screen.getByTestId('rc-hit').getAttribute('aria-label')).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // The `actions` slot.
  // -------------------------------------------------------------------------
  describe('the actions slot', () => {
    it('🔴 renders OUTSIDE the hit area, so a control is never nested in a button', () => {
      // A <button> inside a <button> is invalid HTML: the browser reparents it,
      // the inner control becomes unreachable by keyboard, and its click is
      // eaten by the outer one.
      render(
        <ResourceCard
          variant="card"
          interactive
          resource={LORA}
          onSelect={() => {}}
          actions={<button data-testid="remove">Remove</button>}
          data-testid="rc"
        />,
      );
      const hit = screen.getByTestId('rc-hit');
      const remove = screen.getByTestId('remove');
      expect(
        hit.contains(remove),
        'an actions control must NOT be nested inside the card button',
      ).toBe(false);
      expect(screen.getByTestId('rc').contains(remove)).toBe(true);
      expect(hit.querySelectorAll('button').length).toBe(0);
    });

    it('an actions control is independently clickable and does not trigger onSelect', () => {
      const onSelect = vi.fn();
      const onRemove = vi.fn();
      render(
        <ResourceCard
          variant="row"
          interactive
          resource={LORA}
          onSelect={onSelect}
          actions={<button data-testid="remove" onClick={onRemove}>Remove</button>}
          data-testid="rc"
        />,
      );
      fireEvent.click(screen.getByTestId('remove'));
      expect(onRemove).toHaveBeenCalledTimes(1);
      expect(onSelect).not.toHaveBeenCalled();
    });

    it('the slot is absent entirely when no actions are passed', () => {
      render(<ResourceCard variant="row" resource={LORA} data-testid="rc" />);
      expect(screen.queryByTestId('rc-actions')).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Wiring.
  // -------------------------------------------------------------------------
  describe('wiring', () => {
    it('🔴 DERIVES every hook from the root id, so two cards in one grid stay distinct', () => {
      render(
        <>
          <ResourceCard variant="card" resource={LORA} data-testid="card-a" />
          <ResourceCard variant="card" resource={CHECKPOINT} data-testid="card-b" />
        </>,
      );
      expect(screen.getByTestId('card-a-name').textContent).toBe('Detail Tweaker');
      expect(screen.getByTestId('card-b-name').textContent).toBe('DreamShaper');
      // The undecorated defaults must NOT also be present, or a grid of cards
      // would resolve every query to the same node.
      expect(screen.queryByTestId('resource-card-name')).toBeNull();
    });

    it('falls back to `resource-card` ids when no data-testid is given', () => {
      render(<ResourceCard variant="row" resource={LORA} />);
      expect(screen.getByTestId('resource-card')).toBeTruthy();
      expect(screen.getByTestId('resource-card-name').textContent).toBe('Detail Tweaker');
    });

    it('the variant reaches the DOM, so the caller\'s grid can target it', () => {
      const { rerender } = render(<ResourceCard variant="card" resource={LORA} data-testid="rc" />);
      expect(screen.getByTestId('rc').getAttribute('data-variant')).toBe('card');
      rerender(<ResourceCard variant="row" resource={LORA} data-testid="rc" />);
      expect(screen.getByTestId('rc').getAttribute('data-variant')).toBe('row');
    });

    it('🔴 the theme tokens are injected — in the shape that contains NO other pack component', () => {
      // 🔴 MEASURED: the obvious version of this case could not observe its
      // guard. A card normally renders a <Badge> for the type pill, and Badge
      // calls `useBlocksStyles()` itself — so commenting out ResourceCard's own
      // call left the whole suite GREEN (mutation M16, first pass: SURVIVED).
      //
      // A row with no thumbnail and a blank modelType is the one shape built
      // entirely from bare <div>/<span>, so this component's own call is the
      // only thing that can inject the stylesheet.
      render(<ResourceCard variant="row" resource={{ ...LORA, modelType: '' }} data-testid="rc" />);
      expect(screen.queryByTestId('rc-type'), 'precondition: no Badge in this shape').toBeNull();
      expect(screen.queryByTestId('rc-thumb'), 'precondition: no thumb in this shape').toBeNull();
      expect(
        document.querySelector('style[data-civitai-blocks-ui]'),
        'useBlocksStyles() must run or a bare card renders with no pack CSS at all',
      ).not.toBeNull();
    });

    it('renders the version and base model as visible meta, not only in the aria-label', () => {
      render(<ResourceCard variant="row" resource={CHECKPOINT} data-testid="rc" />);
      const meta = screen.getByTestId('rc-meta').textContent!;
      expect(meta).toContain('Eight');
      expect(meta).toContain('SD 1.5');
      expect(meta).toContain('Checkpoint');
    });

    it('omits an empty baseModel rather than rendering a placeholder dash', () => {
      render(
        <ResourceCard variant="row" resource={{ ...CHECKPOINT, baseModel: '' }} data-testid="rc" />,
      );
      expect(screen.getByTestId('rc-meta').textContent).toBe('CheckpointEight');
    });
  });
});
