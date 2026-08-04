import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BlockInitPayload, ParentToBlockMessage } from '@civitai/app-sdk/blocks';

import { IframeTransport } from '../src/internal/iframeTransport.js';
import { mockParentMessage } from '../src/testing.js';

/**
 * The two wire-contract changes, exercised as a COMPATIBILITY MATRIX:
 *
 *   A. `theme` / `renderMode` / `blockInstanceId` also travel in the iframe URL
 *      FRAGMENT, as an additive fast path. The BLOCK_INIT payload stays
 *      authoritative and still carries all three.
 *   B. The block ANNOUNCES readiness (`BLOCK_HELLO`) so the host can push the
 *      payload in response, instead of the host blind-polling.
 *
 * Every test here names which matrix cell it covers. The cells that live on the
 * HOST side of the wire (old-SDK-against-new-host; a block that never
 * announces) are covered in civitai's `iframeInitController` tests — a host
 * property cannot be proven from inside the block.
 */

const PARENT_ORIGIN = 'https://civitai.com';
const WIRE = 'civitai-block=v1&theme=dark&renderMode=iframe&blockInstanceId=bi_frag';

function buildInitPayload(overrides: Partial<BlockInitPayload> = {}): BlockInitPayload {
  return {
    blockInstanceId: 'bi_payload',
    blockId: 'my-block',
    appId: 'app_test',
    token: {
      raw: 'jwt-1',
      scopes: ['models:read:self'],
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    },
    context: { slotId: 'model.sidebar_top', modelId: 42 },
    settings: { publisherSettings: {}, userSettings: {} },
    viewer: { id: 1, username: 'alice', status: 'active' },
    theme: 'light',
    renderMode: 'iframe',
    ...overrides,
  };
}

describe('IframeTransport — init fragment fast path + readiness announce', () => {
  let postMessageMock: ReturnType<typeof vi.fn>;
  let originalParent: Window;
  let originalHash: string;

  beforeEach(() => {
    vi.useFakeTimers();
    postMessageMock = vi.fn();
    originalParent = window.parent;
    originalHash = window.location.hash;
    Object.defineProperty(window, 'parent', {
      value: { postMessage: postMessageMock },
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(window, 'parent', {
      value: originalParent,
      configurable: true,
      writable: true,
    });
    window.location.hash = originalHash;
  });

  // ── A: fragment fast path ────────────────────────────────────────────────

  it('NEW SDK + NEW HOST: seeds theme/renderMode/blockInstanceId from the fragment BEFORE any message', () => {
    window.location.hash = `#${WIRE}`;
    const transport = new IframeTransport({ allowedParentOrigins: [PARENT_ORIGIN] });

    const snap = transport.getSnapshot();
    expect(snap.theme).toBe('dark');
    expect(snap.renderMode).toBe('iframe');
    expect(snap.blockInstanceId).toBe('bi_frag');
    transport.dispose();
  });

  it('NEW SDK + NEW HOST: the fragment does NOT make the block ready and grants no token/viewer', () => {
    // 🔴 The security-relevant half. A URL is not a credential: nothing the
    // fragment says may unlock a block, and no token may ever be sourced from
    // it. Only BLOCK_INIT flips `ready`.
    window.location.hash = `#${WIRE}`;
    const transport = new IframeTransport({ allowedParentOrigins: [PARENT_ORIGIN] });

    const snap = transport.getSnapshot();
    expect(snap.ready).toBe(false);
    expect(snap.token.raw).toBe('');
    expect(snap.viewer).toBeNull();
    expect(snap.context).toEqual({ slotId: '' });
    expect(transport.getHostOrigin()).toBeNull();
    transport.dispose();
  });

  it('NEW SDK + NEW HOST: BLOCK_INIT OVERRIDES the fragment — the payload is authoritative', async () => {
    // The fragment says dark/bi_frag; the payload says light/bi_payload. The
    // payload must win, in every one of the three fields.
    window.location.hash = `#${WIRE}`;
    const transport = new IframeTransport({ allowedParentOrigins: [PARENT_ORIGIN] });
    expect(transport.getSnapshot().theme).toBe('dark');

    const init: ParentToBlockMessage = { type: 'BLOCK_INIT', payload: buildInitPayload() };
    window.dispatchEvent(mockParentMessage(init, PARENT_ORIGIN));
    await transport.waitForInit();

    const snap = transport.getSnapshot();
    expect(snap.ready).toBe(true);
    expect(snap.theme).toBe('light');
    expect(snap.blockInstanceId).toBe('bi_payload');
    transport.dispose();
  });

  it('NEW SDK + OLD HOST: no fragment → sentinel snapshot, and BLOCK_INIT still works unchanged', async () => {
    // An old host appends nothing. The block must behave exactly as it does
    // today: sentinel values until the payload lands, then full init.
    window.location.hash = '';
    const transport = new IframeTransport({ allowedParentOrigins: [PARENT_ORIGIN] });

    const before = transport.getSnapshot();
    expect(before.theme).toBe('light'); // EMPTY_SNAPSHOT sentinel
    expect(before.blockInstanceId).toBe('');
    expect(before.ready).toBe(false);

    window.dispatchEvent(
      mockParentMessage(
        { type: 'BLOCK_INIT', payload: buildInitPayload({ theme: 'dark' }) },
        PARENT_ORIGIN,
      ),
    );
    await transport.waitForInit();

    expect(transport.getSnapshot().ready).toBe(true);
    expect(transport.getSnapshot().theme).toBe('dark');
    expect(transport.getSnapshot().blockInstanceId).toBe('bi_payload');
    transport.dispose();
  });

  it("NEW SDK + a block's OWN hash route: the fragment is left alone and nothing is seeded", () => {
    // The marker gate is what makes the format safe to co-exist with a
    // hash-routing block app. Neither the snapshot nor the URL may move.
    window.location.hash = '#/settings/profile';
    const transport = new IframeTransport({ allowedParentOrigins: [PARENT_ORIGIN] });

    expect(transport.getSnapshot().blockInstanceId).toBe('');
    expect(window.location.hash).toBe('#/settings/profile');
    transport.dispose();
  });

  it('strips only OUR keys from the visible URL, preserving the block app’s own', () => {
    window.location.hash = `#${WIRE}&tab=history`;
    const transport = new IframeTransport({ allowedParentOrigins: [PARENT_ORIGIN] });

    expect(transport.getSnapshot().blockInstanceId).toBe('bi_frag');
    expect(window.location.hash).toBe('#tab=history');
    transport.dispose();
  });

  it('a failing history.replaceState (opaque-origin sandbox) does not break the seed, and the payload still wins', async () => {
    // A sandboxed frame without `allow-same-origin` can reject the History
    // API. Stripping is cosmetic; the seed must survive it.
    //
    // 🔴 This test also carries the payload-authority claim in its HARD case.
    // The sibling test above proves the payload wins on a URL whose fragment
    // the strip already removed — so it would still pass if the transport
    // re-read the fragment after init. Here the fragment is STILL IN THE URL
    // when BLOCK_INIT lands, so "payload wins" can only hold if the fragment is
    // genuinely read once, before init, and never consulted again.
    window.location.hash = `#${WIRE}`;
    const spy = vi.spyOn(window.history, 'replaceState').mockImplementation(() => {
      throw new Error('SecurityError');
    });

    const transport = new IframeTransport({ allowedParentOrigins: [PARENT_ORIGIN] });
    expect(transport.getSnapshot().theme).toBe('dark');
    expect(transport.getSnapshot().blockInstanceId).toBe('bi_frag');
    expect(window.location.hash).toBe(`#${WIRE}`); // strip really did fail

    window.dispatchEvent(
      mockParentMessage({ type: 'BLOCK_INIT', payload: buildInitPayload() }, PARENT_ORIGIN),
    );
    await transport.waitForInit();

    expect(window.location.hash).toBe(`#${WIRE}`); // fragment still present…
    expect(transport.getSnapshot().theme).toBe('light'); // …and the payload still won
    expect(transport.getSnapshot().blockInstanceId).toBe('bi_payload');

    spy.mockRestore();
    transport.dispose();
  });

  // ── B: readiness announce ────────────────────────────────────────────────

  it('announces BLOCK_HELLO to the exact allowed origin, contentlessly, exactly once', () => {
    const transport = new IframeTransport({ allowedParentOrigins: [PARENT_ORIGIN] });

    const hellos = postMessageMock.mock.calls.filter(
      (c) => (c[0] as { type: string }).type === 'BLOCK_HELLO',
    );
    expect(hellos).toHaveLength(1);
    // 🔴 No payload: the announce goes out BEFORE the parent has been
    // authenticated, so it must disclose nothing.
    expect(hellos[0][0]).toEqual({ type: 'BLOCK_HELLO' });
    expect(hellos[0][1]).toBe(PARENT_ORIGIN);
    transport.dispose();
  });

  it('announces to EVERY exact allowed origin and to no wildcard', () => {
    const transport = new IframeTransport({
      allowedParentOrigins: [PARENT_ORIGIN, 'https://*.civitaic.com', 'https://green.civitai.com'],
    });

    const targets = postMessageMock.mock.calls
      .filter((c) => (c[0] as { type: string }).type === 'BLOCK_HELLO')
      .map((c) => c[1]);
    expect(targets).toEqual([PARENT_ORIGIN, 'https://green.civitai.com']);
    expect(targets).not.toContain('*');
    transport.dispose();
  });

  it('falls back to "*" ONLY when the allowlist is wildcard-only', () => {
    const transport = new IframeTransport({ allowedParentOrigins: ['https://*.civitaic.com'] });

    const targets = postMessageMock.mock.calls
      .filter((c) => (c[0] as { type: string }).type === 'BLOCK_HELLO')
      .map((c) => c[1]);
    expect(targets).toEqual(['*']);
    transport.dispose();
  });

  it('announces AFTER the message listener is attached, so a synchronous host reply is not missed', async () => {
    // Ordering is the whole point: a host that answers the announce
    // synchronously must find a listener already installed. Simulate that by
    // dispatching BLOCK_INIT from inside the parent's postMessage handler.
    let transport: IframeTransport | undefined;
    postMessageMock.mockImplementation((msg: { type: string }) => {
      if (msg.type !== 'BLOCK_HELLO') return;
      window.dispatchEvent(
        mockParentMessage({ type: 'BLOCK_INIT', payload: buildInitPayload() }, PARENT_ORIGIN),
      );
    });

    transport = new IframeTransport({ allowedParentOrigins: [PARENT_ORIGIN] });
    await transport.waitForInit();

    expect(transport.getSnapshot().ready).toBe(true);
    transport.dispose();
  });

  it('does not announce when the frame has no distinct parent', () => {
    Object.defineProperty(window, 'parent', {
      value: window,
      configurable: true,
      writable: true,
    });
    const spy = vi.spyOn(window, 'postMessage');

    const transport = new IframeTransport({ allowedParentOrigins: [PARENT_ORIGIN] });
    expect(spy).not.toHaveBeenCalled();

    spy.mockRestore();
    transport.dispose();
  });

  it('the announce is not a precondition: BLOCK_INIT still resolves if the parent ignores it', async () => {
    // NEW SDK + OLD HOST for part B. The old host has no BLOCK_HELLO handler,
    // so the announce is simply dropped; the host's own retry delivers init.
    const transport = new IframeTransport({ allowedParentOrigins: [PARENT_ORIGIN] });

    vi.advanceTimersByTime(5_000);
    window.dispatchEvent(
      mockParentMessage({ type: 'BLOCK_INIT', payload: buildInitPayload() }, PARENT_ORIGIN),
    );
    await transport.waitForInit();

    expect(transport.getSnapshot().ready).toBe(true);
    transport.dispose();
  });
});
