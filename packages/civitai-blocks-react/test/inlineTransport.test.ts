import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { BlockInitPayload } from '@civitai/app-sdk/blocks';

import { InlineTransport } from '../src/internal/inlineTransport.js';

/**
 * `InlineTransport` is the v1 inline-mode stub. Only the DETECTOR pick is
 * covered elsewhere (detector.test.ts); this pins the transport's own contract:
 * it hydrates its snapshot from `window.__CIVITAI_BLOCK_CONTEXT__` (or the EMPTY
 * sentinel), `subscribe` returns a callable no-op unsubscribe, `sendMessage` is
 * an intentional no-op, and `sendRequest` rejects (not implemented in v1).
 */

function buildInit(overrides: Partial<BlockInitPayload> = {}): BlockInitPayload {
  return {
    blockInstanceId: 'inst-1',
    blockId: 'my-block',
    appId: 'app_test',
    token: {
      raw: 'jwt-1',
      scopes: ['models:read:self'],
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    },
    context: { slotId: 'model.sidebar_top', modelId: 42 },
    settings: { publisherSettings: { a: 1 }, userSettings: {} },
    viewer: { id: 7, username: 'alice', status: 'active' },
    theme: 'dark',
    renderMode: 'inline',
    ...overrides,
  };
}

describe('InlineTransport', () => {
  afterEach(() => {
    delete (window as { __CIVITAI_BLOCK_CONTEXT__?: unknown }).__CIVITAI_BLOCK_CONTEXT__;
  });

  describe('getSnapshot()', () => {
    it('returns the EMPTY sentinel (ready:false) when no bootstrap is present', () => {
      const t = new InlineTransport();
      const snap = t.getSnapshot();
      expect(snap.ready).toBe(false);
      expect(snap.renderMode).toBe('iframe');
      expect(snap.context.slotId).toBe('');
      expect(snap.viewer).toBeNull();
    });

    it('hydrates a ready snapshot from window.__CIVITAI_BLOCK_CONTEXT__', () => {
      window.__CIVITAI_BLOCK_CONTEXT__ = buildInit();
      const t = new InlineTransport();
      const snap = t.getSnapshot();
      expect(snap.ready).toBe(true);
      expect(snap.renderMode).toBe('inline');
      expect(snap.blockId).toBe('my-block');
      expect(snap.context).toEqual({ slotId: 'model.sidebar_top', modelId: 42 });
      expect(snap.viewer).toEqual({ id: 7, username: 'alice', status: 'active' });
      // expiresAt is rehydrated to a Date via snapshotFromInit → tokenFromWrapped.
      expect(snap.token.expiresAt).toBeInstanceOf(Date);
      expect(snap.token.scopes).toEqual(['models:read:self']);
    });
  });

  describe('getHostOrigin()', () => {
    it('returns null when no bootstrap is present', () => {
      const t = new InlineTransport();
      expect(t.getHostOrigin()).toBeNull();
    });

    it('returns the same-document host origin once bootstrapped', () => {
      // Inline mode runs in the host's own document, so window.location.origin
      // IS the trusted host origin (no cross-origin boundary). happy-dom's
      // default origin is http://localhost:3000.
      window.__CIVITAI_BLOCK_CONTEXT__ = buildInit();
      const t = new InlineTransport();
      expect(t.getHostOrigin()).toBe(window.location.origin);
    });
  });

  describe('subscribe()', () => {
    it('returns a callable no-op unsubscribe (never notifies in v1)', () => {
      const t = new InlineTransport();
      let called = false;
      const unsub = t.subscribe(() => {
        called = true;
      });
      expect(typeof unsub).toBe('function');
      expect(() => unsub()).not.toThrow();
      expect(called).toBe(false);
    });
  });

  describe('sendMessage()', () => {
    it('is an intentional no-op (does not throw)', () => {
      const t = new InlineTransport();
      expect(() => t.sendMessage({ type: 'TRACK_EVENT', payload: { eventName: 'x' } })).not.toThrow();
    });
  });

  describe('sendRequest()', () => {
    it('rejects — not implemented in v1', async () => {
      const t = new InlineTransport();
      await expect(
        t.sendRequest({ type: 'GET_BUZZ_BALANCE', payload: {} }, 'BUZZ_BALANCE_RESULT'),
      ).rejects.toThrow('InlineTransport.sendRequest is not implemented in v1');
    });
  });
});
