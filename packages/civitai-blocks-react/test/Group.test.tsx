import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createRef } from 'react';

import { componentsCss } from '@civitai/components';

import { Group } from '../src/ui/Group.js';

afterEach(() => {
  cleanup();
  document.querySelectorAll('style[data-civitai-blocks-ui]').forEach((el) => el.remove());
});

function group(): HTMLElement {
  return document.querySelector('[data-civitai-ui="group"]') as HTMLElement;
}

describe('Group', () => {
  it('renders children', () => {
    render(
      <Group>
        <span>a</span>
        <span>b</span>
      </Group>
    );
    expect(screen.getByText('a')).toBeTruthy();
    expect(screen.getByText('b')).toBeTruthy();
  });

  it('applies a numeric gap as px', () => {
    render(<Group gap={8}>x</Group>);
    expect(group().style.gap).toBe('8px');
  });

  it('applies justify + align', () => {
    render(
      <Group justify="flex-end" align="flex-start">
        x
      </Group>
    );
    expect(group().style.justifyContent).toBe('flex-end');
    expect(group().style.alignItems).toBe('flex-start');
  });

  it('defaults align to center', () => {
    render(<Group>x</Group>);
    expect(group().style.alignItems).toBe('center');
  });

  it('wraps by default and can disable wrapping', () => {
    render(<Group>x</Group>);
    expect(group().style.flexWrap).toBe('wrap');
    cleanup();
    render(<Group wrap={false}>x</Group>);
    expect(group().style.flexWrap).toBe('nowrap');
  });

  it('forwards a ref', () => {
    const ref = createRef<HTMLDivElement>();
    render(<Group ref={ref}>x</Group>);
    expect(ref.current?.getAttribute('data-civitai-ui')).toBe('group');
  });

  /*
   * A SEAM guard, not a spelling one. `group` has two surfaces that must agree:
   * this React component (which writes `flex-wrap` as an inline style) and the
   * `@civitai/components` CSS rule that bare `data-civitai-ui="group"` markup —
   * every non-React consumer — resolves against.
   *
   * They DID disagree: React defaulted to `wrap`, the CSS shipped no
   * `flex-wrap` at all, so identical-looking markup wrapped in React and
   * overflowed everywhere else. Nothing could see it, because each surface was
   * only ever tested against itself.
   *
   * So assert the RELATIONSHIP. Reading the default off the rendered component
   * rather than restating 'wrap' is what makes it a relationship: flip either
   * side alone and this fails.
   */
  describe('wrap default agrees with the @civitai/components CSS', () => {
    /**
     * The `[data-civitai-ui='group']` rule body, from the shipped stylesheet.
     *
     * Comments are stripped FIRST, before the brace walk: a `{` or `}` inside a
     * comment would otherwise unbalance the walk and return a silently wrong
     * slice — a guard that degrades without erroring. The rule's comments do
     * currently contain braces (`<Group wrap={false}>`); they happen to balance,
     * which is luck, not a property to rely on.
     */
    function groupRule(): string {
      const css = componentsCss.replace(/\/\*[\s\S]*?\*\//g, '');
      const start = css.indexOf("[data-civitai-ui='group']");
      expect(start).toBeGreaterThan(-1);
      const open = css.indexOf('{', start);
      let depth = 0;
      for (let i = open; i < css.length; i += 1) {
        if (css[i] === '{') depth += 1;
        else if (css[i] === '}') {
          depth -= 1;
          if (depth === 0) return css.slice(open + 1, i);
        }
      }
      throw new Error('unbalanced braces in the group rule');
    }

    /*
     * The rule's OWN declarations: comments stripped (prose in this file
     * mentions `flex-wrap`) and nested blocks stripped (the `data-nowrap`
     * opt-out declares `flex-wrap: nowrap` one level in). Without both, a
     * naive scan reads the opt-out as the default — it did on the first run.
     */
    function topLevelDecls(body: string): string {
      const noComments = body.replace(/\/\*[\s\S]*?\*\//g, '');
      let depth = 0;
      let out = '';
      for (const ch of noComments) {
        if (ch === '{') depth += 1;
        else if (ch === '}') depth -= 1;
        else if (depth === 0) out += ch;
      }
      return out;
    }

    it('the CSS default matches what <Group> renders with no props', () => {
      render(<Group>x</Group>);
      const reactDefault = group().style.flexWrap; // 'wrap', read not restated
      const declared = /flex-wrap:\s*([a-z-]+)\s*;/.exec(topLevelDecls(groupRule()))?.[1];
      expect(declared).toBe(reactDefault);
    });

    it('the CSS carries the bare-markup opt-out matching <Group wrap={false}>', () => {
      render(<Group wrap={false}>x</Group>);
      const reactOptOut = group().style.flexWrap; // 'nowrap'
      const rule = groupRule();
      const optOut = /&\[data-nowrap='true'\]\s*\{\s*flex-wrap:\s*([a-z-]+)\s*;/.exec(rule)?.[1];
      expect(optOut).toBe(reactOptOut);
    });

    it('children may shrink below their content width', () => {
      // What makes wrap actually help when one item is a long unbroken label.
      // This is a TEXT assertion and therefore weak on its own; the behavioural
      // guard is in responsive-group.browser.test.tsx, which measures it in a
      // real engine. Keep both — this one localises a regression to the CSS.
      expect(groupRule()).toMatch(/&\s*>\s*\*\s*\{\s*min-width:\s*0\s*;/);
    });
  });
});
