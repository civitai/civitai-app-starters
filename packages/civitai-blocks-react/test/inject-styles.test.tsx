import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  BLOCKS_UI_STYLES,
  injectBlocksStyles,
  useBlocksStyles,
} from '../src/ui/styles.js';
import { Badge } from '../src/ui/Badge.js';

/**
 * Post-DS-migration (0.35.0): `injectBlocksStyles()` injects THREE separately
 * marked `<style>` elements — the `@civitai/theme` tokens, the
 * `@civitai/components` presentational CSS, and this package's interactive-5
 * CSS. The interactive-5 `<style>` carries the `data-civitai-blocks-ui` marker.
 */
const MARKER = 'style[data-civitai-blocks-ui]';
const THEME_MARKER = 'style[data-civitai-theme]';
const COMPONENTS_MARKER = 'style[data-civitai-components]';

function countMarkers(sel: string, doc: Document = document): number {
  return doc.querySelectorAll(sel).length;
}

function removeAll(doc: Document = document): void {
  for (const sel of [MARKER, THEME_MARKER, COMPONENTS_MARKER]) {
    doc.querySelectorAll(sel).forEach((el) => el.remove());
  }
}

afterEach(() => {
  cleanup();
  removeAll();
});

describe('injectBlocksStyles', () => {
  it('injects the three DS-migration <style> tags into the document head', () => {
    injectBlocksStyles();
    expect(countMarkers(MARKER)).toBe(1);
    expect(countMarkers(THEME_MARKER)).toBe(1);
    expect(countMarkers(COMPONENTS_MARKER)).toBe(1);
    const style = document.querySelector(MARKER);
    expect(style?.parentElement?.tagName.toLowerCase()).toBe('head');
  });

  it('is idempotent — N calls still yield one of each <style>', () => {
    injectBlocksStyles();
    injectBlocksStyles();
    injectBlocksStyles();
    expect(countMarkers(MARKER)).toBe(1);
    expect(countMarkers(THEME_MARKER)).toBe(1);
    expect(countMarkers(COMPONENTS_MARKER)).toBe(1);
  });

  it('the interactive-5 <style> carries ONLY the interactive rules, on --civitai-* tokens', () => {
    injectBlocksStyles();
    const css = document.querySelector(MARKER)?.textContent ?? '';
    // The 5 interactive components live here.
    expect(css).toContain("[data-civitai-ui='modal']");
    expect(css).toContain("[data-civitai-ui='segmented-control']");
    expect(css).toContain("[data-civitai-ui='slider']");
    expect(css).toContain("[data-civitai-ui='collapse']");
    expect(css).toContain("[data-civitai-ui='select']");
    // Repointed onto the design-system tokens…
    expect(css).toContain('--civitai-radius');
    expect(css).toContain('--civitai-color-surface-2');
    // …and NOT the retired --ci-* palette (standalone --ci-<word> form; note
    // --civitai- itself contains the substring "--ci").
    expect(css).not.toMatch(/--ci-[a-z]/);
    // The presentational-10 CSS is now delegated to @civitai/components — the
    // interactive-5 <style> must NOT carry the Button rule…
    expect(css).not.toContain("[data-civitai-ui='button']");
    // …nor the shared field primitives (owned by @civitai/components now).
    expect(css).not.toContain('[data-civitai-ui-control] {');
  });

  it('delegates tokens + presentational CSS to the design-system packages', () => {
    injectBlocksStyles();
    const tokenCss = document.querySelector(THEME_MARKER)?.textContent ?? '';
    const compCss = document.querySelector(COMPONENTS_MARKER)?.textContent ?? '';
    expect(tokenCss).toContain('--civitai-color-primary');
    expect(compCss).toContain("[data-civitai-ui='button']");
    // @civitai/components layers its rules.
    expect(compCss).toContain('@layer civitai.components');
  });

  it('BLOCKS_UI_STYLES composes tokens + components + interactive into one string', () => {
    expect(BLOCKS_UI_STYLES).toContain('--civitai-color-primary'); // tokens
    expect(BLOCKS_UI_STYLES).toContain("[data-civitai-ui='button']"); // components
    expect(BLOCKS_UI_STYLES).toContain("[data-civitai-ui='segmented-control']"); // interactive
    expect(BLOCKS_UI_STYLES).not.toMatch(/--ci-[a-z]/);
  });

  it('injects into an explicitly-passed document', () => {
    const other = document.implementation.createHTMLDocument('other');
    injectBlocksStyles(other);
    expect(countMarkers(MARKER, other)).toBe(1);
    expect(countMarkers(THEME_MARKER, other)).toBe(1);
    // The ambient document is untouched.
    expect(countMarkers(MARKER, document)).toBe(0);
  });

  it('is idempotent on an explicitly-passed document too', () => {
    const other = document.implementation.createHTMLDocument('other');
    injectBlocksStyles(other);
    injectBlocksStyles(other);
    expect(countMarkers(MARKER, other)).toBe(1);
    expect(countMarkers(THEME_MARKER, other)).toBe(1);
    expect(countMarkers(COMPONENTS_MARKER, other)).toBe(1);
  });
});

describe('useBlocksStyles / component mount', () => {
  beforeEach(() => {
    removeAll();
  });

  it('injects styles when a component that uses the hook mounts', () => {
    expect(countMarkers(MARKER)).toBe(0);
    render(<Badge>new</Badge>);
    expect(countMarkers(MARKER)).toBe(1);
    expect(countMarkers(THEME_MARKER)).toBe(1);
    expect(countMarkers(COMPONENTS_MARKER)).toBe(1);
  });

  it('still only one of each <style> when several components mount', () => {
    render(
      <div>
        <Badge>a</Badge>
        <Badge>b</Badge>
        <Badge>c</Badge>
      </div>
    );
    expect(countMarkers(MARKER)).toBe(1);
    expect(countMarkers(THEME_MARKER)).toBe(1);
    expect(countMarkers(COMPONENTS_MARKER)).toBe(1);
  });

  it('exposes useBlocksStyles as a callable hook (smoke)', () => {
    function Probe(): React.JSX.Element {
      useBlocksStyles();
      return <span>probe</span>;
    }
    render(<Probe />);
    expect(countMarkers(MARKER)).toBe(1);
  });
});
