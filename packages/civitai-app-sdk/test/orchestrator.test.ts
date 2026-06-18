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
  getWorkflow,
  IMAGE_GEN_ENGINES,
  isTerminal,
  OrchestratorError,
  submitWorkflow,
  TERMINAL_STATUSES,
  WORKFLOW_STEP_TYPES,
  type WorkflowSnapshot,
} from '../src/orchestrator/index.js';

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

  it('honors a custom logger', () => {
    const logger = { error: vi.fn() };
    const client = createOrchestratorClient({
      accessToken: 'tok',
      logger,
    });
    expect(client.logger).toBe(logger);
  });

  it('honors null logger for silent orchestrator clients', () => {
    const client = createOrchestratorClient({
      accessToken: 'tok',
      logger: null,
    });
    expect(client.logger).toBeNull();
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

  it('logs failing responses to console.error by default', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'bad_request' }, 400));
    await expect(
      callOrchestrator(client, '/v2/consumer/workflows', {
        method: 'POST',
        body: JSON.stringify({ steps: [] }),
      }),
    ).rejects.toBeInstanceOf(OrchestratorError);

    expect(console.error).toHaveBeenCalledWith(
      '[orchestrator] POST /v2/consumer/workflows -> 400 ERR\n' +
        '  raw body: {"error":"bad_request"}',
    );
  });

  it('sends failing response logs to a custom logger', async () => {
    const logger = { error: vi.fn() };
    const clientWithLogger = createOrchestratorClient({
      accessToken: 'secret-token',
      baseUrl: 'https://orch.test',
      logger,
    });
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'bad_request' }, 400));

    await expect(
      callOrchestrator(clientWithLogger, '/v2/consumer/workflows', {
        method: 'POST',
        body: JSON.stringify({ steps: [] }),
      }),
    ).rejects.toMatchObject({
      name: 'OrchestratorError',
      status: 400,
      body: { error: 'bad_request' },
    });

    expect(logger.error).toHaveBeenCalledWith(
      '[orchestrator] POST /v2/consumer/workflows -> 400 ERR\n' +
        '  raw body: {"error":"bad_request"}',
    );
    expect(console.error).not.toHaveBeenCalled();
  });

  it('does not log failing responses when logger is null', async () => {
    const silentClient = createOrchestratorClient({
      accessToken: 'secret-token',
      baseUrl: 'https://orch.test',
      logger: null,
    });
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'bad_request' }, 400));

    await expect(
      callOrchestrator(silentClient, '/v2/consumer/workflows', {
        method: 'POST',
        body: JSON.stringify({ steps: [] }),
      }),
    ).rejects.toMatchObject({
      name: 'OrchestratorError',
      status: 400,
      body: { error: 'bad_request' },
    });

    expect(console.error).not.toHaveBeenCalled();
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

describe('WORKFLOW_STEP_TYPES + IMAGE_GEN_ENGINES catalogs', () => {
  it('includes the major step types', () => {
    const keys = Object.keys(WORKFLOW_STEP_TYPES);
    expect(keys).toContain('textToImage');
    expect(keys).toContain('imageGen');
    expect(keys).toContain('videoGen');
    expect(keys).toContain('comfy');
    expect(keys).toContain('textToSpeech');
    expect(keys).toContain('aceStepAudio');
    expect(keys).toContain('transcription');
  });

  it('exposes the closed-source image gen engines for imageGen', () => {
    const engines = Object.keys(IMAGE_GEN_ENGINES);
    expect(engines).toContain('google');
    expect(engines).toContain('gemini');
    expect(engines).toContain('openai');
    expect(engines).toContain('flux1-kontext');
    expect(engines).toContain('flux2');
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
