import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRef } from 'react';

import { TextInput } from '../src/ui/TextInput.js';

afterEach(() => {
  cleanup();
  document.querySelectorAll('style[data-civitai-blocks-ui]').forEach((el) => el.remove());
});

describe('TextInput', () => {
  it('calls onChange as the user types', () => {
    const onChange = vi.fn();
    render(<TextInput label="Name" onChange={onChange} />);
    const input = screen.getByLabelText('Name') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'ada' } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]![0].target.value).toBe('ada');
  });

  it('associates the label with the input via htmlFor/id', () => {
    render(<TextInput label="Email" />);
    // getByLabelText only resolves if the for/id wiring is correct.
    const input = screen.getByLabelText('Email');
    expect(input.tagName).toBe('INPUT');
  });

  it('renders the description and links it via aria-describedby', () => {
    render(<TextInput label="Name" description="Your full name" />);
    const input = screen.getByLabelText('Name');
    const describedBy = input.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    const desc = screen.getByText('Your full name');
    expect(describedBy!.split(' ')).toContain(desc.id);
  });

  it('sets aria-invalid and announces + links the error', () => {
    render(<TextInput label="Name" error="Required" />);
    const input = screen.getByLabelText('Name');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    // Announced.
    const err = screen.getByRole('alert');
    expect(err.textContent).toBe('Required');
    // Linked.
    expect(input.getAttribute('aria-describedby')!.split(' ')).toContain(err.id);
  });

  it('links BOTH description and error in aria-describedby', () => {
    render(<TextInput label="Name" description="hint" error="bad" />);
    const input = screen.getByLabelText('Name');
    const ids = input.getAttribute('aria-describedby')!.split(' ');
    expect(ids).toContain(screen.getByText('hint').id);
    expect(ids).toContain(screen.getByRole('alert').id);
  });

  it('does not set aria-invalid when there is no error', () => {
    render(<TextInput label="Name" />);
    expect(screen.getByLabelText('Name').getAttribute('aria-invalid')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('marks required on the native input and via aria-required', () => {
    render(<TextInput id="req-field" label="Name" required />);
    // The required asterisk lives in the label, so the accessible label is
    // "Name *" — query by id rather than label text here.
    const input = document.getElementById('req-field') as HTMLInputElement;
    expect(input.required).toBe(true);
    expect(input.getAttribute('aria-required')).toBe('true');
  });

  it('forwards a ref to the native input', () => {
    const ref = createRef<HTMLInputElement>();
    render(<TextInput label="Name" ref={ref} />);
    expect(ref.current?.tagName).toBe('INPUT');
  });

  it('passes native props (placeholder, type) through to the input', () => {
    render(<TextInput label="Pw" type="password" placeholder="secret" />);
    const input = screen.getByLabelText('Pw') as HTMLInputElement;
    expect(input.type).toBe('password');
    expect(input.placeholder).toBe('secret');
  });

  it('respects an explicit id (label + describedby use it)', () => {
    render(<TextInput id="my-field" label="Name" error="x" />);
    const input = screen.getByLabelText('Name');
    expect(input.id).toBe('my-field');
    expect(input.getAttribute('aria-describedby')).toBe('my-field-err');
  });
});
