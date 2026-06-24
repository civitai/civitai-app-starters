import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRef } from 'react';

import { Textarea } from '../src/ui/Textarea.js';

afterEach(() => {
  cleanup();
  document.querySelectorAll('style[data-civitai-blocks-ui]').forEach((el) => el.remove());
});

describe('Textarea', () => {
  it('calls onChange as the user types', () => {
    const onChange = vi.fn();
    render(<Textarea label="Bio" onChange={onChange} />);
    const input = screen.getByLabelText('Bio') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'hello' } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]![0].target.value).toBe('hello');
  });

  it('renders a native textarea linked to the label', () => {
    render(<Textarea label="Bio" />);
    expect(screen.getByLabelText('Bio').tagName).toBe('TEXTAREA');
  });

  it('sets aria-invalid and announces + links the error', () => {
    render(<Textarea label="Bio" error="Too long" />);
    const input = screen.getByLabelText('Bio');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const err = screen.getByRole('alert');
    expect(err.textContent).toBe('Too long');
    expect(input.getAttribute('aria-describedby')!.split(' ')).toContain(err.id);
  });

  it('applies minRows to the native rows attribute', () => {
    render(<Textarea label="Bio" minRows={6} />);
    expect(screen.getByLabelText('Bio').getAttribute('rows')).toBe('6');
  });

  it('minRows wins over rows when both are passed', () => {
    render(<Textarea label="Bio" rows={2} minRows={8} />);
    expect(screen.getByLabelText('Bio').getAttribute('rows')).toBe('8');
  });

  it('falls back to rows when no minRows', () => {
    render(<Textarea label="Bio" rows={4} />);
    expect(screen.getByLabelText('Bio').getAttribute('rows')).toBe('4');
  });

  it('marks required + aria-required', () => {
    render(<Textarea id="req-bio" label="Bio" required />);
    // Required asterisk in the label makes the accessible label "Bio *";
    // query by id.
    const input = document.getElementById('req-bio') as HTMLTextAreaElement;
    expect(input.required).toBe(true);
    expect(input.getAttribute('aria-required')).toBe('true');
  });

  it('forwards a ref to the native textarea', () => {
    const ref = createRef<HTMLTextAreaElement>();
    render(<Textarea label="Bio" ref={ref} />);
    expect(ref.current?.tagName).toBe('TEXTAREA');
  });
});
