import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createRef } from 'react';

import { Group } from '../src/ui/Group.js';

afterEach(() => {
  cleanup();
  document.querySelectorAll('style[data-civitai-blocks-ui]').forEach((el) => el.remove());
});

function group(): HTMLElement {
  return document.querySelector('[data-civitai-ui="group"]') as HTMLElement;
}

describe('Group', () => {
  it('renders children', () => {
    render(
      <Group>
        <span>a</span>
        <span>b</span>
      </Group>
    );
    expect(screen.getByText('a')).toBeTruthy();
    expect(screen.getByText('b')).toBeTruthy();
  });

  it('applies a numeric gap as px', () => {
    render(<Group gap={8}>x</Group>);
    expect(group().style.gap).toBe('8px');
  });

  it('applies justify + align', () => {
    render(
      <Group justify="flex-end" align="flex-start">
        x
      </Group>
    );
    expect(group().style.justifyContent).toBe('flex-end');
    expect(group().style.alignItems).toBe('flex-start');
  });

  it('defaults align to center', () => {
    render(<Group>x</Group>);
    expect(group().style.alignItems).toBe('center');
  });

  it('wraps by default and can disable wrapping', () => {
    render(<Group>x</Group>);
    expect(group().style.flexWrap).toBe('wrap');
    cleanup();
    render(<Group wrap={false}>x</Group>);
    expect(group().style.flexWrap).toBe('nowrap');
  });

  it('forwards a ref', () => {
    const ref = createRef<HTMLDivElement>();
    render(<Group ref={ref}>x</Group>);
    expect(ref.current?.getAttribute('data-civitai-ui')).toBe('group');
  });
});
