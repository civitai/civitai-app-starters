import { describe, expect, it } from 'vitest';

import { BridgeError } from '../../src/core/errors.js';
import { HOST_REPLIES } from '../../src/core/transports/host-replies.generated.js';
import { init, mountTransport } from '../support/iframe-host.js';

/**
 * `PERSIST_GENERATION_SOURCE` (HQ task app_blocks_sdk_x7dw) through the raw
 * `request()`. There is no typed `app.host` wrapper; what this pins is that
 * `request()` knows the type instead of refusing it as one the host never
 * answered.
 *
 * The expected values are LITERALS from the decided contract, never read off
 * the snapshot or the generated ledger, so a regenerated ledger that drifted
 * from the host contract fails here rather than agreeing with itself.
 */

const RESULT = {
  url: 'https://image.civitai.com/x/original=true/persisted.jpeg',
  width: 832,
  height: 1216,
  imageId: 7301,
  ready: false,
};

function exchange(fields: Record<string, unknown>) {
  const { transport, posted, deliver } = mountTransport();
  deliver(init());
  const pending = transport.request(
    'PERSIST_GENERATION_SOURCE',
    { workflowId: 'wf_persist', imageIndex: 1 },
    { signal: AbortSignal.timeout(500) },
  );
  const sent = posted.at(-1)!.msg as {
    type: string;
    payload?: { requestId?: string; workflowId?: string; imageIndex?: number };
  };
  if (sent.type === 'PERSIST_GENERATION_SOURCE' && sent.payload?.requestId) {
    deliver({ type: 'GENERATION_SOURCE_PERSISTED', payload: { requestId: sent.payload.requestId, ...fields } });
  }
  return { pending, sent };
}

describe('PERSIST_GENERATION_SOURCE in the host reply ledger', () => {
  it('is answered with GENERATION_SOURCE_PERSISTED, legacy framing, carrying `result`', () => {
    expect(HOST_REPLIES['PERSIST_GENERATION_SOURCE']).toEqual({
      reply: 'GENERATION_SOURCE_PERSISTED',
      framing: 'legacy',
      keys: ['result'],
    });
  });

  // The ledger's only key is `result`, so request() unwraps it: the caller gets
  // the source itself, not `{ result }`.
  it('request() posts the type with its payload and resolves with the unwrapped source', async () => {
    const { pending, sent } = exchange({ result: RESULT });
    expect(sent.type).toBe('PERSIST_GENERATION_SOURCE');
    expect(sent.payload).toMatchObject({ workflowId: 'wf_persist', imageIndex: 1 });
    await expect(pending).resolves.toEqual(RESULT);
  });

  it('request() rejects with a BridgeError carrying the host error as its message', async () => {
    const { pending } = exchange({ error: 'not supported in an iframe host' });
    await expect(pending).rejects.toBeInstanceOf(BridgeError);
    await expect(pending).rejects.toMatchObject({
      operation: 'PERSIST_GENERATION_SOURCE',
      message: 'not supported in an iframe host',
    });
  });
});
