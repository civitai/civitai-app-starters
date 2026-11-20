/**
 * Compile-time coverage for `accountType` — the Buzz pool tried first — on the
 * two `kind: 'step'` arms and the `kind: 'workflow'` body, mirroring
 * civitai/civitai's step and multi-step schemas. Each is OPTIONAL, typed as the
 * block-facing `BuzzAccountType`, and a pool outside it is a type error.
 *
 * Compiled by `tsc -p tsconfig.typecheck.json` (the `test:types` script). Nothing
 * runs at runtime.
 */
import { expectTypeOf } from 'vitest';

import type {
  BuzzAccountType,
  WorkflowBody,
  WorkflowBodyPassThroughStep,
  WorkflowBodyStep,
  WorkflowBodyWorkflow,
  WorkflowBodyWorkflowStep,
} from '../../src/blocks/types.js';

// --- the field is optional and typed as BuzzAccountType on all three bodies ---
expectTypeOf<WorkflowBodyStep['accountType']>().toEqualTypeOf<BuzzAccountType | undefined>();
expectTypeOf<WorkflowBodyPassThroughStep['accountType']>().toEqualTypeOf<
  BuzzAccountType | undefined
>();
expectTypeOf<WorkflowBodyWorkflow['accountType']>().toEqualTypeOf<BuzzAccountType | undefined>();

// --- a pick rides on each body as a WorkflowBody (what submit/estimate accept) ---
const registered: WorkflowBody = {
  kind: 'step',
  step: 'convert-image',
  params: { image: 'https://image.civitai.com/a.jpeg' },
  accountType: 'green',
};
const passThrough: WorkflowBody = {
  kind: 'step',
  $type: 'imageBackgroundRemoval',
  input: { image: 'https://image.civitai.com/a.jpeg' },
  maxBuzz: 10,
  accountType: 'yellow',
};
const multiStep: WorkflowBody = {
  kind: 'workflow',
  steps: [{ $type: 'imageBackgroundRemoval', input: {} }],
  accountType: 'blue',
};
declare function submitLike(body: WorkflowBody): void;
submitLike(registered);
submitLike(passThrough);
submitLike(multiStep);

// --- omitting it still type-checks (the host's default order) ---
const noPick: WorkflowBody = {
  kind: 'step',
  $type: 'imageBackgroundRemoval',
  input: {},
  maxBuzz: 10,
};
submitLike(noPick);

// --- a pool outside BuzzAccountType is a type error on every body ---
const redRegistered: WorkflowBodyStep = {
  kind: 'step',
  step: 'convert-image',
  params: {},
  // @ts-expect-error 'red' is a platform-internal pool, not a block-facing BuzzAccountType
  accountType: 'red',
};
const redPassThrough: WorkflowBodyPassThroughStep = {
  kind: 'step',
  $type: 'imageBackgroundRemoval',
  input: {},
  maxBuzz: 10,
  // @ts-expect-error 'red' is a platform-internal pool, not a block-facing BuzzAccountType
  accountType: 'red',
};
const redWorkflow: WorkflowBodyWorkflow = {
  kind: 'workflow',
  steps: [],
  // @ts-expect-error 'red' is a platform-internal pool, not a block-facing BuzzAccountType
  accountType: 'red',
};
void redRegistered;
void redPassThrough;
void redWorkflow;

// --- the pick is per WORKFLOW: a workflow STEP has no accountType ---
const stepWithPick: WorkflowBodyWorkflowStep = {
  $type: 'imageBackgroundRemoval',
  input: {},
  // @ts-expect-error a workflow step cannot name its own pool
  accountType: 'green',
};
void stepWithPick;
