/**
 * Compile-time coverage for the App Blocks `kind: 'training'` surface, mirrored
 * from civitai/civitai#5434 (`blockTrainingBodySchema` + the ai-toolkit params
 * schema) and civitai/civitai#6461 (the dataset is the blobs the page host
 * uploaded: `items: [{ air, caption }]`, uploaded through
 * `OPEN_IMAGE_UPLOAD { purpose: 'trainingData' }`).
 *
 * The `items` / upload-purpose / multi-image-result / new-host-code lines were
 * compile ERRORS on the `datasetId` contract this replaced; the
 * `@ts-expect-error` lines pin the parts of the host schema a type CAN express —
 * the strict top-level keys, the removed `datasetId`, the required
 * `modelVariant` on the ecosystems that need one, the absent one on those that
 * do not, and the `batchSize: 1` pin — and that the removed
 * `PREPARE_TRAINING_DATASET` pair is gone from both message unions.
 *
 * Compiled by `tsc -p tsconfig.typecheck.json` (run by `pnpm test`). Nothing
 * runs at runtime.
 */
import { expectTypeOf } from 'vitest';

import type {
  AiToolkitTrainingParams,
  AiToolkitTrainingParamsBase,
  BlockRunTrainingHostError,
  BlockToParentMessage,
  BlockTrainingDataImage,
  BlockTrainingDataUploadResult,
  BlockTrainingDatasetItem,
  BlockTrainingQuote,
  BlockUploadPurpose,
  BlockWorkflowSnapshot,
  ParentToBlockMessage,
  WorkflowBody,
  WorkflowBodyTraining,
} from '../../src/blocks/index.js';
import { BLOCK_TRAINING_CAPTION_MAX_CHARS } from '../../src/blocks/index.js';

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
  items: [{ air: 'k1a2b3.png', caption: 'one' }],
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

// --- the dataset is uploaded blobs with captions ---
expectTypeOf<WorkflowBodyTraining['items']>().toEqualTypeOf<BlockTrainingDatasetItem[]>();
expectTypeOf<BlockTrainingDatasetItem>().toEqualTypeOf<{ air: string; caption: string }>();

// --- `datasetId` is gone: a body still naming one does not compile ---
const legacy: WorkflowBodyTraining = {
  ...body,
  // @ts-expect-error — the server-prepared dataset handle was removed; send `items`.
  datasetId: `tds_${'a'.repeat(32)}`,
};
void legacy;

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

// --- the host's caption bound (civitai/civitai#6461 raised it to 8,192) ---
expectTypeOf(BLOCK_TRAINING_CAPTION_MAX_CHARS).toEqualTypeOf<8192>();

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

// --- the upload: a `trainingData` purpose, answered with several images ---
expectTypeOf<'trainingData'>().toMatchTypeOf<BlockUploadPurpose>();
expectTypeOf<BlockUploadPurpose>().toEqualTypeOf<'display' | 'generationSource' | 'trainingData'>();
expectTypeOf<BlockTrainingDataImage>().toEqualTypeOf<{ url: string; air: string }>();
expectTypeOf<BlockTrainingDataUploadResult>().toEqualTypeOf<{ images: BlockTrainingDataImage[] }>();
const trainingUpload: Extract<BlockToParentMessage, { type: 'OPEN_IMAGE_UPLOAD' }> = {
  type: 'OPEN_IMAGE_UPLOAD',
  payload: { requestId: 'r1', purpose: 'trainingData' },
};
void trainingUpload;
const uploaded: Extract<ParentToBlockMessage, { type: 'IMAGE_UPLOAD_RESULT' }> = {
  type: 'IMAGE_UPLOAD_RESULT',
  payload: {
    requestId: 'r1',
    selected: { images: [{ url: 'https://example.test/v2/consumer/blobs/k1a2b3.png', air: 'k1a2b3.png' }] },
  },
};
void uploaded;

// --- the run pair; the removed dataset pair is not in either union ---
expectTypeOf<Extract<BlockToParentMessage, { type: 'RUN_TRAINING' }>['payload']>()
  .toEqualTypeOf<{ requestId: string; body: WorkflowBodyTraining }>();
expectTypeOf<Extract<ParentToBlockMessage, { type: 'TRAINING_RESULT' }>['payload']>()
  .toEqualTypeOf<{ requestId: string; snapshot?: BlockWorkflowSnapshot; error?: string }>();
expectTypeOf<Extract<BlockToParentMessage, { type: 'PREPARE_TRAINING_DATASET' }>>().toBeNever();
expectTypeOf<Extract<ParentToBlockMessage, { type: 'TRAINING_DATASET_RESULT' }>>().toBeNever();

// --- the host refusal codes, mirrored exactly (civitai/civitai `RUN_TRAINING_HOST_ERRORS`) ---
expectTypeOf<BlockRunTrainingHostError>().toEqualTypeOf<
  | 'review-mode'
  | 'block is not ready'
  | 'sign in to train'
  | 'invalid training request'
  | 'no block token'
  | 'training data not uploaded here'
  | 'declined'
  | 'submission-unconfirmed'
>();
