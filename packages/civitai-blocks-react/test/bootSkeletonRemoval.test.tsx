/**
 * MEASURES the one claim that lets a React block's entry module ship with NO
 * boot-skeleton cleanup code:
 *
 *   React's `createRoot(container).render(...)` CLEARS the container's existing
 *   children before its first commit.
 *
 * That is why a React block's `[data-boot-skeleton]` markup in `index.html`
 * removes itself with nothing written to remove it. If it ever stopped being
 * true, the skeleton would stay on screen UNDER the mounted app — a silent
 * visual defect on every React block relying on it, and the code that would
 * have prevented it is code deliberately not written.
 *
 * (`starters/civitai-block-starter` used to be that React block. It is now
 * framework-free and removes the skeleton itself — its first render does
 * `root.replaceChildren(…)` — which its own `test/block.test.ts` asserts.)
 *
 * 🔴 IT IS REACT-SPECIFIC AND DOES NOT GENERALISE. Svelte 5's
 * `mount(App, { target })` APPENDS: `_mount` does
 * `target.appendChild(create_text())` and never clears. Measured on
 * svelte@5.55.10 + happy-dom in this repo — a prefilled target came back holding
 * BOTH the skeleton and the app. A Svelte block needs an explicit
 * `document.querySelector('[data-boot-skeleton]')?.remove()` after mount.
 * Assume APPEND for any framework nobody has measured.
 *
 * This lives in `@civitai/blocks-react` because it is a fact about React, and
 * this package's suite (vitest + happy-dom, CI job `blocks-react`) is where
 * React runs in this repo.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

const SKELETON = '<div data-boot-skeleton aria-hidden="true"><span>shape</span></div>';

afterEach(() => {
  document.body.innerHTML = '';
});

/** The starter's App, reduced to the only property under test: it renders. */
function App() {
  return <div data-app-content>rendered</div>;
}

describe('boot skeleton removal (React createRoot)', () => {
  it('clears a prefilled mount container on first render', async () => {
    document.body.innerHTML = `<div id="root">${SKELETON}</div>`;
    const container = document.getElementById('root')!;

    // Pre-condition: the skeleton really is there before we mount. Without this
    // the post-assertion is satisfied by a container that never held one.
    expect(container.querySelector('[data-boot-skeleton]')).not.toBeNull();
    expect(container.children.length).toBe(1);

    const root = createRoot(container);
    await act(async () => {
      root.render(<App />);
    });

    // POSITIVE CONTROL, in the same test: the app genuinely rendered. Without
    // it, "the skeleton is gone" is equally satisfied by a render that threw and
    // wiped the container — the reassuring absence and the failure look alike.
    expect(container.querySelector('[data-app-content]')).not.toBeNull();
    expect(container.textContent).toContain('rendered');

    // The claim.
    expect(container.querySelector('[data-boot-skeleton]')).toBeNull();
    expect(document.querySelectorAll('[data-boot-skeleton]').length).toBe(0);

    root.unmount();
  });

  it('a skeleton OUTSIDE the container survives — which is why placement is gated', async () => {
    // The mirror image, and the reason `scripts/lib/boot-skeleton-gate.mjs`
    // rule 4 exists: React only clears what it mounts into. A skeleton painted
    // as a SIBLING of #root is never replaced and stays on screen after mount.
    document.body.innerHTML = `${SKELETON}<div id="root"></div>`;
    const container = document.getElementById('root')!;

    const root = createRoot(container);
    await act(async () => {
      root.render(<App />);
    });

    expect(container.querySelector('[data-app-content]')).not.toBeNull();
    expect(document.querySelector('[data-boot-skeleton]')).not.toBeNull();

    root.unmount();
  });
});
