import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { fakeMcpServers } from '../test-support/fake-mcp.js';
import { defineElements } from './define.js';

beforeAll(() => defineElements());
afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const SANDBOX = 'https://sandbox.example/mcp';
const OTHER = 'https://other.example/mcp';

function fakeApp() {
  return {
    getToken: async () => 'token',
    requestGrants: async () => true,
    site: { get: async () => ({ username: 'viewer' }) },
    orchestration: { queryWorkflows: async () => ({ items: [], next: '' }), submitWorkflow: vi.fn() },
  } as never;
}

describe('<civitai-chat> mcpServers', () => {
  it('connects as soon as it starts, swaps servers when given a new list, and ignores an equal one', async () => {
    const fake = fakeMcpServers({ [SANDBOX]: [{ name: 'run_command' }], [OTHER]: [{ name: 'run_command' }] });
    vi.stubGlobal('fetch', fake.fetch);
    const chat = document.createElement('civitai-chat');
    chat.mcp = { orchestration: false, site: false };
    chat.mcpServers = [{ id: 'sandbox', url: SANDBOX, label: 'Sandbox', token: () => 'tok' }];
    chat.app = fakeApp();
    document.body.append(chat);
    await vi.waitFor(() => expect(fake.servers[SANDBOX]!.initializes).toBe(1));

    chat.mcpServers = [{ id: 'sandbox', url: SANDBOX, label: 'Sandbox', token: () => 'tok' }];
    await chat.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fake.servers[SANDBOX]!.initializes).toBe(1);

    chat.mcpServers = [{ id: 'sandbox', url: OTHER, token: () => 'tok' }];
    await vi.waitFor(() => expect(fake.servers[OTHER]!.initializes).toBe(1));
  });

  it('tells the viewer when a server cannot be reached, and the chat carries on', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', fakeMcpServers({ [SANDBOX]: 'down' }).fetch);
    const chat = document.createElement('civitai-chat');
    chat.mcp = { orchestration: false, site: false };
    chat.mcpServers = [{ id: 'sandbox', url: SANDBOX, label: 'Your sandbox', token: () => 'tok' }];
    chat.app = fakeApp();
    document.body.append(chat);
    const root = chat.shadowRoot!;

    await vi.waitFor(() => expect(root.querySelector('civitai-toast-region')?.textContent).toContain('Could not reach Your sandbox'));
    expect(root.querySelector('civitai-chat-composer')).not.toBeNull();
  });
});
