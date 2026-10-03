/** content-studios' engine-1 input kinds, so a panel can become a studio; `map`, `base` and `image` are panel-only. */
export type PanelInput =
  | { kind: 'text'; label?: string; default?: string; placeholder?: string; maxLen?: number; multiline?: boolean; required?: boolean }
  | { kind: 'choice'; label?: string; options: string[]; default?: string; map?: Record<string, string> }
  | { kind: 'slider'; label?: string; min: number; max: number; step?: number; default?: number }
  | { kind: 'aspect'; label?: string; options: string[]; default?: string; base?: number }
  | { kind: 'count'; label?: string; min?: number; max: number; default?: number }
  | { kind: 'seed'; label?: string; default?: number }
  | { kind: 'toggle'; label?: string; default?: boolean; map?: { on?: string; off?: string } }
  | { kind: 'image'; label?: string; required?: boolean };

export type PanelInputKind = PanelInput['kind'];
export type PanelValue = string | number | boolean;
export type PanelValues = Record<string, PanelValue>;

/** `run_step` arguments (`stepType` + `input`) or `run_workflow` arguments (`steps`), with `{{input}}` placeholders. */
export type PanelRun = Record<string, unknown>;

export interface PanelSpec {
  title: string;
  description?: string;
  inputs: Record<string, PanelInput>;
  /** Rows of input names, top to bottom; inputs left out follow, one per row. */
  layout?: string[][];
  run: PanelRun;
}

export const MAX_INPUTS = 12;
const MAX_TEXT = 2000;
const MAX_COUNT = 8;
const SEED_MAX = 2_147_483_647;
const KEY = /^[A-Za-z_][A-Za-z0-9_]{0,39}$/;
const RESERVED = new Set(['__proto__', 'constructor', 'prototype', 'toString', 'valueOf', 'hasOwnProperty']);
const ASPECT = /^(\d{1,2}):(\d{1,2})$/;
const PLACEHOLDER = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)(?:\.(width|height))?\s*\}\}/g;
const WHOLE = /^\{\{\s*([A-Za-z_][A-Za-z0-9_]*)(?:\.(width|height))?\s*\}\}$/;
const KINDS = new Set<PanelInputKind>(['text', 'choice', 'slider', 'aspect', 'count', 'seed', 'toggle', 'image']);

type Obj = Record<string, unknown>;
const isObj = (value: unknown): value is Obj => typeof value === 'object' && value !== null && !Array.isArray(value);
const isNum = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const optString = (value: unknown, max: number): string | undefined => (typeof value === 'string' && value.trim() ? value.slice(0, max) : undefined);

export type Checked = { spec: PanelSpec; errors?: undefined } | { spec?: undefined; errors: string[] };

/** Checks a definition written by the assistant; errors are worded for it to fix and call again. */
export function checkPanelSpec(raw: unknown): Checked {
  const errors: string[] = [];
  if (!isObj(raw)) return { errors: ['The panel must be an object with title, inputs and run.'] };
  const title = typeof raw.title === 'string' ? raw.title.trim() : '';
  if (!title || title.length > 80) errors.push('title must be 1-80 characters.');

  const inputs: Record<string, PanelInput> = {};
  if (!isObj(raw.inputs) || Object.keys(raw.inputs).length === 0) {
    errors.push('inputs must name at least one control, e.g. {"subject": {"kind": "text", "label": "Subject"}}.');
  } else {
    const keys = Object.keys(raw.inputs);
    if (keys.length > MAX_INPUTS) errors.push(`A panel has at most ${MAX_INPUTS} inputs; keep the ones that matter to the user.`);
    for (const key of keys.slice(0, MAX_INPUTS)) {
      if (!KEY.test(key) || RESERVED.has(key)) {
        errors.push(`Input name "${key}" must start with a letter or "_" and use only letters, digits and "_".`);
        continue;
      }
      const input = checkInput(raw.inputs[key], (message) => errors.push(`inputs.${key}: ${message}`));
      if (input) inputs[key] = input;
    }
  }

  let layout: string[][] | undefined;
  if (raw.layout !== undefined) {
    if (!Array.isArray(raw.layout) || !raw.layout.every((row) => Array.isArray(row) && row.every((key) => typeof key === 'string'))) {
      errors.push('layout must be rows of input names, e.g. [["subject"], ["style", "shape"]].');
    } else {
      layout = (raw.layout as string[][]).map((row) => row.filter((key) => key in inputs)).filter((row) => row.length > 0);
      const unknown = (raw.layout as string[][]).flat().filter((key) => !(key in inputs) && isObj(raw.inputs) && !(key in raw.inputs));
      if (unknown.length) errors.push(`layout names inputs that do not exist: ${unknown.join(', ')}.`);
    }
  }

  const run = raw.run;
  if (!isObj(run) || !((typeof run.stepType === 'string' && isObj(run.input)) || Array.isArray(run.steps))) {
    errors.push('run must be run_step arguments ({"stepType": ..., "input": {...}}) or run_workflow arguments ({"steps": [...]}).');
  } else {
    const used = new Set<string>();
    for (const { key, part } of placeholdersIn(run)) {
      used.add(key);
      const input = inputs[key];
      if (!input) {
        if (!(isObj(raw.inputs) && key in raw.inputs)) errors.push(`run uses {{${key}}}, but there is no input called ${key}.`);
      } else if (part && input.kind !== 'aspect') {
        errors.push(`{{${key}.${part}}} only works on an aspect input.`);
      }
    }
    const unused = Object.keys(inputs).filter((key) => !used.has(key));
    if (unused.length) errors.push(`Inputs ${unused.join(', ')} are not used in run; put {{name}} where each value belongs, or remove them.`);
  }

  if (errors.length) return { errors };
  const description = optString(raw.description, 500);
  return { spec: { title, ...(description ? { description } : {}), inputs, ...(layout ? { layout } : {}), run: run as PanelRun } };
}

function checkInput(raw: unknown, err: (message: string) => void): PanelInput | undefined {
  if (!isObj(raw) || !KINDS.has(raw.kind as PanelInputKind)) {
    err(`kind must be one of ${[...KINDS].join(', ')}.`);
    return undefined;
  }
  const label = optString(raw.label, 60);
  const base = label ? { label } : {};
  switch (raw.kind as PanelInputKind) {
    case 'text': {
      const maxLen = isNum(raw.maxLen) ? Math.min(Math.max(1, Math.round(raw.maxLen)), MAX_TEXT) : 500;
      const placeholder = optString(raw.placeholder, 200);
      return {
        kind: 'text',
        ...base,
        default: typeof raw.default === 'string' ? raw.default.slice(0, maxLen) : '',
        ...(placeholder ? { placeholder } : {}),
        maxLen,
        ...(raw.multiline === true ? { multiline: true } : {}),
        ...(raw.required === true ? { required: true } : {}),
      };
    }
    case 'choice': {
      const options = stringList(raw.options);
      if (options.length < 2 || options.length > 12) {
        err('a choice needs 2 to 12 distinct options.');
        return undefined;
      }
      const map = isObj(raw.map) ? Object.fromEntries(Object.entries(raw.map).filter(([k, v]) => options.includes(k) && typeof v === 'string')) as Record<string, string> : undefined;
      return { kind: 'choice', ...base, options, default: options.includes(raw.default as string) ? (raw.default as string) : options[0]!, ...(map && Object.keys(map).length ? { map } : {}) };
    }
    case 'slider': {
      if (!isNum(raw.min) || !isNum(raw.max) || raw.min >= raw.max) {
        err('a slider needs numbers min < max.');
        return undefined;
      }
      const step = isNum(raw.step) && raw.step > 0 ? raw.step : undefined;
      const fallback = raw.min + (raw.max - raw.min) / 2;
      return { kind: 'slider', ...base, min: raw.min, max: raw.max, ...(step ? { step } : {}), default: clamp(isNum(raw.default) ? raw.default : fallback, raw.min, raw.max) };
    }
    case 'aspect': {
      const options = stringList(raw.options);
      if (options.length < 1 || options.length > 8 || !options.every((option) => ASPECT.test(option))) {
        err('an aspect needs 1 to 8 ratios like "1:1", "2:3", "16:9".');
        return undefined;
      }
      const sizeBase = isNum(raw.base) ? clamp(Math.round(raw.base / 64) * 64, 256, 2048) : undefined;
      return { kind: 'aspect', ...base, options, default: options.includes(raw.default as string) ? (raw.default as string) : options[0]!, ...(sizeBase ? { base: sizeBase } : {}) };
    }
    case 'count': {
      const max = isNum(raw.max) ? clamp(Math.round(raw.max), 1, MAX_COUNT) : 4;
      const min = isNum(raw.min) ? clamp(Math.round(raw.min), 1, max) : 1;
      return { kind: 'count', ...base, min, max, default: clamp(isNum(raw.default) ? Math.round(raw.default) : min, min, max) };
    }
    case 'seed':
      return { kind: 'seed', ...base, default: isNum(raw.default) && raw.default >= 0 ? Math.min(Math.round(raw.default), SEED_MAX) : -1 };
    case 'toggle': {
      const map = isObj(raw.map) ? { ...(typeof raw.map.on === 'string' ? { on: raw.map.on } : {}), ...(typeof raw.map.off === 'string' ? { off: raw.map.off } : {}) } : undefined;
      return { kind: 'toggle', ...base, default: raw.default === true, ...(map && Object.keys(map).length ? { map } : {}) };
    }
    case 'image':
      return { kind: 'image', ...base, ...(raw.required === true ? { required: true } : {}) };
  }
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === 'string' && item.trim() !== '').map((item) => item.slice(0, 60)))];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function placeholdersIn(value: unknown): { key: string; part?: 'width' | 'height' }[] {
  if (typeof value === 'string') return [...value.matchAll(PLACEHOLDER)].map((match) => ({ key: match[1]!, part: match[2] as 'width' | 'height' | undefined }));
  if (Array.isArray(value)) return value.flatMap(placeholdersIn);
  if (isObj(value)) return Object.values(value).flatMap(placeholdersIn);
  return [];
}

export function defaultValue(input: PanelInput): PanelValue {
  switch (input.kind) {
    case 'text':
      return input.default ?? '';
    case 'choice':
    case 'aspect':
      return input.default ?? input.options[0]!;
    case 'slider':
      return input.default ?? input.min;
    case 'count':
      return input.default ?? input.min ?? 1;
    case 'seed':
      return input.default ?? -1;
    case 'toggle':
      return input.default ?? false;
    case 'image':
      return '';
  }
}

/** Every input's value: what was given when it fits the input, a number pulled into range, else the default. */
export function normalizeValues(spec: PanelSpec, given: Record<string, unknown> = {}): PanelValues {
  const values: PanelValues = {};
  for (const [key, input] of Object.entries(spec.inputs)) {
    const value = inRange(input, given[key]);
    values[key] = fits(input, value) ? (value as PanelValue) : defaultValue(input);
  }
  return values;
}

function inRange(input: PanelInput, value: unknown): unknown {
  if (!isNum(value)) return value;
  switch (input.kind) {
    case 'slider':
      return clamp(value, input.min, input.max);
    case 'count':
      return clamp(Math.round(value), input.min ?? 1, input.max);
    case 'seed':
      return value < 0 ? -1 : Math.min(Math.round(value), SEED_MAX);
    default:
      return value;
  }
}

function fits(input: PanelInput, value: unknown): boolean {
  switch (input.kind) {
    case 'text':
      return typeof value === 'string' && value.length <= (input.maxLen ?? 500);
    case 'image':
      return typeof value === 'string';
    case 'choice':
    case 'aspect':
      return typeof value === 'string' && input.options.includes(value);
    case 'slider':
      return isNum(value) && value >= input.min && value <= input.max;
    case 'count':
      return Number.isInteger(value) && (value as number) >= (input.min ?? 1) && (value as number) <= input.max;
    case 'seed':
      return Number.isInteger(value) && (value as number) >= -1 && (value as number) <= SEED_MAX;
    case 'toggle':
      return typeof value === 'boolean';
  }
}

/** Inputs whose value must be filled in before the panel can run. */
export function missingRequired(spec: PanelSpec, values: PanelValues): string[] {
  return Object.entries(spec.inputs)
    .filter(([key, input]) => (input.kind === 'text' || input.kind === 'image') && input.required && String(values[key] ?? '').trim() === '')
    .map(([key, input]) => input.label ?? key);
}

/** Width and height for a ratio at about base×base pixels, in multiples of 64 (as studios size them). */
export function sizeFor(aspect: string, base = 1024): { width: number; height: number } {
  const match = ASPECT.exec(aspect);
  const w = Number(match?.[1] ?? 1) || 1;
  const h = Number(match?.[2] ?? 1) || 1;
  const scale = Math.sqrt((base * base) / (w * h));
  const snap = (n: number) => Math.max(64, Math.round(n / 64) * 64);
  return { width: snap(w * scale), height: snap(h * scale) };
}

/** A seed input left at -1 gets a fresh seed for each run; the run keeps the one it used. */
export function withSeeds(spec: PanelSpec, values: PanelValues, random: () => number): PanelValues {
  const out = { ...values };
  for (const [key, input] of Object.entries(spec.inputs)) {
    if (input.kind === 'seed' && out[key] === -1) out[key] = Math.floor(random() * SEED_MAX);
  }
  return out;
}

/** The run's tool and arguments with every placeholder filled in from the values. */
export function renderRun(spec: PanelSpec, values: PanelValues): { tool: 'run_step' | 'run_workflow'; args: Record<string, unknown> } {
  const valueOf = (key: string, part?: string): unknown => {
    const input = spec.inputs[key];
    const value = values[key];
    if (!input) return '';
    if (input.kind === 'aspect') {
      const size = sizeFor(String(value), input.base);
      return part === 'width' ? size.width : part === 'height' ? size.height : value;
    }
    if (input.kind === 'choice') return input.map?.[String(value)] ?? value;
    if (input.kind === 'toggle' && input.map) return (value ? input.map.on : input.map.off) ?? '';
    return value;
  };
  const fill = (node: unknown): unknown => {
    if (typeof node === 'string') {
      const whole = WHOLE.exec(node);
      if (whole) return valueOf(whole[1]!, whole[2]);
      return node.replace(PLACEHOLDER, (_, key: string, part?: string) => String(valueOf(key, part)));
    }
    if (Array.isArray(node)) {
      // An optional input left empty drops out, and so does a list it emptied.
      const items = node.map(fill).filter((item) => item !== '');
      return items.length === 0 && node.length > 0 ? '' : items;
    }
    if (isObj(node)) return Object.fromEntries(Object.entries(node).map(([key, item]) => [key, fill(item)]).filter(([, item]) => item !== ''));
    return node;
  };
  const args = fill(spec.run) as Record<string, unknown>;
  return { tool: Array.isArray(spec.run.steps) ? 'run_workflow' : 'run_step', args };
}

/** Input rows in display order. */
export function layoutRows(spec: PanelSpec): string[][] {
  const rows = (spec.layout ?? []).map((row) => row.filter((key) => key in spec.inputs)).filter((row) => row.length > 0);
  const placed = new Set(rows.flat());
  return [...rows, ...Object.keys(spec.inputs).filter((key) => !placed.has(key)).map((key) => [key])];
}

/** Applies an assistant's change: inputs merge by name (null removes one), anything else given replaces. */
export function mergeSpec(spec: PanelSpec, patch: Obj): Obj {
  const inputs: Obj = { ...spec.inputs };
  if (isObj(patch.inputs)) {
    for (const [key, input] of Object.entries(patch.inputs)) {
      if (input === null) delete inputs[key];
      else inputs[key] = input;
    }
  }
  return {
    title: patch.title ?? spec.title,
    description: patch.description ?? spec.description,
    inputs,
    layout: Array.isArray(patch.layout) ? patch.layout : spec.layout?.map((row) => row.filter((key) => key in inputs)),
    run: patch.run ?? spec.run,
  };
}
