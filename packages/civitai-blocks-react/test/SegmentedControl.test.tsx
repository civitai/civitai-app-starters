import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRef } from 'react';

import { SegmentedControl } from '../src/ui/SegmentedControl.js';

/**
 * Behavioral coverage for SegmentedControl: tablist/tab roles + aria-selected,
 * value-semantics onChange on click, ArrowLeft/ArrowRight roving (skipping
 * disabled segments), the disabled guards, and stylesheet injection. Asserts on
 * observable behavior + the data-* hooks the injected CSS reads (no jest-dom in
 * this harness — DOM props/attributes read directly).
 */

const MARKER = 'style[data-civitai-blocks-ui]';

afterEach(() => {
  cleanup();
  document.querySelectorAll(MARKER).forEach((el) => el.remove());
});

const views = [
  { value: 'grid', label: 'Grid' },
  { value: 'list', label: 'List' },
  { value: 'table', label: 'Table' },
];

function tab(text: string): HTMLButtonElement {
  return screen.getByText(text).closest('button') as HTMLButtonElement;
}

describe('SegmentedControl', () => {
  it('renders a tablist with one tab per segment', () => {
    render(
      <SegmentedControl aria-label="View" value="grid" onChange={() => {}} data={views} />
    );
    expect(screen.getByRole('tablist')).toBeTruthy();
    expect(screen.getAllByRole('tab')).toHaveLength(3);
  });

  it('marks only the selected value as aria-selected', () => {
    render(
      <SegmentedControl aria-label="View" value="list" onChange={() => {}} data={views} />
    );
    expect(tab('List').getAttribute('aria-selected')).toBe('true');
    expect(tab('Grid').getAttribute('aria-selected')).toBe('false');
    expect(tab('Table').getAttribute('aria-selected')).toBe('false');
    // data-active only on the selected one (the CSS hook).
    expect(tab('List').getAttribute('data-active')).toBe('true');
    expect(tab('Grid').getAttribute('data-active')).toBeNull();
  });

  it('fires onChange with the clicked segment VALUE', () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl aria-label="View" value="grid" onChange={onChange} data={views} />
    );
    fireEvent.click(tab('Table'));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('table');
  });

  it('does not fire onChange when clicking the already-selected segment', () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl aria-label="View" value="grid" onChange={onChange} data={views} />
    );
    fireEvent.click(tab('Grid'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('ArrowRight moves selection to the next segment', () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl aria-label="View" value="grid" onChange={onChange} data={views} />
    );
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith('list');
  });

  it('ArrowLeft moves selection to the previous segment', () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl aria-label="View" value="list" onChange={onChange} data={views} />
    );
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenCalledWith('grid');
  });

  it('ArrowRight wraps from the last segment to the first', () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl aria-label="View" value="table" onChange={onChange} data={views} />
    );
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith('grid');
  });

  it('ArrowRight skips a disabled segment', () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        aria-label="View"
        value="grid"
        onChange={onChange}
        data={[
          { value: 'grid', label: 'Grid' },
          { value: 'list', label: 'List', disabled: true },
          { value: 'table', label: 'Table' },
        ]}
      />
    );
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
    // 'list' is disabled → lands on 'table'.
    expect(onChange).toHaveBeenCalledWith('table');
  });

  it('does not fire onChange on arrow keys when the whole control is disabled', () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl aria-label="View" value="grid" onChange={onChange} data={views} disabled />
    );
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('disables every segment when the control is disabled', () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl aria-label="View" value="grid" onChange={onChange} data={views} disabled />
    );
    expect(tab('List').disabled).toBe(true);
    fireEvent.click(tab('List'));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('tablist').getAttribute('data-disabled')).toBe('true');
  });

  it('sets the native disabled attribute on an individual disabled segment', () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        aria-label="View"
        value="grid"
        onChange={onChange}
        data={[
          { value: 'grid', label: 'Grid' },
          { value: 'list', label: 'List', disabled: true },
        ]}
      />
    );
    expect(tab('List').disabled).toBe(true);
    fireEvent.click(tab('List'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('uses roving tabindex — only the selected tab is in the tab order', () => {
    render(
      <SegmentedControl aria-label="View" value="list" onChange={() => {}} data={views} />
    );
    expect(tab('List').getAttribute('tabindex')).toBe('0');
    expect(tab('Grid').getAttribute('tabindex')).toBe('-1');
    expect(tab('Table').getAttribute('tabindex')).toBe('-1');
  });

  it('reflects size + fullWidth on data-attrs', () => {
    render(
      <SegmentedControl
        aria-label="View"
        value="grid"
        onChange={() => {}}
        data={views}
        size="lg"
        fullWidth
      />
    );
    const list = screen.getByRole('tablist');
    expect(list.getAttribute('data-size')).toBe('lg');
    expect(list.getAttribute('data-full-width')).toBe('true');
  });

  it('defaults to size md and omits data-full-width', () => {
    render(
      <SegmentedControl aria-label="View" value="grid" onChange={() => {}} data={views} />
    );
    const list = screen.getByRole('tablist');
    expect(list.getAttribute('data-size')).toBe('md');
    expect(list.getAttribute('data-full-width')).toBeNull();
  });

  it('exposes the aria-label as the tablist accessible name', () => {
    render(
      <SegmentedControl aria-label="Gallery view" value="grid" onChange={() => {}} data={views} />
    );
    expect(screen.getByRole('tablist').getAttribute('aria-label')).toBe('Gallery view');
  });

  it('forwards a ref to the root div', () => {
    const ref = createRef<HTMLDivElement>();
    render(
      <SegmentedControl aria-label="View" value="grid" onChange={() => {}} data={views} ref={ref} />
    );
    expect(ref.current?.getAttribute('role')).toBe('tablist');
  });

  it('passes className and arbitrary native props through', () => {
    render(
      <SegmentedControl
        aria-label="View"
        value="grid"
        onChange={() => {}}
        data={views}
        className="custom"
        data-testid="sc"
      />
    );
    const el = screen.getByTestId('sc');
    expect(el.classList.contains('custom')).toBe(true);
  });

  // Regression: an author-passed data-civitai-ui must NOT win — the injected
  // stylesheet keys off [data-civitai-ui='segmented-control'].
  it('keeps data-civitai-ui="segmented-control" even when an author passes a stray value', () => {
    render(
      <SegmentedControl
        aria-label="View"
        value="grid"
        onChange={() => {}}
        data={views}
        data-testid="sc"
        {...({ 'data-civitai-ui': 'evil' } as Record<string, string>)}
      />
    );
    expect(screen.getByTestId('sc').getAttribute('data-civitai-ui')).toBe('segmented-control');
  });

  it('injects the pack stylesheet on mount', () => {
    expect(document.querySelectorAll(MARKER).length).toBe(0);
    render(
      <SegmentedControl aria-label="View" value="grid" onChange={() => {}} data={views} />
    );
    expect(document.querySelectorAll(MARKER).length).toBe(1);
  });
});
