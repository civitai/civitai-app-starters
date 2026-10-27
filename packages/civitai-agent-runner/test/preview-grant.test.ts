import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { buildRunApp } from '../src/app.js';
import type { GrantStore, GrantVerifier, RunGrant } from '../src/interfaces.js';
import { MemoryConversationStore } from '../src/memory-store.js';
import { GRANT_HEADER } from '../src/protocol.js';
import { Runner } from '../src/runner.js';
import type { RunService } from '../src/service.js';
import { bearerAuthenticator } from '../src/test-support/fakes.js';
import { noTools, unconfiguredModel } from '../src/unconfigured.js';

/**
 * A run grant must SAY what it is. `preview: false` is a run grant (good for a start or a patch),
 * `preview: true` a preview grant (good only where a route asks for one). A grant with no `preview`
 * flag at all is neither, and is refused everywhere: a verifier that forgot to set the flag on its
 * preview grants must not have them start runs. The runner fails closed, it does not guess.
 */

const USER = 'u1';
const CONVERSATION = 'c1';
const KEY = 'k1';

/** A grant as a verifier returns it; `preview` is left off when `undefined` is passed. */
function grant(preview: boolean | undefined): RunGrant {
  const base = {
    token: 'the-grant',
    userId: USER,
    conversationId: CONVERSATION,
    idempotencyKey: KEY,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  };
  // Cast: the point is a grant that a JavaScript (or carelessly typed) verifier can hand back.
  return (preview === undefined ? base : { ...base, preview }) as unknown as RunGrant;
}

const startBody = {
  v: 1,
  idempotencyKey: KEY,
  conversationId: CONVERSATION,
  turn: { seq: 1, user: { content: 'Hello.', attachments: [] } },
  model: 'some-model',
  settings: {
    maxOutputTokens: 1024,
    tier: 'auto',
    allowMature: false,
    autoRunLimit: 0,
    spokenReplies: false,
  },
};

/** A run service that records what reached it. */
function recordingService() {
  const calls = { start: 0, patch: 0 };
  const service: RunService = {
    start: async () => {
      calls.start++;
      return {
        ok: true,
        response: { v: 1, runId: 'run-1', eventsUrl: '/runs/run-1/events' },
      } as never;
    },
    lookup: async () => null,
    owns: async () => false,
    events: async function* () {},
    stop: async () => false,
    stopByKey: async () => undefined,
    patch: async () => {
      calls.patch++;
      return true;
    },
    ready: () => true,
  };
  return { service, calls };
}

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

function serve(preview: boolean | undefined) {
  const { service, calls } = recordingService();
  const grants: GrantVerifier = { grant: async () => grant(preview) };
  app = buildRunApp({
    service,
    authenticator: bearerAuthenticator,
    grants,
    // A deployment's own route that asks for a preview grant (civitai's Restart preview).
    routes: (api, { authed, grantFor, refuse }) => {
      api.post('/preview', { preHandler: authed }, async (request, reply) => {
        const found = await grantFor(request, CONVERSATION, undefined, true);
        if (!found) return refuse(reply, 'refused', 'This needs a preview grant.');
        return reply.code(200).send({ ok: true });
      });
    },
  });
  const headers = { authorization: `Bearer user:${USER}`, [GRANT_HEADER]: 'the-grant' };
  return {
    calls,
    start: () => app!.inject({ method: 'POST', url: '/runs', headers, payload: startBody }),
    patch: () =>
      app!.inject({
        method: 'POST',
        url: `/conversations/${CONVERSATION}/patch`,
        headers,
        payload: { v: 1, title: 'A title' },
      }),
    preview: () => app!.inject({ method: 'POST', url: '/preview', headers, payload: {} }),
  };
}

describe('a grant must say whether it is a preview grant (fail closed)', () => {
  it('a grant with no `preview` flag starts nothing', async () => {
    const runner = serve(undefined);
    const response = await runner.start();
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ v: 1, error: 'refused' });
    expect(runner.calls.start).toBe(0);
  });

  it('a grant with no `preview` flag patches nothing', async () => {
    const runner = serve(undefined);
    const response = await runner.patch();
    expect(response.statusCode).toBe(403);
    expect(runner.calls.patch).toBe(0);
  });

  it('a grant with no `preview` flag is not a preview grant either', async () => {
    const runner = serve(undefined);
    expect((await runner.preview()).statusCode).toBe(403);
  });

  it('an explicit `preview: false` is a run grant (positive control)', async () => {
    const runner = serve(false);
    const response = await runner.start();
    expect(response.statusCode).toBe(201);
    expect(runner.calls.start).toBe(1);
    expect((await runner.patch()).statusCode).toBe(204);
    expect(runner.calls.patch).toBe(1);
    // ...and only a run grant: a preview route refuses it.
    expect((await runner.preview()).statusCode).toBe(403);
  });

  it('an explicit `preview: true` is a preview grant, and only that', async () => {
    const runner = serve(true);
    expect((await runner.preview()).statusCode).toBe(200);
    expect((await runner.start()).statusCode).toBe(403);
    expect(runner.calls.start).toBe(0);
  });
});

describe('Runner.start takes only a run grant', () => {
  function runner() {
    const saved: string[] = [];
    const grants: GrantStore = {
      save: async (runId) => void saved.push(runId),
      delete: async () => undefined,
      forgetUnlessEndPending: async () => undefined,
      markEndPending: async () => undefined,
      pendingEnds: async () => [],
      sweep: async () => 0,
    };
    // Never launched: a start that got past the grant check would reach DBOS and throw.
    const instance = new Runner({
      models: unconfiguredModel,
      tools: noTools,
      store: new MemoryConversationStore(),
      grants,
      log: { info: () => undefined, warn: () => undefined, error: () => undefined },
      wallClockMs: 60_000,
      stopGraceMs: 1_000,
    });
    return { instance, saved };
  }

  for (const [what, preview] of [
    ['no `preview` flag', undefined],
    ['`preview: true`', true],
  ] as const) {
    it(`refuses a grant with ${what}, before keeping it`, async () => {
      const { instance, saved } = runner();
      const outcome = await instance.start(USER, startBody as never, grant(preview));
      expect(outcome).toMatchObject({ ok: false, error: 'refused' });
      expect(saved).toEqual([]);
    });
  }
});
