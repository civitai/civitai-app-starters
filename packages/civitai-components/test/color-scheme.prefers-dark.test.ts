/**
 * Runs in a context the browser reports as `prefers-color-scheme: dark`, which
 * is the only way to observe the token stylesheet's preference block at all.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { darkTokens, injectTokens, tokens } from '@civitai/theme';

import '../src/elements/civitai-card.define.js';

const root = document.documentElement;

// Colour tokens are `@property`-registered, so a computed value comes back as
// `rgb(...)`; both sides go through the UA to be comparable.
const paint = (el: Element, value: string): string => {
  const probe = document.createElement('div');
  probe.style.color = value;
  el.append(probe);
  const painted = getComputedStyle(probe).color;
  probe.remove();
  return painted;
};
const bodyColor = (el: Element): string => paint(el, 'var(--civitai-color-body)');

let scope: HTMLElement | undefined;

afterEach(() => {
  scope?.remove();
  scope = undefined;
  root.removeAttribute('data-theme');
});

describe('prefers-color-scheme: dark', () => {
  it('is what the browser actually reports', () => {
    expect(matchMedia('(prefers-color-scheme: dark)').matches).toBe(true);
  });

  it('resolves dark tokens when nothing declares a theme', () => {
    injectTokens();
    expect(bodyColor(root)).toBe(paint(root, darkTokens.colorBody));
    expect(getComputedStyle(root).colorScheme).toBe('dark');
  });

  it('yields to an explicit light theme on the root', () => {
    injectTokens();
    root.setAttribute('data-theme', 'light');
    expect(bodyColor(root)).toBe(paint(root, tokens.colorBody));
    expect(getComputedStyle(root).colorScheme).toBe('light');
  });

  it('yields to a light theme on an ancestor below the root', () => {
    injectTokens();
    scope = document.createElement('div');
    scope.setAttribute('data-theme', 'light');
    document.body.append(scope);
    expect(bodyColor(scope)).toBe(paint(scope, tokens.colorBody));
  });

  it('reaches a shadow root with no theme attribute in the tree', async () => {
    injectTokens();
    scope = document.createElement('div');
    scope.innerHTML = '<civitai-card>x</civitai-card>';
    document.body.append(scope);

    const card = scope.firstElementChild as HTMLElement & { updateComplete: Promise<boolean> };
    await card.updateComplete;
    // A plain card's hairline is width-zero in dark; `with-border` is explicit
    // and stays 1px, so it would prove nothing here.
    expect(getComputedStyle(card).borderTopWidth).toBe('0px');
  });
});
