/**
 * `<Stack>` must inject the PACK's stylesheet — the one property no other test
 * in this package covers.
 *
 * `useBlocksStyles()` injects the WHOLE pack: the `@civitai/theme` tokens,
 * `@civitai/components`' presentational sheet, and this package's own
 * interactive CSS. Rendering any `/ui` component has always been enough to
 * style a block, including its hand-written `data-civitai-ui="…"` markup — the
 * contract `@civitai/components`' MARKUP.md documents. A block whose only
 * `/ui` import is `<Stack>` therefore depends on `<Stack>` for the styling of
 * everything else on the page.
 *
 * `Stack.test.tsx` cannot see this: all six of its assertions are about the
 * attributes and inline styles `Stack` writes itself, so it stays green with
 * the hook present or absent.
 *
 * MUTATION MATRIX — measured against THIS file's `Stack.tsx`, not a former
 * revision of it. Two mutants, both run with the rest of the package's unit
 * tier so the attribution is checked, not assumed:
 *
 *   1. `useBlocksStyles();` commented out (identifier still present in the
 *      file) → the two behavioural cases below FAIL with their OWN assertions
 *      ("<style data-civitai-theme> missing …" and "expected '' to contain
 *      [data-civitai-ui='card']"). Across the full unit tier — 88 files,
 *      1508 tests — those two are the ONLY failures; every other test stays
 *      green, which is the point: nothing else observes this.
 *   2. the call AND its import deleted → all three cases fail, the ledger
 *      included.
 *
 *   Unmutated: 1508/1508 green.
 *
 * Mutant 1 is also the honest limit of the ledger at the bottom of this file:
 * it greps for the STRING `useBlocksStyles()`, so a commented-out call
 * satisfies it. It is a guard on spelling and survives mutant 1; the two
 * behavioural cases are what actually pin the behaviour.
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
  // (a new or rewritten `/ui` component dropping the hook) *or* SHRINKS (the
  // exception below silently acquiring the hook, which would mean this list is
  // no longer describing reality).
  //
  // This is a guard on the SPELLING of a call, so it is weaker than the
  // behavioural cases above — measured: it survives a commented-out call (see
  // mutant 1 in the header). It exists to make the next omission loud at the
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
