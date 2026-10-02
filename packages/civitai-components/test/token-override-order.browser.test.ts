/**
 * THE BRAND-OVERRIDE CONTRACT — which ways of recolouring a `--civitai-*` token
 * actually work, and which depend on stylesheet ORDER.
 *
 * 🔴 WHY THIS EXISTS, AND WHY IT ASSERTS A TRAP RATHER THAN ONLY A HAPPY PATH.
 * `@civitai/theme`'s token sheet is the one piece of the design system with NO
 * cascade layer: its `:root` and `[data-theme='…']` blocks are unlayered at
 * specificity 0-1-0. So an app's own `:root { --civitai-color-primary: … }` TIES
 * with them and the winner is decided by stylesheet order — and the order that
 * LOSES is the one the framework itself produces, because
 * `@civitai/blocks-react`'s `useBlocksStyles()` injects the token sheet from a
 * `useEffect`, i.e. after an app's bundler-injected CSS is already in `<head>`.
 * An author who brands their block the obvious way gets no error and civitai
 * blue.
 *
 * Every route documented in `MARKUP.md` ("Cascade / overriding") and in the two
 * READMEs is pinned here, in BOTH orders, so the prose cannot drift from the
 * behaviour: the routes the docs recommend are the ones measured order-IMMUNE,
 * and the route the docs warn against is measured order-dependent.
 *
 * 🔴 IF YOU LAYER THE TOKEN SHEET, THIS FILE GOES RED — deliberately. Wrapping
 * the tokens in `@layer civitai.tokens` would make every unlayered app override
 * win regardless of order, which retires the trap and falsifies the two
 * `order-DEPENDENT` cases below. That is the forcing function: the cascade
 * change and the doc correction have to land together, because this test is the
 * seam between them.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { darkTokens, injectTokens } from '@civitai/theme';

const root = document.documentElement;

/** Chosen so it can collide with no civitai token value — the fixture control. */
const BRAND_HEX = '#ff00ff';
const BRAND = 'rgb(255, 0, 255)';

/**
 * Colour tokens are `@property`-registered, so a computed value comes back as
 * `rgb(...)`; both sides go through the UA to be comparable.
 */
const paint = (el: Element, value: string): string => {
  const probe = document.createElement('div');
  probe.style.color = value;
  el.append(probe);
  const painted = getComputedStyle(probe).color;
  probe.remove();
  return painted;
};
const primary = (el: Element): string => paint(el, 'var(--civitai-color-primary)');

let appSheet: HTMLStyleElement | undefined;
let scope: HTMLElement | undefined;

/** An app's own CSS, as a bundler injects it: a `<style>` appended to `<head>`. */
const appCss = (css: string): HTMLStyleElement => {
  appSheet = document.createElement('style');
  appSheet.textContent = css;
  document.head.append(appSheet);
  return appSheet;
};

/** `injectTokens()` is idempotent on a marker attribute, so the sheet has to go
 *  before the order can be re-staged. */
const dropTokenSheet = (): void => {
  document.head.querySelectorAll('style[data-civitai-theme]').forEach((s) => s.remove());
};

/** A branded element BELOW the root — the scope an app would actually brand. */
const brandedScope = (attrs: { className?: string; style?: string }): HTMLElement => {
  scope = document.createElement('div');
  if (attrs.className) scope.className = attrs.className;
  if (attrs.style) scope.setAttribute('style', attrs.style);
  document.body.append(scope);
  return scope;
};

beforeEach(() => {
  dropTokenSheet();
});

afterEach(() => {
  appSheet?.remove();
  appSheet = undefined;
  scope?.remove();
  scope = undefined;
  root.removeAttribute('data-theme');
  dropTokenSheet();
});

describe('token override: fixture controls', () => {
  it('an unbranded token does NOT already equal the brand colour', () => {
    // Without this, every "brand wins" assertion below could pass for free.
    injectTokens();
    expect(primary(root)).not.toBe(BRAND);
  });

  it('an unbranded token resolves to the civitai DARK value under the host stamp', () => {
    // The positive control: names the real value the trap resolves to, so a
    // failure below says "stayed civitai blue" rather than merely "not brand".
    injectTokens();
    root.setAttribute('data-theme', 'dark');
    expect(primary(root)).toBe(paint(root, darkTokens.colorPrimary));
  });
});

describe('token override at :root is ORDER-DEPENDENT', () => {
  it('wins when the app sheet is injected AFTER the token sheet', () => {
    injectTokens();
    appCss(`:root { --civitai-color-primary: ${BRAND_HEX}; }`);
    root.setAttribute('data-theme', 'dark');
    expect(primary(root)).toBe(BRAND);
  });

  it('LOSES when the token sheet is injected after — the useBlocksStyles order', () => {
    appCss(`:root { --civitai-color-primary: ${BRAND_HEX}; }`);
    injectTokens();
    root.setAttribute('data-theme', 'dark');
    // Not merely "not brand": it stays civitai's own value, silently.
    expect(primary(root)).toBe(paint(root, darkTokens.colorPrimary));
  });

  it('LOSES in that order even with no data-theme on the page', () => {
    // So the host stamp is NOT the cause — this is purely stylesheet order
    // between two unlayered declarations of equal specificity.
    appCss(`:root { --civitai-color-primary: ${BRAND_HEX}; }`);
    injectTokens();
    expect(primary(root)).toBe(paint(root, darkTokens.colorPrimary));
  });
});

describe('these routes are ORDER-IMMUNE — what the docs recommend', () => {
  it.each([
    ['tokens first', true],
    ['tokens last', false],
  ])('a class on a nearer element wins (%s)', (_label, tokensFirst) => {
    if (tokensFirst) injectTokens();
    appCss(`.brand { --civitai-color-primary: ${BRAND_HEX}; }`);
    if (!tokensFirst) injectTokens();
    root.setAttribute('data-theme', 'dark');
    expect(primary(brandedScope({ className: 'brand' }))).toBe(BRAND);
  });

  it.each([
    ['tokens first', true],
    ['tokens last', false],
  ])('an inline style on a nearer element wins (%s)', (_label, tokensFirst) => {
    if (tokensFirst) injectTokens();
    appCss(`/* the app sheet exists but declares no token */`);
    if (!tokensFirst) injectTokens();
    root.setAttribute('data-theme', 'dark');
    expect(primary(brandedScope({ style: `--civitai-color-primary: ${BRAND_HEX}` }))).toBe(BRAND);
  });

  it.each([
    ['tokens first', true],
    ['tokens last', false],
  ])('a specificity notch (:root:root) wins at the root itself (%s)', (_label, tokensFirst) => {
    // The escape hatch for an app that genuinely wants a document-wide rebrand
    // and cannot scope it: one extra `:root` outranks the theme's 0-1-0 blocks,
    // so order stops mattering.
    if (tokensFirst) injectTokens();
    appCss(`:root:root { --civitai-color-primary: ${BRAND_HEX}; }`);
    if (!tokensFirst) injectTokens();
    root.setAttribute('data-theme', 'dark');
    expect(primary(root)).toBe(BRAND);
  });
});

describe('a scoped brand token reaches where components actually paint', () => {
  it('crosses the shadow boundary into a custom element', async () => {
    injectTokens();
    await import('../src/elements/civitai-button.define.js');
    root.setAttribute('data-theme', 'dark');
    const host = brandedScope({ style: `--civitai-color-primary: ${BRAND_HEX}` });
    host.innerHTML = '<civitai-button variant="filled">x</civitai-button>';
    const btn = host.firstElementChild as HTMLElement & { updateComplete: Promise<boolean> };
    await btn.updateComplete;
    const painted = btn.shadowRoot?.querySelector('button') ?? btn;
    expect(getComputedStyle(painted).backgroundColor).toBe(BRAND);
  });
});
