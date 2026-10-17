import { describe, expect, it, afterEach } from 'vitest';

import { abbreviateCount } from '../src/elements/format.js';
import type { CivitaiMediaCard } from '../src/elements/civitai-media-card.js';
import type { CivitaiReaction, ReactionDetail } from '../src/elements/civitai-reaction.js';
import '../src/elements/register-site.js';

let scope: HTMLElement | undefined;

const PIXEL =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/** The card from the site's image feed, with every layer it actually carries. */
const CARD = `
  <civitai-media-card href="/images/1" label="Open image" style="width: 240px">
    <img slot="media" src="${PIXEL}" alt="" />
    <civitai-rating-badge slot="top-start" rating="pg"></civitai-rating-badge>
    <civitai-menu slot="top-end" label="Image actions">
      <button slot="trigger" aria-label="More">&#8942;</button>
      <civitai-menu-item id="report">Report image</civitai-menu-item>
    </civitai-menu>
    <civitai-reaction slot="bottom" emoji="&#128077;" label="Like" count="13100"></civitai-reaction>
    <civitai-reaction slot="bottom" emoji="&#10084;" label="Heart" count="5000" reacted></civitai-reaction>
  </civitai-media-card>`;

function mount(markup = CARD): CivitaiMediaCard {
  scope?.remove();
  scope = document.createElement('div');
  scope.setAttribute('data-theme', 'dark');
  scope.innerHTML = markup;
  document.body.append(scope);
  return scope.querySelector('civitai-media-card')!;
}

const settled = async (card: CivitaiMediaCard): Promise<CivitaiMediaCard> => {
  await card.updateComplete;
  await Promise.all(
    [...card.querySelectorAll('*')]
      .map((el) => (el as HTMLElement & { updateComplete?: Promise<boolean> }).updateComplete)
      .filter(Boolean)
  );
  return card;
};

afterEach(() => {
  scope?.remove();
  scope = undefined;
});

describe('abbreviateCount', () => {
  it.each([
    [0, '0'],
    [964, '964'],
    [1600, '1.6k'],
    [5000, '5k'],
    [13100, '13.1k'],
    [1_250_000, '1.3m'],
    [-13100, '-13.1k'],
  ])('reads %s as %s, the way the site does', (value, expected) => {
    expect(abbreviateCount(value)).toBe(expected);
  });
});

describe('<civitai-media-card>', () => {
  it('links the media without trapping the overlay controls inside the anchor', async () => {
    const card = await settled(mount());
    const link = card.shadowRoot!.querySelector('a')!;

    expect(link.getAttribute('href')).toBe('/images/1');
    expect(link.querySelector('slot[name="top-end"]'), 'a menu inside a link is unreachable')
      .toBeNull();
    expect(card.shadowRoot!.querySelector('[part="top-end"] slot')).not.toBeNull();
  });

  it('is a plain box with no href, so a card need not be a link', async () => {
    const card = await settled(mount(CARD.replace('href="/images/1"', '')));
    expect(card.shadowRoot!.querySelector('a')).toBeNull();
    expect(card.shadowRoot!.querySelector('[part="media"]')).not.toBeNull();
  });

  it('keeps the overlays clickable over the link', async () => {
    const card = await settled(mount());
    const trigger = card.querySelector<HTMLElement>('[slot="trigger"]')!;
    const box = trigger.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    expect(card.querySelector('civitai-menu')!.contains(hit)).toBe(true);
  });

  it('lets the pointer through the empty parts of an overlay strip', async () => {
    const card = await settled(mount());
    const strip = card.shadowRoot!.querySelector('[part="bottom"]')!.getBoundingClientRect();
    // The far right of the bottom strip carries no reaction, so a click there is
    // meant for the link underneath. `document.elementFromPoint` retargets to the
    // host and cannot tell the two apart; the shadow root's own version can.
    const hit = card.shadowRoot!.elementFromPoint(strip.right - 6, strip.top + strip.height / 2);
    expect(hit, 'the scrim must not eat clicks meant for the card').toBe(
      card.querySelector('[slot="media"]')
    );
  });

  it.each(['light', 'dark'])('keeps an overlay control light on %s media', async (theme) => {
    scope?.remove();
    scope = document.createElement('div');
    scope.setAttribute('data-theme', theme);
    scope.innerHTML =
      '<civitai-media-card style="width: 240px"><img slot="media" src="' + PIXEL + '" alt="" />' +
      '<civitai-action-button slot="top-end" label="Remix"></civitai-action-button>' +
      '</civitai-media-card>' +
      '<civitai-action-button id="loose" label="Remix"></civitai-action-button>';
    document.body.append(scope);
    const [onMedia, loose] = [...scope.querySelectorAll('civitai-action-button')];
    await Promise.all(
      [onMedia, loose].map((el) => (el as HTMLElement & { updateComplete: Promise<boolean> }).updateComplete)
    );

    const bg = (el: Element): string =>
      getComputedStyle(el.shadowRoot!.querySelector('button')!).backgroundColor;
    expect(bg(onMedia!), 'the media card overrides it').toBe('rgb(248, 249, 250)');
    if (theme === 'dark') expect(bg(loose!), 'on its own it follows the page').not.toBe(bg(onMedia!));
  });

  it('puts the overlays in the corners the site uses', async () => {
    const card = await settled(mount());
    const box = card.getBoundingClientRect();
    const rating = card.querySelector('civitai-rating-badge')!.getBoundingClientRect();
    const menu = card.querySelector('civitai-menu')!.getBoundingClientRect();
    const reaction = card.querySelector('civitai-reaction')!.getBoundingClientRect();

    expect(rating.left - box.left).toBeLessThan(box.width / 2);
    expect(box.right - menu.right).toBeLessThan(box.width / 2);
    expect(reaction.top - box.top).toBeGreaterThan(box.height / 2);
  });

  it('stacks the top-end corner, kebab above the action button', async () => {
    const card = await settled(
      mount(
        CARD.replace(
          '<civitai-reaction slot="bottom"',
          '<civitai-action-button slot="top-end" label="Remix"></civitai-action-button>' +
            '<civitai-reaction slot="bottom"'
        )
      )
    );
    const menu = card.querySelector('civitai-menu')!.getBoundingClientRect();
    const action = card.querySelector('civitai-action-button')!.getBoundingClientRect();

    expect(action.top, 'the action button hangs under the kebab').toBeGreaterThanOrEqual(menu.bottom);
    expect(action.right, 'both stay flush right').toBeCloseTo(menu.right, 0);
  });

  it('keeps the top-start corner in a row, where the badges sit side by side', async () => {
    const card = await settled(
      mount(
        CARD.replace(
          '<civitai-rating-badge slot="top-start" rating="pg"></civitai-rating-badge>',
          '<civitai-rating-badge slot="top-start" rating="pg"></civitai-rating-badge>' +
            '<civitai-badge slot="top-start" id="poi">POI</civitai-badge>'
        )
      )
    );
    const rating = card.querySelector('civitai-rating-badge')!.getBoundingClientRect();
    const poi = card.querySelector('#poi')!.getBoundingClientRect();
    expect(poi.left).toBeGreaterThanOrEqual(rating.right);
    // Badges of different heights are centred on each other, not top-aligned.
    const middle = (box: DOMRect): number => box.top + box.height / 2;
    expect(middle(poi)).toBeCloseTo(middle(rating), 0);
  });
});

describe('<civitai-reaction>', () => {
  const button = (el: CivitaiReaction): HTMLButtonElement =>
    el.shadowRoot!.querySelector('button')!;

  it('abbreviates its count', async () => {
    const card = await settled(mount());
    const like = card.querySelector<CivitaiReaction>('civitai-reaction')!;
    expect(button(like).textContent!.replace(/\s+/g, '')).toContain('13.1k');
  });

  it('shows an existing reaction as pressed', async () => {
    const card = await settled(mount());
    const [like, heart] = [...card.querySelectorAll<CivitaiReaction>('civitai-reaction')];
    expect(button(like!).getAttribute('aria-pressed')).toBe('false');
    expect(button(heart!).getAttribute('aria-pressed')).toBe('true');
  });

  it('counts up when reacted and back down when taken away', async () => {
    const card = await settled(mount());
    const like = card.querySelector<CivitaiReaction>('civitai-reaction')!;
    const seen: ReactionDetail[] = [];
    like.addEventListener('react', (e) => seen.push((e as CustomEvent<ReactionDetail>).detail));

    button(like).click();
    await like.updateComplete;
    expect(like.count).toBe(13101);
    expect(button(like).getAttribute('aria-pressed')).toBe('true');

    button(like).click();
    await like.updateComplete;
    expect(like.count).toBe(13100);

    expect(seen.map((d) => d.reacted)).toEqual([true, false]);
  });

  it('never counts below zero', async () => {
    scope?.remove();
    scope = document.createElement('div');
    scope.innerHTML = '<civitai-reaction emoji="x" count="0" reacted></civitai-reaction>';
    document.body.append(scope);
    const el = scope.firstElementChild as CivitaiReaction;
    await el.updateComplete;

    button(el).click();
    await el.updateComplete;
    expect(el.count).toBe(0);
  });

  /** One bare reaction element, rendered and settled. */
  const single = async (markup: string): Promise<CivitaiReaction> => {
    scope?.remove();
    scope = document.createElement('div');
    scope.innerHTML = markup;
    document.body.append(scope);
    const el = scope.firstElementChild as CivitaiReaction;
    await el.updateComplete;
    return el;
  };

  const details = (el: CivitaiReaction): ReactionDetail[] => {
    const seen: ReactionDetail[] = [];
    el.addEventListener('react', (e) => seen.push((e as CustomEvent<ReactionDetail>).detail));
    return seen;
  };

  it('carries its `reaction` in the event detail', async () => {
    const el = await single('<civitai-reaction emoji="&#10084;" reaction="Heart" count="2"></civitai-reaction>');
    const seen = details(el);

    button(el).click();
    await el.updateComplete;
    button(el).click();
    await el.updateComplete;

    expect(seen).toEqual([
      { emoji: '❤', reacted: true, count: 3, reaction: 'Heart' },
      { emoji: '❤', reacted: false, count: 2, reaction: 'Heart' },
    ]);
  });

  it('dispatches exactly the old detail when it has no `reaction`', async () => {
    const el = await single('<civitai-reaction emoji="&#128077;" count="2"></civitai-reaction>');
    const seen = details(el);

    button(el).click();
    await el.updateComplete;

    // The KEY SET is the contract: a consumer spreading or serialising the
    // detail must see no new field.
    expect(seen).toHaveLength(1);
    expect(Object.keys(seen[0]!).sort()).toEqual(['count', 'emoji', 'reacted']);
    expect(seen[0]).toEqual({ emoji: '👍', reacted: true, count: 3 });
  });

  it('passes any non-empty `reaction` string through unjudged', async () => {
    // The element names no reaction set; which reactions exist is the host's
    // business. A value outside civitai.com's four still reaches the handler.
    const el = await single('<civitai-reaction emoji="x" reaction="Dislike" count="1"></civitai-reaction>');
    const seen = details(el);

    button(el).click();
    await el.updateComplete;

    expect(seen).toEqual([{ emoji: 'x', reacted: true, count: 2, reaction: 'Dislike' }]);
  });

  it('treats an EMPTY `reaction` as absent: the old detail exactly', async () => {
    const el = await single('<civitai-reaction emoji="x" reaction="" count="1"></civitai-reaction>');
    const seen = details(el);

    button(el).click();
    await el.updateComplete;

    expect(seen).toHaveLength(1);
    expect(Object.keys(seen[0]!).sort()).toEqual(['count', 'emoji', 'reacted']);
  });

  it('carries a `reaction` set as a property', async () => {
    const el = await single('<civitai-reaction emoji="x" count="0"></civitai-reaction>');
    el.reaction = 'Laugh';
    await el.updateComplete;
    expect(el.getAttribute('reaction')).toBe('Laugh');
    const seen = details(el);

    button(el).click();
    await el.updateComplete;

    expect(seen[0]?.reaction).toBe('Laugh');
  });

  it('names itself by `reaction` when it has no `label`, and by `label` over both', async () => {
    const named = await single('<civitai-reaction emoji="&#128514;" reaction="Laugh"></civitai-reaction>');
    expect(button(named).getAttribute('aria-label')).toBe('Laugh');

    const labelled = await single(
      '<civitai-reaction emoji="&#128514;" reaction="Laugh" label="Funny"></civitai-reaction>',
    );
    expect(button(labelled).getAttribute('aria-label')).toBe('Funny');

    // No reaction: the old fallback to the emoji, unchanged.
    const bare = await single('<civitai-reaction emoji="&#128514;"></civitai-reaction>');
    expect(button(bare).getAttribute('aria-label')).toBe('😂');
  });

  it('can be reverted by setting the properties back after a failed write', async () => {
    const el = await single('<civitai-reaction emoji="x" reaction="Like" count="5"></civitai-reaction>');
    el.addEventListener('react', (e) => {
      const { reacted, count } = (e as CustomEvent<ReactionDetail>).detail;
      // What a host does when the write fails: undo the optimistic flip.
      queueMicrotask(() => {
        el.reacted = !reacted;
        el.count = count + (reacted ? -1 : 1);
      });
    });

    button(el).click();
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;

    expect(el.reacted).toBe(false);
    expect(el.count).toBe(5);
    expect(button(el).getAttribute('aria-pressed')).toBe('false');
  });

  it('refuses to react when disabled', async () => {
    scope?.remove();
    scope = document.createElement('div');
    scope.innerHTML = '<civitai-reaction emoji="x" count="4" disabled></civitai-reaction>';
    document.body.append(scope);
    const el = scope.firstElementChild as CivitaiReaction;
    await el.updateComplete;
    const seen: ReactionDetail[] = [];
    el.addEventListener('react', (e) => seen.push((e as CustomEvent<ReactionDetail>).detail));

    button(el).click();
    await el.updateComplete;

    expect(seen).toEqual([]);
    expect(el.count).toBe(4);
  });
});
