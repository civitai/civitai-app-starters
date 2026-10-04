import type { McpConnection } from '../mcp/clients.js';
import { mcpResultToText, structuredOf } from '../mcp/result.js';
import type { PanelSpec, PanelValues } from './spec.js';

const CATEGORY: Record<string, string> = { imageGen: 'image', videoGen: 'video' };
const ALTERNATIVES = 6;
const CANDIDATES = 12;
const OPERATION = /^(create|edit)[A-Z]\w*$/;
const LABEL_MAX = 60;
const SERVICE = /^## #\d+: (.+)\n\s+Service: (\S+) \(stepType (\w+)\)/gm;

interface Service {
  id: string;
  name: string;
}

/**
 * A generation turned into a panel without the assistant: its prompt to edit, and its model beside
 * other services the orchestrator offers for the same kind of step, each priced up front (free) so the
 * list shows what it costs and leaves out any the service refuses. `null` for anything that is not one
 * `run_step` with a prompt.
 */
export async function adjustPanel(
  tool: string,
  args: Record<string, unknown>,
  deps: { mcp: Pick<McpConnection, 'callTool'>; resolveArgs(args: Record<string, unknown>): Promise<Record<string, unknown>> },
  title: string,
): Promise<{ spec: PanelSpec; values: PanelValues } | null> {
  const input = args.input as Record<string, unknown> | undefined;
  const stepType = args.stepType;
  if (tool !== 'run_step' || typeof stepType !== 'string' || !input || typeof input.prompt !== 'string') return null;
  const prompt = input.prompt.slice(0, 2000);

  const operation = typeof input.operation === 'string' ? input.operation : undefined;
  // Edits keep their source pictures whichever model makes them.
  const carried = 'images' in input ? { images: input.images } : {};
  const services = await listServices(deps.mcp, stepType, operation);
  const current = services.find((service) => describes(service.id, input));
  const candidates = await Promise.all(
    services
      .filter((service) => service !== current)
      .slice(0, CANDIDATES)
      .map(async (service) => {
        const example = await exampleInput(deps.mcp, service.id);
        return example ? { name: service.name, input: { ...example, ...carried, prompt: '{{prompt}}' } } : null;
      }),
  );
  const priced = await Promise.all(
    [{ name: `${current?.name ?? modelOf(input)} (current)`, input: { ...input, prompt: '{{prompt}}' } }, ...candidates.flatMap((c) => (c ? [c] : []))].map(async (option) => ({
      ...option,
      price: await priceOf(deps, stepType, { ...option.input, prompt }),
    })),
  );
  const [mine, ...others] = priced;
  const alternatives = others
    .filter((option) => option.price !== null)
    .sort((a, b) => a.price! - b.price!)
    .slice(0, ALTERNATIVES);
  const options = [mine!, ...alternatives].map((option) => ({ label: optionLabel(option.name, option.price), input: option.input }));
  const unique = options.filter((option, index) => options.findIndex((o) => o.label === option.label) === index);
  const single = unique.length === 1;

  return {
    spec: {
      title,
      description: 'Change the prompt or pick another model; the button shows what it costs.',
      inputs: {
        prompt: { kind: 'text', label: 'Prompt', multiline: true, required: true, maxLen: 2000, default: prompt },
        ...(single ? {} : { model: { kind: 'choice', label: 'Model', options: unique.map((o) => o.label), default: unique[0]!.label, map: Object.fromEntries(unique.map((o) => [o.label, o.input])) } }),
      },
      run: { stepType, input: single ? unique[0]!.input : '{{model}}' },
    },
    values: { prompt, ...(single ? {} : { model: unique[0]!.label }) },
  };
}

async function listServices(mcp: Pick<McpConnection, 'callTool'>, stepType: string, operation?: string): Promise<Service[]> {
  try {
    // The whole category rather than a search by prompt, which ranks one model family above the rest.
    const result = await mcp.callTool('find_services', { query: '*', ...(CATEGORY[stepType] ? { category: CATEGORY[stepType] } : {}), limit: 30 });
    if (result.isError) return [];
    return [...mcpResultToText(result, Infinity).matchAll(SERVICE)]
      .filter((match) => match[3] === stepType && !otherOperation(match[2]!, operation))
      .map((match) => ({ id: match[2]!, name: match[1]!.replace(/ · [^·]+$/, '').trim() }));
  } catch {
    return [];
  }
}

/** Ids name their operation when a model has several, e.g. …/createImage or …/editImage. */
function otherOperation(serviceId: string, operation?: string): boolean {
  return Boolean(operation) && serviceId.split('/').some((part) => OPERATION.test(part) && part !== operation);
}

async function priceOf(
  deps: { mcp: Pick<McpConnection, 'callTool'>; resolveArgs(args: Record<string, unknown>): Promise<Record<string, unknown>> },
  stepType: string,
  input: Record<string, unknown>,
): Promise<number | null> {
  try {
    const result = await deps.mcp.callTool('run_step', { ...(await deps.resolveArgs({ stepType, input })), whatif: true });
    const total = (structuredOf(result)?.cost as { total?: unknown } | undefined)?.total;
    return result.isError || typeof total !== 'number' ? null : total;
  } catch {
    return null;
  }
}

function optionLabel(name: string, price: number | null): string {
  const suffix = price === null ? '' : ` · ≈ ${price} Buzz`;
  return `${name.slice(0, LABEL_MAX - suffix.length)}${suffix}`;
}

async function exampleInput(mcp: Pick<McpConnection, 'callTool'>, service: string): Promise<Record<string, unknown> | null> {
  try {
    const result = await mcp.callTool('get_input_schema', { service });
    if (result.isError) return null;
    const example = (JSON.parse(mcpResultToText(result, Infinity)) as { example?: unknown }).example;
    return example && typeof example === 'object' && !Array.isArray(example) ? (example as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** A service id is its parameters in order (e.g. image/comfy/krea2/turbo/createImage); the request carries them as fields. */
function describes(serviceId: string, input: Record<string, unknown>): boolean {
  const parts = serviceId.split('/').slice(1);
  const values = new Set(Object.values(input).filter((value): value is string => typeof value === 'string'));
  return parts.length > 0 && parts.every((part) => values.has(part));
}

function modelOf(input: Record<string, unknown>): string {
  return [input.engine, input.ecosystem, input.model].filter((part) => typeof part === 'string').join(' ') || 'This model';
}
