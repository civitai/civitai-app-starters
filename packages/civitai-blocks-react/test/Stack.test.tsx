import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createRef } from 'react';

import { Stack } from '../src/ui/Stack.js';

afterEach(() => {
  cleanup();
  document.querySelectorAll('style[data-civitai-blocks-ui]').forEach((el) => el.remove());
});

function stack(): HTMLElement {
  return document.querySelector('[data-civitai-ui="stack"]') as HTMLElement;
}

describe('Stack', () => {
  it('renders children', () => {
    render(
      <Stack>
        <span>a</span>
        <span>b</span>
      </Stack>
    );
    expect(screen.getByText('a')).toBeTruthy();
    expect(screen.getByText('b')).toBeTruthy();
  });

  it('applies a numeric gap as px', () => {
    render(<Stack gap={20}>x</Stack>);
    expect(stack().style.gap).toBe('20px');
  });

  it('applies a string gap verbatim', () => {
    render(<Stack gap="1rem">x</Stack>);
    expect(stack().style.gap).toBe('1rem');
  });

  it('defaults gap to 12px', () => {
    render(<Stack>x</Stack>);
    expect(stack().style.gap).toBe('12px');
  });

  it('applies align + justify', () => {
    render(
      <Stack align="center" justify="space-between">
        x
      </Stack>
    );
    expect(stack().style.alignItems).toBe('center');
    expect(stack().style.justifyContent).toBe('space-between');
  });

  it('forwards a ref', () => {
    const ref = createRef<HTMLDivElement>();
    render(<Stack ref={ref}>x</Stack>);
    expect(ref.current?.getAttribute('data-civitai-ui')).toBe('stack');
  });
});
