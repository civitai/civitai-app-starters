import { describe, expect, it, vi } from 'vitest';

import { ChatSession, type ChatRunner } from './session.js';

/** The experimental `runner` option: only the browser runner exists yet. */
describe("ChatSession's runner", () => {
  const app = () => ({ getToken: async () => 'token', site: {}, orchestration: {} }) as never;

  it("runs in the browser unless told otherwise, and when told 'browser'", () => {
    expect(new ChatSession(app()).agent.running).toBe(false);
    expect(new ChatSession(app(), { runner: 'browser' }).agent.running).toBe(false);
  });

  it("refuses 'remote' as not implemented yet, before wiring anything", () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    try {
      expect(() => new ChatSession(app(), { runner: 'remote' })).toThrow("The 'remote' chat runner is not implemented yet (experimental): leave runner unset or 'browser'.");
      // Even with no signed-in app: the runner is checked first.
      expect(() => new ChatSession(null, { runner: 'remote' })).toThrow(/'remote' chat runner is not implemented/);
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('refuses a runner it does not know', () => {
    expect(() => new ChatSession(app(), { runner: 'server' as ChatRunner })).toThrow('Unknown chat runner "server": use \'browser\'.');
  });
});
