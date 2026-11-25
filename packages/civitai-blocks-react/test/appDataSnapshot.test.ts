import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { BlockInitPayload } from '@civitai/app-sdk/blocks';

// `@civitai/sdk` is not a dependency of this package; its SOURCE is read from the
// workspace, as `errorReportsParity.test.ts` and `reactionHostContract.test.ts` do.
// This is the consumer the fix exists for: an app that builds the SDK on THIS
// package's transport (`initialize({ transport })` over `getSnapshot()`).
import { initialize } from '../../civitai-sdk/src/app/index.js';
import type { BlockTransport as SdkTransport } from '../../civitai-sdk/src/core/transport.js';
import { IframeTransport } from '../src/transport/iframeTransport.js';
import { InlineTransport } from '../src/transport/inlineTransport.js';
import { snapshotFromInit, type BlockTransport } from '../src/transport/transport.js';
import { mockParentMessage } from './helpers/mockParentMessage.js';

/**
 * `BLOCK_INIT.appData` (and the token's `kind`, which the SDK's service mode also
 * reads) must survive this package's `snapshotFromInit`, or no app built on
 * blocks-react can ever reach the app-data service.
 *
 * Fixtures are pairwise distinct: the service origin differs from the parent
 * origin and the site, and the slug differs from `blockId`/`appId`, so a value
 * read from the wrong field shows.
 */

const PARENT_ORIGIN = 'https://civitai.com';
const SERVICE = 'https://data.example.test';
const SLUG = 'bench-app';

function initPayload(extra: Record<string, unknown> = {}, tokenExtra: Record<string, unknown> = {}): BlockInitPayload {
  return {
    blockInstanceId: 'inst-7',
    blockId: 'my-block',
    appId: 'app_test',
    token: {
      raw: 'blk-first',
      scopes: ['apps:storage'],
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
      ...tokenExtra,
    },
    context: { slotId: 'app.page' },
    settings: { publisherSettings: {}, userSettings: {} },
    viewer: { id: 7, username: 'koen', status: 'active' },
    theme: 'light',
    renderMode: 'iframe',
    ...extra,
  } as BlockInitPayload;
}

const hasKey = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

let originalParent: Window;
beforeEach(() => {
  originalParent = window.parent;
  Object.defineProperty(window, 'parent', {
    value: { postMessage: () => {} },
    configurable: true,
    writable: true,
  });
});
afterEach(() => {
  Object.defineProperty(window, 'parent', { value: originalParent, configurable: true, writable: true });
  delete (window as { __CIVITAI_BLOCK_CONTEXT__?: unknown }).__CIVITAI_BLOCK_CONTEXT__;
});

async function initIframe(payload: BlockInitPayload): Promise<IframeTransport> {
  const transport = new IframeTransport({ allowedParentOrigins: [PARENT_ORIGIN] });
  const ready = transport.waitForInit();
  window.dispatchEvent(mockParentMessage({ type: 'BLOCK_INIT', payload }, PARENT_ORIGIN));
  await ready;
  return transport;
}

describe('IframeTransport: BLOCK_INIT.appData reaches the snapshot', () => {
  it('appData { url, slug } is carried, copied by field', async () => {
    const transport = await initIframe(initPayload({ appData: { url: SERVICE, slug: SLUG, extra: 'dropped' } }));
    expect(transport.getSnapshot().appData).toEqual({ url: SERVICE, slug: SLUG });
    transport.dispose();
  });

  it('INVARIANT: without appData the key is absent', async () => {
    const transport = await initIframe(initPayload());
    expect(hasKey(transport.getSnapshot(), 'appData')).toBe(false);
    transport.dispose();
  });

  it.each([
    ['a string', SERVICE],
    ['an http URL', { url: 'http://data.example.test', slug: SLUG }],
    ['a URL with a query', { url: `${SERVICE}/?x=1`, slug: SLUG }],
    ['a slug outside the grammar', { url: SERVICE, slug: 'Bench_App' }],
    ['null', null],
  ])('INVARIANT: a malformed appData (%s) reads as absent', async (_why, appData) => {
    const transport = await initIframe(initPayload({ appData }));
    expect(hasKey(transport.getSnapshot(), 'appData')).toBe(false);
    transport.dispose();
  });

  it("the token's kind is carried at init and on a host TOKEN_REFRESH", async () => {
    const transport = await initIframe(initPayload({ appData: { url: SERVICE, slug: SLUG } }, { kind: 'block' }));
    expect(transport.getSnapshot().token.kind).toBe('block');
    window.dispatchEvent(
      mockParentMessage(
        {
          type: 'TOKEN_REFRESH',
          payload: {
            token: { raw: 'oauth-next', scopes: [], expiresAt: new Date(Date.now() + 900_000).toISOString(), kind: 'oauth' },
          },
        },
        PARENT_ORIGIN,
      ),
    );
    const snap = transport.getSnapshot();
    expect(snap.token.raw).toBe('oauth-next');
    expect(snap.token.kind).toBe('oauth');
    // A token refresh does not drop appData.
    expect(snap.appData).toEqual({ url: SERVICE, slug: SLUG });
    transport.dispose();
  });

  it('INVARIANT: an unknown token kind is left off, not copied', () => {
    const snap = snapshotFromInit(initPayload({}, { kind: 'admin' }));
    expect(hasKey(snap.token, 'kind')).toBe(false);
  });
});

describe('InlineTransport: the bootstrap appData reaches the snapshot', () => {
  it('appData { url, slug } is carried', () => {
    window.__CIVITAI_BLOCK_CONTEXT__ = initPayload({ renderMode: 'inline', appData: { url: SERVICE, slug: SLUG } });
    expect(new InlineTransport().getSnapshot().appData).toEqual({ url: SERVICE, slug: SLUG });
  });

  it('INVARIANT: without appData the key is absent', () => {
    window.__CIVITAI_BLOCK_CONTEXT__ = initPayload({ renderMode: 'inline' });
    expect(hasKey(new InlineTransport().getSnapshot(), 'appData')).toBe(false);
  });
});

/**
 * The shape an app uses to hand this package's transport to `@civitai/sdk`
 * (model-benchmarking's `src/lib/sdk-transport.ts`): the snapshot plus the
 * validated `hostOrigin`, memoised so `get()` is stable between changes.
 */
function sdkAdapter(bridge: BlockTransport): SdkTransport {
  let lastBase: unknown;
  let lastComposed: ReturnType<SdkTransport['snapshot']['get']> | undefined;
  return {
    snapshot: {
      get() {
        const base = bridge.getSnapshot();
        if (base !== lastBase || lastComposed === undefined) {
          lastBase = base;
          lastComposed = { ...base, hostOrigin: bridge.getHostOrigin() } as ReturnType<SdkTransport['snapshot']['get']>;
        }
        return lastComposed;
      },
      subscribe: (listener) => bridge.subscribe(listener),
    },
    notify: () => {},
    request: () => Promise.reject(new Error('not used by this test')),
    on: () => () => {},
  };
}

function recordingFetch() {
  const urls: string[] = [];
  const fetch = (async (input: RequestInfo | URL) => {
    urls.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    return new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof globalThis.fetch;
  return { urls, fetch };
}

describe('@civitai/sdk built on this transport', () => {
  it('sends app.storage to the app-data service when BLOCK_INIT carries appData', async () => {
    const bridge = await initIframe(initPayload({ appData: { url: SERVICE, slug: SLUG } }, { kind: 'block' }));
    const f = recordingFetch();
    const app = await initialize({ transport: sdkAdapter(bridge), fetch: f.fetch });
    await app.storage.collection('posts').get('p1').catch(() => undefined);
    expect(f.urls).toEqual([`${SERVICE}/v1/apps/${SLUG}/collections/posts/records/p1`]);
    bridge.dispose();
  });

  it('INVARIANT: without appData, app.storage stays on the site route', async () => {
    const bridge = await initIframe(initPayload({}, { kind: 'block' }));
    const f = recordingFetch();
    const app = await initialize({ transport: sdkAdapter(bridge), fetch: f.fetch });
    await app.storage.collection('posts').get('p1').catch(() => undefined);
    expect(f.urls).toEqual(['https://civitai.com/api/v1/blocks/storage/posts/p1']);
    bridge.dispose();
  });
});
