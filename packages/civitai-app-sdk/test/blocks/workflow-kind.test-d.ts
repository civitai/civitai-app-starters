/**
 * Compile-time coverage for the multi-step `kind: 'workflow'` body
 * (`WorkflowBodyWorkflow`), its reference type, and the per-step snapshot.
 *
 * Every positive line below was a compile ERROR before the kind existed; the
 * `@ts-expect-error` lines pin what the type can express about the contract:
 * no `maxBuzz`, a required `$type` and `input` per step, a reference that needs
 * both `$ref` and `path`, and a closed per-step status.
 *
 * Compiled by `tsc -p tsconfig.typecheck.json` (run by `pnpm test`). Nothing
 * runs at runtime.
 */
import { expectTypeOf } from 'vitest';

import type {
  BlockToParentMessage,
  BlockWorkflowSnapshot,
  BlockWorkflowStepSnapshot,
  WithWorkflowStepRefs,
  WorkflowBody,
  WorkflowBodyWorkflow,
  WorkflowBodyWorkflowStep,
  WorkflowStepRef,
} from '../../src/blocks/index.js';
import { BLOCK_WORKFLOW_MAX_STEPS } from '../../src/blocks/index.js';

// --- the member is in the union, extracted by its discriminant ---
expectTypeOf<Extract<WorkflowBody, { kind: 'workflow' }>>().toEqualTypeOf<WorkflowBodyWorkflow>();
expectTypeOf<WorkflowBodyWorkflow['steps']>().toEqualTypeOf<WorkflowBodyWorkflowStep[]>();
expectTypeOf<WorkflowBodyWorkflow['arguments']>().toEqualTypeOf<
  Record<string, unknown> | undefined
>();
expectTypeOf<typeof BLOCK_WORKFLOW_MAX_STEPS>().toEqualTypeOf<8>();

// --- a two-step body: an image step whose output the second step consumes ---
const chained: WorkflowBody = {
  kind: 'workflow',
  arguments: { prompt: 'a lighthouse at dusk' },
  steps: [
    {
      name: 'draw',
      $type: 'imageGen',
      input: {
        engine: 'google',
        model: 'nano-banana-2',
        prompt: { $ref: '$arguments', path: 'prompt' },
      },
      suppressOutput: true,
    },
    {
      $type: 'imageBackgroundRemoval',
      // By name, with the optional reference fields.
      input: {
        image: { $ref: 'draw', path: 'output.images[0].url', default: null, format: '{0}' },
      },
    },
  ],
};
void chained;

// --- the smallest body: one step, no name, no arguments ---
const single: WorkflowBody = { kind: 'workflow', steps: [{ $type: 'echo', input: {} }] };
void single;

// --- it rides the existing messages: no new message type ---
const submit: BlockToParentMessage = {
  type: 'SUBMIT_WORKFLOW',
  payload: { requestId: 'r1', body: chained },
};
const batch: BlockToParentMessage = {
  type: 'ESTIMATE_WORKFLOW_BATCH',
  payload: { requestId: 'r2', bodies: [chained, single] },
};
void submit;
void batch;

// --- per-step optionality ---
expectTypeOf<WorkflowBodyWorkflowStep['name']>().toEqualTypeOf<string | undefined>();
expectTypeOf<WorkflowBodyWorkflowStep['suppressOutput']>().toEqualTypeOf<boolean | undefined>();
expectTypeOf<WorkflowBodyWorkflowStep['input']>().toEqualTypeOf<Record<string, unknown>>();

const withMaxBuzz: WorkflowBody = {
  kind: 'workflow',
  steps: [{ $type: 'echo', input: {} }],
  // @ts-expect-error — this kind has no `maxBuzz`; the ceiling is host-enforced
  maxBuzz: 10,
};
void withMaxBuzz;

// @ts-expect-error — `steps` is required
const noSteps: WorkflowBody = { kind: 'workflow' };
void noSteps;

// @ts-expect-error — a step needs its `input`
const noInput: WorkflowBodyWorkflowStep = { $type: 'echo' };
void noInput;

// @ts-expect-error — a step needs its `$type`
const noType: WorkflowBodyWorkflowStep = { input: {} };
void noType;

// --- the reference type ---
expectTypeOf<WorkflowStepRef['path']>().toEqualTypeOf<string>();
expectTypeOf<WorkflowStepRef['format']>().toEqualTypeOf<string | undefined>();
const byArguments: WorkflowStepRef = { $ref: '$arguments', path: 'seed' };
const byIndex: WorkflowStepRef = { $ref: '$3', path: 'output.blob.url' };
const byName: WorkflowStepRef = { $ref: 'draw', path: 'output.images[0].url', default: '' };
void byArguments;
void byIndex;
void byName;
// @ts-expect-error — a reference needs a `path`
const noPath: WorkflowStepRef = { $ref: 'draw' };
void noPath;
// @ts-expect-error — `$ref` is a string, never a step index number
const numericRef: WorkflowStepRef = { $ref: 0, path: 'output' };
void numericRef;

// --- WithWorkflowStepRefs keeps an input typed while allowing references ---
type CutoutInput = { image: string; format?: 'png' | 'webp'; sizes: number[] };
const typedInput: WithWorkflowStepRefs<CutoutInput> = {
  image: { $ref: 'draw', path: 'output.images[0].url' },
  format: 'png',
  sizes: [512, { $ref: '$arguments', path: 'size' }],
};
void typedInput;
const plainInput: WithWorkflowStepRefs<CutoutInput> = { image: 'https://x/y.png', sizes: [] };
void plainInput;
// @ts-expect-error — `format` is still checked against the real field type
const wrongLeaf: WithWorkflowStepRefs<CutoutInput> = { image: 'https://x/y.png', format: 'gif', sizes: [] };
void wrongLeaf;
// A typed input drops straight into a step.
const typedStep: WorkflowBodyWorkflowStep = { $type: 'imageBackgroundRemoval', input: typedInput };
void typedStep;

// --- the snapshot's per-step view ---
expectTypeOf<BlockWorkflowSnapshot['steps']>().toEqualTypeOf<
  BlockWorkflowStepSnapshot[] | undefined
>();
expectTypeOf<BlockWorkflowStepSnapshot['status']>().toEqualTypeOf<BlockWorkflowSnapshot['status']>();
expectTypeOf<BlockWorkflowStepSnapshot['output']>().toEqualTypeOf<unknown>();

// A FAILED workflow that still carries cost and images from its earlier steps.
const partialFailure: BlockWorkflowSnapshot = {
  workflowId: 'wf_1',
  status: 'failed',
  cost: { total: 12 },
  imageUrls: ['https://image.civitai.com/a.jpeg'],
  steps: [
    { name: 'draw', $type: 'imageGen', status: 'succeeded', imageUrls: ['https://image.civitai.com/a.jpeg'] },
    { name: 'cutout', $type: 'imageBackgroundRemoval', status: 'failed', error: 'boom' },
  ],
};
void partialFailure;
// A snapshot without `steps` (every other kind, and an older host) still assigns.
const noStepsField: BlockWorkflowSnapshot = { workflowId: 'wf_2', status: 'succeeded' };
void noStepsField;

const badStatus: BlockWorkflowSnapshot = {
  workflowId: 'wf_3',
  status: 'processing',
  // @ts-expect-error — a step status is one of the six workflow statuses
  steps: [{ name: 'draw', $type: 'imageGen', status: 'unassigned' }],
};
void badStatus;

// The refusal codes assign without a cast.
const refused: BlockWorkflowSnapshot = {
  workflowId: 'failed',
  status: 'failed',
  error: 'step 2 references a later step',
  errorCode: 'workflow_ref_invalid',
};
void refused;
