import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CivitaiAvatar } from '../src/elements/civitai-avatar.js';
import type { CivitaiTag, TagVoteDetail } from '../src/elements/civitai-tag.js';
import '../src/elements/register-site.js';

let scope: HTMLElement | undefined;

function mount<T extends HTMLElement>(markup: string, theme: 'light' | 'dark' = 'dark'): T {
  scope?.remove();
  scope = document.createElement('div');
  scope.setAttribute('data-theme', theme);
  scope.innerHTML = markup;
  document.body.append(scope);
  return scope.firstElementChild as T;
}

const rendered = async <T extends HTMLElement & { updateComplete: Promise<boolean> }>(
  el: T
): Promise<T> => {
  await el.updateComplete;
  return el;
};

const PIXEL =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const CORRUPT = 'data:image/gif;base64,Y29ycnVwdA==';

/**
 * Waits for the <img> to appear AND THEN go. Waiting only for it to be absent
 * passes before the first render, which is a test of nothing.
 */
async function broken(el: CivitaiAvatar): Promise<CivitaiAvatar> {
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector('img'), 'the image should be attempted').not.toBeNull();
  await vi.waitFor(() => {
    expect(el.shadowRoot!.querySelector('img')).toBeNull();
  });
  return el;
}

afterEach(() => {
  scope?.remove();
  scope = undefined;
});

describe('<civitai-rating-badge>', () => {
  it.each([
    ['g', 'G'],
    ['pg', 'PG'],
    ['pg13', 'PG-13'],
    ['r', 'R'],
    ['x', 'X'],
  ])('shows %s as the label civitai.com already uses: %s', async (rating, label) => {
    const el = await rendered(mount(`<civitai-rating-badge rating="${rating}"></civitai-rating-badge>`));
    expect(el.shadowRoot!.textContent!.trim()).toBe(label);
  });

  it('shows an unknown rating verbatim rather than inventing a spelling', async () => {
    const el = await rendered(mount('<civitai-rating-badge rating="nc17"></civitai-rating-badge>'));
    expect(el.shadowRoot!.textContent!.trim()).toBe('nc17');
  });

  it('escalates colour with the ladder', async () => {
    const bg = async (rating: string): Promise<string> => {
      const el = await rendered(mount(`<civitai-rating-badge rating="${rating}"></civitai-rating-badge>`));
      return getComputedStyle(el).backgroundColor;
    };
    const [pg, pg13, r, x] = [await bg('pg'), await bg('pg13'), await bg('r'), await bg('x')];
    expect(pg13).not.toBe(pg);
    expect(r).not.toBe(pg13);
    expect(x).toBe(r);
  });
});

describe('<civitai-avatar>', () => {
  it('shows the image, named for the person', async () => {
    const el = await rendered(
      mount<CivitaiAvatar>(`<civitai-avatar src="${PIXEL}" name="Jane Doe"></civitai-avatar>`)
    );
    const img = el.shadowRoot!.querySelector('img')!;
    expect(img.alt).toBe('Jane Doe');
  });

  it('falls back to initials with no image', async () => {
    const el = await rendered(mount<CivitaiAvatar>('<civitai-avatar name="Jane Q Doe"></civitai-avatar>'));
    expect(el.shadowRoot!.querySelector('img')).toBeNull();
    expect(el.shadowRoot!.textContent!.trim()).toBe('JD');
  });

  it('falls back to initials when the image fails', async () => {
    const el = await broken(mount<CivitaiAvatar>(`<civitai-avatar name="Koen" src="${CORRUPT}"></civitai-avatar>`));
    expect(el.shadowRoot!.textContent!.trim()).toBe('K');
  });

  it('retries a new src after a failure', async () => {
    const el = await broken(mount<CivitaiAvatar>(`<civitai-avatar name="Koen" src="${CORRUPT}"></civitai-avatar>`));
    el.src = PIXEL;
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('img')).not.toBeNull();
  });

  it('paints a cosmetic frame behind the image', async () => {
    const plain = await rendered(mount<CivitaiAvatar>('<civitai-avatar name="K"></civitai-avatar>'));
    const plainFrame = getComputedStyle(plain.shadowRoot!.querySelector('.frame')!);
    const decorated = await rendered(
      mount<CivitaiAvatar>('<civitai-avatar name="K" frame="rgb(255, 0, 0)"></civitai-avatar>')
    );
    const frame = getComputedStyle(decorated.shadowRoot!.querySelector('.frame')!);
    expect(frame.backgroundColor).toBe('rgb(255, 0, 0)');
    expect(frame.paddingTop).not.toBe(plainFrame.paddingTop);
  });
});

describe('<civitai-tag>', () => {
  const buttons = (el: CivitaiTag): { up: HTMLButtonElement; down: HTMLButtonElement } => ({
    up: el.shadowRoot!.querySelector('button.up')!,
    down: el.shadowRoot!.querySelector('button.down')!,
  });

  it('reports an upvote by name, and shows it pressed', async () => {
    const el = await rendered(mount<CivitaiTag>('<civitai-tag name="wolf"></civitai-tag>'));
    const seen: TagVoteDetail[] = [];
    el.addEventListener('vote', (e) => seen.push((e as CustomEvent<TagVoteDetail>).detail));

    buttons(el).up.click();
    await el.updateComplete;

    expect(seen).toEqual([{ name: 'wolf', vote: 1 }]);
    expect(el.vote).toBe(1);
    expect(buttons(el).up.getAttribute('aria-pressed')).toBe('true');
  });

  it('clears the vote when the same side is pressed again', async () => {
    const el = await rendered(mount<CivitaiTag>('<civitai-tag name="wolf" vote="1"></civitai-tag>'));
    const seen: TagVoteDetail[] = [];
    el.addEventListener('vote', (e) => seen.push((e as CustomEvent<TagVoteDetail>).detail));

    buttons(el).up.click();
    await el.updateComplete;

    expect(seen).toEqual([{ name: 'wolf', vote: 0 }]);
    expect(buttons(el).up.getAttribute('aria-pressed')).toBe('false');
  });

  it('swings straight from up to down', async () => {
    const el = await rendered(mount<CivitaiTag>('<civitai-tag name="wolf" vote="1"></civitai-tag>'));
    const seen: TagVoteDetail[] = [];
    el.addEventListener('vote', (e) => seen.push((e as CustomEvent<TagVoteDetail>).detail));

    buttons(el).down.click();
    await el.updateComplete;

    expect(seen).toEqual([{ name: 'wolf', vote: -1 }]);
    expect(buttons(el).down.getAttribute('aria-pressed')).toBe('true');
  });

  it('escapes an enclosing shadow root, which is where a host would listen', async () => {
    // A tag inside someone else's shadow root: a `composed: false` event stops
    // at that boundary and the page never learns about the vote.
    const outer = document.createElement('div');
    const root = outer.attachShadow({ mode: 'open' });
    root.innerHTML = '<civitai-tag name="wolf"></civitai-tag>';
    scope = document.createElement('div');
    scope.append(outer);
    document.body.append(scope);

    const el = await rendered(root.querySelector('civitai-tag') as CivitaiTag);
    const seen: TagVoteDetail[] = [];
    const onVote = (e: Event) => seen.push((e as CustomEvent<TagVoteDetail>).detail);
    document.addEventListener('vote', onVote);
    try {
      buttons(el).up.click();
      expect(seen).toEqual([{ name: 'wolf', vote: 1 }]);
    } finally {
      document.removeEventListener('vote', onVote);
    }
  });

  it('drops the controls when read-only, keeping the label', async () => {
    const el = await rendered(mount<CivitaiTag>('<civitai-tag name="wolf" readonly></civitai-tag>'));
    expect(el.shadowRoot!.querySelector('button')).toBeNull();
    expect(el.shadowRoot!.textContent).toContain('wolf');
  });

  it('keeps its label when it carries a slotted menu', async () => {
    // Formatting markup across lines slots whitespace text nodes, which suppress
    // a <slot> fallback. `textContent` still reports the fallback, so the only
    // honest check is the RENDERED box.
    scope?.remove();
    scope = document.createElement('div');
    scope.innerHTML =
      '<civitai-tag id="bare" name="moderated content"></civitai-tag>' +
      `<civitai-tag id="menued" name="moderated content">
         <span slot="menu">x</span>
       </civitai-tag>`;
    document.body.append(scope);

    const bare = scope.querySelector<CivitaiTag>('#bare')!;
    const menued = scope.querySelector<CivitaiTag>('#menued')!;
    await Promise.all([bare.updateComplete, menued.updateComplete]);

    const width = (el: CivitaiTag): number =>
      el.shadowRoot!.querySelector('[part="label"]')!.getBoundingClientRect().width;
    expect(width(menued)).toBeGreaterThan(0);
    expect(width(menued)).toBeCloseTo(width(bare), 0);
  });

  it('leaves the confidence bar off when nothing is known', async () => {
    const el = await rendered(mount<CivitaiTag>('<civitai-tag name="wolf"></civitai-tag>'));
    expect(el.shadowRoot!.querySelector('.fill')).toBeNull();
  });

  it.each([
    [0.75, 0.75],
    [0, 0],
    [1, 1],
    [1.7, 1],
    [-0.5, 0],
  ])('fills %s of the pill as confidence, clamped', async (confidence, expected) => {
    const el = await rendered(
      mount<CivitaiTag>(`<civitai-tag name="wolf" confidence="${confidence}"></civitai-tag>`)
    );
    const fill = el.shadowRoot!.querySelector('.fill')!.getBoundingClientRect();
    expect(fill.width / el.getBoundingClientRect().width).toBeCloseTo(expected, 1);
  });

  it('stays clickable through the bar', async () => {
    const el = await rendered(
      mount<CivitaiTag>('<civitai-tag name="wolf" confidence="1"></civitai-tag>')
    );
    const seen: TagVoteDetail[] = [];
    el.addEventListener('vote', (e) => seen.push((e as CustomEvent<TagVoteDetail>).detail));

    // `document.elementFromPoint` retargets to the host and so cannot tell the
    // bar from the button; the shadow root's own version does not retarget.
    const up = buttons(el).up.getBoundingClientRect();
    const hit = el.shadowRoot!.elementFromPoint(up.left + up.width / 2, up.top + up.height / 2);
    expect(buttons(el).up.contains(hit), 'the bar must not swallow the pointer').toBe(true);
    buttons(el).up.click();

    expect(seen).toEqual([{ name: 'wolf', vote: 1 }]);
  });

  it('tints the bar with the rating, like the border', async () => {
    const neutral = await rendered(
      mount<CivitaiTag>('<civitai-tag name="a" confidence="1"></civitai-tag>')
    );
    const neutralFill = getComputedStyle(neutral.shadowRoot!.querySelector('.fill')!).backgroundColor;
    const mature = await rendered(
      mount<CivitaiTag>('<civitai-tag name="a" confidence="1" rating="r"></civitai-tag>')
    );
    const matureFill = getComputedStyle(mature.shadowRoot!.querySelector('.fill')!).backgroundColor;
    expect(matureFill).not.toBe(neutralFill);
  });

  it('shows the score only when asked', async () => {
    const quiet = await rendered(mount<CivitaiTag>('<civitai-tag name="wolf" score="42"></civitai-tag>'));
    expect(quiet.shadowRoot!.querySelector('.score')).toBeNull();
    const loud = await rendered(
      mount<CivitaiTag>('<civitai-tag name="wolf" score="42" show-score></civitai-tag>')
    );
    expect(loud.shadowRoot!.querySelector('.score')!.textContent).toBe('42');
  });
});
