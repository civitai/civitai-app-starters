/**
 * Compile-time coverage for the queue position / ETA / progress fields on
 * `BlockWorkflowSnapshot` (`eta`) and `BlockWorkflowStepSnapshot` (`queue`,
 * `progress`, `startedAt`, `completedAt`). Every one is OPTIONAL and additive,
 * so a snapshot from a host that predates them still type-checks.
 *
 * Compiled by `tsc -p tsconfig.typecheck.json` (run by `pnpm test`). Nothing
 * runs at runtime.
 */
import { expectTypeOf } from 'vitest';

import type {
  BlockWorkflowEta,
  BlockWorkflowSnapshot,
  BlockWorkflowStepQueue,
  BlockWorkflowStepSnapshot,
  KnownBlockWorkflowQueueSupport,
} from '../../src/blocks/index.js';

declare const snapshot: BlockWorkflowSnapshot;
declare const step: BlockWorkflowStepSnapshot;

// --- optional: absent on an old host, `null` where the contract says so ---
expectTypeOf(snapshot.eta).toEqualTypeOf<BlockWorkflowEta | null | undefined>();
expectTypeOf(step.queue).toEqualTypeOf<BlockWorkflowStepQueue | null | undefined>();
expectTypeOf(step.progress).toEqualTypeOf<number | null | undefined>();
expectTypeOf(step.startedAt).toEqualTypeOf<string | null | undefined>();
expectTypeOf(step.completedAt).toEqualTypeOf<string | null | undefined>();

// The throttled-poll marker: optional, and only ever the literal `true`.
expectTypeOf(snapshot.throttled).toEqualTypeOf<true | undefined>();
const throttledReply: BlockWorkflowSnapshot = { workflowId: 'w', status: 'processing', throttled: true };
void throttledReply;
// @ts-expect-error — the marker is `true` or absent, never `false`.
const notThrottled: BlockWorkflowSnapshot = { workflowId: 'w', status: 'processing', throttled: false };
void notThrottled;

// An old-host snapshot (none of the fields) is still a snapshot.
const oldHost: BlockWorkflowSnapshot = {
  workflowId: 'w',
  status: 'processing',
  steps: [{ name: 'draw', $type: 'imageGen', status: 'processing' }],
};
void oldHost;

// `eta` can be null (terminal).
const terminal: BlockWorkflowSnapshot = { workflowId: 'w', status: 'succeeded', eta: null };
void terminal;

// --- the shapes, pinned to the shared host contract ---
expectTypeOf<KnownBlockWorkflowQueueSupport>().toEqualTypeOf<
  'unsupported' | 'unavailable' | 'available'
>();
expectTypeOf<BlockWorkflowStepQueue['precedingJobs']>().toEqualTypeOf<number | null>();
expectTypeOf<BlockWorkflowStepQueue['estimatedStartAt']>().toEqualTypeOf<string | null>();
expectTypeOf<BlockWorkflowStepQueue['estimatedCompleteAt']>().toEqualTypeOf<string | null>();
expectTypeOf<BlockWorkflowEta['stepName']>().toEqualTypeOf<string>();
expectTypeOf<BlockWorkflowEta['queuedAhead']>().toEqualTypeOf<number | null>();
expectTypeOf<BlockWorkflowEta['startsAt']>().toEqualTypeOf<string | null>();
expectTypeOf<BlockWorkflowEta['completesAt']>().toEqualTypeOf<string | null>();
expectTypeOf<BlockWorkflowEta['progress']>().toEqualTypeOf<number | null>();
expectTypeOf<keyof BlockWorkflowStepQueue>().toEqualTypeOf<
  'precedingJobs' | 'estimatedStartAt' | 'estimatedCompleteAt' | 'support'
>();
expectTypeOf<keyof BlockWorkflowEta>().toEqualTypeOf<
  'stepName' | 'queuedAhead' | 'startsAt' | 'completesAt' | 'progress' | 'support'
>();

// --- `support`: the known literals AND an arbitrary string (an open union) ---
const known: BlockWorkflowStepQueue['support'][] = ['unsupported', 'unavailable', 'available'];
const future: BlockWorkflowStepQueue['support'] = 'someFutureValue';
const etaSupport: BlockWorkflowEta['support'][] = ['available', 'anything-else', null];
void known;
void future;
void etaSupport;
// …but not a non-string.
// @ts-expect-error — support is a string.
const notString: BlockWorkflowStepQueue['support'] = 3;
void notString;
// @ts-expect-error — a queue's support is never null (only eta's is).
const nullQueueSupport: BlockWorkflowStepQueue['support'] = null;
void nullQueueSupport;
