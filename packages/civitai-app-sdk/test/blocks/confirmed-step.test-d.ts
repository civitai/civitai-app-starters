/**
 * Compile-time coverage for the confirmed-step surface and the 3D output labels,
 * mirrored from civitai/civitai#5786 (`runConfirmedStepGate.ts`,
 * `blockPassThroughStepBodySchema`, `BlockStepQuote`, `BlockModel3dOutput`).
 *
 * Every positive line below was a compile ERROR before these types existed.
 * The `toEqualTypeOf` pins fail when a field is added, dropped or retyped — in
 * either direction — so the mirror cannot drift quietly.
 *
 * Compiled by `tsc -p tsconfig.typecheck.json` (run by `pnpm test`). Nothing
 * runs at runtime.
 */
import { expectTypeOf } from 'vitest';

import type {
  AppWorkflow,
  BlockModel3dOutput,
  BlockRunConfirmedStepHostError,
  BlockStepQuote,
  BlockToParentMessage,
  BlockWorkflowSnapshot,
  KnownBlockWorkflowErrorCode,
  ParentToBlockMessage,
  WorkflowBody,
  WorkflowBodyPassThroughStep,
} from '../../src/blocks/index.js';

declare const snapshot: BlockWorkflowSnapshot;
declare const row: AppWorkflow;

// --- `quoteId` on the pass-through body: optional (an estimate omits it) ---
expectTypeOf<WorkflowBodyPassThroughStep['quoteId']>().toEqualTypeOf<string | undefined>();
const estimateBody: WorkflowBodyPassThroughStep = {
  kind: 'step',
  $type: 'polyGen',
  input: { prompt: 'a chair' },
  maxBuzz: 250,
};
const runBody: WorkflowBodyPassThroughStep = { ...estimateBody, quoteId: `sq_${'a'.repeat(32)}` };
// Still a member of the union, with or without it — `estimate()` takes both.
const asUnion: WorkflowBody[] = [estimateBody, runBody];
void asUnion;
const numericQuote: WorkflowBodyPassThroughStep = {
  ...estimateBody,
  // @ts-expect-error — `quoteId` is the opaque string handle, never a number.
  quoteId: 42,
};
void numericQuote;

// --- the estimate's quote on the snapshot ---
expectTypeOf(snapshot.stepQuote).toEqualTypeOf<BlockStepQuote | undefined>();
expectTypeOf<BlockStepQuote>().toEqualTypeOf<{
  quoteId: string;
  total: number;
  stepType: string;
  expiresAt: string;
}>();

// --- the message pair ---
expectTypeOf<Extract<BlockToParentMessage, { type: 'RUN_CONFIRMED_STEP' }>['payload']>()
  .toEqualTypeOf<{ requestId: string; body: WorkflowBodyPassThroughStep }>();
expectTypeOf<Extract<ParentToBlockMessage, { type: 'CONFIRMED_STEP_RESULT' }>['payload']>()
  .toEqualTypeOf<{ requestId: string; snapshot?: BlockWorkflowSnapshot; error?: string }>();

// --- the host refusal codes, mirrored exactly (order-insensitive, set-exact) ---
expectTypeOf<BlockRunConfirmedStepHostError>().toEqualTypeOf<
  | 'review-mode'
  | 'block is not ready'
  | 'sign in to run'
  | 'invalid confirmed step request'
  | 'no block token'
  | 'declined'
  | 'daily-limit-exceeded'
  | 'submission-unconfirmed'
>();

// --- `errorCode`: the daily-limit code is a KNOWN one, and the field stays open ---
expectTypeOf<KnownBlockWorkflowErrorCode>().toEqualTypeOf<
  | 'training-quote-rejected'
  | 'training-quote-unavailable'
  | 'training-quote-unpriced'
  | 'daily-limit-exceeded'
  // The multi-step `kind: 'workflow'` codes, from a separate change.
  | 'workflow_step_denied'
  | 'workflow_ref_invalid'
  | 'workflow_too_many_steps'
  | 'workflow_repeat_unbounded'
  | 'workflow_quote_rejected'
  | 'workflow_quote_unavailable'
  | 'workflow_quote_unpriced'
  // The registered-step quote codes, from a separate change.
  | 'step_quote_rejected'
  | 'step_quote_unavailable'
  | 'step_quote_unpriced'
>();
const dailyLimit: BlockWorkflowSnapshot['errorCode'] = 'daily-limit-exceeded';
const futureCode: BlockWorkflowSnapshot['errorCode'] = 'some-code-a-later-host-adds';
void dailyLimit;
void futureCode;

// --- 3D output labels: on the snapshot AND on an app-queue row, same shape ---
expectTypeOf(snapshot.model3dOutputs).toEqualTypeOf<BlockModel3dOutput[] | undefined>();
expectTypeOf(row.model3dOutputs).toEqualTypeOf<BlockModel3dOutput[] | undefined>();
expectTypeOf<BlockModel3dOutput>().toEqualTypeOf<{
  url: string;
  format: string;
  variant: string;
}>();
// Readable by `format` / `variant` with no cast — the documented lookup.
const glb = snapshot.model3dOutputs?.find((m) => m.format === 'glb' && m.variant === 'model');
expectTypeOf(glb).toEqualTypeOf<BlockModel3dOutput | undefined>();
