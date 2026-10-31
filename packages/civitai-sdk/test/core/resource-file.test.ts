import { describe, expect, it } from 'vitest';

import { BridgeError } from '../../src/core/errors.js';
import { HOST_REPLIES } from '../../src/core/transports/host-replies.generated.js';
import { init, mountTransport } from '../support/iframe-host.js';

/**
 * `GET_RESOURCE_FILE` (civitai/civitai-app-starters#664, phase 2) through the
 * raw `request()`. There is no typed `app.host` wrapper yet; what this pins is
 * that `request()` knows the type instead of refusing it as one the host never
 * answered.
 *
 * The expected values are LITERALS from the issue's decided shape, never read
 * off the snapshot or the generated ledger, so a regenerated ledger that drifted
 * from the host contract fails here rather than agreeing with itself.
 */

const FILE = {
  meta: {
    modelId: 4101,
    modelVersionId: 5202,
    fileId: 6303,
    fileName: 'workflow.json',
    modelName: 'A workflow',
    versionName: 'v1',
    creatorUsername: 'maker',
  },
  entries: [{ path: 'workflow.json', format: 'ui', graph: { nodes: [] } }],
  truncated: false,
};

function exchange(fields: Record<string, unknown>) {
  const { transport, posted, deliver } = mountTransport();
  deliver(init());
  const pending = transport.request(
    'GET_RESOURCE_FILE',
    { modelVersionId: 5202, fileId: 6303 },
    { signal: AbortSignal.timeout(500) },
  );
  const sent = posted.at(-1)!.msg as {
    type: string;
    payload?: { requestId?: string; modelVersionId?: number; fileId?: number };
  };
  if (sent.type === 'GET_RESOURCE_FILE' && sent.payload?.requestId) {
    deliver({ type: 'RESOURCE_FILE_RESULT', payload: { requestId: sent.payload.requestId, ...fields } });
  }
  return { pending, sent };
}

describe('GET_RESOURCE_FILE in the host reply ledger', () => {
  it('is answered with RESOURCE_FILE_RESULT, legacy framing, carrying `file`', () => {
    expect(HOST_REPLIES['GET_RESOURCE_FILE']).toEqual({
      reply: 'RESOURCE_FILE_RESULT',
      framing: 'legacy',
      keys: ['file'],
    });
  });

  it('request() posts the type with its payload and resolves with the file', async () => {
    const { pending, sent } = exchange({ file: FILE });
    expect(sent.type).toBe('GET_RESOURCE_FILE');
    expect(sent.payload).toMatchObject({ modelVersionId: 5202, fileId: 6303 });
    await expect(pending).resolves.toEqual({ file: FILE });
  });

  it('request() rejects with a BridgeError carrying the host code as its message', async () => {
    const { pending } = exchange({ error: 'rate-limited' });
    await expect(pending).rejects.toBeInstanceOf(BridgeError);
    await expect(pending).rejects.toMatchObject({
      operation: 'GET_RESOURCE_FILE',
      message: 'rate-limited',
    });
  });
});
