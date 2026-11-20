import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRef } from 'react';

import { Select } from '../src/ui/Select.js';

/**
 * Behavioral coverage for Select: options + children forms, controlled value
 * reflection, value-semantics onChange on pick, placeholder, disabled, and the
 * label/description/error a11y wiring shared with TextInput.
 */

afterEach(() => {
  cleanup();
  document.querySelectorAll('style[data-civitai-blocks-ui]').forEach((el) => el.remove());
});

const samplers = [
  { value: 'euler', label: 'Euler' },
  { value: 'dpmpp', label: 'DPM++ 2M' },
  { value: 'ddim', label: 'DDIM' },
];

describe('Select', () => {
  it('renders a labeled select from the options prop', () => {
    render(<Select label="Sampler" value="euler" onChange={() => {}} options={samplers} />);
    const select = screen.getByLabelText('Sampler') as HTMLSelectElement;
    expect(select.tagName).toBe('SELECT');
    // One <option> per entry.
    expect(select.querySelectorAll('option')).toHaveLength(3);
    expect(screen.getByText('DPM++ 2M')).toBeTruthy();
  });

  it('is announced as a combobox', () => {
    render(<Select label="Sampler" value="euler" onChange={() => {}} options={samplers} />);
    expect(screen.getByRole('combobox')).toBeTruthy();
  });

  it('reflects the controlled value', () => {
    render(<Select label="Sampler" value="ddim" onChange={() => {}} options={samplers} />);
    expect((screen.getByLabelText('Sampler') as HTMLSelectElement).value).toBe('ddim');
  });

  it('fires onChange with the picked option VALUE', () => {
    const onChange = vi.fn();
    render(<Select label="Sampler" value="euler" onChange={onChange} options={samplers} />);
    fireEvent.change(screen.getByLabelText('Sampler'), { target: { value: 'dpmpp' } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('dpmpp');
  });

  it('renders a disabled placeholder as the leading option', () => {
    render(
      <Select
        label="Sampler"
        value=""
        onChange={() => {}}
        options={samplers}
        placeholder="Pick one…"
      />
    );
    const select = screen.getByLabelText('Sampler') as HTMLSelectElement;
    const first = select.querySelectorAll('option')[0] as HTMLOptionElement;
    expect(first.textContent).toBe('Pick one…');
    expect(first.disabled).toBe(true);
    expect(first.value).toBe('');
  });

  it('marks an individual option disabled', () => {
    render(
      <Select
        label="Sampler"
        value="euler"
        onChange={() => {}}
        options={[{ value: 'euler', label: 'Euler' }, { value: 'x', label: 'X', disabled: true }]}
      />
    );
    const opt = screen.getByText('X') as HTMLOptionElement;
    expect(opt.disabled).toBe(true);
  });

  it('supports <option> children instead of options', () => {
    const onChange = vi.fn();
    render(
      <Select label="Base model" value="sdxl" onChange={onChange}>
        <option value="sdxl">SDXL</option>
        <option value="flux">Flux</option>
      </Select>
    );
    const select = screen.getByLabelText('Base model') as HTMLSelectElement;
    expect(select.querySelectorAll('option')).toHaveLength(2);
    fireEvent.change(select, { target: { value: 'flux' } });
    expect(onChange).toHaveBeenCalledWith('flux');
  });

  it('sets the native disabled attribute, which blocks user interaction', () => {
    // Native `disabled` is what blocks a real pick; happy-dom's synthetic
    // fireEvent bypasses it, so assert the attribute that governs interaction.
    render(
      <Select label="Sampler" value="euler" onChange={() => {}} options={samplers} disabled />
    );
    const select = screen.getByLabelText('Sampler') as HTMLSelectElement;
    expect(select.disabled).toBe(true);
  });

  it('supports an accessible name via aria-label without a visible label', () => {
    render(<Select aria-label="Workflow type" value="euler" onChange={() => {}} options={samplers} />);
    const select = screen.getByLabelText('Workflow type') as HTMLSelectElement;
    expect(select.getAttribute('aria-label')).toBe('Workflow type');
  });

  it('links description + error via aria-describedby and sets aria-invalid', () => {
    render(
      <Select
        label="Sampler"
        value="euler"
        onChange={() => {}}
        options={samplers}
        description="hint"
        error="bad"
      />
    );
    const select = screen.getByLabelText('Sampler');
    const ids = select.getAttribute('aria-describedby')!.split(' ');
    expect(ids).toContain(screen.getByText('hint').id);
    expect(ids).toContain(screen.getByRole('alert').id);
    expect(select.getAttribute('aria-invalid')).toBe('true');
  });

  it('marks required on the native select + aria-required', () => {
    render(
      <Select id="sel1" label="Sampler" value="euler" onChange={() => {}} options={samplers} required />
    );
    const select = document.getElementById('sel1') as HTMLSelectElement;
    expect(select.required).toBe(true);
    expect(select.getAttribute('aria-required')).toBe('true');
  });

  it('forwards a ref to the native select', () => {
    const ref = createRef<HTMLSelectElement>();
    render(<Select label="Sampler" value="euler" onChange={() => {}} options={samplers} ref={ref} />);
    expect(ref.current?.tagName).toBe('SELECT');
  });
});
