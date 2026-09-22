/**
 * Runs on every engine in the matrix. Keep it to the cross-browser contract —
 * the behaviour suites already cover the rest on chromium alone.
 */
import { describe, expect, it } from 'vitest';

import { CAPABILITIES, missingCapabilities } from '../src/elements/capabilities.js';
import type { CivitaiSegmentedControl } from '../src/elements/civitai-segmented-control.js';
import type { CivitaiTextInput } from '../src/elements/civitai-text-input.js';
import '../src/elements/register.js';

const settle = async (el: HTMLElement & { updateComplete: Promise<boolean> }): Promise<void> => {
  await el.updateComplete;
};

function mount<T extends HTMLElement>(markup: string): { scope: HTMLElement; el: T } {
  const scope = document.createElement('div');
  scope.setAttribute('data-theme', 'light');
  scope.innerHTML = markup;
  document.body.append(scope);
  return { scope, el: scope.firstElementChild as T };
}

describe('platform capabilities', () => {
  it.each(CAPABILITIES.map((c) => [c.name, c] as const))('%s is supported', (_name, capability) => {
    expect(capability.supported(), `missing — breaks ${capability.needed}`).toBe(true);
  });

  it('reports nothing missing overall', () => {
    expect(missingCapabilities()).toEqual([]);
  });
});

describe('cross-engine element contract', () => {
  it('elements upgrade and render a shadow root', async () => {
    const { scope, el } = mount<HTMLElement & { updateComplete: Promise<boolean> }>(
      '<civitai-button>Go</civitai-button>'
    );
    try {
      await settle(el);
      expect(el.shadowRoot?.querySelector('button')).toBeTruthy();
    } finally {
      scope.remove();
    }
  });

  it('tokens inherit across the shadow boundary', async () => {
    const { scope, el } = mount<HTMLElement & { updateComplete: Promise<boolean> }>(
      '<civitai-button>Go</civitai-button>'
    );
    try {
      await settle(el);
      const background = getComputedStyle(el.shadowRoot!.querySelector('button')!).backgroundColor;
      expect(background).not.toBe('');
      expect(background).not.toBe('rgba(0, 0, 0, 0)');
    } finally {
      scope.remove();
    }
  });

  it('a form-associated element reaches its form and round-trips a value', async () => {
    const { scope } = mount(
      '<form><civitai-text-input name="q" value="hi"></civitai-text-input></form>'
    );
    try {
      const el = scope.querySelector<CivitaiTextInput>('civitai-text-input')!;
      await settle(el);
      expect(el.form).toBe(scope.querySelector('form'));
      expect(new FormData(scope.querySelector('form')!).get('q')).toBe('hi');
    } finally {
      scope.remove();
    }
  });

  it('change crosses the shadow boundary', async () => {
    const { scope } = mount('<civitai-segmented-control aria-label="View"></civitai-segmented-control>');
    try {
      const el = scope.querySelector<CivitaiSegmentedControl>('civitai-segmented-control')!;
      el.data = [
        { value: 'grid', label: 'Grid' },
        { value: 'list', label: 'List' },
      ];
      await settle(el);
      let seen = 0;
      document.addEventListener('change', () => void (seen += 1));
      el.shadowRoot!.querySelectorAll('button')[1]!.click();
      await settle(el);
      expect(seen).toBe(1);
    } finally {
      scope.remove();
    }
  });

  it('::part is reachable from outside the shadow root', async () => {
    const style = document.createElement('style');
    style.textContent = 'civitai-button::part(button) { letter-spacing: 3px; }';
    document.head.append(style);
    const { scope, el } = mount<HTMLElement & { updateComplete: Promise<boolean> }>(
      '<civitai-button>Go</civitai-button>'
    );
    try {
      await settle(el);
      expect(getComputedStyle(el.shadowRoot!.querySelector('button')!).letterSpacing).toBe('3px');
    } finally {
      scope.remove();
      style.remove();
    }
  });
});
