import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  BLOCKS_UI_STYLES,
  injectBlocksStyles,
  useBlocksStyles,
} from '../src/ui/styles.js';
import { Badge } from '../src/ui/Badge.js';

const MARKER = 'style[data-civitai-blocks-ui]';

function countMarkers(doc: Document = document): number {
  return doc.querySelectorAll(MARKER).length;
}

afterEach(() => {
  cleanup();
  document.querySelectorAll(MARKER).forEach((el) => el.remove());
});

describe('injectBlocksStyles', () => {
  it('injects exactly one <style> into the document head', () => {
    injectBlocksStyles();
    expect(countMarkers()).toBe(1);
    const style = document.querySelector(MARKER);
    expect(style?.parentElement?.tagName.toLowerCase()).toBe('head');
  });

  it('is idempotent — N calls still yield one <style>', () => {
    injectBlocksStyles();
    injectBlocksStyles();
    injectBlocksStyles();
    expect(countMarkers()).toBe(1);
  });

  it('injects the actual token + component CSS (not an empty tag)', () => {
    injectBlocksStyles();
    const style = document.querySelector(MARKER);
    expect(style?.textContent).toContain('--ci-color-primary');
    expect(style?.textContent).toContain("[data-civitai-ui='button']");
    expect(style?.textContent).toBe(BLOCKS_UI_STYLES);
  });

  it('injects into an explicitly-passed document', () => {
    const other = document.implementation.createHTMLDocument('other');
    injectBlocksStyles(other);
    expect(countMarkers(other)).toBe(1);
    // The ambient document is untouched.
    expect(countMarkers(document)).toBe(0);
  });

  it('is idempotent on an explicitly-passed document too', () => {
    const other = document.implementation.createHTMLDocument('other');
    injectBlocksStyles(other);
    injectBlocksStyles(other);
    expect(countMarkers(other)).toBe(1);
  });
});

describe('useBlocksStyles / component mount', () => {
  beforeEach(() => {
    document.querySelectorAll(MARKER).forEach((el) => el.remove());
  });

  it('injects styles when a component that uses the hook mounts', () => {
    expect(countMarkers()).toBe(0);
    render(<Badge>new</Badge>);
    expect(countMarkers()).toBe(1);
  });

  it('still only one <style> when several components mount', () => {
    render(
      <div>
        <Badge>a</Badge>
        <Badge>b</Badge>
        <Badge>c</Badge>
      </div>
    );
    expect(countMarkers()).toBe(1);
  });

  it('exposes useBlocksStyles as a callable hook (smoke)', () => {
    function Probe(): React.JSX.Element {
      useBlocksStyles();
      return <span>probe</span>;
    }
    render(<Probe />);
    expect(countMarkers()).toBe(1);
  });
});
