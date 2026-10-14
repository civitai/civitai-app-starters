import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { BridgeError } from '../../src/core/errors.js';
import { unanswerable, unwrap } from '../../src/core/transports/iframe-transport.js';
import { init, mountTransport } from '../support/iframe-host.js';

/**
 * Every request the host answers, delivered through the real transport in the
 * shape the host sends it. The expectations come from the host's side of the
 * contract — the committed snapshot of civitai's inventory and reply literals —
 * never from the transport's own table, so a table that disagrees with the host
 * fails here rather than agreeing with itself.
 */
interface HostMessage {
  request: boolean;
  reply: string;
  framing?: 'envelope' | 'legacy';
  failure?: 'string' | 'object' | null;
  replyKeys?: string[] | null;
}

const snapshot = JSON.parse(
  readFileSync(new URL('../../snapshots/host-messages.json', import.meta.url), 'utf8'),
) as { messages: Record<string, HostMessage> };

const requests = Object.entries(snapshot.messages).filter(([, m]) => m.request);
const notifications = Object.entries(snapshot.messages)
  .filter(([, m]) => !m.request)
  .map(([type]) => type);

/** Long enough for a microtask round-trip; a hang turns red here, not at the suite timeout. */
const HANG_MS = 500;

function exchange(type: string, reply: string, fields: Record<string, unknown>) {
  const { transport, posted, deliver } = mountTransport();
  deliver(init());
  const pending = transport.request(type, {}, { signal: AbortSignal.timeout(HANG_MS) });
  const sent = posted.at(-1)!.msg as { type: string; payload?: { requestId?: string } };
  // A rejection before anything was posted has no requestId to answer.
  if (sent.type === type && sent.payload?.requestId) {
    deliver({ type: reply, payload: { requestId: sent.payload.requestId, ...fields } });
  }
  return pending;
}

/** Distinct per key and per type, so a reply resolved for the wrong request cannot pass. */
function fixture(type: string, keys: string[] | null | undefined): Record<string, unknown> {
  // Unknown keys: any flat field must come back as-is.
  const names = keys && keys.length > 0 ? keys : ['probe'];
  return Object.fromEntries(names.map((key) => [key, `${type}.${key}`]));
}

describe('every host request settles through the transport', () => {
  // A snapshot that parsed empty would pass every row below.
  it('covers the whole host inventory', () => {
    expect(requests.length).toBeGreaterThanOrEqual(40);
  });

  it.each(requests)('%s resolves with what the host replied', async (type, host) => {
    const fields = fixture(type, host.replyKeys);
    const expected = host.replyKeys?.length === 1 && host.replyKeys[0] === 'result' ? fields.result : fields;
    await expect(exchange(type, host.reply, fields)).resolves.toEqual(expected);
  });

  // Only where the host is seen sending a failure: one it never sends proves nothing.
  const failing = requests.filter(([, host]) => host.failure != null);
  it('sees a failure form for most of the inventory', () => {
    expect(failing.length).toBeGreaterThanOrEqual(30);
  });

  it.each(failing)('%s rejects with the failure the host reported', async (type, host) => {
    const error = host.framing === 'envelope' ? { code: 'invalid', message: 'boom' } : 'boom';
    const failure = exchange(type, host.reply, { error });
    await expect(failure).rejects.toBeInstanceOf(BridgeError);
    await expect(failure).rejects.toMatchObject({
      code: host.framing === 'envelope' ? 'invalid' : 'unavailable',
      operation: type,
      message: 'boom',
    });
  });
});

describe('a request the host never answers', () => {
  it('rejects at once instead of hanging', async () => {
    const { transport, posted, deliver } = mountTransport();
    deliver(init());
    const before = posted.length;

    await expect(transport.request('NOT_A_HOST_MESSAGE', {})).rejects.toMatchObject({
      code: 'invalid',
      operation: 'NOT_A_HOST_MESSAGE',
    });
    // Nothing reached the host, so nothing is left pending.
    expect(posted.length).toBe(before);
  });

  it.each(notifications)('%s is fire-and-forget, so request() refuses it', async (type) => {
    const { transport, deliver } = mountTransport();
    deliver(init());
    await expect(transport.request(type, {})).rejects.toThrow(/notify\(\)/);
  });

  it('names what replaced a bridge message', async () => {
    const { transport, deliver } = mountTransport();
    deliver(init());
    await expect(transport.request('TRACK_EVENT', {})).rejects.toThrow('app.host.track');
  });

  // The host answers GET_VIEWER today, so the transport cannot reach this; it is
  // what a block sees the day the host drops it from the bridge.
  it('points a dropped GET_VIEWER at blocks/me, not /me', () => {
    expect(unanswerable('GET_VIEWER').message).toBe(
      "GET_VIEWER is not a request the host answers, so request() would wait forever. " +
        "Use app.site.get('blocks/me') instead.",
    );
  });
});

// No host reply is envelope-framed yet, so nothing above reaches this branch.
describe('an envelope-framed reply', () => {
  const envelope = { reply: 'X_RESULT', framing: 'envelope', keys: null } as const;

  it('resolves with its result', () => {
    expect(unwrap('X', { requestId: 'r', result: { a: 1 } }, envelope)).toEqual({ a: 1 });
  });

  it('rejects with the code and message it carries', () => {
    expect(() =>
      unwrap('X', { requestId: 'r', error: { code: 'forbidden', message: 'no' } }, envelope),
    ).toThrow(expect.objectContaining({ code: 'forbidden', operation: 'X', message: 'no' }));
  });
});
