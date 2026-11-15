/**
 * Compile-time coverage for `outputs` on `BlockWorkflowSnapshot`,
 * `BlockWorkflowStepSnapshot` and `AppWorkflow`: optional and additive, and a
 * RESTRICTED entry carries no url, so an app cannot read one off it without
 * narrowing first.
 *
 * Compiled by `tsc -p tsconfig.typecheck.json` (run by `pnpm test`). Nothing
 * runs at runtime.
 */
import { expectTypeOf } from 'vitest';

import type {
  AppWorkflow,
  BlockWorkflowAvailableOutput,
  BlockWorkflowBlockedOutput,
  BlockWorkflowPendingOutput,
  BlockWorkflowOutput,
  BlockWorkflowRestrictedOutput,
  BlockWorkflowSnapshot,
  BlockWorkflowStepSnapshot,
  KnownBlockWorkflowOutputRating,
  KnownBlockWorkflowRestrictionReason,
} from '../../src/blocks/index.js';

declare const snapshot: BlockWorkflowSnapshot;
declare const step: BlockWorkflowStepSnapshot;
declare const listed: AppWorkflow;
declare const out: BlockWorkflowOutput;

// --- optional on all three: absent on an old host ---
expectTypeOf(snapshot.outputs).toEqualTypeOf<BlockWorkflowOutput[] | undefined>();
expectTypeOf(step.outputs).toEqualTypeOf<BlockWorkflowOutput[] | undefined>();
expectTypeOf(listed.outputs).toEqualTypeOf<BlockWorkflowOutput[] | undefined>();

// --- narrowing on `restricted` ---
if (out.restricted === true) {
  expectTypeOf(out).toEqualTypeOf<BlockWorkflowRestrictedOutput>();
  expectTypeOf(out.reason).toEqualTypeOf<KnownBlockWorkflowRestrictionReason | (string & {})>();
  expectTypeOf(out.url).toEqualTypeOf<undefined>();
} else if (out.pending !== true && out.blocked !== true) {
  expectTypeOf(out).toEqualTypeOf<BlockWorkflowAvailableOutput>();
  expectTypeOf(out.url).toEqualTypeOf<string>();
  expectTypeOf(out.nsfwLevel).toEqualTypeOf<
    KnownBlockWorkflowOutputRating | (string & {}) | undefined
  >();
}

// --- pending / blocked: no url, no rating, narrowed by their own marker ---
if (out.pending === true) {
  expectTypeOf(out).toEqualTypeOf<BlockWorkflowPendingOutput>();
  expectTypeOf(out.url).toEqualTypeOf<undefined>();
}
if (out.blocked === true) {
  expectTypeOf(out).toEqualTypeOf<BlockWorkflowBlockedOutput>();
  expectTypeOf(out.url).toEqualTypeOf<undefined>();
}
expectTypeOf(snapshot.ratingPending).toEqualTypeOf<true | undefined>();
expectTypeOf(step.ratingPending).toEqualTypeOf<true | undefined>();
expectTypeOf(listed.ratingPending).toEqualTypeOf<true | undefined>();
const held: BlockWorkflowOutput = { pending: true };
const blockedOut: BlockWorkflowOutput = { blocked: true };
void [held, blockedOut];
// @ts-expect-error — a pending entry never carries a url.
const pendingLeak: BlockWorkflowOutput = { pending: true, url: 'https://x/p.png' };
void pendingLeak;
// @ts-expect-error — one marker per entry.
const twoMarkers: BlockWorkflowOutput = { pending: true, blocked: true };
void twoMarkers;

// The url is not readable as a string before narrowing.
expectTypeOf(out.url).toEqualTypeOf<string | undefined>();

// --- the shapes the host sends ---
const available: BlockWorkflowOutput = { url: 'https://x/a.png', nsfwLevel: 'pg13' };
const unrated: BlockWorkflowOutput = { url: 'https://x/b.png' };
const pool: BlockWorkflowOutput = { restricted: true, reason: 'pool' };
const ceiling: BlockWorkflowOutput = { restricted: true, reason: 'ceiling' };
const unrated: BlockWorkflowOutput = { restricted: true, reason: 'unrated' };
expectTypeOf<'unrated'>().toMatchTypeOf<KnownBlockWorkflowRestrictionReason>();
void unrated;
// Open unions: a reason or rating added later still type-checks.
const futureReason: BlockWorkflowOutput = { restricted: true, reason: 'region' };
const futureRating: BlockWorkflowOutput = { url: 'https://x/c.png', nsfwLevel: 'g' };
void [available, unrated, pool, ceiling, futureReason, futureRating];

// @ts-expect-error — a restricted entry never carries a url.
const leaky: BlockWorkflowOutput = { restricted: true, reason: 'pool', url: 'https://x/r.png' };
void leaky;
// @ts-expect-error — nor a rating.
const rated: BlockWorkflowOutput = { restricted: true, reason: 'pool', nsfwLevel: 'r' };
void rated;
// @ts-expect-error — `restricted` is the literal `true` or absent.
const notRestricted: BlockWorkflowOutput = { restricted: false, reason: 'pool' };
void notRestricted;
// @ts-expect-error — a restricted entry names its reason.
const noReason: BlockWorkflowOutput = { restricted: true };
void noReason;

// A snapshot / step / listing row carrying them.
const withOutputs: BlockWorkflowSnapshot = {
  workflowId: 'w',
  status: 'succeeded',
  imageUrls: ['https://x/a.png'],
  outputs: [{ url: 'https://x/a.png', nsfwLevel: 'pg' }, { restricted: true, reason: 'pool' }],
  steps: [
    {
      name: 'gen',
      $type: 'imageGen',
      status: 'succeeded',
      imageUrls: ['https://x/a.png'],
      outputs: [{ url: 'https://x/a.png' }, { restricted: true, reason: 'ceiling' }],
    },
  ],
};
void withOutputs;
const row: AppWorkflow = {
  workflowId: 'w',
  status: 'succeeded',
  images: [],
  cost: null,
  createdAt: '2026-11-14T00:00:00.000Z',
  outputs: [{ restricted: true, reason: 'ceiling' }],
};
void row;
