/**
 * RESPONSIVE BASE LAYER — real layout, real computed values.
 *
 * The unit guards next door assert the CSS *text* and that the two `group`
 * surfaces agree. Text is not behaviour: a rule can ship and still do nothing
 * (this repo already has the recorded precedent of an inert `@container` class
 * that a text/attribute assertion happily passed). So this suite runs headless
 * Chromium and reads `getComputedStyle` + real geometry.
 *
 * Two deliberate choices:
 *
 *  - It exercises BARE `data-civitai-ui="group"` markup, never React `<Group>`.
 *    `<Group>` writes `flex-wrap` as an INLINE style, so testing through it
 *    would pass whether or not the stylesheet contains the rule — it would
 *    measure the component and call the result a fact about the CSS. Bare
 *    markup is the surface every non-React consumer actually gets.
 *
 *  - Width comes from an explicit fixed-width CONTAINER, never the viewport.
 *    The browser project pins `viewport: { width: 800 }`, and a suite whose
 *    config fixes a dimension is structurally blind to bugs on it. Sizing the
 *    container makes these cases independent of that setting.
 */
import { beforeAll, afterEach, describe, expect, it } from 'vitest';

import { injectBlocksStyles } from '../src/ui/styles.js';

/** Narrower than one row of the three 140px children below — so wrap is forced. */
const CONTAINER_PX = 320;
const CHILD_PX = 140;

let host: HTMLDivElement;

beforeAll(() => {
  injectBlocksStyles();
});

afterEach(() => {
  host?.remove();
});

/**
 * Mount a fixed-width container holding a bare group with `n` fixed-width
 * children. Returns the group plus its children, after layout.
 */
function mountGroup(opts: { nowrap?: boolean; children?: number } = {}) {
  const { nowrap = false, children = 3 } = opts;
  host = document.createElement('div');
  host.style.width = `${CONTAINER_PX}px`;
  host.innerHTML = `
    <div data-civitai-ui="group"${nowrap ? ' data-nowrap="true"' : ''}>
      ${Array.from({ length: children }, (_, i) => `<span data-i="${i}" style="width:${CHILD_PX}px;height:20px;flex:0 0 auto;">c${i}</span>`).join('')}
    </div>`;
  document.body.appendChild(host);
  const group = host.querySelector('[data-civitai-ui="group"]') as HTMLElement;
  const kids = [...group.querySelectorAll('span')] as HTMLElement[];
  // Force layout before anything is measured.
  void group.getBoundingClientRect();
  return { group, kids };
}

/** How many distinct rows the children occupy, by their top edges. */
function rowCount(kids: HTMLElement[]): number {
  return new Set(kids.map((k) => Math.round(k.getBoundingClientRect().top))).size;
}

describe('bare group markup is responsive', () => {
  it('the stylesheet actually applies — computed flex-wrap is wrap', () => {
    const { group } = mountGroup();
    // The computed value, not the CSS source text. Inert rules fail here.
    expect(getComputedStyle(group).flexWrap).toBe('wrap');
    expect(getComputedStyle(group).display).toBe('flex');
  });

  it('three 140px controls in a 320px slot really reflow onto more than one row', () => {
    const { kids } = mountGroup();
    expect(rowCount(kids)).toBeGreaterThan(1);
  });

  it('and the row therefore does not overflow its slot', () => {
    const { group } = mountGroup();
    // scrollWidth > clientWidth is precisely the horizontal-overflow condition
    // this layer exists to remove.
    expect(group.scrollWidth).toBeLessThanOrEqual(group.clientWidth + 1);
  });

  /*
   * THE CONTROL. Everything above would also pass against a group that simply
   * never overflowed for some unrelated reason. Opting out must reproduce the
   * ORIGINAL defect — one row, overflowing — which is what proves the three
   * assertions are sensitive to the property under test.
   */
  it('CONTROL: data-nowrap="true" reproduces the old behaviour — one row, overflowing', () => {
    const { group, kids } = mountGroup({ nowrap: true });
    expect(getComputedStyle(group).flexWrap).toBe('nowrap');
    expect(rowCount(kids)).toBe(1);
    expect(group.scrollWidth).toBeGreaterThan(group.clientWidth);
  });

  it('a long unbroken label shrinks below its content width (min-width: 0 is live)', () => {
    host = document.createElement('div');
    host.style.width = `${CONTAINER_PX}px`;
    host.innerHTML = `
      <div data-civitai-ui="group">
        <span data-testid="long" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${'Supercalifragilistic'.repeat(12)}</span>
      </div>`;
    document.body.appendChild(host);
    const long = host.querySelector('[data-testid="long"]') as HTMLElement;
    void long.getBoundingClientRect();
    // Without `min-width: 0` the item keeps its full content width and pushes
    // the row wide; with it, the box is narrower than its content and the
    // ellipsis can engage.
    expect(long.getBoundingClientRect().width).toBeLessThan(long.scrollWidth);
    expect(long.getBoundingClientRect().width).toBeLessThanOrEqual(CONTAINER_PX);
  });
});
