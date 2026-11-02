import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { reportDevErrors } from '../../src/host/dev-errors.js';
import { initialize } from '../../src/index.js';
import { createFakeTransport, type FakeTransport } from '../../src/testing.js';

// In a DEV session (the host marked the frame `storageMode: 'local-preview'`,
// which it does on the dev-tunnel surface only, App Assistant's live preview
// included) `initialize()` forwards uncaught errors, unhandled rejections and
// `console.error` to the host as non-fatal `BLOCK_ERROR`s. A production embed
// sends nothing new.

const T0 = 1_700_000_000_000;
const realConsoleError = console.error;

let win: EventTarget;
let original: Mock<(...args: unknown[]) => void>;
const stops: (() => void)[] = [];

beforeEach(() => {
  win = new EventTarget();
  vi.stubGlobal('window', win);
  original = vi.fn<(...args: unknown[]) => void>();
  console.error = original;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
});

afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  console.error = realConsoleError;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function start(dev: boolean, token = 'opaque-block-token-0123456789') {
  const transport = createFakeTransport({
    ...(dev ? { storageMode: 'local-preview' as const } : {}),
    token: { raw: token, scopes: [], expiresAt: new Date(0) },
  });
  await initialize({ transport });
  // Idempotent per transport: this hands back the stop for what initialize()
  // installed. Not called for production, where it would install them itself.
  if (dev) stops.push(reportDevErrors(transport));
  return transport;
}

const errors = (t: FakeTransport) =>
  t.sent.filter((m) => m.type === 'BLOCK_ERROR').map((m) => m.payload as Record<string, unknown>);

const fireError = (error: unknown, extra: Record<string, unknown> = {}) =>
  win.dispatchEvent(Object.assign(new Event('error'), { error, ...extra }));
const fireRejection = (reason: unknown) =>
  win.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason }));
const advance = (ms: number) => vi.setSystemTime(Date.now() + ms);

function boom(message: string): Error {
  const error = new Error(message);
  error.stack = `Error: ${message}\n    at render (app.js:1:1)`;
  return error;
}

describe('dev session: forwards to the host', () => {
  // 🔴 The regression test: before this change nothing listened, so this was [].
  it('an uncaught error, with its message, stack, source and time', async () => {
    const t = await start(true);
    fireError(boom('render failed'));
    expect(errors(t)).toEqual([
      {
        message: 'render failed',
        fatal: false,
        source: 'error',
        stack: 'Error: render failed\n    at render (app.js:1:1)',
        at: T0,
      },
    ]);
  });

  it('an error event with no error object (e.g. "Script error.") keeps its location', async () => {
    const t = await start(true);
    fireError(null, { message: 'Script error.', filename: 'https://app.test/main.js', lineno: 3, colno: 9 });
    expect(errors(t)).toEqual([
      { message: 'Script error.', fatal: false, source: 'error', stack: 'at https://app.test/main.js:3:9', at: T0 },
    ]);
  });

  it('an unhandled rejection, Error or not', async () => {
    const t = await start(true);
    fireRejection(boom('fetch failed'));
    advance(1);
    fireRejection({ code: 42, why: 'nope' });
    advance(1);
    fireRejection(undefined);
    expect(errors(t)).toEqual([
      expect.objectContaining({ message: 'fetch failed', source: 'unhandledrejection', fatal: false, at: T0 }),
      { message: '{"code":42,"why":"nope"}', fatal: false, source: 'unhandledrejection', at: T0 + 1 },
      { message: 'undefined', fatal: false, source: 'unhandledrejection', at: T0 + 2 },
    ]);
    expect(errors(t)[0]!.stack).toContain('fetch failed');
  });

  it('console.error, joining its arguments and taking the first Error’s stack', async () => {
    const t = await start(true);
    console.error('loading', 3, boom('bad json'));
    expect(errors(t)).toEqual([
      {
        message: 'loading 3 bad json',
        fatal: false,
        source: 'console',
        stack: 'Error: bad json\n    at render (app.js:1:1)',
        at: T0,
      },
    ]);
  });

  it('console.error still reaches the original, first, with the same arguments', async () => {
    const t = await start(true);
    const order: string[] = [];
    original.mockImplementation(() => order.push(`original:${errors(t).length}`));
    const arg = { a: 1 };
    console.error('x', arg);
    expect(original).toHaveBeenCalledTimes(1);
    expect(original).toHaveBeenCalledWith('x', arg);
    expect(order).toEqual(['original:0']); // ran before the report was posted
    expect(errors(t)).toHaveLength(1);
  });

  it('a circular, bigint-carrying rejection reason is stringified without throwing', async () => {
    const t = await start(true);
    const reason: Record<string, unknown> = { n: 10n };
    reason.self = reason;
    fireRejection(reason);
    expect(errors(t)[0]!.message).toBe('{"n":"10n","self":"[Circular]"}');
  });

  it('a reason whose toJSON throws still reports', async () => {
    const t = await start(true);
    fireRejection({ toJSON: () => { throw new Error('no'); } });
    expect(errors(t)).toEqual([
      { message: '[object Object]', fatal: false, source: 'unhandledrejection', at: T0 },
    ]);
  });
});

describe('production session: NEGATIVE CONTROL', () => {
  it('sends nothing for an error, a rejection or console.error, and leaves console.error alone', async () => {
    const t = await start(false);
    fireError(boom('render failed'));
    fireRejection(boom('fetch failed'));
    console.error('logged');
    expect(errors(t)).toEqual([]);
    expect(console.error).toBe(original);
    expect(original).toHaveBeenCalledWith('logged');
  });

  it('an unknown storageMode is not a dev session', async () => {
    const transport = createFakeTransport({ storageMode: 'something-else' as never });
    await initialize({ transport });
    fireError(boom('x'));
    expect(errors(transport)).toEqual([]);
  });

  it('host.reportError() is unchanged: { message, fatal } only, fatal kept', async () => {
    const t = await start(true);
    const app = await initialize({ transport: t });
    app.host.reportError('gone', { fatal: true });
    expect(errors(t)).toEqual([{ message: 'gone', fatal: true }]);
  });
});

describe('limits', () => {
  it('drops an identical message within 10 s of its last report, and sends it again after', async () => {
    const t = await start(true);
    fireError(boom('same'));
    advance(9_999);
    fireError(boom('same'));
    console.error('same');
    expect(errors(t)).toHaveLength(1);
    advance(1);
    fireError(boom('same'));
    expect(errors(t)).toHaveLength(2);
    // A different message is not a duplicate.
    fireError(boom('other'));
    expect(errors(t)).toHaveLength(3);
  });

  it('sends at most 20 a minute, and frees budget as reports age out', async () => {
    const t = await start(true);
    for (let i = 0; i < 25; i++) {
      fireError(boom(`e${i}`));
      advance(100);
    }
    expect(errors(t)).toHaveLength(20);
    expect(errors(t).at(-1)!.message).toBe('e19');

    advance(60_000 - 25 * 100); // exactly a minute after the first report
    fireError(boom('late'));
    expect(errors(t)).toHaveLength(21);
    expect(errors(t).at(-1)!.message).toBe('late');
  });

  it('a duplicate dropped by dedupe costs no rate budget', async () => {
    const t = await start(true);
    fireError(boom('dup'));
    for (let i = 0; i < 30; i++) fireError(boom('dup'));
    for (let i = 0; i < 19; i++) fireError(boom(`u${i}`));
    expect(errors(t)).toHaveLength(20);
  });

  it('truncates message to 2,000 and stack to 4,000 characters', async () => {
    const t = await start(true);
    const error = new Error('m'.repeat(5_000));
    error.stack = 's'.repeat(9_000);
    fireError(error);
    const [sent] = errors(t);
    expect((sent!.message as string).length).toBe(2_000);
    expect((sent!.stack as string).length).toBe(4_000);
    expect(sent!.message).toBe(`${'m'.repeat(1_999)}…`);
    // Short ones pass through untouched.
    advance(1);
    fireError(boom('short'));
    expect(errors(t)[1]!.message).toBe('short');
  });
});

describe('redaction', () => {
  const jwt =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4ifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

  it('JWT-shaped strings, Bearer credentials and the frame’s own token never leave the frame', async () => {
    const own = 'zz-own-opaque-token-ABCDEFGHIJKLMNOP';
    const t = await start(true, own);
    const error = new Error(`auth ${jwt} failed; header Authorization: Bearer abc.def-123 sent; token=${own}`);
    error.stack = `Error: ${jwt}\n  Bearer s3cr3t`;
    fireError(error);
    const [sent] = errors(t);
    expect(sent!.message).toBe(
      'auth [redacted-jwt] failed; header Authorization: Bearer [redacted] sent; token=[redacted]',
    );
    expect(sent!.stack).toBe('Error: [redacted-jwt]\n  Bearer [redacted]');
    const wire = JSON.stringify(t.sent);
    expect(wire).not.toContain(jwt);
    expect(wire).not.toContain('s3cr3t');
    expect(wire).not.toContain(own);
  });

  it('redacts before truncating, so no fragment of a token at the cut survives', async () => {
    const t = await start(true);
    fireError(new Error(`${'x'.repeat(1_990)}${jwt}`));
    const message = errors(t)[0]!.message as string;
    expect(message).toBe(`${'x'.repeat(1_990)}[redacted…`);
    expect(message).not.toContain('eyJ');
  });

  it('redacts console.error arguments and rejection reasons too', async () => {
    const t = await start(true);
    console.error('token', jwt);
    advance(1);
    fireRejection({ authorization: `Bearer ${jwt}` });
    expect(errors(t).map((e) => e.message)).toEqual([
      'token [redacted-jwt]',
      '{"authorization":"Bearer [redacted]"}',
    ]);
  });
});

describe('robustness', () => {
  it('initialize() twice on one transport registers once', async () => {
    const t = await start(true);
    await initialize({ transport: t });
    fireError(boom('once'));
    console.error('once-console');
    expect(errors(t)).toHaveLength(2);
    expect(original).toHaveBeenCalledTimes(1);
  });

  it('stop removes the listeners and restores console.error', async () => {
    const t = await start(true);
    expect(console.error).not.toBe(original);
    stops.pop()!();
    expect(console.error).toBe(original);
    fireError(boom('after stop'));
    fireRejection(boom('after stop'));
    expect(errors(t)).toEqual([]);
  });

  it('no recursion and no throw when posting itself fails and logs', async () => {
    const t = await start(true);
    let posts = 0;
    t.notify = () => {
      posts++;
      console.error('post failed');
      throw new Error('post failed');
    };
    expect(() => console.error('outer')).not.toThrow();
    expect(posts).toBe(1);
    // The app's call and the inner one both reached the console; nothing looped.
    expect(original.mock.calls).toEqual([['outer'], ['post failed']]);

    advance(1);
    expect(() => fireError(boom('in a listener'))).not.toThrow();
    expect(() => fireRejection(boom('in a listener too'))).not.toThrow();
    expect(posts).toBe(3);
  });
});
