/**
 * Runs in a context the browser reports as `prefers-color-scheme: dark`.
 *
 * ⚠️ WHAT THIS FILE IS NO LONGER FOR. Its original reason was that a dark-OS
 * context "is the only way to observe the token stylesheet's preference block
 * at all" — and that block is GONE: the stylesheet now carries the dark palette
 * on `:root` unconditionally and declares no `prefers-color-scheme` anywhere.
 *
 * 🔴 So every assertion below passes identically before and after that flip, and
 * none of them is evidence for it. A dark-OS context cannot distinguish "dark
 * base" from "light base plus an OS-dark override" — both answer dark. The
 * discriminating fixture is a LIGHT OS, and it lives in
 * `color-scheme.dark-base.browser.test.ts`; the source-level claim that no
 * at-rule exists is pinned in `@civitai/theme`'s `test/generation-parity.test.ts`.
 *
 * What it still earns its place for: proving the dark base is NOT secretly
 * OS-coupled in the other direction — that a dark-OS viewer gets the same
 * answers, and that an explicit `data-theme` still overrides regardless of what
 * the OS says.
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
