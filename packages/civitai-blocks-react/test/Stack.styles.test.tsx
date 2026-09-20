/**
 * REGRESSION — the strangler shim must still inject the PACK's stylesheet.
 *
 * `<Stack>` renders `<civitai-stack>`, which adopts its own per-component CSS
 * and the `@civitai/theme` tokens on upgrade. An earlier draft of the shim read
 * that as "the element brings its own styling, so `useBlocksStyles()` is
 * redundant" and dropped the hook — the only one of the pack's components to
 * lack it.
 *
 * It is not redundant. `useBlocksStyles()` injects the WHOLE pack: the tokens,
 * `@civitai/components`' presentational sheet, and this package's own
 * interactive CSS. Rendering any `/ui` component has always been enough to
 * style a block, including its hand-written `data-civitai-ui="…"` markup — the
 * contract `@civitai/components`' MARKUP.md documents. A block whose only
 * `/ui` import is `<Stack>` therefore lost the styling for everything else on
 * the page.
 *
 * `Stack.test.tsx` cannot see this: all six of its assertions are about
 * attributes and inline styles the shim writes itself, so it stays green with
 * the hook present or absent. This file asserts the injected DOM instead.
 *
 * Red/green matrix (measured, not assumed):
 *   - at the parent commit (shim without `useBlocksStyles()`) — RED, both cases
 *   - at HEAD — GREEN
 */
import { cleanup, render } from '@testing-library/react';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import { Stack } from '../src/ui/Stack.js';

const MARKERS = [
  'data-civitai-theme', // @civitai/theme tokens
  'data-civitai-components', // @civitai/components presentational sheet
  'data-civitai-blocks-ui', // this package's own interactive CSS
] as const;

function clearInjectedStyles(): void {
  for (const marker of MARKERS) {
    document.querySelectorAll(`style[${marker}]`).forEach((el) => el.remove());
  }
}

afterEach(() => {
  cleanup();
  clearInjectedStyles();
});

describe('Stack injects the pack stylesheet', () => {
  it('starts from a document with none of the pack styles', () => {
    // Positive control for the assertions below: without this, a marker left
    // behind by an earlier test file would make them pass vacuously.
    clearInjectedStyles();
    for (const marker of MARKERS) {
      expect(document.querySelector(`style[${marker}]`), marker).toBeNull();
    }
  });

  it('rendering ONLY <Stack> injects all three pack stylesheets', () => {
    clearInjectedStyles();
    render(<Stack>x</Stack>);
    for (const marker of MARKERS) {
      expect(
        document.querySelector(`style[${marker}]`),
        `<style ${marker}> missing — a Stack-only block renders its other ` +
          '`data-civitai-ui` markup unstyled'
      ).not.toBeNull();
    }
  });

  it('the injected sheet actually carries rules for OTHER components', () => {
    // Structural, not a marker count: the failure being guarded is "a block's
    // hand-written Card/Badge markup is unstyled", and only the rule text can
    // answer that. A marker with an empty sheet would pass the test above.
    clearInjectedStyles();
    render(<Stack>x</Stack>);
    const sheet = document.querySelector('style[data-civitai-components]')?.textContent ?? '';
    expect(sheet).toContain("[data-civitai-ui='card']");
    expect(sheet).toContain("[data-civitai-ui='badge']");
  });
});

describe('every /ui component injects the pack styles', () => {
  // LEDGER, not a sample: fails when the set of non-injecting components GROWS
  // (the next strangler seam repeating Stack's mistake) *or* SHRINKS (the
  // exception below silently acquiring the hook, which would mean this list is
  // no longer describing reality).
  //
  // This is a guard on the SPELLING of a call, so it is weaker than the
  // behavioural cases above; it exists to make the next omission loud at the
  // file level, not to replace them.
  const EXPECTED_WITHOUT = new Set([
    // Documented as intentionally unstyled: it ships native controls so the
    // platform pages can theme them inline. See its module comment.
    'SettingsForm.tsx',
  ]);

  it('only the documented exception omits useBlocksStyles()', () => {
    const uiDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'ui');
    const files = readdirSync(uiDir).filter((f) => f.endsWith('.tsx'));
    expect(files.length, 'no /ui components found — the scan is vacuous').toBeGreaterThan(15);

    const without = files
      .filter((f) => !readFileSync(join(uiDir, f), 'utf8').includes('useBlocksStyles()'))
      .sort();
    expect(without).toEqual([...EXPECTED_WITHOUT].sort());
  });
});
