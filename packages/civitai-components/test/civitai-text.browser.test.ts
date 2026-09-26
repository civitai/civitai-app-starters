/**
 * `<civitai-text>` — the typography primitive.
 *
 * The claim worth testing here is not that a font-size lands (the parity suite
 * covers every size/weight/colour against the attribute markup, in both themes)
 * but that the SEMANTICS are real: `as="h2"` must render an actual `<h2>`, not a
 * styled box wearing `role="heading"`. Two assertions carry that, and they fail
 * for different reasons — the structural one reads the tag, the axe one proves a
 * heading rendered INSIDE A SHADOW ROOT still reaches the accessibility tree
 * with its level intact, which is the part a structural check cannot see.
 */
import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';

import { injectStyles } from '../src/index.js';
import type { CivitaiText, TextAs } from '../src/elements/civitai-text.js';
import '../src/elements/register.js';

let scope: HTMLElement | undefined;

async function mount(markup: string): Promise<HTMLElement> {
  scope?.remove();
  injectStyles();
  scope = document.createElement('div');
  scope.setAttribute('data-theme', 'light');
  scope.innerHTML = markup;
  document.body.append(scope);
  await Promise.all(
    [...scope.querySelectorAll('*')]
      .filter((el): el is HTMLElement & { updateComplete: Promise<boolean> } =>
        'updateComplete' in el
      )
      .map((el) => el.updateComplete)
  );
  return scope;
}

/** The element the host actually rendered, whatever it is. */
const rendered = (host: CivitaiText): Element =>
  host.shadowRoot!.querySelector('[part="text"]')!;

afterEach(() => {
  scope?.remove();
  scope = undefined;
});

const SEMANTIC: readonly TextAs[] = ['p', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'];

describe('<civitai-text> semantics', () => {
  it.each(SEMANTIC)('as="%s" renders that element, not a styled box', async (as) => {
    await mount(`<civitai-text as="${as}">Copy</civitai-text>`);
    const host = scope!.querySelector<CivitaiText>('civitai-text')!;

    expect(rendered(host).tagName.toLowerCase()).toBe(as);
  });

  it('defaults to a paragraph, so bare markup is prose', async () => {
    await mount('<civitai-text>Copy</civitai-text>');
    const host = scope!.querySelector<CivitaiText>('civitai-text')!;

    expect(host.as).toBe('p');
    expect(rendered(host).tagName).toBe('P');
  });

  it('falls back to a paragraph rather than rendering nothing on a bad `as`', async () => {
    // A typo in one attribute must not silently delete the copy on the page.
    await mount('<civitai-text as="marquee">Copy</civitai-text>');
    const host = scope!.querySelector<CivitaiText>('civitai-text')!;

    expect(rendered(host).tagName).toBe('P');
    expect(host.textContent?.trim()).toBe('Copy');
  });

  it('slots its content instead of reading it, per the authoring rules', async () => {
    await mount('<civitai-text as="h2">Head <em>up</em></civitai-text>');
    const host = scope!.querySelector<CivitaiText>('civitai-text')!;
    const slot = rendered(host).querySelector('slot')!;

    // The consumer's own nodes stay in the consumer's light DOM, which is what
    // makes `civitai-text h2 em { … }` their business and not ours.
    expect(slot.assignedNodes({ flatten: true }).map((n) => n.nodeName)).toContain('EM');
  });

  it('keeps an inline box for inline text and a block box for everything else', async () => {
    await mount('<civitai-text as="span">a</civitai-text><civitai-text as="p">b</civitai-text>');
    const [inline, block] = [...scope!.children] as [CivitaiText, CivitaiText];

    expect(getComputedStyle(inline).display).toBe('inline');
    expect(getComputedStyle(block).display).toBe('block');
  });

  it('sizes the heading the consumer asked for, not the one the tag implies', async () => {
    // The whole point of splitting semantics from scale: an <h2> can be small.
    await mount(
      '<civitai-text as="h2" size="xs">caption</civitai-text>' +
        '<civitai-text as="h2" size="xl">headline</civitai-text>'
    );
    const [small, large] = [...scope!.children] as [CivitaiText, CivitaiText];

    expect(getComputedStyle(rendered(small) as HTMLElement).fontSize).toBe('12px');
    expect(getComputedStyle(rendered(large) as HTMLElement).fontSize).toBe('20px');
    // And the UA's own 1.5em-bold h2 is gone in both, or the scale would be
    // multiplied by whichever tag the consumer happened to pick.
    expect(getComputedStyle(rendered(small) as HTMLElement).fontWeight).toBe('400');
    expect(getComputedStyle(rendered(small) as HTMLElement).marginTop).toBe('0px');
  });

  /*
   * THE HEADLINE HALF OF THE RAMP, pinned as an EXPLICIT TABLE rather than a
   * loop over a list the implementation also owns.
   *
   * This is the assertion the component's whole justification rests on: it was
   * added to close a headline gap, and with a ramp topping out at 20px it did
   * not close one — 20px is `ci-fs-5`, the second-SMALLEST of six heading steps,
   * so `<civitai-text as="h1" size="xl">` rendered a semantic h1 at half the
   * size of `ci-fs-1`. These four steps are what make the claim true, and the
   * right-hand comments are why there is one scale and not two.
   *
   * The literals are written out on purpose. Deriving them from `TextSize`, or
   * from a px-per-step formula, would make the test agree with the element by
   * construction — the ramp is a CONTRACT with `ci-fs-*`, so its values have to
   * be stated independently of the code that implements them.
   */
  const RAMP: ReadonlyArray<readonly [string, string]> = [
    ['2xl', '24px'], // = ci-fs-4
    ['3xl', '28px'], // = ci-fs-3
    ['4xl', '32px'], // = ci-fs-2
    ['5xl', '40px'], // = ci-fs-1
  ];

  it.each(RAMP)(
    'size="%s" is %s, the value ci-fs-* already ships — one scale, not two',
    async (size, px) => {
      await mount(`<civitai-text as="h1" size="${size}">Headline</civitai-text>`);
      const host = scope!.querySelector<CivitaiText>('civitai-text')!;
      const style = getComputedStyle(rendered(host) as HTMLElement);

      expect(
        style.fontSize,
        `size="${size}" must compute to ${px}: the heading ramp is value-identical ` +
          'to the ci-fs-* utilities, and a divergence here means the package ships ' +
          'two type scales that disagree'
      ).toBe(px);
      // Everything from xl up tightens its leading; a 24px-plus heading leaded
      // at 1.5 reads as loose. Asserted as a ratio of the size, so the check
      // does not silently pass on a line-height that failed to apply.
      expect(style.lineHeight, `size="${size}" must lead at 1.25`).toBe(
        `${Number.parseFloat(px) * 1.25}px`
      );
    }
  );

  it('has no colour attribute — colour is a utility, and it inherits in', async () => {
    /*
     * The dropped axis, pinned as a RELATIONSHIP rather than as the absence of a
     * word: `color` is not a property of this element AND the mechanism that
     * replaces it actually works through the shadow boundary. The second half is
     * the load-bearing one — "there is no color attribute" alone would stay green
     * if the utility route were broken too, which is the state that would make
     * dropping the axis a regression rather than a simplification.
     */
    await mount(
      '<civitai-text as="p" style="color: rgb(1, 2, 3)">inherited</civitai-text>'
    );
    const host = scope!.querySelector<CivitaiText>('civitai-text')!;

    // An EXACT SET, so this fails if the observed attributes grow (colour comes
    // back undocumented) or shrink (an axis is lost) — not a spelled check on
    // one word.
    expect(
      [...(host.constructor as typeof CivitaiText).observedAttributes].sort(),
      'civitai-text observes a different attribute set than the three documented ' +
        'axes. `color` in particular was dropped deliberately: ci-muted / ' +
        'ci-text-* already express every value it would have taken, and they ' +
        'reach this element by inheritance'
    ).toEqual(['as', 'size', 'weight']);
    // A colour set on the HOST reaches the element rendered in the shadow root,
    // which is exactly how a `ci-*` utility class on the host does it. Without
    // this, dropping the axis could have been a regression rather than a
    // simplification and the assertion above would not have noticed.
    expect(getComputedStyle(rendered(host) as HTMLElement).color).toBe('rgb(1, 2, 3)');
  });
});

/**
 * 🔴 THE ACCESSIBILITY ASSERTION, WITH ITS POSITIVE CONTROL.
 *
 * axe's `heading-order` rule only has anything to say about nodes it resolved AS
 * HEADINGS. So the RED arm is the load-bearing half: if the shadow-rendered
 * `<h1>`/`<h3>` were styled boxes — or if axe could not see into the shadow root
 * at all — there would be no heading sequence to be out of order and the rule
 * would report zero, indistinguishable from the clean arm. Watching it go red on
 * a skipped level is what proves the heading reached the accessibility tree with
 * its level. The green arm on its own would be vacuous.
 */
describe('<civitai-text> headings reach the accessibility tree', () => {
  const AXE_OPTIONS: axe.RunOptions = {
    // Narrowed to the one rule under test so an unrelated violation cannot make
    // the red arm pass for the wrong reason. `color-contrast` is off pack-wide
    // (it flags the upstream Mantine palette) and is not in scope here anyway.
    runOnly: { type: 'rule', values: ['heading-order'] },
    resultTypes: ['violations'],
  };

  it('POSITIVE CONTROL: a skipped level IS reported, so axe sees real headings', async () => {
    await mount(
      '<civitai-text as="h1">Title</civitai-text><civitai-text as="h3">Skipped</civitai-text>'
    );

    const { violations } = await axe.run(scope!, AXE_OPTIONS);
    expect(
      violations.map((v) => v.id),
      'axe found no heading sequence at all — the shadow-rendered headings are ' +
        'not reaching the accessibility tree, and the clean arm below proves nothing'
    ).toEqual(['heading-order']);
  });

  it('a correct sequence is clean', async () => {
    await mount(
      '<civitai-text as="h1">Title</civitai-text><civitai-text as="h2">Section</civitai-text>'
    );

    const { violations } = await axe.run(scope!, AXE_OPTIONS);
    expect(violations.map((v) => v.id)).toEqual([]);
  });
});
