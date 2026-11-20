import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRef } from 'react';

import { Collapse } from '../src/ui/Collapse.js';

/**
 * Behavioral coverage for Collapse (disclosure): controlled open state, trigger
 * toggles onOpenChange, aria-expanded / aria-controls wiring, region labelling,
 * hidden content when closed, and disabled.
 */

afterEach(() => {
  cleanup();
  document.querySelectorAll('style[data-civitai-blocks-ui]').forEach((el) => el.remove());
});

describe('Collapse', () => {
  it('renders a trigger button with the title', () => {
    render(
      <Collapse open={false} onOpenChange={() => {}} title="Advanced">
        <p>body</p>
      </Collapse>
    );
    const trigger = screen.getByRole('button', { name: 'Advanced' });
    expect(trigger.tagName).toBe('BUTTON');
    expect(trigger.getAttribute('type')).toBe('button');
  });

  it('hides the content region when closed', () => {
    render(
      <Collapse open={false} onOpenChange={() => {}} title="Advanced">
        <p>secret</p>
      </Collapse>
    );
    const region = document.querySelector('[data-civitai-ui-collapse-region]') as HTMLElement;
    expect(region.hidden).toBe(true);
    expect(screen.getByRole('button', { name: 'Advanced' }).getAttribute('aria-expanded')).toBe(
      'false'
    );
    // A hidden region is out of the a11y tree — getByRole('region') should miss it.
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('shows the content region when open', () => {
    render(
      <Collapse open onOpenChange={() => {}} title="Advanced">
        <p>secret</p>
      </Collapse>
    );
    const region = document.querySelector('[data-civitai-ui-collapse-region]') as HTMLElement;
    expect(region.hidden).toBe(false);
    expect(screen.getByRole('button', { name: 'Advanced' }).getAttribute('aria-expanded')).toBe(
      'true'
    );
    expect(screen.getByRole('region')).toBeTruthy();
    expect(screen.getByText('secret')).toBeTruthy();
  });

  it('requests the opposite open state on trigger click', () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <Collapse open={false} onOpenChange={onOpenChange} title="Advanced">
        <p>body</p>
      </Collapse>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Advanced' }));
    expect(onOpenChange).toHaveBeenCalledWith(true);

    rerender(
      <Collapse open onOpenChange={onOpenChange} title="Advanced">
        <p>body</p>
      </Collapse>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Advanced' }));
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it('wires aria-controls to the region and the region back to the trigger', () => {
    render(
      <Collapse open onOpenChange={() => {}} title="Advanced">
        <p>body</p>
      </Collapse>
    );
    const trigger = screen.getByRole('button', { name: 'Advanced' });
    const region = screen.getByRole('region');
    expect(trigger.getAttribute('aria-controls')).toBe(region.id);
    expect(region.getAttribute('aria-labelledby')).toBe(trigger.id);
  });

  it('disables the trigger and blocks the toggle when disabled', () => {
    const onOpenChange = vi.fn();
    render(
      <Collapse open={false} onOpenChange={onOpenChange} title="Advanced" disabled>
        <p>body</p>
      </Collapse>
    );
    const trigger = screen.getByRole('button', { name: 'Advanced' }) as HTMLButtonElement;
    expect(trigger.disabled).toBe(true);
    fireEvent.click(trigger);
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('reflects open state on the wrapper data-open hook', () => {
    const { rerender } = render(
      <Collapse open onOpenChange={() => {}} title="Advanced">
        <p>body</p>
      </Collapse>
    );
    expect(document.querySelector('[data-civitai-ui="collapse"]')?.getAttribute('data-open')).toBe(
      'true'
    );
    rerender(
      <Collapse open={false} onOpenChange={() => {}} title="Advanced">
        <p>body</p>
      </Collapse>
    );
    expect(
      document.querySelector('[data-civitai-ui="collapse"]')?.getAttribute('data-open')
    ).toBeNull();
  });

  it('respects an explicit id for the trigger + region ids', () => {
    render(
      <Collapse id="adv" open onOpenChange={() => {}} title="Advanced">
        <p>body</p>
      </Collapse>
    );
    expect(screen.getByRole('button', { name: 'Advanced' }).id).toBe('adv-trigger');
    expect(screen.getByRole('region').id).toBe('adv-region');
  });

  it('forwards a ref to the trigger button', () => {
    const ref = createRef<HTMLButtonElement>();
    render(
      <Collapse open={false} onOpenChange={() => {}} title="Advanced" ref={ref}>
        <p>body</p>
      </Collapse>
    );
    expect(ref.current?.tagName).toBe('BUTTON');
  });
});
