import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';

import { injectStyles } from '../src/index.js';

/** Inject the token + component stylesheet into the test document once. */
export function ensureStyles(): void {
  injectStyles(document);
}

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

/** Render a React node under a `[data-theme]` ancestor (synchronously). */
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
