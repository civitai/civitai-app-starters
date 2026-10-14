import { afterEach, describe, expect, it, vi } from 'vitest';

import { chatConfig } from '../config.js';
import { buildModelList, ModelCatalog, OPENROUTER_MODELS_URL, priceLabel } from './model-list.js';

const DEFAULT = 'urn:air:qwen3:repository:huggingface:example/default@main';
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
      { id: DEFAULT, label: 'Default', source: 'default' },
      { id: 'g/listed', label: 'Listed G', source: 'listed', note: 'Picked by the page.', pricePerMillion: 4.2 },
      { id: 'urn:air:hosted:repository:example/own-model@main', label: 'urn:air:hosted:repository:example/own-model@main', source: 'hosted' },
      { id: 'a/at-limit', label: 'At Limit', source: 'openrouter', pricePerMillion: 8 },
      { id: 'd/cheap', label: 'Cheap D', source: 'openrouter', pricePerMillion: 0.37 },
      { id: 'h/free', label: 'Free H', source: 'openrouter', pricePerMillion: 0 },
    ]);
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

  it('shows the price per million output tokens', () => {
    expect([8, 0.37, 0.042, 0, undefined].map((pricePerMillion) => priceLabel({ pricePerMillion }))).toEqual(['$8.00/M out', '$0.37/M out', '$0.042/M out', 'Free', '']);
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
