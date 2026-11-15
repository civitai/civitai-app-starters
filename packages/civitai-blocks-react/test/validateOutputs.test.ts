import { describe, expect, it } from 'vitest';

import {
  isValidAppWorkflowsResult,
  isValidCancelAppWorkflowResult,
  isValidWorkflowSnapshot,
  projectInboundPayload,
} from '../src/transport/validate.js';

/**
 * The inbound validator and `outputs` (`BlockWorkflowSnapshot.outputs`,
 * `BlockWorkflowStepSnapshot.outputs`, `AppWorkflow.outputs`).
 *
 * A MALFORMED entry is not fatal — the precedent of the queue/ETA fields:
 * `isValidWorkflowSnapshot` does not look at `outputs`, and `projectInboundPayload`
 * REPLACES each malformed entry IN PLACE with the restricted placeholder
 * `{ restricted: true, reason: 'ceiling' }` (the whole field goes only when it is
 * not an array). Never removed: indexes are positions in `outputs`, so a removed
 * entry would move every later position. Rejecting the reply instead would drop its
 * status and every other output.
 *
 * A restricted entry that carries a url is malformed, so a url the host meant to
 * withhold never reaches block code labelled as restricted.
 */

const OK_A = { url: 'https://img.test/a.png', nsfwLevel: 'pg' };
const OK_B = { url: 'https://img.test/b.png' };
const POOL = { restricted: true, reason: 'pool' };
const CEILING = { restricted: true, reason: 'ceiling' };
/** What a malformed entry becomes: a locked slot in the SAME position. */
const PLACEHOLDER = { restricted: true, reason: 'ceiling' };

/** The host's own expectation for a mixed workflow (civitai/civitai `block-output-restriction.test.ts`, case e). */
const HOST_MIXED = {
  workflowId: 'wf_r',
  status: 'succeeded',
  cost: { total: 8 },
  imageUrls: ['https://cdn/m0.png', 'https://cdn/m2.png', 'https://cdn/m4.png'],
  outputs: [
    { url: 'https://cdn/m0.png', nsfwLevel: 'pg' },
    { restricted: true, reason: 'pool' },
    { url: 'https://cdn/m2.png', nsfwLevel: 'pg13' },
    { restricted: true, reason: 'pool' },
    { url: 'https://cdn/m4.png' },
    { restricted: true, reason: 'pool' },
  ],
};

const snapshot = (over: Record<string, unknown> = {}) => ({
  workflowId: 'wf_1',
  status: 'succeeded',
  imageUrls: [OK_A.url, OK_B.url],
  outputs: [OK_A, POOL, OK_B],
  ...over,
});

const MALFORMED: Array<[string, unknown]> = [
  ['a restricted entry WITH a url', { restricted: true, reason: 'pool', url: 'https://img.test/leak.png' }],
  ['a restricted entry with a rating', { restricted: true, reason: 'pool', nsfwLevel: 'r' }],
  ['a restricted entry with no reason', { restricted: true }],
  ['a non-string reason', { restricted: true, reason: 3 }],
  ['restricted: false', { restricted: false, reason: 'pool' }],
  ['a url entry carrying a reason', { url: 'https://img.test/x.png', reason: 'pool' }],
  ['an empty url', { url: '' }],
  ['a non-string url', { url: 7 }],
  ['a non-string rating', { url: 'https://img.test/y.png', nsfwLevel: 4 }],
  ['null', null],
  ['a string', 'https://img.test/z.png'],
];

describe('outputs on a workflow snapshot', () => {
  it("crosses the host's own mixed snapshot by identity", () => {
    expect(isValidWorkflowSnapshot(HOST_MIXED)).toBe(true);
    const payload = { requestId: 'r', snapshot: HOST_MIXED };
    expect(projectInboundPayload('WORKFLOW_STATUS', payload)).toBe(payload);
  });

  it('crosses a well-formed snapshot, and one with every reason / rating as any string, by identity', () => {
    for (const s of [
      snapshot(),
      snapshot({ outputs: [CEILING, { restricted: true, reason: 'a-future-reason' }] }),
      snapshot({ outputs: [{ url: 'https://img.test/g.png', nsfwLevel: 'g' }] }),
      snapshot({ outputs: [] }),
    ]) {
      const payload = { requestId: 'r', snapshot: s };
      expect(projectInboundPayload('WORKFLOW_STATUS', payload)).toBe(payload);
    }
  });

  it('an old-host snapshot with no outputs is untouched', () => {
    const payload = { requestId: 'r', snapshot: snapshot({ outputs: undefined }) };
    expect(projectInboundPayload('WORKFLOW_STATUS', payload)).toBe(payload);
  });

  it.each(MALFORMED)('replaces %s in place, keeping every position', (_label, bad) => {
    const s = snapshot({ outputs: [OK_A, bad, POOL, OK_B] });
    // The snapshot itself is still valid: the reply is not dropped.
    expect(isValidWorkflowSnapshot(s)).toBe(true);
    const projected = projectInboundPayload('WORKFLOW_STATUS', { requestId: 'r', snapshot: s }) as {
      snapshot: Record<string, unknown>;
    };
    expect(projected.snapshot).toStrictEqual(snapshot({ outputs: [OK_A, PLACEHOLDER, POOL, OK_B] }));
    // 🔴 POSITIONS DO NOT SHIFT: OK_B is still at index 3.
    expect((projected.snapshot.outputs as unknown[])[3]).toStrictEqual(OK_B);
    expect(JSON.stringify(projected)).not.toContain('leak.png');
  });

  it('removes the whole field when outputs is not an array', () => {
    for (const bad of [{}, 'x', 3, null]) {
      const projected = projectInboundPayload('WORKFLOW_STATUS', {
        requestId: 'r',
        snapshot: snapshot({ outputs: bad }),
      }) as { snapshot: Record<string, unknown> };
      expect(projected.snapshot).not.toHaveProperty('outputs');
      expect(projected.snapshot.imageUrls).toStrictEqual([OK_A.url, OK_B.url]);
    }
  });

  it("replaces a malformed entry in a step's outputs too", () => {
    const step = { name: 'gen', $type: 'imageGen', status: 'succeeded', imageUrls: [OK_A.url] };
    const s = snapshot({
      steps: [{ ...step, outputs: [{ restricted: true, reason: 'pool', url: 'https://img.test/leak.png' }, OK_A] }],
    });
    const projected = projectInboundPayload('WORKFLOW_STATUS', { requestId: 'r', snapshot: s }) as {
      snapshot: { steps: unknown[] };
    };
    expect(projected.snapshot.steps).toStrictEqual([{ ...step, outputs: [PLACEHOLDER, OK_A] }]);
    expect(JSON.stringify(projected)).not.toContain('leak.png');
  });

  it.each([
    'ESTIMATE_RESULT',
    'WORKFLOW_SUBMITTED',
    'WORKFLOW_STATUS',
    'WORKFLOW_CANCELED',
    'TRAINING_RESULT',
    'CONFIRMED_STEP_RESULT',
  ])('is applied to %s', (type) => {
    const projected = projectInboundPayload(type, {
      requestId: 'r',
      snapshot: snapshot({ outputs: [OK_A, { url: '' }] }),
    }) as { snapshot: { outputs: unknown[] } };
    expect(projected.snapshot.outputs).toStrictEqual([OK_A, PLACEHOLDER]);
  });

  it('is applied to each ESTIMATE_BATCH_RESULT cell', () => {
    const projected = projectInboundPayload('ESTIMATE_BATCH_RESULT', {
      requestId: 'r',
      snapshots: [snapshot({ outputs: [{ url: '' }, OK_B] }), snapshot()],
    }) as { snapshots: Array<{ outputs: unknown[] }> };
    expect(projected.snapshots.map((s) => s.outputs)).toStrictEqual([
      [PLACEHOLDER, OK_B],
      [OK_A, POOL, OK_B],
    ]);
  });
});

describe('outputs on an AppWorkflow row', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    workflowId: 'wf_1',
    status: 'succeeded',
    images: [{ url: OK_A.url, width: null, height: null, nsfwLevel: 1 }],
    cost: 8,
    createdAt: '2026-11-14T00:00:00.000Z',
    outputs: [OK_A, POOL],
    ...over,
  });

  it('a well-formed row is valid and crosses by identity', () => {
    const list = { requestId: 'q', result: { workflows: [row()], cursor: null } };
    expect(isValidAppWorkflowsResult(list)).toBe(true);
    expect(projectInboundPayload('APP_WORKFLOWS_RESULT', list)).toBe(list);
    const cancel = { requestId: 'c', result: { workflow: row() } };
    expect(isValidCancelAppWorkflowResult(cancel)).toBe(true);
    expect(projectInboundPayload('CANCEL_APP_WORKFLOW_RESULT', cancel)).toBe(cancel);
  });

  it.each(MALFORMED)('APP_WORKFLOWS_RESULT replaces %s in place in a row', (_label, bad) => {
    const list = {
      requestId: 'q',
      result: { workflows: [row({ outputs: [bad, OK_A, POOL] }), row()], cursor: null },
    };
    expect(isValidAppWorkflowsResult(list)).toBe(true);
    const projected = projectInboundPayload('APP_WORKFLOWS_RESULT', list) as typeof list;
    expect(projected.result.workflows).toStrictEqual([
      row({ outputs: [PLACEHOLDER, OK_A, POOL] }),
      row(),
    ]);
    expect(JSON.stringify(projected)).not.toContain('leak.png');
  });

  it.each(MALFORMED)('CANCEL_APP_WORKFLOW_RESULT replaces %s in place', (_label, bad) => {
    const cancel = { requestId: 'c', result: { workflow: row({ outputs: [OK_A, bad, POOL] }) } };
    expect(isValidCancelAppWorkflowResult(cancel)).toBe(true);
    const projected = projectInboundPayload('CANCEL_APP_WORKFLOW_RESULT', cancel) as typeof cancel;
    expect(projected.result.workflow).toStrictEqual(row({ outputs: [OK_A, PLACEHOLDER, POOL] }));
  });

  it('an error reply is untouched', () => {
    const payload = { requestId: 'q', error: 'FORBIDDEN' };
    expect(projectInboundPayload('APP_WORKFLOWS_RESULT', payload)).toBe(payload);
    expect(projectInboundPayload('CANCEL_APP_WORKFLOW_RESULT', payload)).toBe(payload);
  });
});
