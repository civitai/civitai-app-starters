import { describe, expect, it } from 'vitest';

import {
  estimatedCost,
  initialize,
  type BlockWorkflowSnapshot,
  type WorkflowBody,
} from '../../src/index.js';
import { fakeFetch, json } from '../support/fake-fetch.js';

const BODY: WorkflowBody = {
  kind: 'textToImage',
  modelId: 7,
  modelVersionId: 99,
  params: { prompt: 'a fox' },
};

const snap = (
  status: BlockWorkflowSnapshot['status'],
  extra: Partial<BlockWorkflowSnapshot> = {},
): BlockWorkflowSnapshot => ({ workflowId: 'estimate', status, ...extra });

/**
 * `estimatedCost` is the one rule for "did this estimate come back with a
 * price": `status` is not `'failed'` AND `cost.total` is a number. Each fixture
 * carries a different total, none of which the helper could return by
 * accident, so a mutant that hardcodes a value or reads the wrong field shows.
 */
describe('estimatedCost', () => {
  it('🔴 a pending estimate with a cost IS priced — never wait for `succeeded`', () => {
    // The shape the host answers a priced estimate with: status 'pending'.
    expect(estimatedCost(snap('pending', { cost: { total: 14, authorFee: 0 } }))).toBe(14);
  });

  it('reads the price whatever non-failed status carries it', () => {
    expect(estimatedCost(snap('processing', { cost: { total: 23 } }))).toBe(23);
    expect(estimatedCost(snap('succeeded', { cost: { total: 58 } }))).toBe(58);
  });

  it('0 is a price, not a missing one', () => {
    expect(estimatedCost(snap('pending', { cost: { total: 0, authorFee: 0 } }))).toBe(0);
  });

  it('🔴 a refused estimate is not priced, even when it carries the cost it refused', () => {
    // A refusal with no cost — the usual estimate refusal.
    expect(
      estimatedCost(
        snap('failed', { workflowId: 'failed', error: 'no quote', errorCode: 'step_quote_unavailable' }),
      ),
    ).toBeNull();
    // A budget refusal carries the total it would not charge. Still not a price to show.
    expect(estimatedCost(snap('failed', { workflowId: 'failed', cost: { total: 912 } }))).toBeNull();
  });

  it('an estimate that came back without a numeric total is not priced', () => {
    expect(estimatedCost(snap('pending'))).toBeNull();
    // A host that sent the total as something other than a number.
    const stringly = snap('pending', { cost: { total: '31' as unknown as number } });
    expect(estimatedCost(stringly)).toBeNull();
  });

  it('prices the reply `app.workflows.estimate` resolves, end to end through the real client', async () => {
    const { fetch } = fakeFetch([
      () =>
        json(200, {
          snapshot: {
            workflowId: 'estimate',
            status: 'pending',
            cost: { total: 17, authorFee: 0 },
            spentAccountType: 'blue',
          },
        }),
      () => json(200, { snapshot: { workflowId: 'failed', status: 'failed', error: 'refused' } }),
    ]);
    const app = await initialize({ token: 'block-jwt-1', fetch });

    const priced = await app.workflows.estimate(BODY);
    expect(priced.status).toBe('pending');
    expect(estimatedCost(priced)).toBe(17);

    const refused = await app.workflows.estimate(BODY);
    expect(estimatedCost(refused)).toBeNull();
  });
});
