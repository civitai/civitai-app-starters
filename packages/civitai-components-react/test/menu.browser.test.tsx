/**
 * The menu, driven through the PACKAGE ROOT.
 *
 * Every import below comes from `../src/index.js` — the module `package.json`'s
 * `.` entry points at — because the surface is what is under test, not the
 * mechanics. `elements.browser.test.tsx` imports per-binding paths and owns the
 * mechanics (property assignment, refs, `change` retargeting); this file asserts
 * that an app block can build a dropdown, and NAME the type of what `onSelect`
 * hands it, with `@civitai/components-react` as its only import.
 *
 * `MenuSelectDetail` used to be reachable from neither entry of this package —
 * only from `@civitai/components/civitai-menu`, a second direct dependency for a
 * type this package's own published `onSelect` signature already mentions. The
 * sibling in `test/entry-points.test.ts` is what pins the NAME onto the built
 * `.d.ts`; this file is the behavioural half, since a structural check on a
 * `.d.ts` cannot tell that `detail` really carries `value`.
 *
 * 🔴 The `import type` here is NOT itself a type guard: vitest transforms with
 * oxc, which strips types without checking them, and this package's `typecheck`
 * excludes `test/`. If the export were removed, this file would still run — it
 * is `entry-points.test.ts` that goes red. Do not read a green run here as
 * evidence the type is exported.
 */
import { describe, expect, it } from 'vitest';

import {
  CivitaiMenu,
  CivitaiMenuItem,
  CivitaiMenuLabel,
  type MenuSelectDetail,
} from '../src/index.js';
import { mountReact, settle } from './render.js';

/** The menu opens on a Lit update, and the popover toggle costs a second one. */
async function settleTwice(mount: HTMLElement): Promise<void> {
  await settle(mount);
  await settle(mount);
}

/** The shape `ZacxDev/civitai-app-model-benchmarking`'s Contribute menu needs. */
function ContributeMenu({ onSelect }: { onSelect: (detail: MenuSelectDetail) => void }) {
  return (
    <CivitaiMenu label="Contribute" onSelect={(event) => onSelect(event.detail)}>
      <button slot="trigger" type="button">
        Contribute
      </button>
      <CivitaiMenuLabel>Add to the benchmark</CivitaiMenuLabel>
      <CivitaiMenuItem value="combination">Submit a combination</CivitaiMenuItem>
      <CivitaiMenuItem value="prompt">Submit a prompt</CivitaiMenuItem>
      <CivitaiMenuItem value="blocked" disabled>
        Submit a workflow
      </CivitaiMenuItem>
    </CivitaiMenu>
  );
}

describe('the menu, off the package root', () => {
  it('renders three upgraded elements from the root barrel', async () => {
    const { mount, cleanup } = mountReact('dark', <ContributeMenu onSelect={() => {}} />);
    try {
      await settle(mount);
      // `shadowRoot` is only non-null once the element has been UPGRADED, which
      // is the thing a bare unregistered tag would fail — and the reason this
      // suite runs in real Chromium rather than happy-dom.
      expect(mount.querySelector('civitai-menu')!.shadowRoot).not.toBeNull();
      expect(mount.querySelector('civitai-menu-label')!.shadowRoot).not.toBeNull();
      expect(mount.querySelectorAll('civitai-menu-item')).toHaveLength(3);
      for (const item of mount.querySelectorAll('civitai-menu-item')) {
        expect(item.shadowRoot).not.toBeNull();
        expect(item.getAttribute('role')).toBe('menuitem');
      }
      // The label names the group without joining the item count.
      expect(mount.querySelector('civitai-menu-label')!.getAttribute('role')).toBe('presentation');
    } finally {
      cleanup();
    }
  });

  it('delivers the chosen value to onSelect, and closes', async () => {
    const seen: MenuSelectDetail[] = [];
    const { mount, cleanup } = mountReact(
      'dark',
      <ContributeMenu onSelect={(detail) => seen.push(detail)} />
    );
    try {
      await settleTwice(mount);
      const menu = mount.querySelector('civitai-menu') as HTMLElement & { open: boolean };

      mount.querySelector<HTMLButtonElement>('[slot="trigger"]')!.click();
      await settleTwice(mount);
      expect(menu.open).toBe(true);

      mount.querySelectorAll<HTMLElement>('civitai-menu-item')[1]!.click();
      await settleTwice(mount);

      // The literal expected value, not one read back off the element: the
      // whole claim is that `detail.value` is the item's `value`.
      expect(seen).toEqual([{ value: 'prompt' }]);
      expect(menu.open).toBe(false);
    } finally {
      cleanup();
    }
  });

  /**
   * 🔴 READ THE SCOPE — this pins the BEHAVIOUR, not either layer that provides
   * it. MEASURED by mutation, and the result is worth writing down: the
   * suppression is REDUNDANT across two elements, so neither mutant alone kills
   * this test.
   *
   *   drop `item.disabled` from `<civitai-menu>`'s panel click handler  -> SURVIVED
   *   neuter `<civitai-menu-item>`'s capture-phase `#gate`              -> SURVIVED
   *   drop BOTH                                                        -> KILLED,
   *     `expected [] to deeply equal [{ value: 'blocked' }]`
   *
   * The item's `#gate` calls `stopImmediatePropagation()` in the CAPTURE phase,
   * so a real click on a disabled item never reaches the menu's bubble-phase
   * handler and the menu's own `item.disabled` clause is unreachable FOR A
   * CLICK. Do not read this test as covering that clause; do not delete it on
   * the strength of this test either.
   */
  it('does not fire onSelect for a disabled item', async () => {
    // Also a control on the assertion above: a handler wired to nothing would
    // pass that one only by luck, and would pass this one for the wrong reason.
    const seen: MenuSelectDetail[] = [];
    const { mount, cleanup } = mountReact(
      'dark',
      <ContributeMenu onSelect={(detail) => seen.push(detail)} />
    );
    try {
      await settleTwice(mount);
      const menu = mount.querySelector('civitai-menu') as HTMLElement & { open: boolean };

      mount.querySelector<HTMLButtonElement>('[slot="trigger"]')!.click();
      await settleTwice(mount);

      mount.querySelectorAll<HTMLElement>('civitai-menu-item')[2]!.click();
      await settleTwice(mount);

      expect(seen).toEqual([]);
      expect(menu.open).toBe(true);
    } finally {
      cleanup();
    }
  });
});
