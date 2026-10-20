import { encodeRunEvent, type RunEvent, type StartRunRequest } from '../runner-protocol.js';
import type { TurnPart } from '../agent/parts.js';

/** A request the page made, as the fake runner saw it. */
export interface SeenRequest {
  method: string;
  /** Relative to the runner's base URL, with its query. */
  path: string;
  headers: Record<string, string>;
  body?: unknown;
}

export interface FakeRun {
  runId: string;
  conversationId: string;
  seq: number;
  request: StartRunRequest;
  journal: RunEvent[];
  live: boolean;
}

export const RUNNER_URL = 'https://runner.test/v1';

/**
 * A server runner in memory, serving the run protocol through `fetch`. Each run's journal is the test's
 * to fill (`push`); every open event stream gets each new event as it is pushed. Knobs make it misbehave
 * the ways a network and a server do.
 */
export function fakeRunner() {
  const requests: SeenRequest[] = [];
  const runs = new Map<string, FakeRun>();
  const streams = new Map<string, Set<{ push(id: number, event: RunEvent): void; drop(error?: Error): void }>>();
  const knobs = {
    /** The next N starts get no answer (the fetch rejects): the run is NOT created. */
    failStarts: 0,
    /** The next N event-stream opens get no answer. */
    failEvents: 0,
    /** Each event stream closes after sending this many events. */
    dropAfter: undefined as number | undefined,
    /** Sends the journal from this id on every open, whatever `Last-Event-ID` says (a runner that replays too much). */
    replayFrom: undefined as number | undefined,
    /** Refuses every start with this answer. */
    refuseStart: undefined as { status: number; body: unknown } | undefined,
    /** The parts `run-started` carries. */
    startParts: [] as TurnPart[],
  };
  let count = 0;

  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  function create(request: StartRunRequest): FakeRun {
    const existing = [...runs.values()].find((run) => (run.request.idempotencyKey === request.idempotencyKey));
    if (existing) return existing;
    const runId = `r${++count}`;
    const run: FakeRun = { runId, conversationId: request.conversationId, seq: request.turn.seq, request, journal: [], live: true };
    runs.set(runId, run);
    push(runId, { type: 'run-started', v: 1, runId, conversationId: request.conversationId, seq: request.turn.seq, user: request.turn.user, parts: knobs.startParts });
    return run;
  }

  function push(runId: string, event: RunEvent): void {
    const run = runs.get(runId)!;
    run.journal.push(event);
    if (event.type === 'run-ended') run.live = false;
    for (const stream of streams.get(runId) ?? []) stream.push(run.journal.length - 1, event);
  }

  function events(run: FakeRun, lastEventId: string | undefined, signal: AbortSignal | undefined): Response {
    const from = knobs.replayFrom ?? (lastEventId === undefined ? 0 : Number(lastEventId) + 1);
    const encoder = new TextEncoder();
    let sent = 0;
    let closed = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const handle = {
          push(id: number, event: RunEvent) {
            if (closed) return;
            controller.enqueue(encoder.encode(encodeRunEvent(id, event)));
            sent++;
            if (event.type === 'run-ended' || (knobs.dropAfter !== undefined && sent >= knobs.dropAfter)) handle.drop();
          },
          drop(error?: Error) {
            if (closed) return;
            closed = true;
            streams.get(run.runId)?.delete(handle);
            if (error) controller.error(error);
            else controller.close();
          },
        };
        if (!streams.has(run.runId)) streams.set(run.runId, new Set());
        streams.get(run.runId)!.add(handle);
        signal?.addEventListener('abort', () => handle.drop(new DOMException('The operation was aborted.', 'AbortError')));
        controller.enqueue(encoder.encode(': connected\n\n'));
        run.journal.slice(from).forEach((event, index) => handle.push(from + index, event));
      },
    });
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }

  const fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(String(input));
    const path = url.href.slice(`${RUNNER_URL}/`.length);
    const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>).map(([key, value]) => [key.toLowerCase(), value]));
    const method = init.method ?? 'GET';
    const body = typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    requests.push({ method, path, headers, ...(body !== undefined ? { body } : {}) });
    await Promise.resolve();
    if (method === 'POST' && path === 'runs') {
      if (knobs.failStarts > 0) {
        knobs.failStarts--;
        throw new TypeError('fetch failed');
      }
      if (knobs.refuseStart) return json(knobs.refuseStart.body, knobs.refuseStart.status);
      const run = create(body as StartRunRequest);
      return json({ v: 1, runId: run.runId, conversationId: run.conversationId, seq: run.seq }, 201);
    }
    if (method === 'GET' && url.pathname.endsWith('/runs') && url.searchParams.has('conversationId')) {
      const run = [...runs.values()].find((r) => r.live && r.conversationId === url.searchParams.get('conversationId'));
      return json({ v: 1, run: run ? { runId: run.runId, conversationId: run.conversationId, seq: run.seq, user: run.request.turn.user, startedAt: '2026-10-19T00:00:00Z' } : null });
    }
    const eventsPath = /^runs\/([^/]+)\/events$/.exec(path);
    if (method === 'GET' && eventsPath) {
      if (knobs.failEvents > 0) {
        knobs.failEvents--;
        throw new TypeError('fetch failed');
      }
      const run = runs.get(decodeURIComponent(eventsPath[1]!));
      if (!run) return json({ v: 1, error: 'not-found', message: 'No such run.' }, 404);
      return events(run, headers['last-event-id'], init.signal ?? undefined);
    }
    if (method === 'POST' && /^runs\/[^/]+\/stop$/.test(path)) return new Response(null, { status: 202 });
    if (method === 'POST' && /^conversations\/[^/]+\/patch$/.test(path)) return new Response(null, { status: 204 });
    return json({ v: 1, error: 'not-found', message: `No route ${method} ${path}` }, 404);
  };

  return {
    fetch: fetch as typeof globalThis.fetch,
    requests,
    runs,
    knobs,
    push,
    /** Cuts every open event stream of the run, as a network drop does. */
    dropStreams(runId: string, error: Error = new TypeError('terminated')): void {
      for (const stream of [...(streams.get(runId) ?? [])]) stream.drop(error);
    },
    /** How many event streams of the run are open now. */
    openStreams(runId: string): number {
      return streams.get(runId)?.size ?? 0;
    },
    eventOpens(runId: string): SeenRequest[] {
      return requests.filter((request) => request.method === 'GET' && request.path === `runs/${runId}/events`);
    },
  };
}
