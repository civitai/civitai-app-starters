import type { StartRunRequest } from '@civitai/components-chat/runner-protocol';
import { DBOS } from '@dbos-inc/dbos-sdk';
import type { ModelMessage } from 'ai';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { GrantStore, ToolContext, ToolProvider } from '../src/interfaces.js';
import { MemoryConversationStore } from '../src/memory-store.js';
import { Runner, type ReplyOutput } from '../src/runner.js';
import { fakeTools } from '../src/test-support/fakes.js';
import { freshDatabase, TEST_DATABASE_URL } from '../src/test-support/pg.js';
import { scriptedModel, toolResults } from '../src/test-support/scripted-model.js';

/**
 * A reply whose tool says `reopenTools` (components-chat) has its tools built again mid-reply: the
 * runner opens them from where the reply is, and closes every set it opened exactly once, a Stop that
 * comes while a set is being opened included.
 *
 * Runs against a real Postgres (CI's `agent-runner` job); without
 * ASSISTANT_RUNNER_TEST_DATABASE_URL it skips.
 */
const describePg = TEST_DATABASE_URL ? describe : describe.skip;
if (process.env.CI && !TEST_DATABASE_URL)
  throw new Error('ASSISTANT_RUNNER_TEST_DATABASE_URL is not set in CI');

describePg('building a reply’s tools again (reopenTools)', () => {
  let db: Awaited<ReturnType<typeof freshDatabase>>;
  let runner: Runner;
  const store = new MemoryConversationStore();
  const calls = { record: 0 };
  const tools = fakeTools({
    reopen: async () => ({ reopenTools: true }),
    record: async () => {
      calls.record++;
      return 'recorded';
    },
  });
  /** What each open was handed as the reply's progress (`history.current`). */
  const progress: ModelMessage[][] = [];
  /** While set, an open that rebuilds (it has progress) waits on it. */
  const hold: { until?: Promise<void>; reached?: () => void } = {};
  const provider: ToolProvider = {
    open: async (context: ToolContext) => {
      const current = context.history?.current ?? [];
      progress.push(current);
      if (hold.until && current.length > 0) {
        hold.reached?.();
        await hold.until;
      }
      return tools.provider.open(context);
    },
  };
  const grants: GrantStore = {
    save: async () => undefined,
    delete: async () => undefined,
    forgetUnlessEndPending: async () => undefined,
    markEndPending: async () => undefined,
    pendingEnds: async () => [],
    sweep: async () => 0,
  };

  beforeAll(async () => {
    db = await freshDatabase('rebuild');
    runner = new Runner({
      models: {
        languageModel: () =>
          scriptedModel((prompt) =>
            toolResults(prompt) === 0
              ? { text: 'Making it. ', calls: [{ toolName: 'reopen', input: {} }] }
              : toolResults(prompt) === 1
              ? { text: 'Building. ', calls: [{ toolName: 'record', input: {} }] }
              : { text: 'Built.' }
          ),
      },
      tools: provider,
      store,
      grants,
      log: {
        info: () => undefined,
        warn: () => undefined,
        error: (object, message) => console.error(message, object),
      },
      wallClockMs: 60_000,
      stopGraceMs: 20_000,
    });
    runner.register();
    await runner.launch({
      databaseUrl: db.url,
      executorId: 'rebuild',
      workerConcurrency: 4,
      logLevel: 'warn',
    });
  });

  afterAll(async () => {
    await runner?.shutdown();
    await db?.drop();
  });

  async function start(user: string): Promise<string> {
    const body: StartRunRequest = {
      v: 1,
      idempotencyKey: `key-${user}`,
      conversationId: `c-${user}`,
      turn: { seq: 1, user: { content: 'Make me a tip calculator.', attachments: [] } },
      model: 'scripted',
      settings: {
        maxOutputTokens: 1024,
        tier: 'auto',
        allowMature: false,
        autoRunLimit: 0,
        spokenReplies: false,
      },
    };
    const outcome = await runner.start(user, body, {
      token: 'rebuild-grant',
      userId: user,
      conversationId: body.conversationId,
      idempotencyKey: body.idempotencyKey,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      subagents: false,
      preview: false,
    });
    if (!outcome.ok) throw new Error(`start refused: ${outcome.error} ${outcome.message}`);
    return outcome.response.runId;
  }

  it('opens the tools again from where the reply is, carries on with them, and closes both sets', async () => {
    const before = { ...tools.stats, record: calls.record, opens: progress.length };
    const runId = await start('reopen');
    const output = await DBOS.retrieveWorkflow<ReplyOutput>(runId).getResult();
    expect(output.status).toBe('done');
    expect(calls.record).toBe(before.record + 1);
    expect(tools.stats.opened).toBe(before.opened + 2);
    expect(tools.stats.closed).toBe(before.closed + 2);
    // The rebuild was handed the reply's finished steps: the reopen call and its result.
    const rebuilt = progress.slice(before.opens)[1]!;
    expect(rebuilt.map((message) => message.role)).toEqual(['assistant', 'tool']);
  });

  it('a Stop while the tools are being opened again closes the set it was opening too', async () => {
    const before = { ...tools.stats };
    let release!: () => void;
    hold.until = new Promise<void>((resolve) => (release = resolve));
    const reached = new Promise<void>((resolve) => (hold.reached = resolve));
    try {
      const runId = await start('reopen-stop');
      await reached;
      expect(await runner.stop('reopen-stop', runId)).toBe(true);
      release();
      const output = await DBOS.retrieveWorkflow<ReplyOutput>(runId).getResult();
      expect(output.status).toBe('stopped');
    } finally {
      hold.until = undefined;
      hold.reached = undefined;
      release();
    }
    expect(tools.stats.opened).toBe(before.opened + 2);
    const deadline = Date.now() + 5_000;
    while (tools.stats.closed < before.closed + 2 && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 20));
    expect(tools.stats.closed).toBe(before.closed + 2);
  });
});
