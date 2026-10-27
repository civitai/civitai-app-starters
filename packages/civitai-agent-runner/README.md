# @civitai/agent-runner

The server side of [`<civitai-chat>`](../civitai-components-chat)'s remote mode. Instead of running an assistant reply in the page, the page starts a run on a runner, follows its events over SSE, and can stop it. The run keeps going if the page closes or reloads. This package is that runner:

- Each reply runs as a [DBOS](https://docs.dbos.dev/) workflow on Postgres. When the process crashes, the reply picks up from its last saved progress, on whichever replica recovers it.
- It serves the chat's runner protocol v1 (`@civitai/components-chat/runner-protocol`) over HTTP: start, look up, stop, stop by idempotency key, patch a conversation, and read a run's events from any offset.
- A viewer can have one active run at a time.

Civitai's own assistant runner is built on it. The package knows nothing about Civitai's accounts, tokens or models. A deployment supplies those through a few interfaces.

## Install

```bash
pnpm add @civitai/agent-runner @civitai/components-chat
```

`@civitai/components-chat` is a peer dependency, because the page and the runner have to speak the same protocol. You need Node 22 or later and a Postgres database that DBOS can use.

## What a deployment provides

Everything the runner needs from outside comes through the interfaces in `interfaces.ts`:

| Interface | What it does |
| --- | --- |
| `Authenticator` | Turns a request's headers into the user id it acts for. |
| `GrantVerifier` | Checks the run grant a start or a patch carries (header `x-run-grant`). |
| `GrantStore` | Keeps a run's grant while the run lives, in your own table and never in DBOS. |
| `ConversationStore` | Loads and atomically updates the saved conversation, the chat's v2/v3 metadata. |
| `ModelProvider` | Supplies the language model a reply uses. A real one mints its credential per request. |
| `ToolProvider` | Opens the tools for a reply. The runner closes them on Stop or when the reply ends. |

The runner never hands a credential to the model, tool or store seams. Anything passed into a DBOS workflow or returned from a step is persisted in Postgres, so a token must never cross those seams as an argument or a return value.

## Run grants must say what they are

A `RunGrant` carries a required `preview` flag:

- `preview: false` is a run grant. It is good for a start or a patch.
- `preview: true` is a preview grant. It is good only on a route that asks for one, through `grantFor(request, conversationId, undefined, true)`.
- A grant with no boolean `preview` is neither. It is refused everywhere, and the run API logs the refusal. `Runner.start` also refuses anything other than a run grant, before it keeps the grant.

The rule fails closed, so a verifier that forgets the flag cannot let its preview grants start runs.

## Sketch

```ts
import { buildRunApp, loggerOptions, Runner } from '@civitai/agent-runner';

const runner = new Runner({
  models, // ModelProvider
  tools, // ToolProvider
  store, // ConversationStore
  grants: grantStore, // GrantStore
  log,
  wallClockMs: 10 * 60 * 1000,
  stopGraceMs: 20_000,
});

const app = buildRunApp({
  service: runner,
  authenticator, // Authenticator
  grants: grantVerifier, // GrantVerifier
  logger: loggerOptions('info'), // never logs request headers
});

runner.register(); // once per process, before launch
await runner.launch({ databaseUrl, executorId: 'replica-1', workerConcurrency: 8 });
await app.listen({ port: 8080, host: '0.0.0.0' });
```

`buildRunApp` also takes `routes`, for a deployment's own routes served beside the run API. They are handed the same `authed`, `grantFor` and `refuse` helpers the run API uses. It also takes `patchRefusal` and `basePath`.

## Durable names: do not change them casually

A run that a restarted process recovers is replayed against what DBOS recorded for it. The workflow names (`reply`, `reply-stop-marker`), the queue (`replies`), the application version (`WORKFLOW_VERSION`, `reply-1`), the journal stream (`events`) and the order of the calls a reply makes are therefore part of the contract. `test/reply-dbos-calls.pg.test.ts` reads them back from DBOS's own tables and compares them with a golden record. That record is byte-identical to the one the runner was verified against before it moved into this package. If you change any of them, bump `WORKFLOW_VERSION` with the change.

`@dbos-inc/dbos-sdk` is pinned to an exact version for the same reason.

## Test support

`@civitai/agent-runner/test-support` exports the fakes the suites use: a scripted model, fake tools, a bearer authenticator, a file-backed conversation store, an SSE reader, and `freshDatabase` for a throwaway Postgres database (it reads `ASSISTANT_RUNNER_TEST_DATABASE_URL`).

## Development

```bash
pnpm --filter @civitai/agent-runner typecheck
pnpm --filter @civitai/agent-runner build
```

The suites run in CI, in the `agent-runner` job, against a Postgres service. Outside CI, the Postgres-backed suite skips unless `ASSISTANT_RUNNER_TEST_DATABASE_URL` points at a server where it may create and drop databases. In CI, a missing URL fails the suite instead of skipping it. `test/core-boundary.test.ts` fails when anything under `src/` imports a file outside it, or imports a package that `package.json` does not declare.

## License

MIT
