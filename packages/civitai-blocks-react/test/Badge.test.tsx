import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createRef } from 'react';

import { Badge } from '../src/ui/Badge.js';

afterEach(() => {
  cleanup();
  document.querySelectorAll('style[data-civitai-blocks-ui]').forEach((el) => el.remove());
});

function badge(): HTMLElement {
  return document.querySelector('[data-civitai-ui="badge"]') as HTMLElement;
}

describe('Badge', () => {
  it('renders its content', () => {
    render(<Badge>NEW</Badge>);
    expect(screen.getByText('NEW')).toBeTruthy();
  });

  it('reflects variant + size (defaults light / md)', () => {
    render(<Badge>x</Badge>);
    expect(badge().getAttribute('data-variant')).toBe('light');
    expect(badge().getAttribute('data-size')).toBe('md');
  });

  it('honors explicit variant + size', () => {
    render(
      <Badge variant="outline" size="sm">
        x
      </Badge>
    );
    expect(badge().getAttribute('data-variant')).toBe('outline');
    expect(badge().getAttribute('data-size')).toBe('sm');
  });

  it('maps a semantic color onto the primary CSS var', () => {
    render(<Badge color="success">x</Badge>);
    expect(badge().style.getPropertyValue('--ci-color-primary')).toBe(
      'var(--ci-color-success)'
    );
  });

  it('leaves the var untouched for the default color', () => {
    render(<Badge>x</Badge>);
    expect(badge().style.getPropertyValue('--ci-color-primary')).toBe('');
  });

  it('forwards a ref', () => {
    const ref = createRef<HTMLSpanElement>();
    render(<Badge ref={ref}>x</Badge>);
    expect(ref.current?.tagName).toBe('SPAN');
  });
});
