import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Alert } from '../src/ui/Alert.js';

afterEach(() => {
  cleanup();
  document.querySelectorAll('style[data-civitai-blocks-ui]').forEach((el) => el.remove());
});

describe('Alert', () => {
  it('renders with role="alert" so it is announced', () => {
    render(<Alert>heads up</Alert>);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('heads up');
  });

  it('reflects color on data-color (default info)', () => {
    render(<Alert>x</Alert>);
    expect(screen.getByRole('alert').getAttribute('data-color')).toBe('info');
    cleanup();
    render(<Alert color="error">x</Alert>);
    expect(screen.getByRole('alert').getAttribute('data-color')).toBe('error');
  });

  it('renders an optional title', () => {
    render(<Alert title="Warning">body</Alert>);
    expect(screen.getByText('Warning')).toBeTruthy();
    expect(screen.getByText('body')).toBeTruthy();
  });

  it('shows no close button by default', () => {
    render(<Alert>x</Alert>);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn();
    render(
      <Alert withCloseButton onClose={onClose}>
        x
      </Alert>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close alert' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('uses a custom close-button label', () => {
    render(
      <Alert withCloseButton onClose={() => {}} closeButtonLabel="Dismiss">
        x
      </Alert>
    );
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeTruthy();
  });
});
