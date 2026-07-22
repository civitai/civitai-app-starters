/**
 * Unit suite (happy-dom) — asserts each binding renders the correct
 * `data-civitai-ui` markup contract + ARIA wiring. Layout/computed-style parity
 * is covered separately in the browser suite (`*.browser.test.tsx`).
 */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Loader,
  NumberInput,
  Stack,
  TextInput,
  Textarea,
} from '../src/index.js';

afterEach(cleanup);

describe('markup contract', () => {
  it('Button renders the attribute contract + defaults', () => {
    const { container } = render(<Button>Go</Button>);
    const btn = container.querySelector('[data-civitai-ui="button"]')!;
    expect(btn.tagName).toBe('BUTTON');
    expect(btn.getAttribute('data-variant')).toBe('filled');
    expect(btn.getAttribute('data-size')).toBe('md');
    expect(btn.getAttribute('type')).toBe('button');
  });

  it('Button loading sets aria-busy + disabled + a loader child', () => {
    const { container } = render(<Button loading>Go</Button>);
    const btn = container.querySelector<HTMLButtonElement>('[data-civitai-ui="button"]')!;
    expect(btn.getAttribute('aria-busy')).toBe('true');
    expect(btn.disabled).toBe(true);
    expect(btn.querySelector('[data-civitai-ui="loader"]')).toBeTruthy();
  });

  it('Button variant/size/fullWidth pass through', () => {
    const { container } = render(
      <Button variant="outline" size="lg" fullWidth>
        Go
      </Button>
    );
    const btn = container.querySelector('[data-civitai-ui="button"]')!;
    expect(btn.getAttribute('data-variant')).toBe('outline');
    expect(btn.getAttribute('data-size')).toBe('lg');
    expect(btn.getAttribute('data-full-width')).toBe('true');
  });

  it('TextInput wires label htmlFor to the control id', () => {
    const { container } = render(<TextInput label="Name" id="t1" />);
    const label = container.querySelector('label[data-civitai-ui-label]')!;
    const input = container.querySelector('[data-civitai-ui-control]')!;
    expect(label.getAttribute('for')).toBe('t1');
    expect(input.getAttribute('id')).toBe('t1');
    expect(container.querySelector('[data-civitai-ui="text-input"]')).toBeTruthy();
  });

  it('TextInput error sets aria-invalid + describedby + role=alert message', () => {
    const { container } = render(<TextInput label="Name" error="Required" id="t2" />);
    const input = container.querySelector('[data-civitai-ui-control]')!;
    const err = container.querySelector('[data-civitai-ui-error]')!;
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(err.getAttribute('role')).toBe('alert');
    expect(input.getAttribute('aria-describedby')).toContain(err.id);
  });

  it('TextInput required sets native required + asterisk', () => {
    const { container } = render(<TextInput label="Name" required id="t3" />);
    const input = container.querySelector<HTMLInputElement>('[data-civitai-ui-control]')!;
    expect(input.required).toBe(true);
    expect(container.querySelector('[data-civitai-ui-required]')).toBeTruthy();
  });

  it('Textarea renders a <textarea> control', () => {
    const { container } = render(<Textarea label="Prompt" id="ta" />);
    const el = container.querySelector('[data-civitai-ui-control]')!;
    expect(el.tagName).toBe('TEXTAREA');
    expect(container.querySelector('[data-civitai-ui="textarea"]')).toBeTruthy();
  });

  it('NumberInput renders input[type=number]', () => {
    const { container } = render(<NumberInput label="Steps" id="n1" />);
    const el = container.querySelector<HTMLInputElement>('[data-civitai-ui-control]')!;
    expect(el.getAttribute('type')).toBe('number');
    expect(container.querySelector('[data-civitai-ui="number-input"]')).toBeTruthy();
  });

  it('Card exposes border + padding attributes', () => {
    const { container } = render(<Card padding="lg">x</Card>);
    const card = container.querySelector('[data-civitai-ui="card"]')!;
    expect(card.getAttribute('data-with-border')).toBe('true');
    expect(card.getAttribute('data-padding')).toBe('lg');
  });

  it('Stack / Group render layout markers + gap', () => {
    const { container: s } = render(<Stack gap="lg">x</Stack>);
    expect(s.querySelector('[data-civitai-ui="stack"]')!.getAttribute('data-gap')).toBe('lg');
    const { container: g } = render(<Group gap="sm">x</Group>);
    expect(g.querySelector('[data-civitai-ui="group"]')!.getAttribute('data-gap')).toBe('sm');
  });

  it('Alert has role=alert, color, title, and dismiss button', () => {
    const { container } = render(
      <Alert color="success" title="Saved" onClose={() => {}}>
        body
      </Alert>
    );
    const alert = container.querySelector('[data-civitai-ui="alert"]')!;
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.getAttribute('data-color')).toBe('success');
    expect(container.querySelector('[data-civitai-ui-alert-title]')!.textContent).toBe('Saved');
    const close = container.querySelector('[data-civitai-ui-alert-close]')!;
    expect(close.getAttribute('aria-label')).toBe('Dismiss');
  });

  it('Loader / Badge render markers + size/variant', () => {
    const { container: l } = render(<Loader size="lg" />);
    expect(l.querySelector('[data-civitai-ui="loader"]')!.getAttribute('data-size')).toBe('lg');
    const { container: b } = render(
      <Badge variant="light" size="sm">
        new
      </Badge>
    );
    const badge = b.querySelector('[data-civitai-ui="badge"]')!;
    expect(badge.getAttribute('data-variant')).toBe('light');
    expect(badge.getAttribute('data-size')).toBe('sm');
    // No `color` prop => no data-color attribute (default primary, non-breaking).
    expect(badge.hasAttribute('data-color')).toBe(false);
  });

  it('Badge color maps to data-color (mirrors Alert)', () => {
    const { container } = render(
      <Badge color="success" variant="filled">
        ready
      </Badge>
    );
    const badge = container.querySelector('[data-civitai-ui="badge"]')!;
    expect(badge.getAttribute('data-color')).toBe('success');
  });
});
