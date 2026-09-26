import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';

export interface Mounted {
  mount: HTMLElement;
  cleanup: () => void;
}

function makeWrapper(theme: string): { wrapper: HTMLElement; mount: HTMLElement } {
  const wrapper = document.createElement('div');
  wrapper.setAttribute('data-theme', theme);
  const mount = document.createElement('div');
  wrapper.appendChild(mount);
  document.body.appendChild(wrapper);
  return { wrapper, mount };
}

/**
 * Render a React node under a `[data-theme]` ancestor (synchronously).
 *
 * No stylesheet setup: the elements are self-styling and `CivitaiElement`
 * injects the `@civitai/theme` tokens into the document itself on first
 * connect, so mounting one is all a test has to do.
 */
export function mountReact(theme: string, node: React.ReactElement): Mounted {
  const { wrapper, mount } = makeWrapper(theme);
  const root = createRoot(mount);
  flushSync(() => root.render(node));
  return {
    mount,
    cleanup: () => {
      root.unmount();
      wrapper.remove();
    },
  };
}

/** Render plain HTML under a `[data-theme]` ancestor. */
export function mountHtml(theme: string, html: string): Mounted {
  const { wrapper, mount } = makeWrapper(theme);
  mount.innerHTML = html;
  return { mount, cleanup: () => wrapper.remove() };
}

/**
 * Lit renders async, so a mounted element is not populated on the same tick —
 * await every upgraded descendant before asserting against its shadow root.
 */
export async function settle(mount: HTMLElement): Promise<void> {
  await Promise.all(
    [...mount.querySelectorAll('*')]
      .filter((el): el is HTMLElement & { updateComplete: Promise<boolean> } =>
        'updateComplete' in el
      )
      .map((el) => el.updateComplete)
  );
}
