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
import { utilitiesCss } from '../src/utilities.generated.js';
import type { CivitaiText, TextAs } from '../src/elements/civitai-text.js';
import '../src/elements/register.js';

import compatCss from '../dist/bootstrap-compat.css?raw';

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

const UTILITY_MARKER = 'data-civitai-text-test-utilities';

/**
 * `injectStyles()` ships the TOKENS and `components.css` — and nothing else.
 * `utilities.css` and `bootstrap-compat.css` are separate files a consumer links
 * separately, so the colour cases below have to load them or `ci-muted` is an
 * unknown class, every element in the fixture computes the same default colour,
 * and the whole block passes while testing nothing. The positive control inside
 * each case is what actually proves this ran.
 */
function injectUtilities(): void {
  if (document.querySelector(`style[${UTILITY_MARKER}]`)) return;
  for (const css of [utilitiesCss, compatCss]) {
    const style = document.createElement('style');
    style.setAttribute(UTILITY_MARKER, 'true');
    style.textContent = css;
    document.head.append(style);
  }
}

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

  /*
   * 🔴 THE FALLBACK'S ACTUAL HOLE, AND WHY `marquee` ALONE DID NOT FIND IT.
   *
   * The guard is `TEMPLATES[this.as] ?? TEMPLATES.p`. `marquee` is not a key of
   * `TEMPLATES` and not a key of anything up its prototype chain, so the lookup
   * is `undefined`, `??` fires, and a `<p>` renders. Every key BELOW is a key of
   * `Object.prototype`, so the lookup resolves to an inherited function, `??`
   * never fires, and the component calls something that is not a template
   * factory. That produced TWO distinct failures, neither of which a single
   * fixture value can pin:
   *
   *   RENDERS THE WRONG THING — `toString` / `constructor` resolve to functions
   *   that RETURN A VALUE, so Lit renders that value's string form
   *   (`[object Undefined]`, `[object Object]`) as the shadow root's only
   *   content. There is no `<slot>`, so the consumer's copy is not styled
   *   wrongly, it is GONE from the rendered page.
   *
   *   THROWS INSIDE LIT'S UPDATE — `valueOf` / `hasOwnProperty` /
   *   `isPrototypeOf` throw when called with `TEMPLATES` unbound from its
   *   arguments, and `__proto__` is not callable at all. The update rejects and
   *   the shadow root stays empty.
   *
   * `as` is a plain reflected attribute, so anything rendering a heading level
   * from data — a CMS field, a JSON manifest, a URL segment — can reach these.
   * The assertions below are the fallback's own stated purpose applied to them:
   * a `<p>`, a `<slot>`, and the copy still on the page.
   */
  const PROTOTYPE_KEYS = [
    'toString',
    'constructor',
    'valueOf',
    'hasOwnProperty',
    'isPrototypeOf',
    '__proto__',
  ] as const;

  it.each(PROTOTYPE_KEYS)(
    'as="%s" — an Object.prototype key — still falls back to <p> with the copy intact',
    async (as) => {
      let thrown: unknown;
      await mount(`<civitai-text as="${as}">Copy</civitai-text>`).catch((error: unknown) => {
        thrown = error;
      });
      const host = scope!.querySelector<CivitaiText>('civitai-text')!;
      const el = host.shadowRoot!.querySelector('[part="text"]');

      expect(
        thrown,
        `as="${as}" threw inside Lit's update. \`${as}\` is inherited from ` +
          'Object.prototype, so the `?? TEMPLATES.p` fallback never fired and ' +
          'render() called a non-template — an uncaught error on a page whose only ' +
          'mistake was a bad attribute value'
      ).toBeUndefined();
      expect(
        el?.tagName,
        `as="${as}" did not fall back to <p>: the lookup resolved an inherited ` +
          'Object.prototype member instead of missing, so the guard was bypassed'
      ).toBe('P');
      expect(
        el?.querySelector('slot'),
        `as="${as}" rendered no <slot>, which is the failure the fallback exists to ` +
          "prevent: the consumer's copy is silently deleted from the page rather " +
          'than merely styled wrongly'
      ).not.toBeNull();
      expect(
        el?.textContent,
        `as="${as}" put rendered content of its own inside [part="text"]; the ` +
          "element must project the consumer's nodes, never stringify a template " +
          'factory it resolved off the prototype chain'
      ).toBe('');
      expect(host.textContent?.trim()).toBe('Copy');
    }
  );

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

/**
 * 🔴 COLOUR ARRIVES BY INHERITANCE — THE ANCESTOR HALF, ON BOTH TRACKS.
 *
 * This is the claim four shipped surfaces make in the same words — `MARKUP.md`,
 * `src/components.css`, the element's own docblock and the changeset all say a
 * colour utility "on this element — **or on any ancestor**" reaches Text. It is
 * also the justification for Text having no colour axis at all, so if the
 * ancestor route does not work then dropping `data-color` rests on something
 * false.
 *
 * The existing `has no colour attribute` case above tests the ELEMENT half only,
 * with `style="color: …"` on the host. That half always worked. The ancestor half
 * did not: both tracks used to declare `color: var(--civitai-color-text)` on the
 * element itself, and a SPECIFIED value beats an INHERITED one no matter how far
 * up the utility sits or how specific its selector is. Measured before the fix,
 * `<div class="ci-muted">` dimmed a plain `<p>` and left both component tracks at
 * the undimmed token. `ci-text-center` on the same ancestor DID reach both, which
 * is why the gap read as impossible: colour was the one axis the component
 * re-specified.
 *
 * SHAPE OF THE ASSERTION — each case wraps a plain `<p>` in the same ancestor as
 * the two component tracks and requires all three to agree. That makes it a
 * RELATIONSHIP ("Text matches the element beside it") rather than a hard-coded
 * `rgb()` that a token change would falsify, and it holds in both themes. The
 * `not.toBe(baseline)` line is the positive control: without it, a utility sheet
 * that failed to load would make every element in the fixture agree at the page
 * default and the case would pass for exactly the wrong reason.
 *
 * WHAT THE FIX COSTS, pinned by the last case: `color: inherit` means Text no
 * longer paints `--civitai-color-text` itself, so on a page that sets no colour
 * anywhere it renders in the page's own colour rather than the token. That is the
 * price of the published promise, and it is what the two tracks must now do
 * IDENTICALLY.
 */
describe('<civitai-text> colour inherits from an ancestor, on both tracks', () => {
  /** `[data-testid]` inside the fixture, so the selectors do not encode layout. */
  const q = <T extends HTMLElement>(id: string): T =>
    scope!.querySelector<T>(`[data-testid="${id}"]`)!;

  const FIXTURE = (ancestor: string): string =>
    `<div ${ancestor}>` +
    '<p data-testid="oracle">plain element, no component</p>' +
    '<p data-testid="attr" data-civitai-ui="text">attribute track</p>' +
    '<civitai-text data-testid="element" as="p">element track</civitai-text>' +
    '</div>' +
    '<p data-testid="baseline" data-civitai-ui="text">no coloured ancestor</p>';

  /**
   * The three ancestors a consumer actually writes. `text-muted` is in here
   * because `ci-muted` aliases it (`src/utilities.spec.ts`) and a container-level
   * `text-muted` is the commonest idiom in Bootstrap there is — so dropping a
   * `<p data-civitai-ui="text">` into an existing Bootstrap page is the likeliest
   * way a consumer meets this at all.
   */
  const ANCESTORS: ReadonlyArray<readonly [string, string]> = [
    ['ci-muted', 'class="ci-muted"'],
    ['ci-text-error', 'class="ci-text-error"'],
    ['text-muted (the bootstrap alias)', 'class="text-muted"'],
    // What every starter in this repo already does: `[data-theme] { color: … }`
    // on the block's own root. Not a utility at all, and it has to work too, or
    // Text is the one element in a block that ignores the block's text colour.
    ['a plain `color` on a wrapper', 'style="color: rgb(9, 8, 7)"'],
  ];

  it.each(ANCESTORS)('an ancestor with %s colours both tracks', async (_label, ancestor) => {
    injectUtilities();
    await mount(FIXTURE(ancestor));

    const inherited = getComputedStyle(q('oracle')).color;
    const baseline = getComputedStyle(q('baseline')).color;

    expect(
      inherited,
      `the ancestor \`${ancestor}\` did not change the colour of a PLAIN <p>. The ` +
        'utility sheet is not loaded (or the class was renamed), so every assertion ' +
        'below would compare two identical default colours and pass without ' +
        'testing anything'
    ).not.toBe(baseline);

    expect(
      getComputedStyle(q('attr')).color,
      'ATTRIBUTE TRACK: MARKUP.md, components.css and the changeset all promise a ' +
        'colour utility "on this element — or on any ancestor" reaches Text. A ' +
        `<p data-civitai-ui="text"> inside \`${ancestor}\` did not take that ` +
        'colour, so that published claim is false and the dropped data-color axis ' +
        'is justified by a mechanism that does not work'
    ).toBe(inherited);

    const host = q<CivitaiText>('element');
    expect(
      getComputedStyle(host).color,
      `ELEMENT TRACK, host: <civitai-text> inside \`${ancestor}\` re-specified its ` +
        'own colour, so the ancestor never reached it. The host is the gate — the ' +
        'inner element is `color: inherit`, so it can only be as right as this'
    ).toBe(inherited);
    expect(
      getComputedStyle(rendered(host) as HTMLElement).color,
      `ELEMENT TRACK, shadow content: the element rendered inside ` +
        `<civitai-text>'s shadow root did not end up at the ancestor's colour, so ` +
        'the promise that a utility reaches shadow content through the boundary is ' +
        'false'
    ).toBe(inherited);
  });

  it('with no colour anywhere, both tracks fall through to the page — identically', async () => {
    /*
     * THE COST OF `color: inherit`, stated as a test rather than left implicit.
     * Neither track paints `--civitai-color-text` any more, so a bare Text takes
     * whatever the page gives it. Pinned as a relationship against a plain <p>
     * for the same reason as above, and as an equality BETWEEN the tracks because
     * the two laying out and computing identically is the one thing they may not
     * stop doing.
     */
    injectUtilities();
    await mount(FIXTURE(''));

    const page = getComputedStyle(q('oracle')).color;
    const attr = getComputedStyle(q('attr')).color;
    const host = q<CivitaiText>('element');

    expect(
      attr,
      'a <p data-civitai-ui="text"> with no coloured ancestor no longer matches a ' +
        'plain <p>: the attribute track has re-acquired a colour of its own, which ' +
        'is exactly what blocks the ancestor route'
    ).toBe(page);
    expect(
      getComputedStyle(rendered(host) as HTMLElement).color,
      'the element track diverged from the attribute track with no colour in play ' +
        'at all — the two tracks must compute identically'
    ).toBe(attr);
  });
});
