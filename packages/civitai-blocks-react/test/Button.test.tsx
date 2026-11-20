import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRef } from 'react';

import { Button } from '../src/ui/Button.js';

/**
 * Behavioral coverage for Button. Asserts on observable behavior (click
 * firing, disabled/loading guards, the data-* hooks the injected CSS reads)
 * rather than computed styles — robust against any future restyle.
 *
 * No jest-dom in this package's harness — assertions read DOM props /
 * attributes directly, matching the SettingsForm test convention.
 */

afterEach(() => {
  cleanup();
  document.querySelectorAll('style[data-civitai-blocks-ui]').forEach((el) => el.remove());
});

function btnOf(text: string): HTMLButtonElement {
  return screen.getByText(text).closest('button') as HTMLButtonElement;
}

describe('Button', () => {
  it('fires onClick when enabled', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Go</Button>);
    fireEvent.click(screen.getByText('Go'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does not fire onClick when disabled', () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Go
      </Button>
    );
    fireEvent.click(screen.getByText('Go'));
    expect(onClick).not.toHaveBeenCalled();
    expect(btnOf('Go').disabled).toBe(true);
  });

  it('blocks onClick and sets aria-busy when loading', () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Go
      </Button>
    );
    const btn = btnOf('Go');
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
    expect(btn.getAttribute('aria-busy')).toBe('true');
    expect(btn.disabled).toBe(true);
  });

  it('renders a loader while loading (aria-hidden — the button itself is aria-busy)', () => {
    render(<Button loading>Go</Button>);
    const loader = document.querySelector('[data-civitai-ui="loader"]');
    expect(loader).not.toBeNull();
    // The spinner must not double-announce — aria-busy on the button covers it.
    expect(loader!.getAttribute('aria-hidden')).toBe('true');
  });

  it('renders no loader when not loading', () => {
    render(<Button>Go</Button>);
    expect(document.querySelector('[data-civitai-ui="loader"]')).toBeNull();
  });

  it('reflects variant + size on data-attrs', () => {
    render(
      <Button variant="outline" size="lg">
        Go
      </Button>
    );
    const btn = btnOf('Go');
    expect(btn.getAttribute('data-variant')).toBe('outline');
    expect(btn.getAttribute('data-size')).toBe('lg');
  });

  it('defaults to filled / md', () => {
    render(<Button>Go</Button>);
    const btn = btnOf('Go');
    expect(btn.getAttribute('data-variant')).toBe('filled');
    expect(btn.getAttribute('data-size')).toBe('md');
  });

  it('sets data-full-width when fullWidth', () => {
    render(<Button fullWidth>Go</Button>);
    expect(btnOf('Go').getAttribute('data-full-width')).toBe('true');
  });

  it('omits data-full-width by default', () => {
    render(<Button>Go</Button>);
    expect(btnOf('Go').getAttribute('data-full-width')).toBeNull();
  });

  it('defaults type to button (no implicit form submit)', () => {
    render(<Button>Go</Button>);
    expect(btnOf('Go').getAttribute('type')).toBe('button');
  });

  it('honors an explicit type=submit', () => {
    render(<Button type="submit">Go</Button>);
    expect(btnOf('Go').getAttribute('type')).toBe('submit');
  });

  it('renders left and right sections around the label', () => {
    render(
      <Button leftSection={<span>L</span>} rightSection={<span>R</span>}>
        Mid
      </Button>
    );
    expect(screen.getByText('L')).toBeTruthy();
    expect(screen.getByText('R')).toBeTruthy();
    expect(screen.getByText('Mid')).toBeTruthy();
  });

  it('maps a semantic color onto the primary CSS var', () => {
    render(<Button color="error">Go</Button>);
    const btn = btnOf('Go');
    expect(btn.style.getPropertyValue('--civitai-color-primary')).toBe('var(--civitai-color-error)');
  });

  it('passes an arbitrary CSS color through to the var', () => {
    render(<Button color="#ff00ff">Go</Button>);
    expect(btnOf('Go').style.getPropertyValue('--civitai-color-primary')).toBe('#ff00ff');
  });

  it('leaves the primary var untouched for the default color', () => {
    render(<Button>Go</Button>);
    expect(btnOf('Go').style.getPropertyValue('--civitai-color-primary')).toBe('');
  });

  it('forwards a ref to the native button', () => {
    const ref = createRef<HTMLButtonElement>();
    render(<Button ref={ref}>Go</Button>);
    expect(ref.current?.tagName).toBe('BUTTON');
  });

  it('passes className and arbitrary native props through', () => {
    render(
      <Button className="custom" data-testid="b" aria-label="go-btn">
        Go
      </Button>
    );
    const btn = screen.getByTestId('b');
    expect(btn.classList.contains('custom')).toBe(true);
    expect(btn.getAttribute('aria-label')).toBe('go-btn');
  });

  // Regression (B1): an author-passed data-civitai-ui must NOT win — the whole
  // injected stylesheet keys off [data-civitai-ui='button'], so letting a stray
  // spread prop clobber it would render the button completely unstyled.
  it('keeps data-civitai-ui="button" even when an author passes data-civitai-ui="evil"', () => {
    render(
      <Button data-testid="b" {...({ 'data-civitai-ui': 'evil' } as Record<string, string>)}>
        Go
      </Button>
    );
    expect(screen.getByTestId('b').getAttribute('data-civitai-ui')).toBe('button');
  });

  // Regression (B2): aria-busy is component-owned while loading — an author
  // passing aria-busy="false" must not falsely tell a screen reader the control
  // is idle during a load.
  it('keeps aria-busy="true" while loading even when an author passes aria-busy="false"', () => {
    render(
      <Button data-testid="b" loading aria-busy="false">
        Go
      </Button>
    );
    expect(screen.getByTestId('b').getAttribute('aria-busy')).toBe('true');
  });
});
