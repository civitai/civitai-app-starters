import type { Workflow } from '@civitai/sdk';

export interface UsedResource {
  air: string;
  modelId: number;
  versionId: number;
  kind: 'model' | 'lora';
  strength?: number;
}

/** How a result was made, for the viewer: what was asked for, with what, and at what cost. */
export interface GenerationDetails {
  /** What was asked for, in the step's own fields: a prompt, a song description, lyrics, a script. */
  texts: { label: string; text: string }[];
  /** The step and service in their own terms, e.g. "imageGen · comfy · krea2 · turbo". */
  service?: string;
  resources: UsedResource[];
  settings: { label: string; value: string }[];
  cost?: number;
  seconds?: number;
  workflowId?: string;
}

const CIVITAI_AIR = /^urn:air:[^:]+:([^:]+):civitai:(\d+)@(\d+)/;
const SERVICE_KEYS = ['engine', 'ecosystem', 'model', 'version', 'modelVersion', 'provider', 'operation'];
const TEXTS: [key: string, label: string][] = [
  ['prompt', 'Prompt'],
  ['musicDescription', 'Description'],
  ['text', 'Script'],
  ['lyrics', 'Lyrics'],
  ['negativePrompt', 'Negative prompt'],
];
const SETTINGS: [key: string, label: string][] = [
  ['steps', 'Steps'],
  ['cfgScale', 'Guidance'],
  ['cfg', 'Guidance'],
  ['sampler', 'Sampler'],
  ['seed', 'Seed'],
  ['duration', 'Length'],
  ['aspectRatio', 'Aspect ratio'],
  ['resolution', 'Resolution'],
  ['voice', 'Voice'],
  ['bpm', 'Tempo'],
  ['key', 'Key'],
  ['timeSignature', 'Time signature'],
  ['language', 'Language'],
];

function resource(air: string, strength?: number): UsedResource | null {
  const match = CIVITAI_AIR.exec(air);
  if (!match) return null;
  const type = match[1]!.toLowerCase();
  return { air, modelId: Number(match[2]), versionId: Number(match[3]), kind: type === 'lora' || type === 'lycoris' ? 'lora' : 'model', ...(strength !== undefined ? { strength } : {}) };
}

/**
 * Reads the step's input as the orchestrator resolved it, which names the checkpoint even when
 * the request left it to the service; `requested` is what the assistant sent, for before that.
 */
export function generationDetails(
  workflow: Workflow | undefined,
  stepName: string | undefined,
  requested: Record<string, unknown> | undefined,
  size?: { width?: number; height?: number },
): GenerationDetails {
  const step = workflow?.steps.find((candidate) => candidate.name === stepName) ?? (workflow?.steps.length === 1 ? workflow.steps[0] : undefined);
  const input = ((step as { input?: unknown } | undefined)?.input ?? requested ?? {}) as Record<string, unknown>;

  const resources: UsedResource[] = [];
  for (const value of Object.values(input)) {
    const found = typeof value === 'string' ? resource(value) : null;
    if (found && !resources.some((r) => r.air === found.air)) resources.push(found);
  }
  if (input.loras && typeof input.loras === 'object') {
    for (const [air, strength] of Object.entries(input.loras as Record<string, unknown>)) {
      const found = resource(air, typeof strength === 'number' ? strength : undefined);
      if (found) resources.push({ ...found, kind: 'lora' });
    }
  }

  const stepType = (step as { $type?: unknown } | undefined)?.$type ?? requested?.stepType;
  const service = [stepType, ...SERVICE_KEYS.map((key) => input[key])]
    .filter((value): value is string => typeof value === 'string' && value !== '' && !value.startsWith('urn:'))
    .join(' · ');
  const texts = TEXTS.flatMap(([key, label]) => (typeof input[key] === 'string' && (input[key] as string).trim() ? [{ label, text: input[key] as string }] : []));

  const settings: GenerationDetails['settings'] = [];
  const width = size?.width ?? (typeof input.width === 'number' ? input.width : undefined);
  const height = size?.height ?? (typeof input.height === 'number' ? input.height : undefined);
  if (width && height) settings.push({ label: 'Size', value: `${width} × ${height}` });
  for (const [key, label] of SETTINGS) {
    const value = input[key];
    if (typeof value !== 'number' && (typeof value !== 'string' || value === '')) continue;
    if (settings.some((s) => s.label === label)) continue;
    const scheduler = key === 'sampler' && typeof input.scheduler === 'string' ? ` · ${input.scheduler}` : '';
    const unit = key === 'duration' ? ' s' : key === 'bpm' ? ' BPM' : key === 'timeSignature' ? '/4' : '';
    settings.push({ label, value: `${value}${unit}${scheduler}` });
  }

  const started = workflow?.createdAt ? Date.parse(String(workflow.createdAt)) : NaN;
  const finished = workflow?.completedAt ? Date.parse(String(workflow.completedAt)) : NaN;
  return {
    texts,
    ...(service ? { service } : {}),
    resources,
    settings,
    ...(typeof workflow?.cost?.total === 'number' ? { cost: workflow.cost.total } : {}),
    ...(Number.isFinite(started) && Number.isFinite(finished) ? { seconds: Math.max(0, Math.round((finished - started) / 1000)) } : {}),
    ...(workflow?.id ? { workflowId: workflow.id } : {}),
  };
}
