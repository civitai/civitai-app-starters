import { describe, expect, it, vi } from 'vitest';

import { partsFromMessages } from './agent/parts.js';
import { ChatSession } from './session.js';
import { flush } from './test-support/fakes.js';

describe('ChatSession', () => {
  it('offers no tools from a server the embedding page switched off, without contacting it', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const app = { getToken: async () => 'token', site: {}, orchestration: {} } as never;
    const session = new ChatSession(app, { mcp: () => ({ orchestration: false, site: false }) });
    expect(await session.catalog()).toEqual({ orchestration: [], site: [] });
    expect(fetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('opens a shared panel as its own conversation the viewer can run and talk about, without an assistant reply', async () => {
    const fetch = vi.fn(async (_url: unknown, _init?: RequestInit) => new Response('{}'));
    vi.stubGlobal('fetch', fetch);
    const submitted: { metadata?: unknown }[] = [];
    const app = {
      getToken: async () => 'token',
      site: {},
      orchestration: {
        submitWorkflow: vi.fn(async (template: { metadata?: unknown }) => {
          submitted.push(template);
          return { id: `7-${submitted.length}`, cost: { total: 0 } };
        }),
        queryWorkflows: vi.fn(async () => ({ items: [], next: '' })),
      },
    } as never;
    const session = new ChatSession(app);

    await session.openShared({
      v: 1,
      id: 'P1',
      version: 3,
      spec: { title: 'Beat maker', inputs: { mood: { kind: 'choice', options: ['Calm', 'Bold'] } }, run: { stepType: 'aceStepAudio', input: { prompt: '{{mood}}' } } },
      values: { mood: 'Bold' },
    });
    await flush();

    const conversation = session.store.current!;
    expect(conversation.title).toBe('Beat maker');
    const [turn] = conversation.turns;
    expect(turn?.user.content).toBe('Opened a shared panel: Beat maker');
    expect(partsFromMessages(turn!.assistant.messages)).toMatchObject([{ kind: 'tool', toolName: 'open_panel', state: 'done', output: { panel: 'p1' } }]);
    const panel = session.panels.get('p1')!;
    expect(panel).toMatchObject({ forkedFrom: { id: 'P1', version: 3 }, values: { mood: 'Bold' } });
    expect(panel.id).not.toBe('P1');
    expect(session.panels.context()).toContain('Someone else made this panel');
    const saved = fetch.mock.calls.filter(([, init]) => init?.method === 'PUT').map(([, init]) => String(init?.body));
    expect(saved.at(-1)).toContain('"forkedFrom":{"id":"P1","version":3}');
    expect(fetch.mock.calls.map(([url]) => String(url)).filter((url) => url.includes('chat/completions'))).toEqual([]);
    vi.unstubAllGlobals();
  });
});
