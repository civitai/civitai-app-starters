import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { getTransport } from '@civitai/sdk';
import { __resetTransport } from '@civitai/sdk/testing';

import { mountBlock } from '../src/block.js';
import { DIRECT_LOAD_TIMEOUT_MS, hostToRunUrl, renderDirectLoadFallback } from '../src/directLoad.js';

/**
 * These drive the block through its REAL bridge: `mountBlock` → `initialize()`
 * from `@civitai/sdk` → the iframe transport's `message` listener. Each test
 * plays the host by dispatching the same `postMessage` frames civitai.com sends,
 * and reads what the block posts back through a stand-in `window.parent` — no
 * fake transport, so the handshake, the origin allowlist and the outbound
 * messages are the shipped code paths.
 */

const HOST_ORIGIN = 'https://civitai.com';
// A path, not `new URL(…)`: under happy-dom the global `URL` is the DOM's, which
// node:fs refuses as a file URL.
const INDEX_HTML = join(dirname(fileURLToPath(import.meta.url)), '..', 'index.html');

interface Posted {
  message: { type: string; payload?: unknown };
  targetOrigin: string;
}

let posted: Posted[];
let root: HTMLElement;
const realParent = window.parent;
const realTop = window.top;

function initPayload(overrides: Record<string, unknown> = {}) {
  return {
    blockInstanceId: 'bki_test',
    blockId: 'test-block',
    appId: 'app_test',
    token: {
      raw: 'test.token',
      scopes: ['models:read:self'],
      expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    },
    context: {
      slotId: 'model.sidebar_top',
      modelId: 4201,
      modelVersionId: 9902,
      modelName: 'Lighthouse XL',
      modelType: 'Checkpoint',
      modelNsfwLevel: 1,
    },
    settings: { publisherSettings: {}, userSettings: {} },
    viewer: { id: 7, username: 'tester', signedIn: true },
    theme: 'light',
    renderMode: 'iframe',
    ...overrides,
  };
}

function fromHost(data: unknown, origin = HOST_ORIGIN) {
  window.dispatchEvent(new MessageEvent('message', { data, origin }));
}

const sentTypes = () => posted.map((p) => p.message.type);
const field = (name: string) => root.querySelector<HTMLElement>(`[data-field="${name}"]`);
const rendered = () => root.querySelector('[data-block-root]') !== null;

beforeEach(() => {
  // The REAL #root from index.html, boot skeleton included, so "the first
  // render removes the skeleton" is checked against the markup that ships.
  const html = readFileSync(INDEX_HTML, 'utf8');
  const shipped = new DOMParser().parseFromString(html, 'text/html').getElementById('root');
  if (!shipped) throw new Error('index.html has no #root');
  document.body.replaceChildren(document.importNode(shipped, true));
  root = document.getElementById('root')!;
  delete document.documentElement.dataset.theme;

  posted = [];
  Object.defineProperty(window, 'parent', {
    configurable: true,
    writable: true,
    value: {
      postMessage: (message: Posted['message'], targetOrigin: string) =>
        posted.push({ message, targetOrigin }),
    },
  });

  // A fresh bridge per test, pinned to the production host origin. (Without a
  // VITE_ value the SDK's default list also contains it; pinning it here keeps
  // a developer's local .env from changing what these tests see.)
  __resetTransport();
  getTransport({ allowedParentOrigins: [HOST_ORIGIN] });
});

afterEach(() => {
  vi.useRealTimers();
  __resetTransport();
  Object.defineProperty(window, 'parent', { configurable: true, writable: true, value: realParent });
  Object.defineProperty(window, 'top', { configurable: true, writable: true, value: realTop });
});

describe('mountBlock over the real bridge', () => {
  test('BLOCK_INIT renders the host context into upgraded <civitai-*> elements', async () => {
    const mounted = mountBlock(root);
    expect(root.querySelector('[data-boot-skeleton]')).not.toBeNull();

    fromHost({ type: 'BLOCK_INIT', payload: initPayload() });
    await mounted;

    // The host's context, on screen.
    expect(field('slot')?.textContent).toBe('model.sidebar_top');
    expect(field('model-name')?.textContent).toBe('Lighthouse XL');
    expect(field('model-id')?.textContent).toBe('4201');
    expect(field('model-version-id')?.textContent).toBe('9902');
    expect(field('viewer')?.textContent).toBe('signed in');

    // …inside REAL custom elements: registered, upgraded, and rendered by Lit
    // into their shadow roots. An unregistered tag would still hold the text
    // above, so this is the half that proves the design system is wired.
    const TextElement = customElements.get('civitai-text');
    expect(TextElement).toBeDefined();
    const heading = root.querySelector('civitai-text');
    expect(heading).toBeInstanceOf(TextElement!);
    await (heading as unknown as { updateComplete: Promise<unknown> }).updateComplete;
    expect(heading!.shadowRoot?.querySelector('h2')).not.toBeNull();
    const badge = field('viewer')!;
    expect(badge).toBeInstanceOf(customElements.get('civitai-badge')!);

    // The first render replaced the boot skeleton.
    expect(root.querySelector('[data-boot-skeleton]')).toBeNull();

    // The page follows the host's theme (BLOCK_INIT is authoritative).
    expect(document.documentElement.dataset.theme).toBe('light');

    // And the block answered the host — to the host's origin, never '*'.
    expect(sentTypes()).toContain('BLOCK_READY');
    expect(sentTypes()).toContain('RESIZE_IFRAME');
    for (const p of posted) expect(p.targetOrigin).toBe(HOST_ORIGIN);
  });

  test('a BLOCK_INIT from an origin not on the allowlist is ignored', async () => {
    const mounted = mountBlock(root);
    fromHost({ type: 'BLOCK_INIT', payload: initPayload() }, 'https://evil.example');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(rendered()).toBe(false);
    expect(root.querySelector('[data-boot-skeleton]')).not.toBeNull();
    // Only the bridge's own startup BLOCK_HELLO — no reply to the impostor.
    expect(sentTypes()).toEqual(['BLOCK_HELLO']);

    // Positive control: the same frame from the real host mounts the block, so
    // the silence above was the allowlist and not a dead test.
    fromHost({ type: 'BLOCK_INIT', payload: initPayload() });
    await mounted;
    expect(rendered()).toBe(true);
  });

  test('a THEME_CHANGE push re-themes the page live', async () => {
    const mounted = mountBlock(root);
    fromHost({ type: 'BLOCK_INIT', payload: initPayload({ theme: 'light' }) });
    await mounted;
    expect(document.documentElement.dataset.theme).toBe('light');

    fromHost({ type: 'THEME_CHANGE', payload: { theme: 'dark' } });
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  test('an anonymous viewer on a non-model slot', async () => {
    const mounted = mountBlock(root);
    fromHost({
      type: 'BLOCK_INIT',
      payload: initPayload({
        viewer: null,
        context: { slotId: 'app.page', slug: 'my-app', subPath: '/', viewerUserId: null },
      }),
    });
    await mounted;
    expect(field('viewer')?.textContent).toBe('anonymous');
    expect(field('slot')?.textContent).toBe('app.page');
    // The model line is only for model slots: hidden rather than removed,
    // because `fill` only ever updates the view in place.
    expect(field('model')?.style.display).toBe('none');
  });

  test('host-provided strings are rendered as text, never parsed as markup', async () => {
    const mounted = mountBlock(root);
    const hostile = '<img src=x onerror="window.__pwned=1">';
    fromHost({
      type: 'BLOCK_INIT',
      payload: initPayload({ context: { ...initPayload().context, modelName: hostile } }),
    });
    await mounted;
    expect(field('model-name')?.textContent).toBe(hostile);
    expect(root.querySelector('img')).toBeNull();
  });
});

describe('direct (unembedded) load', () => {
  test('top-level with no host: the "Open on Civitai" card, then the block once a host answers', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const mounted = mountBlock(root);

    await vi.advanceTimersByTimeAsync(DIRECT_LOAD_TIMEOUT_MS - 1);
    expect(root.querySelector('[data-civitai-block-direct-load]')).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    // happy-dom serves the page from localhost, so this is the neutral
    // "waiting" card rather than a link to a run URL.
    const card = root.querySelector('[data-civitai-block-direct-load]');
    expect(card).not.toBeNull();
    expect(card?.textContent).toContain('Waiting for the Civitai host');

    // A late host still wins.
    fromHost({ type: 'BLOCK_INIT', payload: initPayload() });
    await mounted;
    expect(rendered()).toBe(true);
    expect(root.querySelector('[data-civitai-block-direct-load]')).toBeNull();
  });

  test.each([
    ['my-app.civit.ai', 'https://civitai.com/apps/run/my-app'],
    ['My-App.Civit.AI.', 'https://civitai.com/apps/run/my-app'],
    ['localhost', null],
    ['civit.ai', null],
    ['evil.example', null],
    ['bad_label.civit.ai', null],
  ])('hostToRunUrl(%s) → %s', (hostname, expected) => {
    expect(hostToRunUrl(hostname)).toBe(expected);
  });
});

describe('host pushes after mount', () => {
  test('a TOKEN_REFRESH leaves the page and what the viewer typed intact', async () => {
    const mounted = mountBlock(root);
    fromHost({ type: 'BLOCK_INIT', payload: initPayload() });
    await mounted;

    // A control a block author adds next to the starter's fields, holding
    // something the viewer typed.
    const input = document.createElement('input');
    input.value = 'half-written prompt';
    root.querySelector('[data-block-root]')!.append(input);
    const heading = root.querySelector('civitai-text');

    // The host rotates the token every few minutes. The snapshot changes (so
    // onChange fires) but nothing the view shows does.
    fromHost({
      type: 'TOKEN_REFRESH',
      payload: {
        token: {
          raw: 'rotated.token',
          scopes: ['models:read:self'],
          expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
        },
      },
    });

    expect(input.isConnected).toBe(true);
    expect(input.value).toBe('half-written prompt');
    expect(root.querySelector('civitai-text')).toBe(heading);
    expect(field('model-name')?.textContent).toBe('Lighthouse XL');
  });

  test('a THEME_CHANGE re-themes without rebuilding the view', async () => {
    const mounted = mountBlock(root);
    fromHost({ type: 'BLOCK_INIT', payload: initPayload({ theme: 'light' }) });
    await mounted;
    const input = document.createElement('input');
    input.value = 'kept';
    root.querySelector('[data-block-root]')!.append(input);

    fromHost({ type: 'THEME_CHANGE', payload: { theme: 'dark' } });

    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(input.isConnected).toBe(true);
    expect(input.value).toBe('kept');
  });
});

describe('a block that cannot start', () => {
  test('the entry module shows a visible error instead of leaving the skeleton up', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.resetModules();
    // The real entry, as index.html loads it. A host payload with no context
    // makes the first render throw.
    await import('../src/main.js');
    fromHost({ type: 'BLOCK_INIT', payload: initPayload({ context: null }) });

    await vi.waitFor(() => expect(root.querySelector('[data-block-error]')).not.toBeNull());
    const alert = root.querySelector('[data-block-error]')!;
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.getAttribute('heading')).toBe('This app could not start');
    expect(alert.textContent).toBe('Reload the page to try again.');
    expect(root.querySelector('[data-boot-skeleton]')).toBeNull();
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });
});

describe('embedded load', () => {
  test('an embedded block never shows the direct-load card, however slow its host', async () => {
    // Framed: window.top is some other window.
    Object.defineProperty(window, 'top', { configurable: true, writable: true, value: {} });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const mounted = mountBlock(root);

    await vi.advanceTimersByTimeAsync(DIRECT_LOAD_TIMEOUT_MS * 5);
    expect(root.querySelector('[data-civitai-block-direct-load]')).toBeNull();
    expect(root.querySelector('[data-boot-skeleton]')).not.toBeNull();

    fromHost({ type: 'BLOCK_INIT', payload: initPayload() });
    await mounted;
    expect(rendered()).toBe(true);
  });
});

describe('the "Open on Civitai" link', () => {
  test('a deployed block host links to its own run page', async () => {
    // <civitai-button> is form-associated and calls attachInternals(), which
    // happy-dom does not implement (real browsers do). A minimal stand-in, for
    // this test only, so the element can upgrade and render its link.
    const proto = HTMLElement.prototype as unknown as { attachInternals?: () => unknown };
    const hadInternals = 'attachInternals' in proto;
    if (!hadInternals) {
      proto.attachInternals = () => ({
        form: null,
        setFormValue() {},
        setValidity() {},
        checkValidity: () => true,
        reportValidity: () => true,
        states: new Set(),
      });
    }
    try {
      await checkRunLink();
    } finally {
      if (!hadInternals) delete proto.attachInternals;
    }
  });
});

async function checkRunLink() {
  {
    renderDirectLoadFallback(root, 'my-app.civit.ai');
    const button = root.querySelector('[data-civitai-block-direct-load] civitai-button');
    expect(button?.getAttribute('href')).toBe('https://civitai.com/apps/run/my-app');
    // …and the element really renders it as a link.
    await (button as unknown as { updateComplete: Promise<unknown> }).updateComplete;
    expect(button!.shadowRoot?.querySelector('a')?.getAttribute('href')).toBe(
      'https://civitai.com/apps/run/my-app',
    );
    expect(root.textContent).not.toContain('Waiting for the Civitai host');
  }
}
