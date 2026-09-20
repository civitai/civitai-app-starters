/**
 * Proves the STRANGLER SEAM is actually load-bearing.
 *
 * `Stack.test.tsx` — unchanged from before the migration — passes whether or
 * not `<civitai-stack>` ever upgrades, because every assertion in it is about
 * attributes and inline styles the React shim writes itself. Green there is
 * necessary (the contract did not move) and says NOTHING about whether the new
 * package is in play. This file is the positive control: it asserts the custom
 * element upgraded, and asserts the behaviour that only the element can
 * provide.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Stack } from '../src/ui/Stack.js';

afterEach(cleanup);

function stack(): HTMLElement {
  return document.querySelector('[data-civitai-ui="stack"]') as HTMLElement;
}

describe('Stack is served by @civitai/elements', () => {
  it('renders the custom element, not a <div>', () => {
    render(<Stack>x</Stack>);
    expect(stack().tagName).toBe('CIVITAI-STACK');
  });

  it('the element UPGRADED — it is not an unknown tag', async () => {
    render(<Stack>x</Stack>);
    const el = stack();
    expect(customElements.get('civitai-stack')).toBeTruthy();
    expect(el.constructor.name).toBe('CivitaiStack');
    // An unknown element would have none of these.
    expect((el as HTMLElement & { updateComplete?: Promise<unknown> }).updateComplete).toBeTruthy();
  });

  it('gap="md" is no longer silently dropped', async () => {
    // THE BUG THIS MIGRATION CLOSES. Before: `gap="md"` typechecked against
    // `string | number`, emitted `style="gap: md"`, and the CSS parser threw it
    // away — the component rendered default spacing with no error anywhere.
    render(<Stack gap="md">x</Stack>);
    const el = stack();
    await (el as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;

    expect(el.getAttribute('gap')).toBe('md');
    // Crucially NOT an invalid inline length.
    expect(el.style.gap).toBe('');
  });

  it('every named step reaches the element', async () => {
    for (const step of ['none', 'xs', 'sm', 'md', 'lg', 'xl'] as const) {
      const { unmount } = render(<Stack gap={step}>x</Stack>);
      const el = stack();
      await (el as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
      expect(el.getAttribute('gap'), `gap="${step}"`).toBe(step);
      unmount();
    }
  });

  it('a length still goes inline, so the old contract is untouched', async () => {
    render(<Stack gap="1.5rem">x</Stack>);
    const el = stack();
    await (el as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
    expect(el.style.gap).toBe('1.5rem');
    expect(el.hasAttribute('gap')).toBe(false);
  });

  it('children survive — the light-DOM constraint, through the React shim', async () => {
    const { rerender } = render(
      <Stack gap={8}>
        <span data-testid="kid">a</span>
      </Stack>
    );
    const kid = screen.getByTestId('kid');
    rerender(
      <Stack gap="xl">
        <span data-testid="kid">a</span>
      </Stack>
    );
    const el = stack();
    await (el as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
    expect(screen.getByTestId('kid')).toBe(kid);
    expect(kid.isConnected).toBe(true);
  });

  it('the element brings its own styling — no useBlocksStyles() needed', () => {
    render(<Stack>x</Stack>);
    // The elements package adopts per-component CSS on upgrade (constructed
    // stylesheet where available, a <style data-civitai-element> otherwise),
    // plus the @civitai/theme tokens. One of the two must be observable.
    const adopted =
      document.adoptedStyleSheets.length > 0 ||
      document.querySelector('style[data-civitai-element="civitai-stack"]') !== null;
    expect(adopted).toBe(true);
    expect(document.querySelector('style[data-civitai-theme]')).not.toBeNull();
  });
});
