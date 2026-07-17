/**
 * Compile-time coverage for the per-account-Buzz contract (Phase 2):
 *  - `BuzzAccountType` is the domain-clamped `'blue' | 'green' | 'yellow'` set
 *    (no `red`/`purple`/internal pools).
 *  - `WorkflowBody.accountType` is OPTIONAL and rides on the submit body.
 *  - `BlockWorkflowSnapshot.spentAccountType` is OPTIONAL and readable.
 *
 * Compiled by `tsc -p tsconfig.typecheck.json` (the `test:types` script, run by
 * `pnpm test`). If the type shape regresses — or if the invalid `accountType:
 * 'red'` case below STOPS being a type error — tsc fails. Nothing runs at runtime.
 */
import { expectTypeOf } from 'vitest';

import type {
  BuzzAccountType,
  WorkflowBody,
  BlockWorkflowSnapshot,
} from '../../src/blocks/types.js';

const baseParams = { prompt: 'a cat' } as const;

// --- BuzzAccountType is exactly the three domain-clamped pools ---
expectTypeOf<BuzzAccountType>().toEqualTypeOf<'blue' | 'green' | 'yellow'>();

// --- accountType is OPTIONAL on the textToImage submit body (backward compatible).
//     `WorkflowBody` is now a discriminated union, so narrow to that arm to read the
//     top-level field (the customComfy arm carries its preference under `params`). ---
expectTypeOf<
  Extract<WorkflowBody, { kind: 'textToImage' }>['accountType']
>().toEqualTypeOf<BuzzAccountType | undefined>();

// --- a checkpoint-only body with NO accountType still type-checks (today's default) ---
const noPreference: WorkflowBody = {
  kind: 'textToImage',
  modelId: 1,
  modelVersionId: 2,
  params: baseParams,
};
expectTypeOf(noPreference).toMatchTypeOf<WorkflowBody>();

// --- a body that expresses an accountType preference type-checks + rides through submit ---
const withPreference: WorkflowBody = {
  kind: 'textToImage',
  modelId: 1,
  modelVersionId: 2,
  accountType: 'yellow',
  params: baseParams,
};
expectTypeOf<
  Extract<WorkflowBody, { kind: 'textToImage' }>['accountType']
>().toEqualTypeOf<BuzzAccountType | undefined>();

// The whole body is what `useBuzzWorkflow().submit(body)` accepts and the host
// forwards unchanged over SUBMIT_WORKFLOW — so accountType is carried by that path.
declare function submitLike(body: WorkflowBody): void;
submitLike(withPreference);

// --- invalid pools are rejected at compile time (gate: this MUST be a type error) ---
const invalidPool: WorkflowBody = {
  kind: 'textToImage',
  modelId: 1,
  modelVersionId: 2,
  // @ts-expect-error 'red' is a platform-internal pool, not a block-facing BuzzAccountType
  accountType: 'red',
  params: baseParams,
};
void invalidPool;

// --- spentAccountType is OPTIONAL on the snapshot and reads back as BuzzAccountType ---
expectTypeOf<BlockWorkflowSnapshot['spentAccountType']>().toEqualTypeOf<
  BuzzAccountType | undefined
>();

const snapshot: BlockWorkflowSnapshot = {
  workflowId: 'wf-1',
  status: 'succeeded',
  spentAccountType: 'blue',
};
expectTypeOf(snapshot.spentAccountType).toEqualTypeOf<BuzzAccountType | undefined>();
