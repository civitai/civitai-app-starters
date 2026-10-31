/**
 * `checkComfyGraph` — can this workflow file run as an inline `customComfy`
 * graph? A pure, offline check an app runs on a {@link BlockResourceFileEntry}
 * before it offers "Run", so a graph that is certain to fail is refused before
 * any Buzz is spent rather than after.
 *
 * It answers from the file alone. `runnable: true` means none of the known
 * blockers below is present — not that the job will succeed: the worker image
 * still decides which nodes exist, and the host still runs its own gates (AIR
 * containment, entitlement, moderation) on the body you submit. The core-node
 * list is pinned to a ComfyUI commit, not to the worker's ComfyUI version, so it
 * can name classes newer than the worker has.
 *
 * 🔴 A Comfy estimate is a CEILING, never a price. `estimate` on a
 * `customComfy` body returns the `maxBuzz` you declared as `cost.total`, and
 * billing settles to the real GPU time afterwards. Show it as "up to N Buzz".
 */
import {
  COMFY_CORE_NODE_CLASSES,
  COMFY_MODEL_FILE_EXTENSIONS,
} from './comfyCoreNodes.generated.js';
import {
  BLOCK_INLINE_COMFY_MAX_GRAPH_BYTES,
  BLOCK_INLINE_COMFY_MAX_NODES,
  type BlockResourceFileEntry,
  type BlockResourceFileEntryFormat,
} from './types.js';

/**
 * Node classes that exist only in the ComfyUI editor and are dropped when a
 * graph is exported to API format. Allowed in a UI graph's node list; an
 * API-format graph never contains them, and a `class_type` naming one is not a
 * class the ComfyUI server can run, so in an API graph it counts as custom.
 */
export const COMFY_FRONTEND_ONLY_NODE_CLASSES: readonly string[] = [
  'MarkdownNote',
  'Note',
  'PrimitiveNode',
  'Reroute',
];

/** The pack id ComfyUI writes into `properties.cnr_id` for its own nodes. */
const CORE_PACK_ID = 'comfy-core';

/**
 * Model-file extensions: ComfyUI's own list at the pinned commit, plus `.gguf`
 * (quantised weights, loaded by the GGUF loader packs).
 */
const MODEL_FILE_EXTENSIONS: readonly string[] = [...COMFY_MODEL_FILE_EXTENSIONS, '.gguf'];

/**
 * An input that names a model: `*_name` with an optional number (`ckpt_name`,
 * `unet_name`, `lora_name`, `vae_name`, `clip_name`, `clip_name2`,
 * `control_net_name`, `style_model_name`, `model_name`, …), plus the two core
 * loader inputs that do not follow that pattern, plus two whose names are too
 * generic to match on any class and so count only on the class that loads by them.
 */
const MODEL_INPUT_NAME = /_name\d*$/;
const MODEL_INPUT_NAMES_EXTRA: readonly string[] = ['model_file', 'text_encoder'];
const MODEL_INPUT_NAMES_BY_CLASS: Readonly<Record<string, readonly string[]>> = {
  ModelPatchLoader: ['name'],
  TrainLoraNode: ['existing_lora'],
};

const CORE = new Set(COMFY_CORE_NODE_CLASSES);
const FRONTEND_ONLY = new Set(COMFY_FRONTEND_ONLY_NODE_CLASSES);

/** A loader input that holds a model filename where the worker needs an AIR. */
export interface ComfyModelFilenameInput {
  /** The node's key in the API graph. */
  nodeId: string;
  classType: string;
  /** The input name, e.g. `'ckpt_name'`. */
  input: string;
  /** The filename it holds, e.g. `'sd_xl_base_1.0.safetensors'`. */
  value: string;
}

/**
 * Why a graph cannot run inline. A CLOSED set: switch on `code`.
 *
 * - `not-api-format` — the entry is a UI (editor) graph or an unknown JSON, not
 *   ComfyUI's API format. Only API format can be submitted, and the SDK does
 *   not convert. When this fires, `model-filenames`, `too-many-nodes` and
 *   `too-large` are not checked (they are defined on the API graph).
 * - `custom-nodes` — node classes outside the core list pinned in
 *   `comfyCoreNodes.generated.ts`, sorted and de-duplicated. `packs` lists the
 *   `properties.cnr_id` pack ids those nodes carry, when the file has them
 *   (UI graphs do; API graphs carry none, so `packs` is empty there). Checked
 *   on API and UI graphs. Custom node packs are disabled on the inline path.
 * - `model-filenames` — loader inputs that hold a model filename (ending in a
 *   model-file extension) instead of an AIR (`urn:air:…`). The worker
 *   downloads only declared AIRs, so a filename cannot load.
 * - `too-many-nodes` — more than {@link BLOCK_INLINE_COMFY_MAX_NODES} nodes.
 * - `too-large` — the graph as it would be sent (each node reduced to
 *   `class_type` + `inputs`) is longer than
 *   {@link BLOCK_INLINE_COMFY_MAX_GRAPH_BYTES} when serialized.
 */
export type ComfyGraphRefusal =
  | { code: 'not-api-format'; format: BlockResourceFileEntryFormat }
  | { code: 'custom-nodes'; classes: string[]; packs: string[] }
  | { code: 'model-filenames'; inputs: ComfyModelFilenameInput[] }
  | { code: 'too-many-nodes'; nodes: number; max: number }
  | { code: 'too-large'; bytes: number; max: number };

/**
 * The verdict of {@link checkComfyGraph}. `reasons` is never empty and is in
 * the order the codes are listed on {@link ComfyGraphRefusal}.
 *
 * Runnable or not, a Comfy estimate is a ceiling (your `maxBuzz`), never a price.
 */
export type ComfyGraphCheck =
  | { runnable: true }
  | { runnable: false; reasons: ComfyGraphRefusal[] };

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** The host's own API-format test (`detectGraphFormat` in civitai). */
function isApiGraph(graph: unknown): graph is Record<string, { class_type: unknown; inputs: unknown }> {
  if (!isObj(graph)) return false;
  const values = Object.values(graph);
  return values.length > 0 && values.every((v) => isObj(v) && 'class_type' in v && 'inputs' in v);
}

function isAir(value: string): boolean {
  return /^urn:air:/i.test(value.trim());
}

function isModelFilename(value: string): boolean {
  if (isAir(value)) return false;
  const v = value.trim().toLowerCase();
  return MODEL_FILE_EXTENSIONS.some((ext) => v.endsWith(ext));
}

function isModelInput(classType: string, name: string): boolean {
  return (
    MODEL_INPUT_NAME.test(name) ||
    MODEL_INPUT_NAMES_EXTRA.includes(name) ||
    (Object.hasOwn(MODEL_INPUT_NAMES_BY_CLASS, classType) &&
      MODEL_INPUT_NAMES_BY_CLASS[classType]!.includes(name))
  );
}

function customNodes(classes: Set<string>, packs: Set<string>): ComfyGraphRefusal | null {
  if (classes.size === 0) return null;
  packs.delete(CORE_PACK_ID);
  return { code: 'custom-nodes', classes: [...classes].sort(), packs: [...packs].sort() };
}

/** UI graph: the node lists of the graph and of every subgraph definition. */
function uiCustomNodes(graph: unknown): ComfyGraphRefusal | null {
  if (!isObj(graph)) return null;
  const lists: unknown[] = [graph.nodes];
  const subgraphIds = new Set<string>();
  const defs = graph.definitions;
  if (isObj(defs) && Array.isArray(defs.subgraphs)) {
    for (const sg of defs.subgraphs) {
      if (!isObj(sg)) continue;
      if (typeof sg.id === 'string') subgraphIds.add(sg.id);
      lists.push(sg.nodes);
    }
  }
  const classes = new Set<string>();
  const packs = new Set<string>();
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const node of list) {
      if (!isObj(node) || typeof node.type !== 'string') continue;
      const type = node.type;
      // A subgraph instance's `type` is its definition's id; its nodes are walked above.
      if (CORE.has(type) || FRONTEND_ONLY.has(type) || subgraphIds.has(type)) continue;
      classes.add(type);
      const props = node.properties;
      if (isObj(props) && typeof props.cnr_id === 'string' && props.cnr_id !== '') {
        packs.add(props.cnr_id);
      }
    }
  }
  return customNodes(classes, packs);
}

/**
 * Check whether a parsed workflow file entry (what `useResourceFile` returns per
 * entry) can run as an inline `customComfy` graph, before any spend.
 *
 * Pure and synchronous: it reads `format` and `graph` and nothing else, and
 * never mutates them. `runnable: true` means no known blocker was found, not
 * that the job will succeed. A Comfy estimate is a ceiling, never a price.
 *
 * @example
 * ```ts
 * const check = checkComfyGraph(entry);
 * if (!check.runnable) {
 *   for (const reason of check.reasons) {
 *     if (reason.code === 'custom-nodes') console.warn('needs packs', reason.packs);
 *   }
 * }
 * ```
 */
export function checkComfyGraph(
  entry: Pick<BlockResourceFileEntry, 'format' | 'graph'>,
): ComfyGraphCheck {
  const { graph } = entry;
  const reasons: ComfyGraphRefusal[] = [];

  if (entry.format !== 'api' || !isApiGraph(graph)) {
    reasons.push({ code: 'not-api-format', format: entry.format === 'api' ? 'unknown' : entry.format });
    const custom = entry.format === 'ui' ? uiCustomNodes(graph) : null;
    if (custom) reasons.push(custom);
    return { runnable: false, reasons };
  }

  const ids = Object.keys(graph);
  const classes = new Set<string>();
  const filenames: ComfyModelFilenameInput[] = [];
  const wire: Record<string, { class_type: unknown; inputs: unknown }> = {};
  for (const nodeId of ids) {
    const node = graph[nodeId] as { class_type: unknown; inputs: unknown };
    wire[nodeId] = { class_type: node.class_type, inputs: node.inputs };
    const classType = typeof node.class_type === 'string' ? node.class_type : String(node.class_type);
    if (!CORE.has(classType)) classes.add(classType);
    if (!isObj(node.inputs)) continue;
    for (const [input, value] of Object.entries(node.inputs)) {
      if (typeof value === 'string' && isModelInput(classType, input) && isModelFilename(value)) {
        filenames.push({ nodeId, classType, input, value });
      }
    }
  }

  const custom = customNodes(classes, new Set());
  if (custom) reasons.push(custom);
  if (filenames.length > 0) reasons.push({ code: 'model-filenames', inputs: filenames });
  if (ids.length > BLOCK_INLINE_COMFY_MAX_NODES) {
    reasons.push({ code: 'too-many-nodes', nodes: ids.length, max: BLOCK_INLINE_COMFY_MAX_NODES });
  }
  const bytes = JSON.stringify(wire).length;
  if (bytes > BLOCK_INLINE_COMFY_MAX_GRAPH_BYTES) {
    reasons.push({ code: 'too-large', bytes, max: BLOCK_INLINE_COMFY_MAX_GRAPH_BYTES });
  }

  return reasons.length === 0 ? { runnable: true } : { runnable: false, reasons };
}
