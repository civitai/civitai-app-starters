/**
 * 🔴 CONSTRAINT (a): light DOM has no `<slot>`.
 *
 * A wrapper primitive whose whole purpose is arbitrary children must never
 * template them. There is no `<slot>` to project into, so a `render()` that
 * emits anything would REPLACE the consumer's content. These guards put real
 * children inside and assert they survive a property change that forces a
 * reactive update.
 *
 * Node IDENTITY is the assertion, not text content: a wrapper that re-created
 * an equivalent child would still read "the text is there" while destroying
 * React/consumer state, focus and event listeners. Comparing the node object
 * catches that; comparing `textContent` does not.
 *
 * MUTATION-VERIFIED: making `CivitaiStack` extend `LitElement` with
 * `render() { return html\`<div><slot></slot></div>\` }` (the naive port of the
 * React component) turns `identity` red on ITS OWN assertion —
 * `expect(after).toBe(kid)` — with the child detached. See PR body.
 */
import { afterEach, describe, expect, it } from 'vitest';

import '../src/button.js';
import '../src/stack.js';
import type { CivitaiStack } from '../src/stack.js';
import type { CivitaiButton } from '../src/button.js';

afterEach(() => {
  document.body.innerHTML = '';
});

async function settle(el: HTMLElement & { updateComplete?: Promise<unknown> }): Promise<void> {
  await (el.updateComplete ?? Promise.resolve());
  await new Promise((r) => setTimeout(r, 0));
}

describe('light DOM wrappers never touch their children', () => {
  it('civitai-stack keeps the SAME child nodes across a reactive update', async () => {
    const stack = document.createElement('civitai-stack') as CivitaiStack;
    const a = document.createElement('p');
    a.textContent = 'alpha';
    const b = document.createElement('section');
    b.textContent = 'beta';
    stack.append(a, b);
    document.body.appendChild(stack);
    await settle(stack);

    // Force several reactive updates through every property the element owns.
    stack.gap = 'lg';
    await settle(stack);
    stack.gap = 24;
    await settle(stack);
    stack.align = 'center';
    await settle(stack);
    stack.justify = 'space-between';
    await settle(stack);

    expect(stack.children.length).toBe(2);
    expect(stack.children[0]).toBe(a);
    expect(stack.children[1]).toBe(b);
    expect(a.isConnected).toBe(true);
    expect(b.isConnected).toBe(true);
  });

  it('civitai-button keeps the SAME child nodes across a reactive update', async () => {
    const btn = document.createElement('civitai-button') as CivitaiButton;
    const icon = document.createElement('svg');
    const label = document.createTextNode('Generate');
    btn.append(icon, label);
    document.body.appendChild(btn);
    await settle(btn);

    btn.loading = true;
    await settle(btn);
    btn.variant = 'outline';
    await settle(btn);
    btn.color = 'error';
    await settle(btn);
    btn.loading = false;
    await settle(btn);

    expect(btn.childNodes.length).toBe(2);
    expect(btn.childNodes[0]).toBe(icon);
    expect(btn.childNodes[1]).toBe(label);
    expect(btn.textContent).toBe('Generate');
  });

  it('a wrapper adds NO element of its own — not even for the loading spinner', async () => {
    const btn = document.createElement('civitai-button') as CivitaiButton;
    btn.textContent = 'Go';
    document.body.appendChild(btn);
    await settle(btn);
    const before = btn.childNodes.length;

    btn.loading = true;
    await settle(btn);

    // The spinner is a ::before pseudo-element. If it ever became a real
    // <civitai-loader> child this count would move, and the enhance-only
    // contract would be broken for every consumer that indexes children.
    expect(btn.childNodes.length).toBe(before);
    expect(btn.querySelector('*')).toBeNull();
    expect(btn.getAttribute('aria-busy')).toBe('true');
  });

  it('children added AFTER upgrade also survive', async () => {
    const stack = document.createElement('civitai-stack') as CivitaiStack;
    document.body.appendChild(stack);
    await settle(stack);

    const late = document.createElement('p');
    late.textContent = 'late';
    stack.appendChild(late);
    stack.gap = 'xl';
    await settle(stack);

    expect(stack.children[0]).toBe(late);
  });
});
