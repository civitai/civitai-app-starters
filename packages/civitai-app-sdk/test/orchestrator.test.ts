import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildImageGenBody,
  buildTextToImageBody,
  buildWorkflowBody,
  callOrchestrator,
  createOrchestratorClient,
  DEFAULT_MODEL_AIR,
  DEFAULT_ORCHESTRATOR_BASE_URL,
  estimateWorkflow,
  extractImageUrls,
  DEFAULT_POLL_WAIT_SECONDS,
  getWorkflow,
  IMAGE_GEN_ENGINES,
  isTerminal,
  OrchestratorError,
  pollWorkflow,
  submitWorkflow,
  TERMINAL_STATUSES,
  WORKFLOW_STEP_TYPES,
  type WorkflowSnapshot,
} from '../src/orchestrator/index.js';
import specCatalogs from './fixtures/orchestrator-spec-catalogs.json' with { type: 'json' };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText: status === 200 ? 'OK' : 'ERR',
    headers: { 'content-type': 'application/json' },
  });
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  // Silence the [orchestrator] error logs from the helper itself — we assert
  // status/body via the thrown OrchestratorError shape, not the log line.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createOrchestratorClient', () => {
  it('defaults baseUrl to the prod orchestrator', () => {
    const client = createOrchestratorClient({ accessToken: 'tok' });
    expect(client.baseUrl).toBe(DEFAULT_ORCHESTRATOR_BASE_URL);
    expect(client.accessToken).toBe('tok');
  });

  it('honors a custom baseUrl', () => {
    const client = createOrchestratorClient({
      accessToken: 'tok',
      baseUrl: 'https://example.test',
    });
    expect(client.baseUrl).toBe('https://example.test');
  });
});

describe('callOrchestrator', () => {
  const client = createOrchestratorClient({
    accessToken: 'secret-token',
    baseUrl: 'https://orch.test',
  });

  it('sends Bearer + json headers and returns parsed JSON on 2xx', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
    const result = await callOrchestrator(client, '/v2/consumer/workflows/abc', {
      method: 'GET',
    });
    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://orch.test/v2/consumer/workflows/abc');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer secret-token');
    expect(headers['content-type']).toBe('application/json');
    expect((init as RequestInit).method).toBe('GET');
  });

  it('throws OrchestratorError with status + parsed body on 4xx', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'bad_request' }, 400));
    await expect(
      callOrchestrator(client, '/v2/consumer/workflows', {
        method: 'POST',
        body: JSON.stringify({ steps: [] }),
      }),
    ).rejects.toMatchObject({
      name: 'OrchestratorError',
      status: 400,
      body: { error: 'bad_request' },
    });
  });

  it('throws OrchestratorError with the raw text when 5xx body is not JSON', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('upstream exploded', {
        status: 502,
        statusText: 'Bad Gateway',
      }),
    );
    let thrown: unknown;
    try {
      await callOrchestrator(client, '/anything', { method: 'GET' });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(OrchestratorError);
    const err = thrown as OrchestratorError;
    expect(err.status).toBe(502);
    expect(err.body).toBe('upstream exploded');
  });

  it('returns null when 2xx body is empty', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const result = await callOrchestrator(client, '/empty', { method: 'GET' });
    expect(result).toBeNull();
  });
});

describe('estimateWorkflow / submitWorkflow / getWorkflow', () => {
  const client = createOrchestratorClient({
    accessToken: 'tok',
    baseUrl: 'https://orch.test',
  });

  it('estimateWorkflow POSTs to ?whatif=true with the body', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ id: 'wf_1', status: 'unassigned', cost: { total: 42 } }),
    );
    const snap = await estimateWorkflow(client, { steps: [] });
    expect(snap.cost?.total).toBe(42);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://orch.test/v2/consumer/workflows?whatif=true');
    expect((init as RequestInit).method).toBe('POST');
    expect((init as RequestInit).body).toBe(JSON.stringify({ steps: [] }));
  });

  it('submitWorkflow POSTs to /v2/consumer/workflows', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ id: 'wf_2', status: 'pending' }),
    );
    const snap = await submitWorkflow(client, { steps: [] });
    expect(snap.id).toBe('wf_2');
    const [url] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://orch.test/v2/consumer/workflows');
  });

  it('getWorkflow GETs /v2/consumer/workflows/{encoded-id}', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ id: 'wf/with slash', status: 'succeeded' }),
    );
    const snap = await getWorkflow(client, 'wf/with slash');
    expect(snap.status).toBe('succeeded');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://orch.test/v2/consumer/workflows/wf%2Fwith%20slash');
    expect((init as RequestInit).method).toBe('GET');
  });
});

describe('buildTextToImageBody', () => {
  it('applies all the defaults when only prompt is provided', () => {
    const body = buildTextToImageBody({ prompt: 'a fox' }) as {
      steps: Array<{ $type: string; input: Record<string, unknown> }>;
      tags?: string[];
    };
    expect(body.tags).toBeUndefined();
    expect(body.steps).toHaveLength(1);
    const step = body.steps[0]!;
    expect(step.$type).toBe('textToImage');
    expect(step.input).toMatchObject({
      prompt: 'a fox',
      model: DEFAULT_MODEL_AIR,
      width: 1024,
      height: 1024,
      steps: 25,
      cfgScale: 5,
      quantity: 1,
    });
  });

  it('respects caller overrides for every field', () => {
    const body = buildTextToImageBody(
      {
        prompt: 'p',
        negativePrompt: 'np',
        model: 'urn:air:custom@1',
        width: 512,
        height: 768,
        steps: 30,
        cfgScale: 7,
        seed: 123,
        quantity: 4,
      },
      { tags: ['civitai-app-starter', 'next-app'] },
    ) as {
      steps: Array<{ input: Record<string, unknown> }>;
      tags?: string[];
    };
    expect(body.tags).toEqual(['civitai-app-starter', 'next-app']);
    expect(body.steps[0]!.input).toEqual({
      prompt: 'p',
      negativePrompt: 'np',
      model: 'urn:air:custom@1',
      width: 512,
      height: 768,
      steps: 30,
      cfgScale: 7,
      seed: 123,
      quantity: 4,
    });
  });
});

describe('buildImageGenBody', () => {
  it('wraps engine + model + input as a single imageGen step', () => {
    const body = buildImageGenBody(
      {
        engine: 'google',
        model: 'nano-banana-2',
        prompt: 'a fox',
        aspectRatio: '1:1',
        numImages: 1,
      },
      { tags: ['my-app'] },
    ) as { tags?: string[]; steps: Array<{ $type: string; name: string; timeout: string; input: Record<string, unknown> }> };
    expect(body.tags).toEqual(['my-app']);
    expect(body.steps).toHaveLength(1);
    expect(body.steps[0]!.$type).toBe('imageGen');
    expect(body.steps[0]!.name).toBe('step_0');
    expect(body.steps[0]!.timeout).toBe('00:10:00');
    expect(body.steps[0]!.input).toEqual({
      engine: 'google',
      model: 'nano-banana-2',
      prompt: 'a fox',
      aspectRatio: '1:1',
      numImages: 1,
    });
  });

  it('passes images[] through verbatim', () => {
    const body = buildImageGenBody({
      engine: 'gemini',
      model: '2.5-flash',
      operation: 'editImage',
      prompt: 'add sunglasses',
      images: ['https://example.com/a.png', 'data:image/png;base64,xxx'],
    }) as { steps: Array<{ input: { images: string[] } }> };
    expect(body.steps[0]!.input.images).toEqual([
      'https://example.com/a.png',
      'data:image/png;base64,xxx',
    ]);
  });

  it('honors caller-provided name + timeout overrides', () => {
    const body = buildImageGenBody(
      { engine: 'flux1-kontext', model: 'pro', prompt: 'p' },
      { name: 'edit_step', timeout: '00:05:00' },
    ) as { steps: Array<{ name: string; timeout: string }> };
    expect(body.steps[0]!.name).toBe('edit_step');
    expect(body.steps[0]!.timeout).toBe('00:05:00');
  });
});

describe('buildWorkflowBody', () => {
  it('wraps an arbitrary step into the workflow envelope', () => {
    const body = buildWorkflowBody(
      {
        $type: 'videoGen',
        input: { engine: 'veo3', prompt: 'a fox jumping', duration: 8 },
      },
      { tags: ['app'] },
    ) as { tags?: string[]; steps: Array<{ $type: string; input: Record<string, unknown> }> };
    expect(body.tags).toEqual(['app']);
    expect(body.steps[0]!.$type).toBe('videoGen');
    expect(body.steps[0]!.input).toMatchObject({ engine: 'veo3', prompt: 'a fox jumping' });
  });

  it('attaches metadata when provided', () => {
    const body = buildWorkflowBody({
      $type: 'echo',
      input: { value: 'hi' },
      metadata: { source: 'test' },
    }) as { steps: Array<{ metadata?: Record<string, unknown> }> };
    expect(body.steps[0]!.metadata).toEqual({ source: 'test' });
  });

  it('omits metadata when not provided', () => {
    const body = buildWorkflowBody({
      $type: 'echo',
      input: { value: 'hi' },
    }) as { steps: Array<Record<string, unknown>> };
    expect(body.steps[0]!.metadata).toBeUndefined();
  });

  it('accepts a step $type not in the catalog (forward-compat)', () => {
    // The orchestrator ships new step types continuously. The catalog is a
    // hint, not a gate — passing a string that isn't a WorkflowStepType key
    // must still type-check and serialize correctly.
    const body = buildWorkflowBody({
      $type: 'someFutureStepType',
      input: { foo: 'bar', nestedNewField: { deep: true } },
    }) as { steps: Array<{ $type: string; input: Record<string, unknown> }> };
    expect(body.steps[0]!.$type).toBe('someFutureStepType');
    expect(body.steps[0]!.input).toEqual({ foo: 'bar', nestedNewField: { deep: true } });
  });
});

describe('buildImageGenBody (forward-compat)', () => {
  it('accepts an engine + per-engine input fields not enumerated in IMAGE_GEN_ENGINES', () => {
    // Same rationale: new engines + new per-engine fields ship continuously.
    // The `engine: ImageGenEngine | (string & {})` union + `[field]: unknown`
    // catch-all on ImageGenInput must keep this compiling and serializing.
    const body = buildImageGenBody({
      engine: 'someFutureEngine',
      model: 'v0',
      prompt: 'hi',
      futureField: 42,
      nested: { newOption: true },
    }) as { steps: Array<{ input: Record<string, unknown> }> };
    expect(body.steps[0]!.input).toMatchObject({
      engine: 'someFutureEngine',
      model: 'v0',
      futureField: 42,
      nested: { newOption: true },
    });
  });
});

// ── Catalog wire-parity pins ────────────────────────────────────────────────
//
// 🔴 THE EXPECTED LISTS ARE TRANSCRIBED FROM THE ORCHESTRATOR SPEC, NOT FROM
// `src/orchestrator/index.ts`. That is the point: a test whose expectation is
// copied from the implementation it tests can only ever confirm that the file
// equals itself. They live in `fixtures/orchestrator-spec-catalogs.json` so the
// LIVE-spec drift script (`pnpm check:catalogs`) can pin the same lists from the
// other side — see that file's `$comment` for the two-leg argument.
//
// This replaced `expect(keys).toContain('textToImage')`-style assertions over 7
// of the then-34 names. That guard could not fail on either half of a drift, and
// did not: the catalog shipped a phantom `audioMix` (0 occurrences in the spec,
// i.e. a guaranteed 400) while missing 10 real step types. An exact-set
// comparison catches BOTH directions — a name the orchestrator does not accept,
// and one it does.
const SPEC_WORKFLOW_STEP_TYPES: readonly string[] = specCatalogs.workflowStepTypes;
const SPEC_IMAGE_GEN_ENGINES: readonly string[] = specCatalogs.imageGenEngines;

describe('WORKFLOW_STEP_TYPES + IMAGE_GEN_ENGINES catalogs', () => {
  it('lists EXACTLY the step types the orchestrator spec accepts', () => {
    // `toEqual` on sorted arrays, not two `toContain` sweeps: an extra key and a
    // missing key are different defects and this must report either one.
    expect([...Object.keys(WORKFLOW_STEP_TYPES)].sort()).toEqual([...SPEC_WORKFLOW_STEP_TYPES].sort());
  });

  it('names no step type the orchestrator does not accept', () => {
    // The half a `toContain` guard structurally cannot express. Spelled out
    // separately so a failure names WHICH phantom rather than dumping a 44-line
    // array diff — this is the assertion `audioMix` would have tripped.
    const phantom = Object.keys(WORKFLOW_STEP_TYPES).filter(
      (k) => !SPEC_WORKFLOW_STEP_TYPES.includes(k),
    );
    expect(phantom).toEqual([]);
  });

  it('omits no step type the orchestrator does accept', () => {
    const missing = SPEC_WORKFLOW_STEP_TYPES.filter(
      (k) => !Object.prototype.hasOwnProperty.call(WORKFLOW_STEP_TYPES, k),
    );
    expect(missing).toEqual([]);
  });

  it('gives every step type a non-empty one-line description', () => {
    // A key with a blank description reads as documented in the catalog and is
    // not — the description is the catalog's whole job.
    const blank = Object.entries(WORKFLOW_STEP_TYPES)
      .filter(([, v]) => typeof v !== 'string' || v.trim().length === 0)
      .map(([k]) => k);
    expect(blank).toEqual([]);
  });

  it('lists EXACTLY the imageGen engines the orchestrator spec accepts', () => {
    expect([...Object.keys(IMAGE_GEN_ENGINES)].sort()).toEqual([...SPEC_IMAGE_GEN_ENGINES].sort());
  });

  it('reads a NON-EMPTY expectation from the spec fixture', () => {
    // Positive control for the four assertions above. Every one of them is an
    // "expect(...).toEqual([])"-shaped or set-equality check, and all of them
    // pass VACUOUSLY if the fixture arrives empty (a bad path, a renamed key, a
    // JSON import that silently yields {}). A green run must therefore also
    // prove the expectation had content — and the counts are pinned, not merely
    // asserted non-zero, so a truncated fixture is a failure and not a smaller
    // vacuous pass.
    // 🔴 These literals are meant to be bumped BY HAND when the orchestrator
    // genuinely gains a step type — that is the point, not friction. 44 -> 45 on
    // 2026-08-14 for `miniMaxMusic3`; engines 12 -> 13 on 2026-08-28 for `krea`;
    // 45 -> 47 on 2026-09-01 for `webScrape` + `webSearch`.
    // If you are here because this failed, confirm the new entry is in the LIVE
    // spec first (`node scripts/check-orchestrator-catalogs.mjs`), then bump;
    // never bump to whatever the fixture happens to hold, which would make this
    // assert nothing.
    expect(SPEC_WORKFLOW_STEP_TYPES).toHaveLength(47);
    expect(SPEC_IMAGE_GEN_ENGINES).toHaveLength(13);
    expect(new Set(SPEC_WORKFLOW_STEP_TYPES).size).toBe(SPEC_WORKFLOW_STEP_TYPES.length);
  });
});

describe('isTerminal', () => {
  it('returns true for every status in TERMINAL_STATUSES', () => {
    for (const status of TERMINAL_STATUSES) {
      expect(isTerminal({ id: 'x', status })).toBe(true);
    }
  });

  it('returns false for non-terminal statuses', () => {
    expect(isTerminal({ id: 'x', status: 'unassigned' })).toBe(false);
    expect(isTerminal({ id: 'x', status: 'pending' })).toBe(false);
    expect(isTerminal({ id: 'x', status: 'processing' })).toBe(false);
    expect(isTerminal({ id: 'x', status: 'mystery-future-status' })).toBe(false);
  });

  it('handles null / undefined / missing status', () => {
    expect(isTerminal(null)).toBe(false);
    expect(isTerminal(undefined)).toBe(false);
    expect(isTerminal({ id: 'x', status: '' as unknown as WorkflowSnapshot['status'] })).toBe(false);
  });
});

describe('extractImageUrls', () => {
  it('pulls from steps[].output.images[] when available && url', () => {
    const snap: WorkflowSnapshot = {
      id: 'wf',
      status: 'succeeded',
      steps: [
        {
          output: {
            images: [
              { url: 'https://cdn.test/a.png', available: true },
              { url: 'https://cdn.test/skip-unavailable.png', available: false },
              { url: undefined, available: true },
            ],
          },
        },
      ],
    };
    expect(extractImageUrls(snap)).toEqual(['https://cdn.test/a.png']);
  });

  it('falls back to blobs[] filtered by image mime', () => {
    const snap: WorkflowSnapshot = {
      id: 'wf',
      status: 'succeeded',
      steps: [
        {
          output: {
            blobs: [
              { url: 'https://cdn.test/img.jpg', mimeType: 'image/jpeg' },
              { url: 'https://cdn.test/legacy.png', type: 'image/png' },
              { url: 'https://cdn.test/skip.mp4', mimeType: 'video/mp4' },
              { url: 'https://cdn.test/no-mime.bin' },
            ],
          },
        },
      ],
    };
    expect(extractImageUrls(snap)).toEqual([
      'https://cdn.test/img.jpg',
      'https://cdn.test/legacy.png',
    ]);
  });

  it('mixes images[] and blobs[] across multiple steps in order', () => {
    const snap: WorkflowSnapshot = {
      id: 'wf',
      status: 'succeeded',
      steps: [
        { output: { images: [{ url: 'a', available: true }] } },
        { output: { blobs: [{ url: 'b', mimeType: 'image/png' }] } },
      ],
    };
    expect(extractImageUrls(snap)).toEqual(['a', 'b']);
  });

  it('returns [] for null / undefined / no steps', () => {
    expect(extractImageUrls(null)).toEqual([]);
    expect(extractImageUrls(undefined)).toEqual([]);
    expect(extractImageUrls({ id: 'wf', status: 'succeeded' })).toEqual([]);
    expect(extractImageUrls({ id: 'wf', status: 'succeeded', steps: [] })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Long polling (`?wait=`). The orchestrator holds the request open until the
// workflow reaches a terminal status, answering with 202 + the current snapshot
// when the hold elapses first. Before 0.31.0 `pollWorkflow` was a client-side
// timer loop DOCUMENTED as a long poll; these pin the real behaviour.
//
// Fixture ids/statuses/costs are pairwise DISTINCT so an implementation that
// returns the wrong attempt's snapshot fails rather than coincidentally passing.
// ---------------------------------------------------------------------------
describe('getWorkflow long-poll (?wait=)', () => {
  const client = createOrchestratorClient({ accessToken: 'tok', baseUrl: 'https://orch.test' });

  it('omits ?wait entirely when no options are passed (pre-0.31 call shape)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'wf_bare', status: 'processing' }));
    await getWorkflow(client, 'wf_bare');
    expect(fetchMock.mock.calls[0]![0]).toBe('https://orch.test/v2/consumer/workflows/wf_bare');
  });

  it('sends ?wait=<seconds> when waitSeconds is given', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'wf_hold', status: 'succeeded' }));
    const snap = await getWorkflow(client, 'wf_hold', { waitSeconds: 13 });
    expect(snap.id).toBe('wf_hold');
    expect(fetchMock.mock.calls[0]![0]).toBe(
      'https://orch.test/v2/consumer/workflows/wf_hold?wait=13',
    );
  });

  it('floors a fractional waitSeconds and drops 0 / negative / non-finite', async () => {
    const cases: Array<[number, string]> = [
      [2.9, '?wait=2'],
      [0, ''],
      [-5, ''],
      [Number.NaN, ''],
      [Number.POSITIVE_INFINITY, ''],
    ];
    for (const [waitSeconds, expectedQs] of cases) {
      fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'wf_q', status: 'processing' }));
      await getWorkflow(client, 'wf_q', { waitSeconds });
      const url = fetchMock.mock.calls.at(-1)![0];
      expect(url, `waitSeconds=${String(waitSeconds)}`).toBe(
        `https://orch.test/v2/consumer/workflows/wf_q${expectedQs}`,
      );
    }
  });

  it('forwards the caller signal to fetch so a hold is genuinely cancellable', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'wf_sig', status: 'processing' }));
    const ctl = new AbortController();
    await getWorkflow(client, 'wf_sig', { waitSeconds: 4, signal: ctl.signal });
    expect((fetchMock.mock.calls[0]![1] as RequestInit).signal).toBe(ctl.signal);
  });
});

describe('pollWorkflow', () => {
  const client = createOrchestratorClient({ accessToken: 'tok', baseUrl: 'https://orch.test' });

  /** The `?wait=` value on each fetch the loop made, in order. */
  function waitParams(): Array<string | null> {
    return fetchMock.mock.calls.map(([url]) =>
      new URL(url as string).searchParams.get('wait'),
    );
  }

  it('completes inside the wait window: ONE request, terminal snapshot', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ id: 'wf_fast', status: 'succeeded', cost: { total: 11 } }),
    );
    const snap = await pollWorkflow(client, 'wf_fast', { timeoutMs: 30_000, intervalMs: 1 });
    expect(snap.id).toBe('wf_fast');
    expect(isTerminal(snap)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(waitParams()).toEqual([String(DEFAULT_POLL_WAIT_SECONDS)]);
  });

  it('202 (hold elapsed, still running) RE-ARMS and returns the later snapshot', async () => {
    // A 202 is a 2xx, so it arrives as an ordinary non-terminal snapshot.
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ id: 'wf_rearm', status: 'processing', cost: { total: 22 } }, 202),
      )
      .mockResolvedValueOnce(
        jsonResponse({ id: 'wf_rearm', status: 'succeeded', cost: { total: 33 } }),
      );
    const snap = await pollWorkflow(client, 'wf_rearm', {
      timeoutMs: 30_000,
      intervalMs: 1,
      waitSeconds: 5,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Distinct costs: returning attempt #1's snapshot would read 22, not 33.
    expect(snap.cost?.total).toBe(33);
    expect(snap.status).toBe('succeeded');
    expect(waitParams()).toEqual(['5', '5']);
  });

  it('a terminal FAILURE stops the loop immediately and is returned, not thrown', async () => {
    // `mockImplementation`, not `mockResolvedValue`: a Response body can only be
    // read once, so a single shared instance makes attempt #2 throw
    // "Body is unusable" and the assertion would pass for the wrong reason.
    fetchMock.mockImplementation(() => jsonResponse({ id: 'wf_fail', status: 'failed' }));
    const snap = await pollWorkflow(client, 'wf_fail', {
      timeoutMs: 30_000,
      intervalMs: 1,
      waitSeconds: 7,
    });
    expect(snap.status).toBe('failed');
    expect(isTerminal(snap)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('CANCELLATION: aborts the in-flight request and returns the last snapshot', async () => {
    const ctl = new AbortController();
    let inFlightSignal: AbortSignal | undefined;
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ id: 'wf_cancel', status: 'processing' }))
      .mockImplementationOnce((_url: string, init: RequestInit) => {
        inFlightSignal = init.signal ?? undefined;
        // Hangs until aborted — a real long hold.
        return new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            const e = new Error('The operation was aborted.');
            e.name = 'AbortError';
            reject(e);
          });
        });
      });

    const promise = pollWorkflow(client, 'wf_cancel', {
      timeoutMs: 30_000,
      intervalMs: 1,
      waitSeconds: 9,
      signal: ctl.signal,
    });
    // Let attempt #2 start, then cancel.
    await new Promise((r) => setTimeout(r, 20));
    ctl.abort();

    const snap = await promise;
    // The caller's abort must reach the SOCKET, not just stop the loop.
    expect(inFlightSignal?.aborted).toBe(true);
    // …and must not destroy the snapshot we already had.
    expect(snap.id).toBe('wf_cancel');
    expect(snap.status).toBe('processing');
  });

  it('clamps the hold down to the time left on timeoutMs', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'wf_clamp', status: 'succeeded' }));
    await pollWorkflow(client, 'wf_clamp', {
      timeoutMs: 4_000,
      intervalMs: 1,
      waitSeconds: 20,
    });
    const asked = Number(waitParams()[0]);
    expect(asked).toBeLessThanOrEqual(4);
    expect(asked).toBeGreaterThan(0);
  });

  it('waitSeconds: 0 restores the pure-timer behaviour (no ?wait, repeated reads)', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ id: 'wf_timer', status: 'processing' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'wf_timer', status: 'succeeded' }));
    const snap = await pollWorkflow(client, 'wf_timer', {
      timeoutMs: 30_000,
      intervalMs: 1,
      waitSeconds: 0,
    });
    expect(snap.status).toBe('succeeded');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(waitParams()).toEqual([null, null]);
  });

  it('a NON-abort error on a later attempt still propagates', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ id: 'wf_err', status: 'processing' }))
      .mockResolvedValueOnce(jsonResponse({ detail: 'boom' }, 500));
    await expect(
      pollWorkflow(client, 'wf_err', { timeoutMs: 30_000, intervalMs: 1, waitSeconds: 3 }),
    ).rejects.toBeInstanceOf(OrchestratorError);
  });

  it('an error on the FIRST attempt propagates (no snapshot to fall back to)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ detail: 'nope' }, 404));
    await expect(
      pollWorkflow(client, 'wf_first', { timeoutMs: 30_000, intervalMs: 1 }),
    ).rejects.toBeInstanceOf(OrchestratorError);
  });

  it('still spaces attempts by intervalMs if the orchestrator ignores ?wait', async () => {
    // The hot-loop guard: an instantly-returning non-terminal response must not
    // be re-fetched at fetch speed.
    fetchMock.mockImplementation(() => jsonResponse({ id: 'wf_hot', status: 'processing' }));
    await pollWorkflow(client, 'wf_hot', {
      timeoutMs: 1_000,
      intervalMs: 100,
      waitSeconds: 20,
    });
    // We DID ask for a hold — the mock just ignored it, which is the scenario.
    expect(waitParams()[0]).toBe('1');
    // ~9 gaps of 100ms inside a 1s budget. A zero-gap re-arm would issue
    // thousands of requests in the same window.
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(4);
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(15);
  });
});
