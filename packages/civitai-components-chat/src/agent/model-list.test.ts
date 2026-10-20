import { afterEach, describe, expect, it, vi } from 'vitest';

import { chatConfig, CONTEXT_BUDGET_TOKENS, REQUEST_OVERHEAD_TOKENS } from '../config.js';
import { buildModelList, ModelCatalog, OPENROUTER_MODELS_URL, prettyModelId, priceLabel, usableModels, type ChatModelEntry } from './model-list.js';

const DEFAULT = 'urn:air:qwen3:repository:huggingface:example/basil-3@main';
const LISTED = [{ id: 'g/listed', label: 'Listed G', note: 'Picked by the page.' }];

// Each price, id and name differs from every other, and from the $8 limit except the one entry that sits on it.
const openRouter = {
  data: [
    { id: 'a/at-limit', name: 'At Limit', pricing: { prompt: '2e-06', completion: '0.000008' }, supported_parameters: ['tools', 'temperature'] },
    { id: 'b/over', name: 'Just Over', pricing: { prompt: '2.000025e-06', completion: '0.0000080001' }, supported_parameters: ['tools'] },
    { id: 'c/no-tools', name: 'No Tools', pricing: { prompt: '2.75e-07', completion: '0.0000011' }, supported_parameters: ['temperature'] },
    { id: 'd/cheap', name: 'Cheap D', pricing: { prompt: '9.25e-08', completion: '0.00000037' }, supported_parameters: ['tools'] },
    { id: 'e/unroutable', name: 'Unroutable', pricing: { prompt: '5.75e-07', completion: '0.0000023' }, supported_parameters: ['tools'] },
    { id: 'f/router', name: 'Router', pricing: { prompt: '-1', completion: '-1' }, supported_parameters: ['tools'] },
    { id: 'g/listed', name: 'G on OpenRouter', pricing: { prompt: '1.05e-06', completion: '0.0000042' }, supported_parameters: ['tools'] },
    { id: 'h/free', name: 'Free H', pricing: { prompt: '0', completion: '0' }, supported_parameters: ['tools'] },
  ],
};
const orchestration = {
  data: [
    ...['a/at-limit', 'b/over', 'c/no-tools', 'd/cheap', 'f/router', 'g/listed', 'h/free'].map((id) => ({ id, object: 'model', owned_by: 'openrouter' })),
    { id: 'civitai/own-model', object: 'model', owned_by: 'civitai' },
    { id: 'urn:air:hosted:repository:example/own-model@main', object: 'model', owned_by: 'civitai' },
  ],
};

describe('buildModelList', () => {
  it('offers routable OpenRouter models at most $8 per million output tokens that call tools, beside the hosted aliases and page models', () => {
    const list = buildModelList({ openRouter, orchestration, defaultModel: DEFAULT, listed: LISTED });
    expect(list.map((entry) => entry.id)).toEqual([DEFAULT, 'g/listed', 'civitai/own-model', 'a/at-limit', 'd/cheap', 'h/free']);
    expect(list).toEqual([
      { id: DEFAULT, label: 'basil-3', source: 'default' },
      { id: 'g/listed', label: 'Listed G', source: 'listed', note: 'Picked by the page.', price: { input: 1.05, output: 4.2 } },
      { id: 'civitai/own-model', label: 'civitai/own-model', source: 'hosted' },
      { id: 'a/at-limit', label: 'At Limit', source: 'openrouter', price: { input: 2, output: 8 } },
      { id: 'd/cheap', label: 'Cheap D', source: 'openrouter', price: { input: 0.0925, output: 0.37 } },
      { id: 'h/free', label: 'Free H', source: 'openrouter', price: { input: 0, output: 0 } },
    ]);
  });

  it("labels the default with its model's name, never the word Default (the marker is added where it is shown)", () => {
    // Every name here differs from every other and from "default": the label can only come from the name.
    const named = buildModelList({
      openRouter: { data: [{ id: 'n/nebula-4', name: 'Nebula Four', pricing: { prompt: '2.5e-07', completion: '0.000001' }, supported_parameters: ['tools'] }] },
      orchestration: { data: [{ id: 'n/nebula-4', owned_by: 'openrouter' }] },
      defaultModel: 'n/nebula-4',
      listed: [],
    });
    expect(named[0]).toEqual({ id: 'n/nebula-4', label: 'Nebula Four', source: 'default', price: { input: 0.25, output: 1 } });
    // A page label for the default model wins over OpenRouter's name.
    const paged = buildModelList({ openRouter: null, orchestration: null, defaultModel: 'p/pine-2', listed: [{ id: 'p/pine-2', label: 'Pine Two' }] });
    expect(paged[0]!.label).toBe('Pine Two');
    // No list names it: its id, made readable.
    const bare = buildModelList({ openRouter: null, orchestration: null, defaultModel: 'urn:air:x:repository:hub/Quartz-9B@main.tar', listed: [] });
    expect(bare[0]!.label).toBe('Quartz-9B');
    for (const list of [named, paged, bare]) expect(list[0]!.label).not.toMatch(/default/i);
  });

  it("makes an AIR readable: its last part, without the version or file after @; other ids as they are", () => {
    expect(['urn:air:x:repository:hub/Quartz-9B@main.tar', 'urn:air:x:repository:hub/b@', 'civitai/qwen3.8', 'plain'].map(prettyModelId)).toEqual(['Quartz-9B', 'b', 'civitai/qwen3.8', 'plain']);
  });

  it('keeps the default and the page models when neither list loaded', () => {
    expect(buildModelList({ openRouter: null, orchestration: null, defaultModel: DEFAULT, listed: LISTED }).map((entry) => entry.id)).toEqual([DEFAULT, 'g/listed']);
  });

  it('offers nothing from OpenRouter without the orchestrator list, and only its hosted models without OpenRouter', () => {
    expect(buildModelList({ openRouter, orchestration: null, defaultModel: DEFAULT, listed: [] }).map((entry) => entry.id)).toEqual([DEFAULT]);
    expect(buildModelList({ openRouter: null, orchestration, defaultModel: DEFAULT, listed: [] }).map((entry) => entry.id)).toEqual([
      DEFAULT,
      'civitai/own-model',
    ]);
  });

  it('shows the price per million input and output tokens, and a $0 model as $0, never "Free" (that is the free tier)', () => {
    expect([{ input: 2, output: 8 }, { input: 0.042, output: 0.37 }, { input: 0, output: 0 }, undefined].map((price) => priceLabel({ price }))).toEqual([
      '$2.00 in · $8.00 out /M',
      '$0.042 in · $0.37 out /M',
      '$0 in · $0 out /M',
      '',
    ]);
  });

  it('carries each model\'s context window from whichever list states it', () => {
    const list = buildModelList({
      openRouter: { data: [{ id: 'k/windowed', name: 'Windowed', pricing: { prompt: '2.5e-07', completion: '0.000001' }, supported_parameters: ['tools'], context_length: 65_536 }, { id: 'm/orch-window', name: 'Orch Window', pricing: { prompt: '5e-07', completion: '0.000002' }, supported_parameters: ['tools'] }] },
      orchestration: { data: [{ id: 'k/windowed', owned_by: 'openrouter' }, { id: 'm/orch-window', owned_by: 'openrouter', context_length: 40_960 }, { id: 'civitai/small', owned_by: 'civitai', context_length: 13_312 }] },
      defaultModel: DEFAULT,
      listed: [],
    });
    expect(Object.fromEntries(list.map((entry) => [entry.id, entry.contextLength]))).toEqual({ [DEFAULT]: undefined, 'civitai/small': 13_312, 'k/windowed': 65_536, 'm/orch-window': 40_960 });
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
    expect(ids).toContain('civitai/own-model');
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
