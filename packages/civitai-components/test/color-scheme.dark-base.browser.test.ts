/**
 * THE DARK-BASE CONTRACT, measured where it can actually fail: a real browser
 * reporting `prefers-color-scheme: light`.
 *
 * The `browser` project sets no `colorScheme`, so Chromium reports light — and
 * that is the whole point of putting these here rather than in the
 * `prefers-dark` project. Before the dark-base flip the stylesheet carried the
 * LIGHT palette on `:root` and reached dark only through
 * `@media (prefers-color-scheme: dark) { :root:not([data-theme]) { … } }`, so an
 * element with no `data-theme` above it followed the OS. Every assertion below
 * is red against that shape.
 *
 * 🔴 A dark-OS context CANNOT distinguish the two designs — it answers "dark"
 * either way — which is why `color-scheme.prefers-dark.test.ts` passes before
 * and after the flip and is not evidence for it. This file is the discriminator.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { darkTokens, injectTokens, tokens } from '@civitai/theme';

import '../src/elements/civitai-card.define.js';

const root = document.documentElement;

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
const bodyColor = (el: Element): string => paint(el, 'var(--civitai-color-body)');

let scope: HTMLElement | undefined;

afterEach(() => {
  scope?.remove();
  scope = undefined;
  root.removeAttribute('data-theme');
});

describe('dark base under a LIGHT OS', () => {
  it('is what the browser actually reports — the fixture is not wired to nothing', () => {
    // The negative control for every assertion below: if this ever reports
    // dark, the file has stopped testing the thing it exists for and the
    // greens underneath mean nothing.
    expect(matchMedia('(prefers-color-scheme: dark)').matches).toBe(false);
    expect(matchMedia('(prefers-color-scheme: light)').matches).toBe(true);
  });

  it('resolves DARK tokens when nothing declares a theme', () => {
    injectTokens();
    expect(bodyColor(root)).toBe(paint(root, darkTokens.colorBody));
    expect(getComputedStyle(root).colorScheme).toBe('dark');
  });

  it('does not resolve the light palette by default', () => {
    // Stated separately and positively: `darkTokens.colorBody` and
    // `tokens.colorBody` are different values (#1A1B1E vs #fefefe), so this
    // cannot pass by both sides being equal — the pair is the fixture control.
    injectTokens();
    expect(paint(root, darkTokens.colorBody)).not.toBe(paint(root, tokens.colorBody));
    expect(bodyColor(root)).not.toBe(paint(root, tokens.colorBody));
  });

  it('yields to an explicit light theme on the root', () => {
    injectTokens();
    root.setAttribute('data-theme', 'light');
    expect(bodyColor(root)).toBe(paint(root, tokens.colorBody));
    expect(getComputedStyle(root).colorScheme).toBe('light');
  });

  it('yields to a light theme on an ancestor below the root, and back to dark inside it', () => {
    injectTokens();
    scope = document.createElement('div');
    scope.setAttribute('data-theme', 'light');
    const inner = document.createElement('div');
    inner.setAttribute('data-theme', 'dark');
    scope.append(inner);
    document.body.append(scope);
    expect(bodyColor(scope)).toBe(paint(scope, tokens.colorBody));
    // The nested dark block is what makes this work; without it `inner` would
    // inherit the light values from `scope`.
    expect(bodyColor(inner)).toBe(paint(inner, darkTokens.colorBody));
  });

  it('reaches a shadow root with no theme attribute in the tree', async () => {
    injectTokens();
    scope = document.createElement('div');
    scope.innerHTML = '<civitai-card>x</civitai-card>';
    document.body.append(scope);

    const card = scope.firstElementChild as HTMLElement & { updateComplete: Promise<boolean> };
    await card.updateComplete;
    // A plain card's hairline is width-zero in dark; `with-border` is explicit
    // and stays 1px, so it would prove nothing here. Under a light OS this was
    // 1px before the flip.
    expect(getComputedStyle(card).borderTopWidth).toBe('0px');
  });
});
