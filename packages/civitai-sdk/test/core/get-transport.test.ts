import { afterEach, describe, expect, it } from 'vitest';

import { __resetTransport, getTransport } from '../../src/core/get-transport.js';
import { initPayload } from '../support/iframe-host.js';

function frame() {
  const listeners = new Set<(event: MessageEvent) => void>();
  const win = {
    parent: { postMessage: () => {} },
    location: { hash: '', pathname: '/', search: '' },
    history: { state: null, replaceState: () => {} },
    addEventListener: (_type: string, fn: (event: MessageEvent) => void) => listeners.add(fn),
    removeEventListener: (_type: string, fn: (event: MessageEvent) => void) => listeners.delete(fn),
  };
  const deliver = (origin: string) => {
    for (const fn of [...listeners]) fn({ data: { type: 'BLOCK_INIT', payload: initPayload() }, origin } as MessageEvent);
  };
  return { win: win as unknown as Window, deliver };
}

describe('getTransport with no configured parents', () => {
  afterEach(() => __resetTransport());

  it.each(['https://civitai.com', 'https://civitai.red', 'https://civitai.green', 'https://app.civitai.com'])(
    'starts inside %s',
    (origin) => {
      const { win, deliver } = frame();
      const transport = getTransport({ window: win });

      deliver(origin);

      expect(transport.snapshot.get().ready).toBe(true);
    },
  );

  it('ignores a page that is not civitai', () => {
    const { win, deliver } = frame();
    const transport = getTransport({ window: win });

    deliver('https://civitai.red.example');

    expect(transport.snapshot.get().ready).toBe(false);
  });
});
