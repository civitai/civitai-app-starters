/**
 * Compile-time coverage for the `BlockWorkflowSnapshot` fields the host emits
 * and the SDK did not mirror until #524 — `modelSubstitutions`, `textOutputs`,
 * `textOutputWithheld`, `toolCalls`, `stepOutputs` — plus the training-publish
 * pair `trainedEpochs` / `publishedModel` (both on `AppWorkflow` too).
 *
 * The closing condition of #524 is that `snapshot.textOutputs` type-checks with
 * NO cast. Every read below is a plain property access on the published type;
 * before the widening each one was `Property '…' does not exist`.
 *
 * Compiled by `tsc -p tsconfig.typecheck.json` (run by `pnpm test`). Nothing
 * runs at runtime.
 */
import { expectTypeOf } from 'vitest';

import type {
  AppWorkflow,
  BlockModelSubstitution,
  BlockPublishedModel,
  BlockStepToolCall,
  BlockTrainedEpoch,
  BlockWorkflowSnapshot,
  ModelSubstitutionReason,
} from '../../src/blocks/index.js';

declare const snapshot: BlockWorkflowSnapshot;
declare const row: AppWorkflow;

// --- the five host fields, each OPTIONAL and readable without a cast ---
expectTypeOf(snapshot.modelSubstitutions).toEqualTypeOf<BlockModelSubstitution[] | undefined>();
expectTypeOf(snapshot.textOutputs).toEqualTypeOf<string[] | undefined>();
expectTypeOf(snapshot.textOutputWithheld).toEqualTypeOf<{ reason: string } | undefined>();
expectTypeOf(snapshot.toolCalls).toEqualTypeOf<BlockStepToolCall[] | undefined>();
expectTypeOf(snapshot.stepOutputs).toEqualTypeOf<
  Array<{ $type: string; output: unknown }> | undefined
>();

// --- their element shapes, pinned to the host's declarations ---
expectTypeOf<ModelSubstitutionReason>().toEqualTypeOf<
  'wrong-workflow' | 'unrecognized' | 'gated'
>();
expectTypeOf<BlockModelSubstitution>().toEqualTypeOf<{
  requested: number;
  applied: number;
  reason: ModelSubstitutionReason;
}>();
expectTypeOf<BlockStepToolCall>().toEqualTypeOf<{
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}>();

// --- the training-publish pair ---
expectTypeOf(snapshot.trainedEpochs).toEqualTypeOf<BlockTrainedEpoch[] | undefined>();
expectTypeOf<BlockTrainedEpoch>().toEqualTypeOf<{
  $type: 'training' | 'imageResourceTraining';
  epochNumber: number;
}>();
expectTypeOf(snapshot.publishedModel).toEqualTypeOf<BlockPublishedModel | undefined>();
expectTypeOf(row.publishedModel).toEqualTypeOf<BlockPublishedModel | undefined>();
expectTypeOf(row.trainedEpochs).toEqualTypeOf<BlockTrainedEpoch[] | undefined>();
expectTypeOf<BlockPublishedModel>().toEqualTypeOf<{
  modelId: number;
  modelVersionId: number;
  published: boolean;
}>();

// --- all OPTIONAL: a snapshot / row from a host that predates them still assigns ---
const minimal: BlockWorkflowSnapshot = { workflowId: 'wf', status: 'pending' };
const minimalRow: AppWorkflow = {
  workflowId: 'wf',
  status: 'succeeded',
  images: [],
  cost: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};
void minimal;
void minimalRow;

// --- a full snapshot the host can emit assigns ---
const full: BlockWorkflowSnapshot = {
  workflowId: 'wf',
  status: 'succeeded',
  modelSubstitutions: [{ requested: 1, applied: 2, reason: 'gated' }],
  textOutputs: ['hello'],
  textOutputWithheld: { reason: 'withheld' },
  toolCalls: [{ id: 'c1', type: 'function', function: { name: 'f', arguments: '{}' } }],
  stepOutputs: [{ $type: 'echo', output: { anything: true } }],
  trainedEpochs: [{ $type: 'training', epochNumber: 1 }],
  publishedModel: { modelId: 1, modelVersionId: 2, published: false },
};
void full;

// --- a full AppWorkflow row the host can emit assigns ---
const fullRow: AppWorkflow = {
  workflowId: 'wf',
  status: 'succeeded',
  images: [],
  cost: 250,
  createdAt: '2026-01-01T00:00:00.000Z',
  publishedModel: { modelId: 1, modelVersionId: 2, published: true },
  trainedEpochs: [{ $type: 'imageResourceTraining', epochNumber: 3 }],
};
void fullRow;

// --- the literal unions reject what the host never emits (gate: MUST be type errors) ---
const badEpoch: BlockTrainedEpoch = {
  // @ts-expect-error — only the two pass-through training `$type`s produce epochs.
  $type: 'imageGen',
  epochNumber: 1,
};
void badEpoch;

const badRowEpoch: AppWorkflow = {
  workflowId: 'wf',
  status: 'succeeded',
  images: [],
  cost: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  // @ts-expect-error — a row's epochs are the same BlockTrainedEpoch shape, not bare numbers.
  trainedEpochs: [1, 2],
};
void badRowEpoch;

const badToolCall: BlockStepToolCall = {
  id: 'c1',
  // @ts-expect-error — the host emits only `'function'` tool calls.
  type: 'retrieval',
  function: { name: 'f', arguments: '{}' },
};
void badToolCall;
