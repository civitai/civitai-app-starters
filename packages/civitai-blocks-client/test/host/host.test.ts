import { describe, expect, it } from 'vitest';

import { host } from '../../src/index.js';
import { createFakeTransport } from '../../src/testing.js';

describe('host chrome', () => {
  it('asks for a height', () => {
    const t = createFakeTransport();
    host.resize(420, { transport: t });
    expect(t.sent.at(-1)).toEqual({ type: 'RESIZE_IFRAME', payload: { height: 420 } });
  });

  it('reports a failure as non-fatal unless told otherwise', () => {
    const t = createFakeTransport();
    host.reportError('render failed', {}, { transport: t });
    expect(t.sent.at(-1)).toEqual({
      type: 'BLOCK_ERROR',
      payload: { message: 'render failed', fatal: false },
    });

    host.reportError('gone', { fatal: true }, { transport: t });
    expect(t.sent.at(-1)).toEqual({
      type: 'BLOCK_ERROR',
      payload: { message: 'gone', fatal: true },
    });
  });

  it('navigates in place unless a new tab is asked for', () => {
    const t = createFakeTransport();
    host.navigate('/gallery', {}, { transport: t });
    expect(t.sent.at(-1)).toEqual({
      type: 'NAVIGATE',
      payload: { path: '/gallery', target: 'current' },
    });

    host.navigate('/gallery', { target: 'new_tab' }, { transport: t });
    expect(t.sent.at(-1)?.payload).toMatchObject({ target: 'new_tab' });
  });
});

describe('host.onVisibilityChange', () => {
  it('reports the page hiding and returning', () => {
    const t = createFakeTransport();
    const seen: boolean[] = [];

    const off = host.onVisibilityChange((visible) => seen.push(visible), { transport: t });
    t.push('SUSPEND', undefined);
    t.push('RESUME', undefined);
    off();
    t.push('SUSPEND', undefined);

    expect(seen).toEqual([false, true]);
  });
});
