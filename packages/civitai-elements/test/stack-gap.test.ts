/**
 * The `gap` contract drift, fixed by construction.
 *
 * MEASURED in the two shipping packages:
 *   - `@civitai/blocks-react/ui`'s Stack types `gap?: string | number` and
 *     writes `style.gap = toLength(gap)`.
 *   - `@civitai/components-react`'s Stack types `gap?: 'sm'|'md'|'lg'` and
 *     writes `data-gap={gap}`.
 * Five of six audited apps import BOTH packages, so `gap="md"` written against
 * the wrong import emits `style="gap: md"` — invalid CSS, dropped by the
 * parser, no error in any tool.
 *
 * One element accepts both spellings. The assertion that matters is the
 * NEGATIVE one: no input may leave the element with neither a resolved custom
 * property nor a matching attribute rule. `expect(gap).toBe('20px')` alone
 * would pass on an implementation that dropped `md`.
 */
import { afterEach, describe, expect, it } from 'vitest';

import '../src/stack.js';
import { GAP_STEPS } from '../src/stack.js';
import type { CivitaiStack } from '../src/stack.js';

afterEach(() => {
  document.body.innerHTML = '';
});

async function stack(attrs = ''): Promise<CivitaiStack> {
  const host = document.createElement('div');
  host.innerHTML = `<civitai-stack ${attrs}>x</civitai-stack>`;
  document.body.appendChild(host);
  const el = host.firstElementChild as CivitaiStack;
  await el.updateComplete;
  return el;
}

describe('civitai-stack gap accepts BOTH drifted contracts', () => {
  it('a named step lands on the attribute the stylesheet selects on', async () => {
    const el = await stack('gap="md"');
    expect(el.getAttribute('gap')).toBe('md');
    // …and NOT as an inline length, which is the bug being fixed.
    expect(el.style.getPropertyValue('--civitai-stack-gap')).toBe('');
    expect(el.style.gap).toBe('');
  });

  it('every documented step is a real attribute the sheet can match', async () => {
    const sheet = (await import('../src/generated/stack.css.js')).stackCss;
    for (const step of GAP_STEPS) {
      const el = await stack(`gap="${step}"`);
      expect(el.getAttribute('gap')).toBe(step);
      // The sheet must actually have a rule for it — a step the CSS forgot
      // would be exactly as silently dropped as `style="gap: md"`.
      expect(sheet).toContain(`[gap='${step}']`);
      document.body.innerHTML = '';
    }
  });

  it('a CSS length passes through verbatim', async () => {
    const el = await stack('gap="1rem"');
    expect(el.style.getPropertyValue('--civitai-stack-gap')).toBe('1rem');
  });

  it('a bare number is read as px (the blocks-react contract)', async () => {
    const el = await stack('gap="20"');
    expect(el.style.getPropertyValue('--civitai-stack-gap')).toBe('20px');
  });

  it('a numeric PROPERTY is read as px too', async () => {
    const el = await stack();
    el.gap = 24;
    await el.updateComplete;
    expect(el.style.getPropertyValue('--civitai-stack-gap')).toBe('24px');
  });

  it('switching from a length back to a step clears the stale inline value', async () => {
    const el = await stack('gap="40px"');
    expect(el.style.getPropertyValue('--civitai-stack-gap')).toBe('40px');
    el.gap = 'sm';
    await el.updateComplete;
    // Without the explicit removeProperty the inline 40px would keep winning
    // over the [gap='sm'] rule forever.
    expect(el.style.getPropertyValue('--civitai-stack-gap')).toBe('');
    expect(el.getAttribute('gap')).toBe('sm');
  });

  it('NO input is silently dropped', async () => {
    const inputs = [...GAP_STEPS, '1rem', '20', '40px', '2ch', 'calc(1rem + 2px)'];
    for (const v of inputs) {
      const el = await stack(`gap="${v}"`);
      const named = (GAP_STEPS as readonly string[]).includes(v);
      const resolved = named
        ? el.getAttribute('gap') === v
        : el.style.getPropertyValue('--civitai-stack-gap') !== '';
      expect(resolved, `gap="${v}" was dropped`).toBe(true);
      document.body.innerHTML = '';
    }
  });

  it('align and justify reach the host style', async () => {
    const el = await stack('align="center" justify="space-between"');
    expect(el.style.alignItems).toBe('center');
    expect(el.style.justifyContent).toBe('space-between');
  });
});
