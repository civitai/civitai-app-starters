/**
 * Compile-time coverage for the App Blocks `kind: 'training'` surface, mirrored
 * from civitai/civitai#5434 (`blockTrainingBodySchema` + the ai-toolkit params
 * schema) and civitai/civitai#5438 (`PREPARE_TRAINING_DATASET`).
 *
 * Every positive line below was a compile ERROR at origin/main (the types did
 * not exist); the `@ts-expect-error` lines pin the parts of the host schema a
 * type CAN express — the strict top-level keys, the required `modelVariant` on
 * the ecosystems that need one, the absent one on those that do not, and the
 * `batchSize: 1` pin.
 *
 * Compiled by `tsc -p tsconfig.typecheck.json` (run by `pnpm test`). Nothing
 * runs at runtime.
 */
import { expectTypeOf } from 'vitest';

import type {
  AiToolkitTrainingParams,
  AiToolkitTrainingParamsBase,
  BlockPrepareTrainingDatasetHostError,
  BlockRunTrainingHostError,
  BlockToParentMessage,
  BlockTrainingDatasetResult,
  BlockTrainingQuote,
  BlockWorkflowSnapshot,
  ParentToBlockMessage,
  WorkflowBody,
  WorkflowBodyTraining,
} from '../../src/blocks/index.js';

const base: AiToolkitTrainingParamsBase = {
  engine: 'ai-toolkit',
  resolution: 1024,
  lr: 0.0001,
  textEncoderLr: null,
  trainTextEncoder: false,
  lrScheduler: 'cosine',
  optimizerType: 'adamw8bit',
  networkDim: 32,
  networkAlpha: 16,
  noiseOffset: null,
  minSnrGamma: null,
  flipAugmentation: false,
  shuffleTokens: false,
  keepTokens: 0,
};
const params: AiToolkitTrainingParams = { ...base, ecosystem: 'sdxl' };

const body: WorkflowBodyTraining = {
  kind: 'training',
  datasetId: `tds_${'a'.repeat(32)}`,
  engine: 'ai-toolkit',
  model: 'sdxl',
  params,
  triggerWord: 'tok',
  samplePrompts: ['a photo of tok'],
};

// --- a member of the WorkflowBody union, so `useBuzzWorkflow().estimate` takes it ---
const asUnion: WorkflowBody = body;
void asUnion;
expectTypeOf<Extract<WorkflowBody, { kind: 'training' }>>().toEqualTypeOf<WorkflowBodyTraining>();

// --- the host body is `.strict()`: no `maxBuzz`, no timeout knob ---
const smuggled: WorkflowBodyTraining = {
  ...body,
  // @ts-expect-error — there is no `maxBuzz` on a training body; the price is the quote.
  maxBuzz: 250,
};
void smuggled;

// --- `quoteId` optional (estimate omits it, run requires it) ---
expectTypeOf<WorkflowBodyTraining['quoteId']>().toEqualTypeOf<string | undefined>();
// --- the only engine ---
expectTypeOf<WorkflowBodyTraining['engine']>().toEqualTypeOf<'ai-toolkit'>();

// --- ecosystem arms ---
// @ts-expect-error — flux1 requires a modelVariant.
const fluxNoVariant: AiToolkitTrainingParams = { ...base, ecosystem: 'flux1' };
void fluxNoVariant;
const fluxDev: AiToolkitTrainingParams = { ...base, ecosystem: 'flux1', modelVariant: 'dev' };
void fluxDev;
// @ts-expect-error — sdxl takes no modelVariant.
const sdxlVariant: AiToolkitTrainingParams = { ...base, ecosystem: 'sdxl', modelVariant: 'dev' };
void sdxlVariant;
// @ts-expect-error — qwen21 pins batchSize to 1.
const qwen21Batch: AiToolkitTrainingParams = { ...base, ecosystem: 'qwen21', batchSize: 2 };
void qwen21Batch;
// @ts-expect-error — an ecosystem the host does not list.
const unknownEco: AiToolkitTrainingParams = { ...base, ecosystem: 'not-an-ecosystem' };
void unknownEco;

// --- the estimate's quote on the snapshot ---
declare const snapshot: BlockWorkflowSnapshot;
expectTypeOf(snapshot.trainingQuote).toEqualTypeOf<BlockTrainingQuote | undefined>();
expectTypeOf<BlockTrainingQuote>().toEqualTypeOf<{
  quoteId: string;
  total: number;
  imageCount: number;
  expiresAt: string;
}>();

// --- the two message pairs ---
expectTypeOf<Extract<BlockToParentMessage, { type: 'PREPARE_TRAINING_DATASET' }>['payload']>()
  .toEqualTypeOf<{ requestId: string; items: Array<{ imageId: number; caption: string }> }>();
expectTypeOf<Extract<BlockToParentMessage, { type: 'RUN_TRAINING' }>['payload']>()
  .toEqualTypeOf<{ requestId: string; body: WorkflowBodyTraining }>();
expectTypeOf<Extract<ParentToBlockMessage, { type: 'TRAINING_DATASET_RESULT' }>['payload']>()
  .toEqualTypeOf<{ requestId: string; result?: BlockTrainingDatasetResult; error?: string }>();
expectTypeOf<Extract<ParentToBlockMessage, { type: 'TRAINING_RESULT' }>['payload']>()
  .toEqualTypeOf<{ requestId: string; snapshot?: BlockWorkflowSnapshot; error?: string }>();

// --- the host refusal codes, mirrored exactly ---
expectTypeOf<BlockRunTrainingHostError>().toEqualTypeOf<
  | 'review-mode'
  | 'block is not ready'
  | 'sign in to train'
  | 'invalid training request'
  | 'no block token'
  | 'declined'
  | 'submission-unconfirmed'
>();
expectTypeOf<BlockPrepareTrainingDatasetHostError>().toEqualTypeOf<
  | 'review-mode'
  | 'block is not ready'
  | 'sign in to train'
  | 'invalid training dataset'
  | 'no block token'
>();
