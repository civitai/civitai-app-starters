import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRef } from 'react';

import { NumberInput } from '../src/ui/NumberInput.js';

/**
 * Behavioral coverage for NumberInput: controlled reflection, parsed-number
 * onChange, empty→null, non-numeric rejection (never emits NaN), and
 * clamp-to-bounds on blur. Plus the label/description/error a11y wiring shared
 * with TextInput.
 */

afterEach(() => {
  cleanup();
  document.querySelectorAll('style[data-civitai-blocks-ui]').forEach((el) => el.remove());
});

describe('NumberInput', () => {
  it('renders with a label associated to a number input', () => {
    render(<NumberInput label="Steps" value={20} onChange={() => {}} />);
    const input = screen.getByLabelText('Steps') as HTMLInputElement;
    expect(input.tagName).toBe('INPUT');
    expect(input.type).toBe('number');
  });

  it('reflects the controlled value', () => {
    render(<NumberInput label="Steps" value={30} onChange={() => {}} />);
    expect((screen.getByLabelText('Steps') as HTMLInputElement).value).toBe('30');
  });

  it('renders an empty field for a null value', () => {
    render(<NumberInput label="Steps" value={null} onChange={() => {}} />);
    expect((screen.getByLabelText('Steps') as HTMLInputElement).value).toBe('');
  });

  it('fires onChange with a parsed NUMBER as the user types', () => {
    const onChange = vi.fn();
    render(<NumberInput label="Steps" value={null} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Steps'), { target: { value: '42' } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(42);
    expect(typeof onChange.mock.calls[0]![0]).toBe('number');
  });

  it('emits null when cleared to empty', () => {
    const onChange = vi.fn();
    render(<NumberInput label="Steps" value={20} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Steps'), { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('rejects non-numeric input — never emits NaN (guard)', () => {
    const onChange = vi.fn();
    render(<NumberInput label="Steps" value={20} onChange={onChange} />);
    // A value that stays in the DOM but does not parse to a finite number.
    fireEvent.change(screen.getByLabelText('Steps'), { target: { value: '1.2.3' } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('rejects a non-finite (overflow) value', () => {
    const onChange = vi.fn();
    render(<NumberInput label="Steps" value={20} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Steps'), { target: { value: '1e400' } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('clamps to max on blur', () => {
    const onChange = vi.fn();
    render(<NumberInput label="Steps" value={150} onChange={onChange} min={1} max={100} />);
    fireEvent.blur(screen.getByLabelText('Steps'));
    expect(onChange).toHaveBeenCalledWith(100);
  });

  it('clamps to min on blur', () => {
    const onChange = vi.fn();
    render(<NumberInput label="Steps" value={-5} onChange={onChange} min={0} max={100} />);
    fireEvent.blur(screen.getByLabelText('Steps'));
    expect(onChange).toHaveBeenCalledWith(0);
  });

  it('does not fire onChange on blur when already in bounds', () => {
    const onChange = vi.fn();
    render(<NumberInput label="Steps" value={50} onChange={onChange} min={1} max={100} />);
    fireEvent.blur(screen.getByLabelText('Steps'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('does not clamp a null value on blur', () => {
    const onChange = vi.fn();
    render(<NumberInput label="Steps" value={null} onChange={onChange} min={10} max={100} />);
    fireEvent.blur(screen.getByLabelText('Steps'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('reflects min/max/step on the native input', () => {
    render(<NumberInput label="CFG" value={7} onChange={() => {}} min={1} max={30} step={0.5} />);
    const input = screen.getByLabelText('CFG') as HTMLInputElement;
    expect(input.min).toBe('1');
    expect(input.max).toBe('30');
    expect(input.step).toBe('0.5');
  });

  it('sets the native disabled attribute, which blocks user interaction', () => {
    // Native `disabled` is what blocks real typing; happy-dom's synthetic
    // fireEvent bypasses it, so assert the attribute that governs interaction.
    render(<NumberInput label="Steps" value={20} onChange={() => {}} disabled />);
    const input = screen.getByLabelText('Steps') as HTMLInputElement;
    expect(input.disabled).toBe(true);
  });

  it('supports an accessible name via aria-label without a visible label', () => {
    render(<NumberInput aria-label="Quantity" value={1} onChange={() => {}} />);
    const input = screen.getByLabelText('Quantity') as HTMLInputElement;
    expect(input.getAttribute('aria-label')).toBe('Quantity');
  });

  it('links description + error via aria-describedby and sets aria-invalid', () => {
    render(
      <NumberInput label="Steps" value={1} onChange={() => {}} description="hint" error="bad" />
    );
    const input = screen.getByLabelText('Steps');
    const ids = input.getAttribute('aria-describedby')!.split(' ');
    expect(ids).toContain(screen.getByText('hint').id);
    expect(ids).toContain(screen.getByRole('alert').id);
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });

  it('forwards a ref to the native input', () => {
    const ref = createRef<HTMLInputElement>();
    render(<NumberInput label="Steps" value={1} onChange={() => {}} ref={ref} />);
    expect(ref.current?.tagName).toBe('INPUT');
  });
});
