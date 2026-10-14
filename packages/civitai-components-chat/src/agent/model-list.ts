import { chatConfig, ORCH_URL, type ChatModelOption } from '../config.js';

/** OpenRouter's public model list: no key, and open to any origin. */
export const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';
/** The dearest a listed OpenRouter model may be, in USD per million output tokens. */
export const MAX_PRICE_PER_MILLION = 8;
const FETCH_TIMEOUT_MS = 10_000;

/** One model the viewer may pick for a chat. */
export interface ChatModelEntry {
  id: string;
  label: string;
  /**
   * `default`: the page's default model. `listed`: one the page offers through `configureChat({ models })`.
   * `hosted`: one the orchestrator runs itself. `openrouter`: one it routes to OpenRouter.
   */
  source: 'default' | 'listed' | 'hosted' | 'openrouter';
  /** USD per million output tokens, when known. */
  pricePerMillion?: number;
  note?: string;
}

interface OpenRouterModel {
  id?: unknown;
  name?: unknown;
  pricing?: { completion?: unknown };
  supported_parameters?: unknown;
}

interface OrchestrationModel {
  id?: unknown;
  owned_by?: unknown;
}

/** Per-token USD as OpenRouter writes it ("0.0000006") to USD per million, without float noise at the boundary. */
function perMillion(completion: unknown): number | undefined {
  const perToken = typeof completion === 'string' || typeof completion === 'number' ? Number(completion) : NaN;
  // A negative price marks a router whose price depends on the model it picks: nothing to compare.
  if (!Number.isFinite(perToken) || perToken < 0) return undefined;
  return Math.round(perToken * 1e12) / 1e6;
}

function dataOf(body: unknown): unknown[] {
  const data = (body as { data?: unknown } | null)?.data;
  return Array.isArray(data) ? data : [];
}

/**
 * What the picker offers: the page's default and its listed models always (they work whatever the
 * lists say), then the orchestrator's own models, then the OpenRouter models the orchestrator can
 * route that cost at most {@link MAX_PRICE_PER_MILLION} per million output tokens and can call tools
 * (the assistant works only through tool calls). A list that could not be loaded is `null`: without
 * the orchestrator's list nothing from OpenRouter is offered, since none of it is known to work.
 */
export function buildModelList({
  openRouter,
  orchestration,
  defaultModel = chatConfig.model,
  listed = chatConfig.models,
}: {
  openRouter: unknown | null;
  orchestration: unknown | null;
  defaultModel?: string;
  listed?: ChatModelOption[];
}): ChatModelEntry[] {
  const entries = new Map<string, ChatModelEntry>();
  const add = (entry: ChatModelEntry) => {
    if (!entries.has(entry.id)) entries.set(entry.id, entry);
  };
  add({ id: defaultModel, label: 'Default', source: 'default' });
  for (const model of listed) add({ id: model.id, label: model.label, source: 'listed', ...(model.note ? { note: model.note } : {}) });

  const routable = new Map<string, OrchestrationModel>();
  for (const model of dataOf(orchestration) as OrchestrationModel[]) {
    if (typeof model?.id === 'string' && model.id) routable.set(model.id, model);
  }
  for (const [id, model] of routable) {
    if (model.owned_by !== 'openrouter') add({ id, label: id, source: 'hosted' });
  }

  const priced: ChatModelEntry[] = [];
  for (const model of dataOf(openRouter) as OpenRouterModel[]) {
    if (typeof model?.id !== 'string' || !routable.has(model.id)) continue;
    const price = perMillion(model.pricing?.completion);
    if (price === undefined || price > MAX_PRICE_PER_MILLION) continue;
    if (!Array.isArray(model.supported_parameters) || !model.supported_parameters.includes('tools')) continue;
    priced.push({ id: model.id, label: typeof model.name === 'string' && model.name ? model.name : model.id, source: 'openrouter', pricePerMillion: price });
  }
  priced.sort((a, b) => a.label.localeCompare(b.label));
  for (const entry of priced) {
    const known = entries.get(entry.id);
    // The page's own entries keep their label and note, and gain the price.
    if (known) known.pricePerMillion ??= entry.pricePerMillion;
    else add(entry);
  }
  return [...entries.values()];
}

export interface ModelCatalogDeps {
  /** Calls the orchestrator as the viewer (its bearer token). */
  orchestrationFetch: typeof fetch;
  /** Calls OpenRouter's public list; no credentials. */
  publicFetch?: typeof fetch;
  orchestrationUrl?: string;
}

/**
 * The picker's list, loaded once per session when it is first opened. A failed load still gives the
 * default and listed models (plus whatever the other list allowed), and is tried again next time.
 */
export class ModelCatalog {
  #deps: ModelCatalogDeps;
  #loaded: Promise<ChatModelEntry[]> | null = null;

  constructor(deps: ModelCatalogDeps) {
    this.#deps = deps;
  }

  load(): Promise<ChatModelEntry[]> {
    this.#loaded ??= this.#load();
    return this.#loaded;
  }

  async #load(): Promise<ChatModelEntry[]> {
    const publicFetch = this.#deps.publicFetch ?? ((input, init) => globalThis.fetch(input, init));
    const [openRouter, orchestration] = await Promise.all([
      getJson(publicFetch, OPENROUTER_MODELS_URL),
      getJson(this.#deps.orchestrationFetch, `${this.#deps.orchestrationUrl ?? ORCH_URL}/v1/models`),
    ]);
    // Only a full answer is kept; anything less is asked again the next time the picker opens.
    if (openRouter === null || orchestration === null) this.#loaded = null;
    return buildModelList({ openRouter, orchestration });
  }
}

async function getJson(doFetch: typeof fetch, url: string): Promise<unknown | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await doFetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`${url} answered ${response.status}`);
    return await response.json();
  } catch (error) {
    console.warn('[chat-cvt] could not load the model list', error);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** "$0.60/M out", or "Free"; empty when the price is unknown. */
export function priceLabel(entry: Pick<ChatModelEntry, 'pricePerMillion'>): string {
  const price = entry.pricePerMillion;
  if (price === undefined) return '';
  if (price === 0) return 'Free';
  return `$${price < 0.1 ? price.toFixed(3) : price.toFixed(2)}/M out`;
}
