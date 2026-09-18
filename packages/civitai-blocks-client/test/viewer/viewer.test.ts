import { describe, expect, it } from 'vitest';

import { viewer } from '../../src/index.js';
import { createFakeTransport } from '../../src/testing.js';
import { init, mountTransport } from '../support/iframe-host.js';

const VIEWER = { id: 7, username: 'koen', status: 'active' as const, buzzBudget: 500 };

const token = (scopes: string[]) => ({ raw: 'jwt', scopes, expiresAt: new Date(0) });

describe('viewer.getViewer', () => {
  it('returns the viewer, not the reply', async () => {
    const t = createFakeTransport();
    t.reply('GET_VIEWER', { viewer: VIEWER });

    await expect(viewer.getViewer({ transport: t })).resolves.toEqual(VIEWER);
  });

  it('reads the host’s differently-named reply and classifies its refusal', async () => {
    const { transport, posted, deliver } = mountTransport();
    deliver(init());

    const pending = viewer.getViewer({ transport });
    const { requestId } = (posted.at(-1)!.msg as { payload: { requestId: string } }).payload;
    deliver({
      type: 'VIEWER_RESULT',
      payload: { requestId, error: 'viewer read requires an authenticated viewer' },
    });

    await expect(pending).rejects.toMatchObject({
      code: 'unauthenticated',
      operation: 'GET_VIEWER',
    });
  });
});

describe('viewer.requestSignIn', () => {
  it('asks the host to start its login flow', () => {
    const t = createFakeTransport();

    viewer.requestSignIn({ returnUrl: '/gallery' }, { transport: t });

    expect(t.sent.at(-1)).toEqual({
      type: 'REQUEST_SIGN_IN',
      payload: { returnUrl: '/gallery' },
    });
  });
});

describe('viewer.requestConsent', () => {
  it('does not ask for a scope the token already carries', async () => {
    const t = createFakeTransport({ token: token(['buzz:read:self']) });

    await expect(viewer.requestConsent(['buzz:read:self'], { transport: t })).resolves.toBeUndefined();
    expect(t.sent).toHaveLength(0);
  });

  it('settles when the re-minted token carries the scope', async () => {
    const t = createFakeTransport({ token: token([]) });

    const pending = viewer.requestConsent(['buzz:read:self'], { transport: t });
    expect(t.sent.at(-1)).toEqual({
      type: 'REQUEST_CONSENT',
      payload: { scopes: ['buzz:read:self'] },
    });

    t.setSnapshot({ token: token(['buzz:read:self', 'user:read:self']) });

    await expect(pending).resolves.toBeUndefined();
  });

  it('takes a refusal that names nothing as a refusal all the same', async () => {
    const t = createFakeTransport({ token: token([]) });

    const pending = viewer.requestConsent(['ai:write:budgeted'], { transport: t });
    t.push('CONSENT_UNAVAILABLE', { reason: 'ungrantable', scopes: [] });

    await expect(pending).rejects.toMatchObject({
      code: 'forbidden',
      operation: 'REQUEST_CONSENT',
    });
  });

  it('stops listening once it settles', async () => {
    const t = createFakeTransport({ token: token([]) });

    const pending = viewer.requestConsent(['buzz:read:self'], { transport: t });
    expect(t.listenerCount('CONSENT_UNAVAILABLE')).toBe(1);

    t.setSnapshot({ token: token(['buzz:read:self']) });
    await pending;

    expect(t.listenerCount('CONSENT_UNAVAILABLE')).toBe(0);
  });

  it('ends the wait when the caller aborts', async () => {
    const t = createFakeTransport({ token: token([]) });
    const ac = new AbortController();

    const pending = viewer.requestConsent(['buzz:read:self'], { transport: t, signal: ac.signal });
    ac.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});
