import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import type { CivitaiSegmentedControl } from '@civitai/components/civitai-segmented-control';
import type { CivitaiTextInput } from '@civitai/components/civitai-text-input';

import {
  ButtonElement,
  SegmentedControlElement,
  TextInputElement,
} from '../src/elements/index.js';
import { mountReact } from './render.js';

const SEGMENTS = [
  { value: 'grid', label: 'Grid' },
  { value: 'list', label: 'List' },
];

/** Lit renders async, so a mounted element is not populated on the same tick. */
async function settle(mount: HTMLElement): Promise<void> {
  await Promise.all(
    [...mount.querySelectorAll('*')]
      .filter((el): el is HTMLElement & { updateComplete: Promise<boolean> } =>
        'updateComplete' in el
      )
      .map((el) => el.updateComplete)
  );
}

describe('React element wrappers', () => {
  it('renders a real custom element, upgraded', async () => {
    const { mount, cleanup } = mountReact('light', <ButtonElement>Go</ButtonElement>);
    try {
      await settle(mount);
      const el = mount.querySelector('civitai-button')!;
      expect(el.shadowRoot).not.toBeNull();
      expect(el.shadowRoot!.querySelector('button')).not.toBeNull();
    } finally {
      cleanup();
    }
  });

  it('maps props onto the element, booleans included', async () => {
    const { mount, cleanup } = mountReact(
      'light',
      <ButtonElement variant="outline" size="lg" loading fullWidth>
        Go
      </ButtonElement>
    );
    try {
      await settle(mount);
      const el = mount.querySelector('civitai-button')!;
      expect(el.variant).toBe('outline');
      expect(el.size).toBe('lg');
      expect(el.loading).toBe(true);
      expect(el.fullWidth).toBe(true);
      expect(el.shadowRoot!.querySelector('button')!.disabled).toBe(true);
    } finally {
      cleanup();
    }
  });

  it('forwards a ref to the element instance', async () => {
    let captured: CivitaiTextInput | null = null;
    const { mount, cleanup } = mountReact(
      'light',
      <TextInputElement ref={(el) => void (captured = el)} label="Prompt" />
    );
    try {
      await settle(mount);
      expect(captured).toBe(mount.querySelector('civitai-text-input'));
    } finally {
      cleanup();
    }
  });

  it('delivers change from inside the shadow root to an onChange prop', async () => {
    const seen: string[] = [];
    const { mount, cleanup } = mountReact(
      'light',
      <SegmentedControlElement data={SEGMENTS} aria-label="View" onChange={(v) => seen.push(v)} />
    );
    try {
      await settle(mount);
      const el = mount.querySelector<CivitaiSegmentedControl>('civitai-segmented-control')!;
      el.shadowRoot!.querySelectorAll('button')[1]!.click();
      await el.updateComplete;
      expect(seen).toEqual(['list']);
    } finally {
      cleanup();
    }
  });

  it('passes array data as a property, not a stringified attribute', async () => {
    const { mount, cleanup } = mountReact(
      'light',
      <SegmentedControlElement data={SEGMENTS} aria-label="View" />
    );
    try {
      await settle(mount);
      const el = mount.querySelector<CivitaiSegmentedControl>('civitai-segmented-control')!;
      expect(el.data).toEqual(SEGMENTS);
      expect(el.hasAttribute('data')).toBe(false);
      expect(el.shadowRoot!.querySelectorAll('button')).toHaveLength(2);
    } finally {
      cleanup();
    }
  });

  it('drives a controlled text input from React state', async () => {
    function Controlled(): React.JSX.Element {
      const [value, setValue] = useState('a cat');
      return (
        <>
          <TextInputElement label="Prompt" value={value} onInput={setValue} />
          <output>{value}</output>
        </>
      );
    }
    const { mount, cleanup } = mountReact('light', <Controlled />);
    try {
      await settle(mount);
      const el = mount.querySelector<CivitaiTextInput>('civitai-text-input')!;
      const control = el.shadowRoot!.querySelector('input')!;
      expect(control.value).toBe('a cat');

      control.value = 'a dog';
      control.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      await el.updateComplete;

      expect(mount.querySelector('output')!.textContent).toBe('a dog');
      expect(el.value).toBe('a dog');
    } finally {
      cleanup();
    }
  });
});
