import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BlockInitPayload, ParentToBlockMessage } from '@civitai/app-sdk/blocks';

import { IframeTransport } from '../src/transport/iframeTransport.js';
import { mockParentMessage } from './helpers/mockParentMessage.js';

/**
 * A civitai.com moderator's REVIEW PREVIEW lists `blockErrors:v1` in
 * `BLOCK_INIT.capabilities`, and the review page shows the frame's non-fatal
 * errors in a console. `@civitai/sdk` forwards them from 0.29.0; this is the
 * same forwarding for `@civitai/blocks-react`.
 *
 * 🔴 THE HARNESS INSTALLS NOTHING ITSELF. A real `IframeTransport` receives a
 * real `BLOCK_INIT` through `window`, and every report is read off what the
 * transport posted to the parent. So these tests go red if the transport does
 * not install the reporter, which is the regression they exist to catch.
 *
 * The literal capability string, not the package's constant: it is a wire
 * contract with the host.
 */

const PARENT_ORIGIN = 'https://civitai.com';
const T0 = 1_700_000_000_000;
const TOKEN = 'opaque-review-token-0123456789';

function initPayload(capabilities?: unknown): BlockInitPayload {
  return {
    blockInstanceId: 'inst-review',
    blockId: 'my-block',
    appId: 'app_test',
    token: { raw: TOKEN, scopes: [], expiresAt: new Date(T0 + 3_600_000).toISOString() },
    context: { slotId: 'app.page' } as BlockInitPayload['context'],
    settings: { publisherSettings: {}, userSettings: {} },
    viewer: null,
    theme: 'light',
    renderMode: 'iframe',
    ...(capabilities === undefined ? {} : { capabilities }),
  } as BlockInitPayload;
}

let postMessage: ReturnType<typeof vi.fn>;
let originalParent: Window;
let transport: IframeTransport | null = null;
const realConsoleError = console.error;
let originalConsoleError: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(T0);
  postMessage = vi.fn();
  originalParent = window.parent;
  Object.defineProperty(window, 'parent', {
    value: { postMessage },
    configurable: true,
    writable: true,
  });
  originalConsoleError = vi.fn();
  console.error = originalConsoleError;
});

afterEach(() => {
  transport?.dispose();
  transport = null;
  console.error = realConsoleError;
  vi.useRealTimers();
  Object.defineProperty(window, 'parent', { value: originalParent, configurable: true, writable: true });
});

async function start(capabilities?: unknown) {
  transport = new IframeTransport({ allowedParentOrigins: [PARENT_ORIGIN] });
  const ready = transport.waitForInit();
  const init: ParentToBlockMessage = { type: 'BLOCK_INIT', payload: initPayload(capabilities) };
  window.dispatchEvent(mockParentMessage(init, PARENT_ORIGIN));
  await ready;
}

const errors = () =>
  postMessage.mock.calls
    .map(([msg]) => msg as { type: string; payload: Record<string, unknown> })
    .filter((msg) => msg.type === 'BLOCK_ERROR')
    .map((msg) => msg.payload);

function boom(message: string): Error {
  const error = new Error(message);
  error.stack = `Error: ${message}\n    at render (app.js:1:1)`;
  return error;
}

const fireError = (error: unknown) =>
  window.dispatchEvent(Object.assign(new Event('error'), { error }));
const fireRejection = (reason: unknown) =>
  window.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason }));
const advance = (ms: number) => vi.setSystemTime(Date.now() + ms);

describe('review preview (host lists blockErrors:v1): forwards to the host', () => {
  // 🔴 The regression test: before this change blocks-react forwarded nothing, so this was [].
  it('an uncaught error, an unhandled rejection and console.error, as non-fatal reports', async () => {
    await start(['workflowMedia:v1', 'blockErrors:v1']);
    fireError(boom('render failed'));
    advance(1);
    fireRejection(boom('fetch failed'));
    advance(1);
    console.error('bad <b>json</b>', 3);
    expect(errors()).toEqual([
      {
        message: 'render failed',
        fatal: false,
        source: 'error',
        stack: 'Error: render failed\n    at render (app.js:1:1)',
        at: T0,
      },
      {
        message: 'fetch failed',
        fatal: false,
        source: 'unhandledrejection',
        stack: 'Error: fetch failed\n    at render (app.js:1:1)',
        at: T0 + 1,
      },
      { message: 'bad <b>json</b> 3', fatal: false, source: 'console', at: T0 + 2 },
    ]);
    // console.error still reached the original, unchanged.
    expect(originalConsoleError).toHaveBeenCalledWith('bad <b>json</b>', 3);
  });

  it('with the same limits as @civitai/sdk: a repeat within 10 s is dropped, at most 20 a minute', async () => {
    await start(['blockErrors:v1']);
    fireError(boom('same'));
    advance(9_999);
    fireError(boom('same'));
    expect(errors()).toHaveLength(1);
    for (let i = 0; i < 30; i += 1) fireError(boom(`distinct ${i}`));
    expect(errors()).toHaveLength(20);
  });

  it('with the same redaction: the frame’s own token never leaves it', async () => {
    await start(['blockErrors:v1']);
    console.error(`token is ${TOKEN} here`);
    expect(errors()).toEqual([
      { message: 'token is [redacted] here', fatal: false, source: 'console', at: T0 },
    ]);
  });

  it('dispose() removes the listeners and restores console.error', async () => {
    await start(['blockErrors:v1']);
    expect(console.error).not.toBe(originalConsoleError);
    transport!.dispose();
    transport = null;
    expect(console.error).toBe(originalConsoleError);
    fireError(boom('after dispose'));
    expect(errors()).toEqual([]);
  });
});

describe('any other host: NEGATIVE CONTROL', () => {
  it.each([
    ['no capabilities field', undefined],
    ['other capabilities only', ['workflowMedia:v1']],
    ['a near-miss string', ['blockErrors:v2', 'BlockErrors:v1']],
    ['the string, not in an array', 'blockErrors:v1'],
    ['a nested array', [['blockErrors:v1']]],
  ])('%s: sends nothing and leaves console.error alone', async (_name, capabilities) => {
    await start(capabilities);
    fireError(boom('render failed'));
    fireRejection(boom('fetch failed'));
    console.error('logged');
    expect(errors()).toEqual([]);
    expect(console.error).toBe(originalConsoleError);
    expect(originalConsoleError).toHaveBeenCalledWith('logged');
  });
});
