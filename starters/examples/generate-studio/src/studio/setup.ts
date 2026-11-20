import type { BlockCheckpointInfo, BlockResourceInfo, BlockSourceImage, WorkflowBodyTextToImage } from '@civitai/app-sdk/blocks';

/**
 * The generation SETUP — everything the viewer has chosen — and the ONE function
 * that turns it into a `WorkflowBody`.
 *
 * 🔴 `buildBody` IS THE ONLY PLACE A BODY IS BUILT (gotcha #59). The estimate
 * effect and the submit both call it with the same setup, so the price on the
 * Generate button is the price of exactly what the click sends. A second builder
 * — say one that drops the seed for the estimate — is how a quote and a charge
 * drift apart.
 */

/** Server bounds the host enforces before any spend (`blockWorkflowBodySchema`). */
export const MAX_LORAS = 5;
export const LORA_STRENGTH_MIN = -1;
export const LORA_STRENGTH_MAX = 2;
export const STEPS_MIN = 1;
export const STEPS_MAX = 50;
export const CFG_MIN = 1;
export const CFG_MAX = 30;
export const QUANTITY_MAX = 4;

/**
 * A page slot carries NO model (its context is `entityType: 'none'`), so a page
 * app needs a checkpoint that works at first paint, before anyone opens a picker.
 * SDXL 1.0 — the same public default the `civitai app init` page template uses.
 * The ids are a HINT: the server re-validates and re-prices them on every call.
 */
export const DEFAULT_CHECKPOINT: BlockCheckpointInfo = {
  versionId: 128078,
  modelId: 101055,
  // Display only, and only until the viewer picks: a real pick carries the
  // host's own names.
  modelName: 'SD XL 1.0',
  versionName: '',
  baseModel: 'SDXL 1.0',
};

/** A LoRA layered on the checkpoint, with the weight the viewer chose. */
export interface LoraChoice {
  resource: BlockResourceInfo;
  strength: number;
  /**
   * The family we ASKED the picker for (the checkpoint's `baseModel` at the time).
   * The host collapses a family to an ecosystem and returns picks carrying their
   * OWN `baseModel` (ask for `SDXL 1.0`, get back `SDXL Turbo`), so this — not
   * `resource.baseModel` — is what can be compared against a later checkpoint.
   */
  requestedFamily: string;
}

export const SIZES = {
  square: { width: 1024, height: 1024, label: 'Square' },
  portrait: { width: 832, height: 1216, label: 'Portrait' },
  landscape: { width: 1216, height: 832, label: 'Landscape' },
} as const;
export type SizeKey = keyof typeof SIZES;

export interface Setup {
  checkpoint: BlockCheckpointInfo;
  loras: LoraChoice[];
  /** img2img = the same body plus a `sourceImage`. Page apps only (refused on a model-slot token). */
  mode: 'txt2img' | 'img2img';
  /** Kept while the viewer flips modes; only SENT in img2img mode. */
  sourceImage: BlockSourceImage | null;
  prompt: string;
  negativePrompt: string;
  size: SizeKey;
  steps: number;
  cfgScale: number;
  quantity: number;
  /** `null` = a fresh random seed per run (the key is OMITTED from the body). */
  seed: number | null;
}

export const INITIAL_SETUP: Setup = {
  checkpoint: DEFAULT_CHECKPOINT,
  loras: [],
  mode: 'txt2img',
  sourceImage: null,
  prompt: 'a lighthouse on a cliff at dusk, volumetric light, detailed',
  negativePrompt: '',
  size: 'square',
  steps: 25,
  cfgScale: 7,
  quantity: 1,
  seed: null,
};

/** `null` when the setup cannot be sent yet (img2img with no image). */
export function buildBody(setup: Setup): WorkflowBodyTextToImage | null {
  const source = setup.mode === 'img2img' ? setup.sourceImage : null;
  if (setup.mode === 'img2img' && !source) return null;
  if (!setup.prompt.trim()) return null;
  const size = SIZES[setup.size];
  return {
    kind: 'textToImage',
    modelId: setup.checkpoint.modelId,
    modelVersionId: setup.checkpoint.versionId,
    // Omit the key entirely when there are none: a checkpoint-only body.
    ...(setup.loras.length
      ? {
          additionalResources: setup.loras.map((l) => ({
            modelVersionId: l.resource.versionId,
            strength: clamp(l.strength, LORA_STRENGTH_MIN, LORA_STRENGTH_MAX),
          })),
        }
      : {}),
    // The SINGULAR field, on purpose: it works on every host, and for one image a
    // 1-element `sourceImages` is byte-identical server-side. A host predating
    // civitai/civitai#3518 silently STRIPS `sourceImages` and bills a plain
    // txt2img. Never send both: that is rejected as ambiguous.
    ...(source ? { sourceImage: source } : {}),
    params: {
      prompt: setup.prompt,
      ...(setup.negativePrompt.trim() ? { negativePrompt: setup.negativePrompt } : {}),
      steps: clamp(Math.round(setup.steps), STEPS_MIN, STEPS_MAX),
      cfgScale: clamp(setup.cfgScale, CFG_MIN, CFG_MAX),
      quantity: clamp(Math.round(setup.quantity), 1, QUANTITY_MAX),
      // img2img: the source image's own width/height drive the graph's
      // aspect derivation, so the body names no output size of its own.
      ...(source ? {} : { width: round64(size.width), height: round64(size.height) }),
      // Omitted = random. The SAME decision reaches the estimate and the submit.
      ...(setup.seed === null ? {} : { seed: setup.seed }),
    },
  };
}

/**
 * Drop the LoRAs a new checkpoint cannot take. Leaving them on the body would
 * make the server reject the next estimate with nothing on screen saying why.
 * Exact-match on the family we asked for: conservative (it can drop a LoRA the
 * server would have accepted), never permissive.
 */
export function keepCompatibleLoras(
  loras: LoraChoice[],
  checkpointBaseModel: string,
): { kept: LoraChoice[]; dropped: LoraChoice[] } {
  const kept: LoraChoice[] = [];
  const dropped: LoraChoice[] = [];
  for (const l of loras) (l.requestedFamily === checkpointBaseModel ? kept : dropped).push(l);
  return { kept, dropped };
}

/** A pick's recommended weight, clamped to both the resource's and the server's bounds. */
export function defaultStrength(r: BlockResourceInfo): number {
  const lo = Math.max(r.minStrength ?? LORA_STRENGTH_MIN, LORA_STRENGTH_MIN);
  const hi = Math.min(r.maxStrength ?? LORA_STRENGTH_MAX, LORA_STRENGTH_MAX);
  return clamp(r.strength ?? 1, lo, hi);
}

/** Round to the nearest multiple of 64 — the orchestrator rejects other dims (gotcha #19). */
export function round64(n: number): number {
  return Math.max(64, Math.round(n / 64) * 64);
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
