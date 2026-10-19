import { afterEach, describe, expect, it, vi } from 'vitest';

import { chatConfig, CONTEXT_BUDGET_TOKENS, REQUEST_OVERHEAD_TOKENS } from '../config.js';
import { buildModelList, ModelCatalog, OPENROUTER_MODELS_URL, prettyModelId, priceLabel, usableModels, type ChatModelEntry } from './model-list.js';

const DEFAULT = 'urn:air:qwen3:repository:huggingface:example/basil-3@main';
const LISTED = [{ id: 'g/listed', label: 'Listed G', note: 'Picked by the page.' }];

// Each price, id and name differs from every other, and from the $8 limit except the one entry that sits on it.
const openRouter = {
  data: [
    { id: 'a/at-limit', name: 'At Limit', pricing: { completion: '0.000008' }, supported_parameters: ['tools', 'temperature'] },
    { id: 'b/over', name: 'Just Over', pricing: { completion: '0.0000080001' }, supported_parameters: ['tools'] },
    { id: 'c/no-tools', name: 'No Tools', pricing: { completion: '0.0000011' }, supported_parameters: ['temperature'] },
    { id: 'd/cheap', name: 'Cheap D', pricing: { completion: '0.00000037' }, supported_parameters: ['tools'] },
    { id: 'e/unroutable', name: 'Unroutable', pricing: { completion: '0.0000023' }, supported_parameters: ['tools'] },
    { id: 'f/router', name: 'Router', pricing: { completion: '-1' }, supported_parameters: ['tools'] },
    { id: 'g/listed', name: 'G on OpenRouter', pricing: { completion: '0.0000042' }, supported_parameters: ['tools'] },
    { id: 'h/free', name: 'Free H', pricing: { completion: '0' }, supported_parameters: ['tools'] },
  ],
};
const orchestration = {
  data: [
    ...['a/at-limit', 'b/over', 'c/no-tools', 'd/cheap', 'f/router', 'g/listed', 'h/free'].map((id) => ({ id, object: 'model', owned_by: 'openrouter' })),
    { id: 'urn:air:hosted:repository:example/own-model@main', object: 'model', owned_by: 'civitai' },
  ],
};

describe('buildModelList', () => {
  it('offers routable OpenRouter models at most $8 per million output tokens that call tools, beside the hosted and page models', () => {
    const list = buildModelList({ openRouter, orchestration, defaultModel: DEFAULT, listed: LISTED });
    expect(list.map((entry) => entry.id)).toEqual([DEFAULT, 'g/listed', 'urn:air:hosted:repository:example/own-model@main', 'a/at-limit', 'd/cheap', 'h/free']);
    expect(list).toEqual([
      { id: DEFAULT, label: 'basil-3 · default', source: 'default' },
      { id: 'g/listed', label: 'Listed G', source: 'listed', note: 'Picked by the page.', pricePerMillion: 4.2 },
      { id: 'urn:air:hosted:repository:example/own-model@main', label: 'urn:air:hosted:repository:example/own-model@main', source: 'hosted' },
      { id: 'a/at-limit', label: 'At Limit', source: 'openrouter', pricePerMillion: 8 },
      { id: 'd/cheap', label: 'Cheap D', source: 'openrouter', pricePerMillion: 0.37 },
      { id: 'h/free', label: 'Free H', source: 'openrouter', pricePerMillion: 0 },
    ]);
  });

  it("labels the default with its model's name and the default marker, never the bare word", () => {
    // Every name here differs from every other and from "default": the label can only come from the name.
    const named = buildModelList({
      openRouter: { data: [{ id: 'n/nebula-4', name: 'Nebula Four', pricing: { completion: '0.000001' }, supported_parameters: ['tools'] }] },
      orchestration: { data: [{ id: 'n/nebula-4', owned_by: 'openrouter' }] },
      defaultModel: 'n/nebula-4',
      listed: [],
    });
    expect(named[0]).toEqual({ id: 'n/nebula-4', label: 'Nebula Four · default', source: 'default', pricePerMillion: 1 });
    // A page label for the default model wins over OpenRouter's name.
    const paged = buildModelList({ openRouter: null, orchestration: null, defaultModel: 'p/pine-2', listed: [{ id: 'p/pine-2', label: 'Pine Two' }] });
    expect(paged[0]!.label).toBe('Pine Two · default');
    // No list names it: its id, made readable.
    const bare = buildModelList({ openRouter: null, orchestration: null, defaultModel: 'urn:air:x:repository:hub/Quartz-9B@main.tar', listed: [] });
    expect(bare[0]!.label).toBe('Quartz-9B · default');
    for (const list of [named, paged, bare]) expect(list[0]!.label).not.toBe('Default');
  });

  it('makes a bare id readable: its last part, without the version or file after @', () => {
    expect(['urn:air:x:repository:hub/Quartz-9B@main.tar', 'vendor/model-name', 'plain', 'a/b@'].map(prettyModelId)).toEqual(['Quartz-9B', 'model-name', 'plain', 'b']);
  });

  it('keeps the default and the page models when neither list loaded', () => {
    expect(buildModelList({ openRouter: null, orchestration: null, defaultModel: DEFAULT, listed: LISTED }).map((entry) => entry.id)).toEqual([DEFAULT, 'g/listed']);
  });

  it('offers nothing from OpenRouter without the orchestrator list, and only its hosted models without OpenRouter', () => {
    expect(buildModelList({ openRouter, orchestration: null, defaultModel: DEFAULT, listed: [] }).map((entry) => entry.id)).toEqual([DEFAULT]);
    expect(buildModelList({ openRouter: null, orchestration, defaultModel: DEFAULT, listed: [] }).map((entry) => entry.id)).toEqual([
      DEFAULT,
      'urn:air:hosted:repository:example/own-model@main',
    ]);
  });

  it('shows the price per million output tokens, and a $0 model as $0, never "Free" (that is the free tier)', () => {
    expect([8, 0.37, 0.042, 0, undefined].map((pricePerMillion) => priceLabel({ pricePerMillion }))).toEqual(['$8.00/M out', '$0.37/M out', '$0.042/M out', '$0/M out', '']);
  });

  it('carries each model\'s context window from whichever list states it', () => {
    const list = buildModelList({
      openRouter: { data: [{ id: 'k/windowed', name: 'Windowed', pricing: { completion: '0.000001' }, supported_parameters: ['tools'], context_length: 65_536 }, { id: 'm/orch-window', name: 'Orch Window', pricing: { completion: '0.000002' }, supported_parameters: ['tools'] }] },
      orchestration: { data: [{ id: 'k/windowed', owned_by: 'openrouter' }, { id: 'm/orch-window', owned_by: 'openrouter', context_length: 40_960 }, { id: 'urn:air:small:hosted', owned_by: 'civitai', context_length: 13_312 }] },
      defaultModel: DEFAULT,
      listed: [],
    });
    expect(Object.fromEntries(list.map((entry) => [entry.id, entry.contextLength]))).toEqual({ [DEFAULT]: undefined, 'urn:air:small:hosted': 13_312, 'k/windowed': 65_536, 'm/orch-window': 40_960 });
  });
});

describe('ModelCatalog', () => {
  afterEach(() => vi.restoreAllMocks());

  const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

  function setup(orch: () => Promise<Response>, open: () => Promise<Response>) {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const orchestrationFetch = vi.fn(async (_url: unknown, _init?: RequestInit) => orch());
    const publicFetch = vi.fn(async (_url: unknown, _init?: RequestInit) => open());
    const catalog = new ModelCatalog({ orchestrationFetch: orchestrationFetch as never, publicFetch: publicFetch as never, orchestrationUrl: 'https://orch.example' });
    return { catalog, orchestrationFetch, publicFetch };
  }

  it("asks OpenRouter's public list and the orchestrator's (as the viewer), once per session", async () => {
    const { catalog, orchestrationFetch, publicFetch } = setup(async () => json(orchestration), async () => json(openRouter));
    const first = await catalog.load();
    expect(first.map((entry) => entry.id)).toContain('d/cheap');
    expect(await catalog.load()).toBe(first);
    expect(publicFetch.mock.calls.map(([url]) => String(url))).toEqual([OPENROUTER_MODELS_URL]);
    expect(orchestrationFetch.mock.calls.map(([url]) => String(url))).toEqual(['https://orch.example/v1/models']);
  });

  it('still offers the default and page models when OpenRouter cannot be reached, and asks again next time', async () => {
    let down = true;
    const { catalog, publicFetch } = setup(async () => json(orchestration), async () => (down ? Promise.reject(new TypeError('Failed to fetch')) : json(openRouter)));
    const ids = (await catalog.load()).map((entry) => entry.id);
    expect(ids).toContain('urn:air:hosted:repository:example/own-model@main');
    expect(ids).not.toContain('d/cheap');
    down = false;
    expect((await catalog.load()).map((entry) => entry.id)).toContain('d/cheap');
    expect(publicFetch).toHaveBeenCalledTimes(2);
  });

  it('offers no OpenRouter model when the orchestrator list fails', async () => {
    const { catalog } = setup(async () => new Response('nope', { status: 500 }), async () => json(openRouter));
    // The page's default is always there, though neither list names it.
    expect((await catalog.load()).map((entry) => entry.id)).toEqual([chatConfig.model]);
  });
});

describe('usableModels', () => {
  const entry = (id: string, source: ChatModelEntry['source'], contextLength?: number): ChatModelEntry => ({ id, label: id, source, ...(contextLength ? { contextLength } : {}) });
  const models = [
    entry('page/default', 'default', 9_000),
    entry('page/listed', 'listed', 9_100),
    entry('hosted/exact', 'hosted', 39_000),
    entry('hosted/one-short', 'hosted', 38_999),
    entry('or/roomy', 'openrouter', 131_072),
    entry('or/one-short', 'openrouter', 38_999),
    entry('or/unknown', 'openrouter'),
    entry('or/current', 'openrouter', 9_200),
  ];

  it('drops a model whose window cannot hold the reply cap plus the conversation budget, but never the default, listed or current one', () => {
    // 5,000 of reply + 24,000 of history + 10,000 of prompt and tools = 39,000: exactly that fits, one less does not.
    expect(usableModels(models, 5_000, 'or/current').map((model) => model.id)).toEqual(['page/default', 'page/listed', 'hosted/exact', 'or/roomy', 'or/unknown', 'or/current']);
  });

  it('counts the measured prompt-and-tools overhead, not only history and reply', () => {
    expect(CONTEXT_BUDGET_TOKENS + REQUEST_OVERHEAD_TOKENS).toBe(34_000);
  });

  it('filters against the cap in force, so changing it changes the list', () => {
    expect(usableModels(models, 4_999).map((model) => model.id)).toEqual(['page/default', 'page/listed', 'hosted/exact', 'hosted/one-short', 'or/roomy', 'or/one-short', 'or/unknown']);
    // The default cap: hosted models with 13,312 or 16,384 tokens cannot fit a request.
    const hosted = [13_312, 262_144, 131_072, 16_384].map((length) => entry(`hosted/${length}`, 'hosted', length));
    expect(usableModels(hosted, 16_384).map((model) => model.id)).toEqual(['hosted/262144', 'hosted/131072']);
  });
});
