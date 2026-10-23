import { describe, expect, it } from 'vitest';

import { createHost, createHostSession } from '../../src/host/index.js';
import { createFakeTransport } from '../../src/testing.js';
import { init, mountTransport } from '../support/iframe-host.js';

const token = (scopes: string[], raw = 'minted') => ({ raw, scopes, expiresAt: new Date(0) });

describe('host chrome', () => {
  it('asks for a height', () => {
    const t = createFakeTransport();
    createHost(t).resize(420);
    expect(t.sent.at(-1)).toEqual({ type: 'RESIZE_IFRAME', payload: { height: 420 } });
  });

  it('reports a failure as non-fatal unless told otherwise', () => {
    const t = createFakeTransport();
    createHost(t).reportError('render failed', {});
    expect(t.sent.at(-1)).toEqual({
      type: 'BLOCK_ERROR',
      payload: { message: 'render failed', fatal: false },
    });

    createHost(t).reportError('gone', { fatal: true });
    expect(t.sent.at(-1)).toEqual({
      type: 'BLOCK_ERROR',
      payload: { message: 'gone', fatal: true },
    });
  });

  it('navigates in place unless a new tab is asked for', () => {
    const t = createFakeTransport();
    createHost(t).navigate('/gallery', {});
    expect(t.sent.at(-1)).toEqual({
      type: 'NAVIGATE',
      payload: { path: '/gallery', target: 'current' },
    });

    createHost(t).navigate('/gallery', { target: 'new_tab' });
    expect(t.sent.at(-1)?.payload).toMatchObject({ target: 'new_tab' });
  });

  it('asks the host to start its login flow', () => {
    const t = createFakeTransport();
    createHost(t).requestSignIn({ returnUrl: '/gallery' });
    expect(t.sent.at(-1)).toEqual({ type: 'REQUEST_SIGN_IN', payload: { returnUrl: '/gallery' } });
  });

  it('sends a custom event as TRACK_EVENT, with no reply awaited', () => {
    const t = createFakeTransport();
    const result = createHost(t).track('generate_clicked', { mode: 'txt2img', batch: 4 });
    expect(result).toBeUndefined();
    expect(t.sent.at(-1)).toEqual({
      type: 'TRACK_EVENT',
      payload: { eventName: 'generate_clicked', properties: { mode: 'txt2img', batch: 4 } },
    });
  });

  it('omits properties from the TRACK_EVENT payload when none are given', () => {
    const t = createFakeTransport();
    createHost(t).track('sign_in_clicked');
    // `toEqual` treats a present-but-undefined key as absent; assert the key itself.
    const payload = t.sent.at(-1)?.payload as Record<string, unknown>;
    expect(payload).toEqual({ eventName: 'sign_in_clicked' });
    expect(Object.keys(payload)).toEqual(['eventName']);
  });

  it('downloads an own-output url under the name given', async () => {
    const t = createFakeTransport();
    t.handle('SAVE_IMAGE', () => ({ ok: true }));

    await createHost(t).download({ url: 'https://blob/out.mp4', filename: 'out.mp4' });

    expect(t.sent.at(-1)).toEqual({
      type: 'SAVE_IMAGE',
      payload: { url: 'https://blob/out.mp4', filename: 'out.mp4' },
    });
  });
});

describe('host.autoResize', () => {
  it('reports the element’s height now and whenever it changes, once per height', () => {
    const callbacks: (() => void)[] = [];
    let disconnected = false;
    const original = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      constructor(callback: () => void) {
        callbacks.push(callback);
      }
      observe() {}
      unobserve() {}
      disconnect() {
        disconnected = true;
      }
    } as unknown as typeof ResizeObserver;

    try {
      let height = 300.4;
      const element = { getBoundingClientRect: () => ({ height }) } as unknown as Element;
      const t = createFakeTransport();

      const stop = createHost(t).autoResize(element);
      height = 480;
      callbacks[0]!();
      callbacks[0]!();
      stop();

      expect(t.sent.map((m) => m.payload)).toEqual([{ height: 301 }, { height: 480 }]);
      expect(disconnected).toBe(true);
    } finally {
      globalThis.ResizeObserver = original;
    }
  });
});

describe('host.onVisibilityChange', () => {
  it('reports the page hiding and returning', () => {
    const t = createFakeTransport();
    const seen: boolean[] = [];

    const off = createHost(t).onVisibilityChange((visible) => seen.push(visible));
    t.push('SUSPEND', undefined);
    t.push('RESUME', undefined);
    off();
    t.push('SUSPEND', undefined);

    expect(seen).toEqual([false, true]);
  });
});

describe('host.openResourcePicker', () => {
  it('reads the host’s differently-named reply', async () => {
    const { transport, posted, deliver } = mountTransport();
    deliver(init());

    const pending = createHost(transport).openResourcePicker({
      resourceType: 'LORA',
      baseModelGroup: 'SDXL',
    });
    const sent = posted.at(-1)!.msg as { type: string; payload: { requestId: string } };
    expect(sent.type).toBe('OPEN_RESOURCE_PICKER');
    expect(sent.payload).toMatchObject({ resourceType: 'LORA', baseModelGroup: 'SDXL' });
    deliver({
      type: 'RESOURCE_PICKER_RESULT',
      payload: { requestId: sent.payload.requestId, selected: { versionId: 11, modelId: 10 } },
    });

    await expect(pending).resolves.toMatchObject({ versionId: 11 });
  });

  it('resolves null when the viewer dismisses the picker', async () => {
    const t = createFakeTransport();
    t.reply('OPEN_RESOURCE_PICKER', {});

    await expect(createHost(t).openResourcePicker({ resourceType: 'Checkpoint' })).resolves.toBeNull();
  });
});

describe('host.openBuzzPurchase', () => {
  it('passes the suggestion and reports only whether a purchase happened', async () => {
    const t = createFakeTransport();
    t.reply('OPEN_BUZZ_PURCHASE', { purchased: true, newBalance: 1200 });

    await expect(createHost(t).openBuzzPurchase({ suggestedAmount: 500 })).resolves.toEqual({
      purchased: true,
    });
    expect(t.sent.at(-1)).toEqual({ type: 'OPEN_BUZZ_PURCHASE', payload: { suggestedAmount: 500 } });
  });
});

describe('createHostSession', () => {
  it('asks the host for its current token when a fresh one is wanted', async () => {
    const { transport, posted, deliver } = mountTransport();
    deliver(init({ blockInstanceId: 'bi_1' }));
    const session = createHostSession(transport);

    const pending = session.getToken({ fresh: true });
    await Promise.resolve();
    const sent = posted.at(-1)!.msg as { type: string; payload: { requestId: string } };
    expect(sent).toMatchObject({ type: 'REQUEST_TOKEN', payload: { blockInstanceId: 'bi_1' } });
    deliver({
      type: 'TOKEN_REFRESH_RESPONSE',
      payload: {
        requestId: sent.payload.requestId,
        token: { raw: 'rotated', scopes: [], expiresAt: '2030-01-01T00:00:00.000Z' },
      },
    });

    await expect(pending).resolves.toBe('rotated');
    await expect(session.getToken()).resolves.toBe('rotated');
  });

  it('follows a rotation the host pushes on its own', async () => {
    const { transport, deliver } = mountTransport();
    deliver(init());
    const session = createHostSession(transport);

    deliver({
      type: 'TOKEN_REFRESH',
      payload: { token: { raw: 'pushed', scopes: [], expiresAt: '2030-01-01T00:00:00.000Z' } },
    });

    await expect(session.getToken()).resolves.toBe('pushed');
  });
});

describe('session.requestGrants on the host', () => {
  it('does not ask for a scope the token already carries', async () => {
    const t = createFakeTransport({ token: token(['buzz:read:self']) });

    await expect(createHostSession(t).requestGrants(['buzz:read:self'])).resolves.toBe(
      true,
    );
    expect(t.sent).toHaveLength(0);
  });

  it('resolves once the re-minted token carries the scope', async () => {
    const t = createFakeTransport({ token: token([]) });

    const pending = createHostSession(t).requestGrants(['buzz:read:self']);
    expect(t.sent.at(-1)).toEqual({ type: 'REQUEST_CONSENT', payload: { scopes: ['buzz:read:self'] } });
    t.setSnapshot({ token: token(['buzz:read:self', 'user:read:self']) });

    await expect(pending).resolves.toBe(true);
  });

  it('resolves false when the host says the scopes can never be granted', async () => {
    const t = createFakeTransport({ token: token([]) });

    const pending = createHostSession(t).requestGrants(['ai:write:budgeted']);
    t.push('CONSENT_UNAVAILABLE', { reason: 'ungrantable', scopes: [] });

    await expect(pending).resolves.toBe(false);
    expect(t.listenerCount('CONSENT_UNAVAILABLE')).toBe(0);
  });

  it('asks for a document-store scope like any other outside a local preview', async () => {
    // INVARIANT GUARD, not regression coverage: this was already true before the
    // local-preview change. It is the guard on the CONDITION: drop the
    // `localPreviewStorage` check and this goes red. The option omitted AND
    // explicitly false must both behave as before: the storage scope goes to
    // the host, and a grant of only the other scope is not enough to resolve.
    for (const session of [
      (t: ReturnType<typeof createFakeTransport>) => createHostSession(t),
      (t: ReturnType<typeof createFakeTransport>) =>
        createHostSession(t, { localPreviewStorage: false }),
    ]) {
      const t = createFakeTransport({ token: token(['models:read:self']) });
      let settled: boolean | undefined;
      const pending = session(t)
        .requestGrants(['apps:storage', 'buzz:read:self'])
        .then((v) => (settled = v));

      expect(t.sent).toEqual([
        { type: 'REQUEST_CONSENT', payload: { scopes: ['apps:storage', 'buzz:read:self'] } },
      ]);
      t.setSnapshot({ token: token(['models:read:self', 'buzz:read:self']) });
      await Promise.resolve();
      expect(settled).toBeUndefined();

      t.push('CONSENT_UNAVAILABLE', { reason: 'ungrantable', scopes: ['apps:storage'] });
      await expect(pending).resolves.toBe(false);
    }
  });

  it('ends the wait when the caller aborts', async () => {
    const t = createFakeTransport({ token: token([]) });
    const ac = new AbortController();

    const pending = createHostSession(t)
      .requestGrants(['buzz:read:self'], { signal: ac.signal });
    ac.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});

/**
 * A dev-tunnel preview (`storageMode: 'local-preview'`): the document store is
 * served by the in-tab local store, and the host never mints a document-store
 * scope onto the token. Asking the host for one can only be refused, so the
 * session treats the document-store scopes as held and asks only for the rest.
 *
 * Fixtures: every scope list below is distinct from the others and from the
 * token's own scopes, so an assertion cannot pass by echoing a neighbour.
 */
describe('session.requestGrants in a local preview', () => {
  it('a document-store-only request resolves true without contacting the host', async () => {
    const t = createFakeTransport({ token: token(['user:read:self']) });

    const granted = createHostSession(t, { localPreviewStorage: true }).requestGrants([
      'apps:storage',
      'apps:storage:publish',
    ]);
    // First, so a session that still asks the host fails HERE rather than timing out.
    expect(t.sent).toEqual([]);
    await expect(granted).resolves.toBe(true);
  });

  it('a mixed request asks only for the rest and resolves true once that is granted', async () => {
    const t = createFakeTransport({ token: token(['collections:read:self']) });

    const pending = createHostSession(t, { localPreviewStorage: true }).requestGrants([
      'apps:storage',
      'ai:write:budgeted',
      'apps:storage:publish',
    ]);
    expect(t.sent).toEqual([{ type: 'REQUEST_CONSENT', payload: { scopes: ['ai:write:budgeted'] } }]);
    t.setSnapshot({ token: token(['collections:read:self', 'ai:write:budgeted']) });

    await expect(pending).resolves.toBe(true);
  });

  it('a mixed request still resolves false when the host refuses the rest', async () => {
    const t = createFakeTransport({ token: token(['goods:read:self']) });

    const pending = createHostSession(t, { localPreviewStorage: true }).requestGrants([
      'posts:write:self',
      'apps:storage',
    ]);
    expect(t.sent).toEqual([{ type: 'REQUEST_CONSENT', payload: { scopes: ['posts:write:self'] } }]);
    t.push('CONSENT_UNAVAILABLE', { reason: 'ungrantable', scopes: ['posts:write:self'] });

    await expect(pending).resolves.toBe(false);
  });

  it('storage scopes the local store does NOT serve still go to the host', async () => {
    // Shared storage and the deprecated key/value scopes keep the real routes in
    // a preview, so holding them locally would be a lie.
    const t = createFakeTransport({ token: token(['social:react:self']) });

    const pending = createHostSession(t, { localPreviewStorage: true }).requestGrants([
      'apps:storage:shared:read',
      'apps:storage:write',
    ]);
    expect(t.sent).toEqual([
      {
        type: 'REQUEST_CONSENT',
        payload: { scopes: ['apps:storage:shared:read', 'apps:storage:write'] },
      },
    ]);
    t.push('CONSENT_UNAVAILABLE', { reason: 'ungrantable', scopes: [] });
    await expect(pending).resolves.toBe(false);
  });
});
