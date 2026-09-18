import type { BlockInitPayload } from '@civitai/app-sdk/blocks';

import { IframeTransport } from '../../src/core/transports/iframe-transport.js';

export const HOST = 'https://civitai.com';

interface Posted {
  msg: { type: string; payload?: unknown };
  origin: string;
}

export function mountTransport(allowedParentOrigins: string[] = [HOST]) {
  const listeners = new Set<(event: MessageEvent) => void>();
  const posted: Posted[] = [];
  const win = {
    parent: { postMessage: (msg: Posted['msg'], origin: string) => posted.push({ msg, origin }) },
    location: { hash: '', pathname: '/', search: '' },
    history: { state: null, replaceState: () => {} },
    addEventListener: (type: string, fn: (event: MessageEvent) => void) => {
      if (type === 'message') listeners.add(fn);
    },
    removeEventListener: (_type: string, fn: (event: MessageEvent) => void) => {
      listeners.delete(fn);
    },
  };

  const transport = new IframeTransport({
    allowedParentOrigins,
    window: win as unknown as Window,
  });

  const deliver = (data: unknown, origin = HOST) => {
    for (const fn of [...listeners]) fn({ data, origin } as MessageEvent);
  };
  const sentTypes = () => posted.map((p) => p.msg.type);

  return { transport, posted, deliver, sentTypes };
}

export const initPayload = (overrides: Partial<BlockInitPayload> = {}): BlockInitPayload => ({
  blockInstanceId: 'bi-1',
  blockId: 'b-1',
  appId: 'a-1',
  token: { raw: 'jwt', scopes: [], expiresAt: '2030-01-01T00:00:00.000Z' },
  context: { slotId: 'slot-1' },
  settings: { publisherSettings: {}, userSettings: {} },
  viewer: null,
  theme: 'light',
  renderMode: 'iframe',
  ...overrides,
});

export const init = (overrides?: Partial<BlockInitPayload>) => ({
  type: 'BLOCK_INIT',
  payload: initPayload(overrides),
});

