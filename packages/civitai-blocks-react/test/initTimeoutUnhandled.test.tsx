/**
 * The 10 s `BLOCK_INIT` timeout must not surface as an UNHANDLED rejection.
 *
 * 🔴 WHY THIS EXISTS. Every hook now connects the transport at mount
 * (`useTransportConnection`). The transport's init promise rejects when no
 * `BLOCK_INIT` arrives within 10 s. If nothing has a handler on that promise,
 * the rejection is unhandled, and an unhandled rejection fails a Vitest run. A
 * block app's own test suite that mounts only `useBuzzWorkflow`, with no host,
 * produced zero such rejections before the connect-at-mount change and one
 * after it. The transport now attaches its own handler (which keeps the timeout
 * diagnostic on the console as a warning). `waitForInit()` callers must still
 * see the rejection.
 */
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useBuzzWorkflow } from '../src/index.js';
import { getTransport } from '../src/transport/singleton.js';
import type { IframeTransport } from '../src/transport/iframeTransport.js';
import { resetTransport } from '../src/testing.js';

const PARENT_ORIGIN = 'https://civitai.com';
const INIT_TIMEOUT_MS = 10_000;

/** Lets Node run its unhandled-rejection check, which happens after microtasks drain. */
async function settleRealTime(): Promise<void> {
  for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0));
}

describe('BLOCK_INIT timeout with no host', () => {
  let unhandled: unknown[];
  const onUnhandled = (reason: unknown): void => {
    unhandled.push(reason);
  };

  beforeEach(() => {
    resetTransport();
    unhandled = [];
    process.on('unhandledRejection', onUnhandled);
    Object.defineProperty(window, 'parent', {
      value: { postMessage: vi.fn() },
      configurable: true,
      writable: true,
    });
    vi.stubEnv('VITE_BLOCK_ALLOWED_PARENT_ORIGINS', PARENT_ORIGIN);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    resetTransport();
    process.off('unhandledRejection', onUnhandled);
  });

  it('mounting only useBuzzWorkflow produces no unhandled rejection after the timeout, and still warns', async () => {
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    function Probe(): null {
      useBuzzWorkflow();
      return null;
    }
    render(<Probe />);

    await vi.advanceTimersByTimeAsync(INIT_TIMEOUT_MS + 1);
    vi.useRealTimers();
    await settleRealTime();

    const initTimeouts = unhandled.filter((r) =>
      String((r as Error)?.message ?? r).includes('timed out waiting for BLOCK_INIT'),
    );
    expect(initTimeouts).toEqual([]);
    // The diagnostic that names the configured and observed origins stays visible.
    const warned = warnSpy.mock.calls.filter((c) =>
      String(c[0]).includes('timed out waiting for BLOCK_INIT'),
    );
    expect(warned).toHaveLength(1);
  });

  it('positive control: the listener does observe an unhandled rejection', async () => {
    void Promise.reject(new Error('control rejection'));
    await settleRealTime();
    expect(unhandled.map((r) => (r as Error).message)).toContain('control rejection');
  });

  it('waitForInit() still rejects with the timeout error', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const transport = getTransport() as IframeTransport;
    const init = transport.waitForInit();
    const assertion = expect(init).rejects.toThrow(/timed out waiting for BLOCK_INIT after 10000ms/);
    await vi.advanceTimersByTimeAsync(INIT_TIMEOUT_MS + 1);
    await assertion;
  });
});
