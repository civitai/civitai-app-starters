import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { initialize } from '../../src/index.js';
import { createFakeTransport } from '../../src/testing.js';

// The host page cannot see input inside the app's frame, so the SDK reports it:
// `VIEWER_ACTIVITY`, no payload, at most once a minute. civitai's App Assistant
// preview counts it as someone working in the app (and judges visibility itself).

let doc: EventTarget;

beforeEach(() => {
  doc = new EventTarget();
  vi.stubGlobal('document', doc);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(1_000_000);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const fire = (type: string) => doc.dispatchEvent(new Event(type));
const advance = (ms: number) => vi.setSystemTime(Date.now() + ms);

async function start() {
  const transport = createFakeTransport();
  await initialize({ transport });
  const reports = () => transport.sent.filter((m) => m.type === 'VIEWER_ACTIVITY');
  return { transport, reports };
}

describe('initialize() in a block reports the viewer’s input to the host', () => {
  it('a press reports once, with no payload, and the next one only a minute later', async () => {
    const { reports } = await start();
    expect(reports()).toHaveLength(0);

    fire('pointerdown');
    expect(reports()).toEqual([{ type: 'VIEWER_ACTIVITY', payload: undefined }]);

    advance(25_000);
    fire('keydown');
    advance(34_999); // 59 999 ms after the report
    fire('wheel');
    expect(reports()).toHaveLength(1);

    advance(1); // exactly one minute
    fire('focusin');
    expect(reports()).toHaveLength(2);
  });

  it('initialize() again on the same transport does not add a second reporter', async () => {
    const transport = createFakeTransport();
    await initialize({ transport });
    await initialize({ transport });
    fire('pointerdown');
    expect(transport.sent.filter((m) => m.type === 'VIEWER_ACTIVITY')).toHaveLength(1);
  });

  it('each of pointerdown, keydown, wheel and focusin counts', async () => {
    for (const type of ['pointerdown', 'keydown', 'wheel', 'focusin']) {
      vi.unstubAllGlobals();
      doc = new EventTarget();
      vi.stubGlobal('document', doc);
      const { reports } = await start();
      fire(type);
      expect(reports(), type).toHaveLength(1);
    }
  });

  it('NEGATIVE CONTROL: the pointer only moving, or other events, report nothing', async () => {
    const { reports } = await start();
    for (const type of ['pointermove', 'mousemove', 'pointerover', 'scroll', 'visibilitychange'])
      fire(type);
    expect(reports()).toHaveLength(0);
    // Positive control: a press on the same document does.
    fire('pointerdown');
    expect(reports()).toHaveLength(1);
  });
});
