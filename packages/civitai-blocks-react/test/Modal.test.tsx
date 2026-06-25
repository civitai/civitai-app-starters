import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Modal } from '../src/ui/Modal.js';

afterEach(() => {
  cleanup();
  document.querySelectorAll('style[data-civitai-blocks-ui]').forEach((el) => el.remove());
});

function overlay(): HTMLElement {
  return document.querySelector('[data-civitai-ui="modal-overlay"]') as HTMLElement;
}

describe('Modal', () => {
  it('renders nothing when not opened', () => {
    render(
      <Modal opened={false} onClose={() => {}}>
        body
      </Modal>
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText('body')).toBeNull();
  });

  it('renders a dialog with aria-modal when opened', () => {
    render(
      <Modal opened onClose={() => {}}>
        body
      </Modal>
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(screen.getByText('body')).toBeTruthy();
  });

  it('wires aria-labelledby to the title', () => {
    render(
      <Modal opened onClose={() => {}} title="Confirm">
        body
      </Modal>
    );
    const dialog = screen.getByRole('dialog');
    const labelledBy = dialog.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    expect(screen.getByText('Confirm').id).toBe(labelledBy);
  });

  it('focuses the panel on open', () => {
    render(
      <Modal opened onClose={() => {}}>
        body
      </Modal>
    );
    expect(document.activeElement).toBe(screen.getByRole('dialog'));
  });

  it('calls onClose on Escape', () => {
    const onClose = vi.fn();
    render(
      <Modal opened onClose={onClose}>
        body
      </Modal>
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close on Escape when closeOnEscape=false', () => {
    const onClose = vi.fn();
    render(
      <Modal opened onClose={onClose} closeOnEscape={false}>
        body
      </Modal>
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls onClose on an overlay click', () => {
    const onClose = vi.fn();
    render(
      <Modal opened onClose={onClose}>
        body
      </Modal>
    );
    fireEvent.mouseDown(overlay());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does NOT close on a click inside the panel', () => {
    const onClose = vi.fn();
    render(
      <Modal opened onClose={onClose}>
        <span>body</span>
      </Modal>
    );
    fireEvent.mouseDown(screen.getByText('body'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not close on overlay click when closeOnOverlayClick=false', () => {
    const onClose = vi.fn();
    render(
      <Modal opened onClose={onClose} closeOnOverlayClick={false}>
        body
      </Modal>
    );
    fireEvent.mouseDown(overlay());
    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls onClose from the header close button', () => {
    const onClose = vi.fn();
    render(
      <Modal opened onClose={onClose} title="T">
        body
      </Modal>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('omits the close button when withCloseButton=false', () => {
    render(
      <Modal opened onClose={() => {}} title="T" withCloseButton={false}>
        body
      </Modal>
    );
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
  });

  it('reflects size on data-size (default md)', () => {
    render(
      <Modal opened onClose={() => {}}>
        body
      </Modal>
    );
    expect(screen.getByRole('dialog').getAttribute('data-size')).toBe('md');
    cleanup();
    render(
      <Modal opened onClose={() => {}} size="lg">
        body
      </Modal>
    );
    expect(screen.getByRole('dialog').getAttribute('data-size')).toBe('lg');
  });

  it('restores focus to the previously-focused element on close', () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'open';
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const { rerender } = render(
      <Modal opened onClose={() => {}}>
        body
      </Modal>
    );
    expect(document.activeElement).toBe(screen.getByRole('dialog'));

    rerender(
      <Modal opened={false} onClose={() => {}}>
        body
      </Modal>
    );
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });
});
