import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import type { CivitaiSegmentedControl } from '@civitai/components/civitai-segmented-control';
import type { CivitaiTextInput } from '@civitai/components/civitai-text-input';
import type { PickedResource, ResourceSource } from '@civitai/components/civitai-resource-picker';
import type { TagVoteDetail } from '@civitai/components/civitai-tag';

import { CivitaiButton } from '../src/elements/civitai-button.js';
import { CivitaiResourcePicker } from '../src/elements/civitai-resource-picker.js';
import { CivitaiSegmentedControl as Segmented } from '../src/elements/civitai-segmented-control.js';
import { CivitaiTag } from '../src/elements/civitai-tag.js';
import { CivitaiTextInput as TextInput } from '../src/elements/civitai-text-input.js';
import { mountReact, settle } from './render.js';

const SEGMENTS = [
  { value: 'grid', label: 'Grid' },
  { value: 'list', label: 'List' },
];

describe('React element bindings', () => {
  it('renders a real custom element, upgraded', async () => {
    const { mount, cleanup } = mountReact('light', <CivitaiButton>Go</CivitaiButton>);
    try {
      await settle(mount);
      const el = mount.querySelector('civitai-button')!;
      // Slotted text is not in the shadow node's `textContent`; the slot's
      // assigned nodes are where it actually lands.
      const slot = el.shadowRoot!.querySelector('button slot:not([name])') as HTMLSlotElement;
      expect(slot.assignedNodes({ flatten: true }).map((n) => n.textContent).join('')).toBe('Go');
    } finally {
      cleanup();
    }
  });

  it('sets props as PROPERTIES, which is what React 19 gets wrong on its own', async () => {
    const { mount, cleanup } = mountReact(
      'light',
      <CivitaiButton variant="outline" size="lg" loading fullWidth>
        Go
      </CivitaiButton>
    );
    try {
      await settle(mount);
      const el = mount.querySelector('civitai-button') as HTMLElement & {
        loading: boolean;
        fullWidth: boolean;
        variant: string;
      };
      // React picks attribute-vs-property by upgrade state and once wrote
      // `loading=""` here; the binding always takes the property path.
      expect(el.loading).toBe(true);
      expect(el.fullWidth).toBe(true);
      expect(el.variant).toBe('outline');
    } finally {
      cleanup();
    }
  });

  it('hands a ref the element itself, not a wrapper', async () => {
    let captured: CivitaiTextInput | null = null;
    const { mount, cleanup } = mountReact(
      'light',
      <TextInput ref={(el) => void (captured = el)} label="Prompt" />
    );
    try {
      await settle(mount);
      expect(captured).toBe(mount.querySelector('civitai-text-input'));
      expect((captured as unknown as CivitaiTextInput).label).toBe('Prompt');
    } finally {
      cleanup();
    }
  });

  it('carries an object prop across, which an attribute could never do', async () => {
    const { mount, cleanup } = mountReact('light', <Segmented data={SEGMENTS} aria-label="View" />);
    try {
      await settle(mount);
      const el = mount.querySelector('civitai-segmented-control') as CivitaiSegmentedControl;
      expect(el.data).toEqual(SEGMENTS);
      expect(el.shadowRoot!.querySelectorAll('button')).toHaveLength(2);
    } finally {
      cleanup();
    }
  });

  it('delivers a typed custom event to its handler', async () => {
    const seen: TagVoteDetail[] = [];
    const { mount, cleanup } = mountReact(
      'light',
      <CivitaiTag name="wolf" onVote={(event) => seen.push(event.detail)} />
    );
    try {
      await settle(mount);
      const el = mount.querySelector('civitai-tag')!;
      el.shadowRoot!.querySelector<HTMLButtonElement>('button.up')!.click();
      expect(seen).toEqual([{ name: 'wolf', vote: 1 }]);
    } finally {
      cleanup();
    }
  });

  it('delivers the change the field re-dispatches out of its shadow root', async () => {
    const seen: string[] = [];
    const { mount, cleanup } = mountReact(
      'light',
      <Segmented
        data={SEGMENTS}
        aria-label="View"
        onChange={(event) => seen.push((event.target as CivitaiSegmentedControl).value)}
      />
    );
    try {
      await settle(mount);
      const el = mount.querySelector('civitai-segmented-control')!;
      el.shadowRoot!.querySelectorAll<HTMLButtonElement>('button')[1]!.click();
      expect(seen).toEqual(['list']);
    } finally {
      cleanup();
    }
  });

  it('follows React state, re-setting the property on each render', async () => {
    function Controlled(): React.JSX.Element {
      const [value, setValue] = useState('a');
      return (
        <>
          <TextInput label="Prompt" value={value} />
          <button type="button" onClick={() => setValue('b')}>
            set
          </button>
        </>
      );
    }
    const { mount, cleanup } = mountReact('light', <Controlled />);
    try {
      await settle(mount);
      const el = mount.querySelector('civitai-text-input') as CivitaiTextInput;
      expect(el.value).toBe('a');

      mount.querySelector('button')!.click();
      await settle(mount);
      expect(el.value).toBe('b');
    } finally {
      cleanup();
    }
  });
  it('wires a resource picker: the source as a property, and onPick / onDismiss', async () => {
    const source: ResourceSource = {
      search: async (params) => ({
        owner: params.owner,
        nextCursor: null,
        items: [
          {
            modelId: 12,
            name: 'Upscale Chain',
            type: 'Workflows',
            creatorUsername: 'maker',
            versions: [{ id: 34, name: 'v2', baseModel: 'SDXL 1.0' }],
          },
        ],
      }),
    };
    const picks: PickedResource[] = [];
    let dismissed = 0;
    const { mount, cleanup } = mountReact(
      'light',
      <CivitaiResourcePicker
        open
        types="Workflows"
        source={source}
        onPick={(event) => picks.push(event.detail)}
        onDismiss={() => (dismissed += 1)}
      />
    );
    try {
      const el = mount.querySelector('civitai-resource-picker')!;
      for (let i = 0; i < 20 && !el.shadowRoot?.querySelector('[part~="select"]'); i++) {
        await settle(mount);
        await new Promise((r) => setTimeout(r, 10));
      }
      expect(el.source).toBe(source);
      el.shadowRoot!.querySelector<HTMLElement>('[part~="select"]')!.click();
      expect(picks).toEqual([
        {
          modelId: 12,
          modelVersionId: 34,
          name: 'Upscale Chain',
          versionName: 'v2',
          creatorUsername: 'maker',
          baseModel: 'SDXL 1.0',
          access: 'open',
          owner: 'any',
        },
      ]);
      expect(dismissed).toBe(0);
    } finally {
      cleanup();
    }
  });
});
