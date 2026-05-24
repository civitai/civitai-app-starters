import { afterEach, describe, expect, it } from 'vitest';

import { BlockTransportDetector } from '../src/internal/detector.js';
import { IframeTransport } from '../src/internal/iframeTransport.js';
import { InlineTransport } from '../src/internal/inlineTransport.js';

describe('BlockTransportDetector.detect', () => {
  afterEach(() => {
    delete (window as { __CIVITAI_BLOCK_CONTEXT__?: unknown }).__CIVITAI_BLOCK_CONTEXT__;
  });

  it('returns IframeTransport when no bootstrap is present', () => {
    const t = BlockTransportDetector.detect({
      allowedParentOrigins: ['https://civitai.com'],
    });
    expect(t).toBeInstanceOf(IframeTransport);
    (t as IframeTransport).dispose();
  });

  it('returns InlineTransport when window.__CIVITAI_BLOCK_CONTEXT__ is set', () => {
    (window as { __CIVITAI_BLOCK_CONTEXT__?: unknown }).__CIVITAI_BLOCK_CONTEXT__ = {
      token: { raw: '', scopes: [], expiresAt: new Date().toISOString() },
      context: { slotId: 'x' },
      settings: { publisherSettings: {}, userSettings: {} },
      viewer: { userId: null, username: null, avatarUrl: null, isLoggedIn: false },
      theme: { colorScheme: 'light', cssVars: {} },
      blockId: 'b',
      blockInstanceId: 'i',
      renderMode: 'inline',
    };
    const t = BlockTransportDetector.detect();
    expect(t).toBeInstanceOf(InlineTransport);
  });
});
