import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createRef } from 'react';

import { Loader } from '../src/ui/Loader.js';

afterEach(() => {
  cleanup();
  document.querySelectorAll('style[data-civitai-blocks-ui]').forEach((el) => el.remove());
});

function loader(): HTMLElement {
  return document.querySelector('[data-civitai-ui="loader"]') as HTMLElement;
}

describe('Loader', () => {
  it('renders with role="status" and a default label', () => {
    render(<Loader />);
    const el = screen.getByRole('status');
    expect(el.getAttribute('aria-label')).toBe('Loading');
  });

  it('reflects size on data-size (default md)', () => {
    render(<Loader />);
    expect(loader().getAttribute('data-size')).toBe('md');
    cleanup();
    render(<Loader size="lg" />);
    expect(loader().getAttribute('data-size')).toBe('lg');
  });

  it('applies a custom color via inline style', () => {
    render(<Loader color="red" />);
    expect(loader().style.color).toBe('red');
  });

  it('allows overriding the aria-label', () => {
    render(<Loader aria-label="Fetching" />);
    expect(screen.getByRole('status').getAttribute('aria-label')).toBe('Fetching');
  });

  it('forwards a ref', () => {
    const ref = createRef<HTMLSpanElement>();
    render(<Loader ref={ref} />);
    expect(ref.current?.getAttribute('data-civitai-ui')).toBe('loader');
  });
});
