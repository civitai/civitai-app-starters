import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createRef } from 'react';

import { Card } from '../src/ui/Card.js';

afterEach(() => {
  cleanup();
  document.querySelectorAll('style[data-civitai-blocks-ui]').forEach((el) => el.remove());
});

function card(): HTMLElement {
  return document.querySelector('[data-civitai-ui="card"]') as HTMLElement;
}

describe('Card', () => {
  it('renders children', () => {
    render(<Card>inside</Card>);
    expect(screen.getByText('inside')).toBeTruthy();
  });

  it('draws a border by default', () => {
    render(<Card>x</Card>);
    expect(card().getAttribute('data-with-border')).toBe('true');
  });

  it('omits the border flag when withBorder=false', () => {
    render(<Card withBorder={false}>x</Card>);
    expect(card().getAttribute('data-with-border')).toBeNull();
  });

  it('reflects padding on data-padding (default md)', () => {
    render(<Card>x</Card>);
    expect(card().getAttribute('data-padding')).toBe('md');
  });

  it('honors an explicit padding', () => {
    render(<Card padding="lg">x</Card>);
    expect(card().getAttribute('data-padding')).toBe('lg');
  });

  it('applies a custom radius via inline style', () => {
    render(<Card radius={4}>x</Card>);
    expect(card().style.borderRadius).toBe('4px');
  });

  it('forwards a ref + className', () => {
    const ref = createRef<HTMLDivElement>();
    render(
      <Card ref={ref} className="c">
        x
      </Card>
    );
    expect(ref.current?.tagName).toBe('DIV');
    expect(card().classList.contains('c')).toBe(true);
  });

  // Regression (B1): a structural component must also pin its own
  // data-civitai-ui after the author spread. Select by test-id (NOT by
  // data-civitai-ui) so the assertion can't be a tautology.
  it('keeps data-civitai-ui="card" even when an author passes data-civitai-ui="evil"', () => {
    render(
      <Card data-testid="c" {...({ 'data-civitai-ui': 'evil' } as Record<string, string>)}>
        x
      </Card>
    );
    expect(screen.getByTestId('c').getAttribute('data-civitai-ui')).toBe('card');
  });
});
