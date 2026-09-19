import { describe, expect, it } from 'vitest';

import { HOST, init, mountTransport } from '../support/iframe-host.js';

describe('IframeTransport handshake', () => {
  it('announces itself to each exact allowed origin', () => {
    const { posted } = mountTransport([HOST, 'https://*.civitai.com', 'https://dev.civitai.com']);
    expect(posted.map((p) => [p.msg.type, p.origin])).toEqual([
      ['BLOCK_HELLO', HOST],
      ['BLOCK_HELLO', 'https://dev.civitai.com'],
    ]);
  });

  it('holds outbound messages until init, then flushes them in order', () => {
    const { transport, posted, deliver, sentTypes } = mountTransport();
    transport.notify({ type: 'RESIZE_IFRAME', payload: { height: 10 } });
    transport.notify({ type: 'RESIZE_IFRAME', payload: { height: 20 } });
    expect(sentTypes()).toEqual(['BLOCK_HELLO']);

    deliver(init());

    expect(sentTypes()).toEqual(['BLOCK_HELLO', 'RESIZE_IFRAME', 'RESIZE_IFRAME', 'BLOCK_READY']);
    expect(posted.slice(1).every((p) => p.origin === HOST)).toBe(true);
  });

  it('publishes the snapshot and tells subscribers once', () => {
    const { transport, deliver } = mountTransport();
    let changes = 0;
    transport.snapshot.subscribe(() => (changes += 1));
    expect(transport.snapshot.get().ready).toBe(false);

    deliver(init());

    expect(changes).toBe(1);
    expect(transport.snapshot.get()).toMatchObject({
      ready: true,
      hostOrigin: HOST,
      blockInstanceId: 'bi-1',
      context: { slotId: 'slot-1' },
    });
    expect(transport.snapshot.get().token.expiresAt).toEqual(new Date('2030-01-01T00:00:00.000Z'));
  });

  it('ignores the host re-posting init after it is ready', () => {
    const { transport, deliver, sentTypes } = mountTransport();
    deliver(init());
    deliver(init({ blockInstanceId: 'bi-2' }));

    expect(transport.snapshot.get().blockInstanceId).toBe('bi-1');
    expect(sentTypes().filter((t) => t === 'BLOCK_READY')).toHaveLength(1);
  });

  it('drops everything from an origin outside the allowlist', () => {
    const { transport, deliver, sentTypes } = mountTransport();
    deliver(init(), 'https://evil.example');

    expect(transport.snapshot.get().ready).toBe(false);
    expect(sentTypes()).toEqual(['BLOCK_HELLO']);
  });
});

describe('IframeTransport requests', () => {
  it('resolves on the reply that carries its request id', async () => {
    const { transport, posted, deliver } = mountTransport();
    deliver(init());

    const pending = transport.request('BUZZ_GET_ACCOUNTS', {});
    const sent = posted.at(-1)!.msg as { type: string; payload: { requestId: string } };
    expect(sent.type).toBe('BUZZ_GET_ACCOUNTS');

    deliver({
      type: 'BUZZ_GET_ACCOUNTS_RESULT',
      payload: { requestId: sent.payload.requestId, result: { accounts: [] } },
    });

    await expect(pending).resolves.toEqual({ accounts: [] });
  });

  it('does not answer a request with a push that reuses its id', async () => {
    const { transport, posted, deliver } = mountTransport();
    deliver(init());

    const pending = transport.request('BUZZ_GET_ACCOUNTS', {});
    const { requestId } = (posted.at(-1)!.msg as { payload: { requestId: string } }).payload;

    const scans: unknown[] = [];
    transport.on('IMAGE_SCAN_RESOLVED', (payload) => scans.push(payload));
    deliver({ type: 'IMAGE_SCAN_RESOLVED', payload: { requestId, blocked: true } });

    expect(scans).toEqual([{ requestId, blocked: true }]);

    deliver({
      type: 'BUZZ_GET_ACCOUNTS_RESULT',
      payload: { requestId, result: { accounts: [{ type: 'blue', balance: 9 }] } },
    });
    await expect(pending).resolves.toEqual({ accounts: [{ type: 'blue', balance: 9 }] });
  });

  it('rejects with the caller’s reason when the signal aborts', async () => {
    const { transport, deliver } = mountTransport();
    deliver(init());
    const controller = new AbortController();

    const pending = transport.request('BUZZ_GET_ACCOUNTS', {}, { signal: controller.signal });
    controller.abort(new Error('caller gave up'));

    await expect(pending).rejects.toThrow('caller gave up');
  });

  it('queues a request sent before init and answers it after', async () => {
    const { transport, posted, deliver } = mountTransport();
    const pending = transport.request('BUZZ_GET_ACCOUNTS', {});

    deliver(init());
    const sent = posted.find((p) => p.msg.type === 'BUZZ_GET_ACCOUNTS')!.msg as {
      payload: { requestId: string };
    };
    deliver({
      type: 'BUZZ_GET_ACCOUNTS_RESULT',
      payload: { requestId: sent.payload.requestId, result: { accounts: [{ type: 'blue', balance: 4 }] } },
    });

    await expect(pending).resolves.toEqual({ accounts: [{ type: 'blue', balance: 4 }] });
  });
});

describe('IframeTransport pushes', () => {
  it('applies a token rotation to the snapshot', () => {
    const { transport, deliver } = mountTransport();
    deliver(init());

    deliver({
      type: 'TOKEN_REFRESH',
      payload: {
        token: { raw: 'jwt-2', scopes: ['buzz:read'], expiresAt: '2031-01-01T00:00:00.000Z' },
      },
    });

    expect(transport.snapshot.get().token).toMatchObject({ raw: 'jwt-2', scopes: ['buzz:read'] });
  });

  it('follows a theme change but stays quiet when the theme is unchanged', () => {
    const { transport, deliver } = mountTransport();
    deliver(init());
    let changes = 0;
    transport.snapshot.subscribe(() => (changes += 1));

    deliver({ type: 'THEME_CHANGE', payload: { theme: 'dark' } });
    deliver({ type: 'THEME_CHANGE', payload: { theme: 'dark' } });

    expect(transport.snapshot.get().theme).toBe('dark');
    expect(changes).toBe(1);
  });

  it('stops delivering to an unsubscribed handler', () => {
    const { transport, deliver } = mountTransport();
    deliver(init());
    const seen: unknown[] = [];
    const off = transport.on('USER_CHECKPOINT_SET', (p) => seen.push(p));

    deliver({ type: 'USER_CHECKPOINT_SET', payload: { checkpoint: 'a' } });
    off();
    deliver({ type: 'USER_CHECKPOINT_SET', payload: { checkpoint: 'b' } });

    expect(seen).toEqual([{ checkpoint: 'a' }]);
  });
});

describe('IframeTransport legacy replies', () => {
  const exchange = (
    type: string,
    reply: (requestId: string) => unknown,
    replyType = `${type}_RESULT`,
  ) => {
    const { transport, posted, deliver } = mountTransport();
    deliver(init());
    const pending = transport.request(type, {});
    const { requestId } = (posted.at(-1)!.msg as { payload: { requestId: string } }).payload;
    deliver({ type: replyType, payload: { requestId, ...(reply(requestId) as object) } });
    return pending;
  };

  it('answers a reply that carries its fields directly', async () => {
    await expect(exchange('APP_STORAGE_GET', () => ({ value: { theme: 'neon' } }))).resolves.toEqual({
      value: { theme: 'neon' },
    });
  });

  it('classifies a failure the host reported as prose', async () => {
    await expect(
      exchange('APP_STORAGE_SET', () => ({ error: 'per-user storage quota exceeded' })),
    ).rejects.toMatchObject({
      code: 'insufficient',
      operation: 'APP_STORAGE_SET',
      message: 'per-user storage quota exceeded',
    });
  });

  it('classifies a failure the host spelled as a code of its own', async () => {
    await expect(exchange('SAVE_IMAGE', () => ({ error: 'busy' }))).rejects.toMatchObject({
      code: 'rate-limited',
      operation: 'SAVE_IMAGE',
    });
  });

  it('reads an empty error as no failure at all', async () => {
    await expect(exchange('APP_STORAGE_LIST', () => ({ keys: [], error: '' }))).resolves.toEqual({
      keys: [],
    });
  });
});
