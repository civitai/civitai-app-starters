import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRef } from 'react';

import { Slider } from '../src/ui/Slider.js';

/**
 * Behavioral coverage for Slider. Asserts on observable behavior + the a11y
 * wiring (label association, role="slider", aria-describedby / aria-invalid)
 * and the data-* hooks the injected CSS reads. No jest-dom — DOM props/attrs
 * read directly, matching the Button/TextInput test convention.
 */

afterEach(() => {
  cleanup();
  document.querySelectorAll('style[data-civitai-blocks-ui]').forEach((el) => el.remove());
});

describe('Slider', () => {
  it('renders with a label associated to the range input', () => {
    render(<Slider label="Weight" value={0.5} onChange={() => {}} min={0} max={1} step={0.1} />);
    const input = screen.getByLabelText('Weight') as HTMLInputElement;
    expect(input.tagName).toBe('INPUT');
    expect(input.type).toBe('range');
  });

  it('exposes an implicit role="slider"', () => {
    render(<Slider label="Weight" value={5} onChange={() => {}} />);
    expect(screen.getByRole('slider')).toBeTruthy();
  });

  it('reflects the controlled value + min/max/step on the input', () => {
    render(<Slider label="W" value={7} onChange={() => {}} min={2} max={20} step={2} />);
    const input = screen.getByLabelText('W') as HTMLInputElement;
    expect(input.value).toBe('7');
    expect(input.min).toBe('2');
    expect(input.max).toBe('20');
    expect(input.step).toBe('2');
  });

  it('defaults min/max/step to 0/100/1', () => {
    render(<Slider label="W" value={10} onChange={() => {}} />);
    const input = screen.getByLabelText('W') as HTMLInputElement;
    expect(input.min).toBe('0');
    expect(input.max).toBe('100');
    expect(input.step).toBe('1');
  });

  it('fires onChange with the new NUMERIC value on input (drag)', () => {
    const onChange = vi.fn();
    render(<Slider label="W" value={3} onChange={onChange} min={0} max={10} />);
    const input = screen.getByLabelText('W');
    fireEvent.change(input, { target: { value: '8' } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(8);
    // Value semantics — a number, not the raw event.
    expect(typeof onChange.mock.calls[0]![0]).toBe('number');
  });

  it('shows the current value when showValue is set', () => {
    render(<Slider label="W" value={42} onChange={() => {}} showValue />);
    const valueEl = document.querySelector('[data-civitai-ui-slider-value]');
    expect(valueEl?.textContent).toBe('42');
  });

  it('omits the value display by default', () => {
    render(<Slider label="W" value={42} onChange={() => {}} />);
    expect(document.querySelector('[data-civitai-ui-slider-value]')).toBeNull();
  });

  it('supports an accessible name via aria-label when no visible label', () => {
    render(<Slider aria-label="LoRA weight" value={1} onChange={() => {}} />);
    const input = screen.getByLabelText('LoRA weight') as HTMLInputElement;
    expect(input.getAttribute('aria-label')).toBe('LoRA weight');
  });

  it('sets the native disabled attribute, which blocks user interaction', () => {
    // The native `disabled` attribute is what blocks a real user from dragging
    // the slider (happy-dom's synthetic fireEvent bypasses it, so it's not a
    // faithful "user" — assert the attribute that governs real interaction).
    render(<Slider label="W" value={3} onChange={() => {}} disabled />);
    const input = screen.getByLabelText('W') as HTMLInputElement;
    expect(input.disabled).toBe(true);
  });

  it('links a description via aria-describedby', () => {
    render(<Slider label="W" value={1} onChange={() => {}} description="Strength of the LoRA" />);
    const input = screen.getByLabelText('W');
    const desc = screen.getByText('Strength of the LoRA');
    expect(input.getAttribute('aria-describedby')!.split(' ')).toContain(desc.id);
  });

  it('sets aria-invalid + announces and links the error', () => {
    render(<Slider label="W" value={1} onChange={() => {}} error="Out of range" />);
    const input = screen.getByLabelText('W');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const err = screen.getByRole('alert');
    expect(err.textContent).toBe('Out of range');
    expect(input.getAttribute('aria-describedby')!.split(' ')).toContain(err.id);
  });

  it('does not set aria-invalid when there is no error', () => {
    render(<Slider label="W" value={1} onChange={() => {}} />);
    expect(screen.getByLabelText('W').getAttribute('aria-invalid')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('marks required on the native input + aria-required, with an asterisk', () => {
    render(<Slider id="s1" label="W" value={1} onChange={() => {}} required />);
    const input = document.getElementById('s1') as HTMLInputElement;
    expect(input.required).toBe(true);
    expect(input.getAttribute('aria-required')).toBe('true');
    expect(document.querySelector('[data-civitai-ui-required]')?.textContent).toBe('*');
  });

  it('forwards a ref to the native input', () => {
    const ref = createRef<HTMLInputElement>();
    render(<Slider label="W" value={1} onChange={() => {}} ref={ref} />);
    expect(ref.current?.tagName).toBe('INPUT');
    expect(ref.current?.type).toBe('range');
  });

  it('respects an explicit id (label + describedby use it)', () => {
    render(<Slider id="my-slider" label="W" value={1} onChange={() => {}} error="x" />);
    const input = screen.getByLabelText('W');
    expect(input.id).toBe('my-slider');
    expect(input.getAttribute('aria-describedby')).toBe('my-slider-err');
  });
});
