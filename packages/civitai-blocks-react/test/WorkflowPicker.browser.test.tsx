import { cleanup, render } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BlockInitPayload } from '@civitai/app-sdk/blocks';
import type {
  CivitaiResourcePicker,
  PickedResource,
  ResourceItem,
} from '@civitai/components/civitai-resource-picker';

import { fakeResourceSource, resetTransport } from '../src/testing.js';
import { getTransport } from '../src/transport/singleton.js';
import { WorkflowPicker, type WorkflowPickerProps } from '../src/ui/WorkflowPicker.js';

// A real browser: the picker is a Lit element inside a native <dialog>.

const PARENT_ORIGIN = 'https://host.example';

const MINE: ResourceItem = {
  modelId: 31,
  name: 'My Upscaler',
  type: 'Workflows',
  creatorUsername: 'me',
  versions: [{ id: 3102, name: 'v2', baseModel: 'SDXL 1.0', access: 'open' }],
};
const THEIRS: ResourceItem = {
  modelId: 47,
  name: 'Old Comfy Graph',
  type: 'ComfyWorkflows',
  creatorUsername: 'someone',
  versions: [{ id: 4701, name: 'v1', baseModel: 'SD 1.5', access: 'paid' }],
};

function buildInit(viewer: BlockInitPayload['viewer'] = { id: 7, username: 'me', status: 'active' }): BlockInitPayload {
  return {
    blockInstanceId: 'inst-1',
    blockId: 'b',
    appId: 'app_test',
    token: { raw: 'jwt-picker', scopes: [], expiresAt: new Date(Date.now() + 600_000).toISOString() },
    context: { slotId: 'app.page' },
    settings: { publisherSettings: {}, userSettings: {} },
    viewer,
    theme: 'dark',
    renderMode: 'iframe',
  } as BlockInitPayload;
}

function sendInit(viewer?: BlockInitPayload['viewer']) {
  window.dispatchEvent(
    new MessageEvent('message', { data: { type: 'BLOCK_INIT', payload: buildInit(viewer) }, origin: PARENT_ORIGIN })
  );
}

const picker = () => document.querySelector('civitai-resource-picker') as CivitaiResourcePicker;
const names = () =>
  [...(picker()?.shadowRoot?.querySelectorAll('[part~="name"]') ?? [])].map((n) => n.textContent!.trim());

async function until(done: () => boolean, ms = 3000) {
  const end = Date.now() + ms;
  while (!done()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}

/** Opens on mount and closes on either callback, as the docs tell a consumer to. */
function Host(props: Omit<WorkflowPickerProps, 'open' | 'onPick'> & { picks: (PickedResource | null)[] }) {
  const { picks, ...rest } = props;
  const [open, setOpen] = useState(true);
  return (
    <WorkflowPicker
      {...rest}
      open={open}
      onPick={(p) => {
        picks.push(p);
        setOpen(false);
      }}
      onDismiss={() => {
        picks.push(null);
        setOpen(false);
      }}
    />
  );
}

describe('<WorkflowPicker>', () => {
  const realFetch = globalThis.fetch;
  const realParent = Object.getOwnPropertyDescriptor(window, 'parent');

  beforeEach(() => {
    Object.defineProperty(window, 'parent', {
      value: { postMessage: vi.fn() },
      configurable: true,
      writable: true,
    });
    getTransport({ allowedParentOrigins: [PARENT_ORIGIN] });
  });

  afterEach(() => {
    cleanup();
    resetTransport();
    globalThis.fetch = realFetch;
    if (realParent) Object.defineProperty(window, 'parent', realParent);
  });

  it('calls the block catalog at the host origin with the block token, for both lists', async () => {
    sendInit();
    const calls: { url: string; auth: string | null }[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, auth: new Headers(init?.headers).get('Authorization') });
      const owner = new URL(url).searchParams.get('owner');
      const item = {
        id: owner === 'mine' ? 31 : 47,
        name: owner === 'mine' ? 'My Upscaler' : 'Old Comfy Graph',
        type: 'Workflows',
        creator: { username: owner === 'mine' ? 'me' : 'someone' },
        modelVersions: [{ id: owner === 'mine' ? 3102 : 4701, name: 'v2', baseModel: 'SDXL 1.0', paidAccess: null }],
      };
      return new Response(JSON.stringify({ items: [item], metadata: { owner } }), { status: 200 });
    }) as typeof fetch;

    const picks: (PickedResource | null)[] = [];
    render(<Host picks={picks} />);
    await until(() => names().length === 1);
    picker().shadowRoot!.querySelector<HTMLInputElement>('input[value="mine"]')!.click();
    await until(() => names().join() === 'My Upscaler');

    expect(calls).toEqual([
      {
        url: `${PARENT_ORIGIN}/api/v1/blocks/models?types=Workflows&types=ComfyWorkflows&owner=any&limit=20`,
        auth: 'Bearer jwt-picker',
      },
      {
        url: `${PARENT_ORIGIN}/api/v1/blocks/models?types=Workflows&types=ComfyWorkflows&owner=mine&limit=20`,
        auth: 'Bearer jwt-picker',
      },
    ]);

    picker().shadowRoot!.querySelector<HTMLElement>('[part~="select"]')!.click();
    await until(() => picks.length === 1);
    expect(picks).toEqual([
      {
        modelId: 31,
        modelVersionId: 3102,
        name: 'My Upscaler',
        versionName: 'v2',
        creatorUsername: 'me',
        baseModel: 'SDXL 1.0',
        access: 'open',
        owner: 'mine',
      },
    ]);
    expect(picker().open).toBe(false);
  });

  it('uses a given source instead, and never touches the network', async () => {
    sendInit();
    const fetchSpy = vi.fn(async () => {
      throw new Error('no request expected');
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const source = fakeResourceSource({ mine: [MINE], any: [MINE, THEIRS] });

    const picks: (PickedResource | null)[] = [];
    render(<Host picks={picks} source={source} owner="mine" />);
    await until(() => names().length === 1);
    expect(names()).toEqual(['My Upscaler']);
    expect(source.calls.map((c) => c.owner)).toEqual(['mine']);

    const modal = picker().shadowRoot!.querySelector('civitai-modal')!;
    modal.shadowRoot!.querySelector<HTMLElement>('[part~="close"]')!.click();
    await until(() => picks.length === 1);
    expect(picks).toEqual([null]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('says it is not connected while the host origin is unknown, then recovers when it lands', async () => {
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      const owner = new URL(String(input)).searchParams.get('owner');
      return new Response(
        JSON.stringify({
          items: [{ id: 47, name: 'Old Comfy Graph', type: 'ComfyWorkflows', modelVersions: [{ id: 4701, name: 'v1' }] }],
          metadata: { owner },
        }),
        { status: 200 }
      );
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    render(<Host picks={[]} />);
    await until(() => picker()?.phase === 'error');
    expect(picker().shadowRoot!.querySelector('[role="alert"]')!.textContent).toContain(
      'Not connected to Civitai yet.'
    );
    expect(fetchSpy).not.toHaveBeenCalled();

    sendInit();
    await until(() => names().length === 1);
    expect(String(fetchSpy.mock.calls[0]![0])).toBe(
      `${PARENT_ORIGIN}/api/v1/blocks/models?types=Workflows&types=ComfyWorkflows&owner=any&limit=20`
    );
  });

  it('after a 401 it mints a fresh block token through the host and retries with it', async () => {
    // The host answers REQUEST_TOKEN the way civitai.com does.
    Object.defineProperty(window, 'parent', {
      value: {
        postMessage: (message: { type: string; payload?: { requestId?: string } }) => {
          if (message?.type !== 'REQUEST_TOKEN') return;
          setTimeout(() =>
            window.dispatchEvent(
              new MessageEvent('message', {
                origin: PARENT_ORIGIN,
                data: {
                  type: 'TOKEN_REFRESH_RESPONSE',
                  payload: {
                    requestId: message.payload?.requestId,
                    token: { raw: 'jwt-fresh', scopes: [], expiresAt: new Date(Date.now() + 600_000).toISOString() },
                  },
                },
              })
            )
          );
        },
      },
      configurable: true,
      writable: true,
    });
    sendInit();
    const auth: (string | null)[] = [];
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const bearer = new Headers(init?.headers).get('Authorization');
      auth.push(bearer);
      if (bearer !== 'Bearer jwt-fresh') return new Response(JSON.stringify({ error: 'expired' }), { status: 401 });
      return new Response(
        JSON.stringify({
          items: [{ id: 47, name: 'Old Comfy Graph', type: 'ComfyWorkflows', modelVersions: [{ id: 4701, name: 'v1' }] }],
          metadata: { owner: 'any' },
        }),
        { status: 200 }
      );
    }) as typeof fetch;

    render(<Host picks={[]} />);
    await until(() => names().length === 1);
    expect(auth).toEqual(['Bearer jwt-picker', 'Bearer jwt-fresh']);
  });

  /** A host that answers REQUEST_TOKEN with `jwt-fresh`, counting each ask. */
  function answeringHost() {
    const asks = { count: 0 };
    Object.defineProperty(window, 'parent', {
      value: {
        postMessage: (message: { type: string; payload?: { requestId?: string } }) => {
          if (message?.type !== 'REQUEST_TOKEN') return;
          asks.count += 1;
          setTimeout(() =>
            window.dispatchEvent(
              new MessageEvent('message', {
                origin: PARENT_ORIGIN,
                data: {
                  type: 'TOKEN_REFRESH_RESPONSE',
                  payload: {
                    requestId: message.payload?.requestId,
                    token: { raw: 'jwt-fresh', scopes: [], expiresAt: new Date(Date.now() + 600_000).toISOString() },
                  },
                },
              })
            )
          );
        },
      },
      configurable: true,
      writable: true,
    });
    return asks;
  }

  it('an anonymous viewer on "mine" is told to sign in after ONE request, with no token refresh', async () => {
    const asks = answeringHost();
    sendInit(null);
    const auth: (string | null)[] = [];
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      auth.push(new Headers(init?.headers).get('Authorization'));
      // What the catalog answers `owner=mine` on an anonymous token, fresh or not.
      return new Response(JSON.stringify({ error: 'Sign-in required' }), { status: 401 });
    }) as typeof fetch;

    render(<Host picks={[]} owner="mine" />);
    await until(() => picker()?.phase === 'error');
    // Long enough for a refresh round trip and a second request to show up.
    await new Promise((r) => setTimeout(r, 50));

    expect(auth).toEqual(['Bearer jwt-picker']);
    expect(asks.count).toBe(0);
    const alert = picker().shadowRoot!.querySelector<HTMLElement>('[part~="error"]')!;
    expect(alert.dataset.kind).toBe('unauthorized');
    expect(alert.textContent).toContain('Sign in to Civitai to see your own workflows.');
  });

  it.each([
    ['a signed-in viewer on "mine"', { id: 7, username: 'me', status: 'active' } as const, 'mine'],
    ['an anonymous viewer on "all"', null, 'any'],
  ] as const)('%s still refreshes an expired token once and retries', async (_label, viewer, owner) => {
    const asks = answeringHost();
    sendInit(viewer);
    const auth: (string | null)[] = [];
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const bearer = new Headers(init?.headers).get('Authorization');
      auth.push(bearer);
      if (bearer !== 'Bearer jwt-fresh') return new Response(JSON.stringify({ error: 'invalid block token' }), { status: 401 });
      return new Response(
        JSON.stringify({
          items: [{ id: 47, name: 'Old Comfy Graph', type: 'ComfyWorkflows', modelVersions: [{ id: 4701, name: 'v1' }] }],
          metadata: { owner },
        }),
        { status: 200 }
      );
    }) as typeof fetch;

    render(<Host picks={[]} owner={owner} />);
    await until(() => names().length === 1);
    expect(auth).toEqual(['Bearer jwt-picker', 'Bearer jwt-fresh']);
    expect(asks.count).toBe(1);
  });

  it('re-rendered with owner any→mine, it drops the old list and searches mine', async () => {
    sendInit();
    const source = fakeResourceSource({ mine: [MINE], any: [THEIRS] });
    const props = { open: true, onPick: () => {}, onDismiss: () => {}, source };
    const { rerender } = render(<WorkflowPicker {...props} owner="any" />);
    await until(() => names().join() === 'Old Comfy Graph');

    rerender(<WorkflowPicker {...props} owner="mine" />);
    await picker().updateComplete;
    expect(names()).not.toContain('Old Comfy Graph');
    await until(() => names().join() === 'My Upscaler');
    expect(source.calls.map((c) => c.owner)).toEqual(['any', 'mine']);
  });

  it('without onDismiss, a dismissed picker re-opens on the next render that still says open', async () => {
    sendInit();
    const source = fakeResourceSource({ any: [THEIRS] });
    const { rerender } = render(<WorkflowPicker open source={source} onPick={() => {}} heading="One" />);
    await until(() => names().length === 1);
    const modal = picker().shadowRoot!.querySelector('civitai-modal')!;
    modal.shadowRoot!.querySelector<HTMLElement>('[part~="close"]')!.click();
    await until(() => picker().open === false);

    // The app never heard about the dismissal, so its prop still says open.
    rerender(<WorkflowPicker open source={source} onPick={() => {}} heading="Two" />);
    await until(() => picker().open === true);
    await until(() => names().length === 1);
  });
});

describe('fakeResourceSource', () => {
  const signal = new AbortController().signal;

  it('lists by owner, type and query, and echoes the owner it applied', async () => {
    const source = fakeResourceSource({ mine: [MINE], any: [MINE, THEIRS] });
    expect(await source.search({ types: ['Workflows', 'ComfyWorkflows'], owner: 'mine' }, signal)).toEqual({
      items: [MINE],
      nextCursor: null,
      owner: 'mine',
    });
    expect(
      (await source.search({ types: ['ComfyWorkflows'], owner: 'any' }, signal)).items.map((i) => i.modelId)
    ).toEqual([47]);
    expect(
      (await source.search({ types: ['Workflows', 'ComfyWorkflows'], owner: 'any', query: ' comfy ' }, signal)).items
    ).toEqual([THEIRS]);
    expect(source.calls).toHaveLength(3);
  });

  it('shows `mine` under "All" too when only `mine` is given', async () => {
    const source = fakeResourceSource({ mine: [MINE] });
    expect((await source.search({ types: ['Workflows'], owner: 'any' }, signal)).items).toEqual([MINE]);
  });

  it('rejects an aborted search', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      fakeResourceSource({ mine: [MINE] }).search({ types: ['Workflows'], owner: 'mine' }, controller.signal)
    ).rejects.toBeDefined();
  });
});
