import { describe, expect, it } from 'vitest';

import { isMessage } from '../../src/blocks/messages.js';
import type {
  BlockToParentMessage,
  ParentToBlockMessage,
} from '../../src/blocks/messages.js';
import type { AppWorkflow } from '../../src/blocks/types.js';

/**
 * Compile-time + discriminator coverage for the app generator SUBQUEUE message
 * pairs (`QUERY_APP_WORKFLOWS` → `APP_WORKFLOWS_RESULT`, `CANCEL_APP_WORKFLOW` →
 * `CANCEL_APP_WORKFLOW_RESULT`). Mirrors civitai/civitai PR #3164's wire shape —
 * these assertions FAIL TO COMPILE if the `AppWorkflow` projection drifts.
 */

const DONE: AppWorkflow = {
  workflowId: 'wf_1',
  status: 'succeeded',
  images: [
    { url: 'https://image.civitai.com/x/a.jpeg', width: 1024, height: 1024, nsfwLevel: 1 },
    // legitimate nullish — the orchestrator hasn't populated dims / rating yet.
    { url: 'https://image.civitai.com/x/b.jpeg', width: null, height: null, nsfwLevel: null },
  ],
  cost: 12,
  createdAt: '2026-07-14T12:00:00.000Z',
};

const PENDING: AppWorkflow = {
  workflowId: 'wf_2',
  status: 'processing',
  images: [],
  cost: null, // legitimate null cost
  createdAt: '2026-07-14T11:58:00.000Z',
};

describe('QUERY_APP_WORKFLOWS / APP_WORKFLOWS_RESULT message guards', () => {
  const request: BlockToParentMessage = {
    type: 'QUERY_APP_WORKFLOWS',
    payload: { requestId: 'q-1', params: { limit: 20, cursor: 'abc' } },
  };
  const successResult: ParentToBlockMessage = {
    type: 'APP_WORKFLOWS_RESULT',
    payload: { requestId: 'q-1', result: { workflows: [DONE, PENDING], cursor: null } },
  };
  const errorResult: ParentToBlockMessage = {
    type: 'APP_WORKFLOWS_RESULT',
    payload: { requestId: 'q-1', error: 'block lacks ai:write:budgeted scope' },
  };

  it('accepts QUERY_APP_WORKFLOWS by discriminator (params optional)', () => {
    expect(
      isMessage<BlockToParentMessage, 'QUERY_APP_WORKFLOWS'>(request, 'QUERY_APP_WORKFLOWS'),
    ).toBe(true);
    const noParams: BlockToParentMessage = {
      type: 'QUERY_APP_WORKFLOWS',
      payload: { requestId: 'q-2' },
    };
    expect(noParams.payload).not.toHaveProperty('params');
  });

  it('accepts APP_WORKFLOWS_RESULT success + error variants', () => {
    expect(
      isMessage<ParentToBlockMessage, 'APP_WORKFLOWS_RESULT'>(successResult, 'APP_WORKFLOWS_RESULT'),
    ).toBe(true);
    expect(
      isMessage<ParentToBlockMessage, 'APP_WORKFLOWS_RESULT'>(errorResult, 'APP_WORKFLOWS_RESULT'),
    ).toBe(true);
  });

  it('narrows the success payload to { workflows, cursor }', () => {
    if (
      isMessage<ParentToBlockMessage, 'APP_WORKFLOWS_RESULT'>(successResult, 'APP_WORKFLOWS_RESULT')
    ) {
      expect(successResult.payload.result?.workflows).toHaveLength(2);
      expect(successResult.payload.result?.cursor).toBeNull();
      expect(successResult.payload.result?.workflows[0]?.status).toBe('succeeded');
      expect(successResult.payload.error).toBeUndefined();
    } else {
      expect.unreachable('successResult should narrow to APP_WORKFLOWS_RESULT');
    }
  });
});

describe('CANCEL_APP_WORKFLOW / CANCEL_APP_WORKFLOW_RESULT message guards', () => {
  const request: BlockToParentMessage = {
    type: 'CANCEL_APP_WORKFLOW',
    payload: { requestId: 'c-1', workflowId: 'wf_1' },
  };
  const successResult: ParentToBlockMessage = {
    type: 'CANCEL_APP_WORKFLOW_RESULT',
    payload: { requestId: 'c-1', result: { workflow: { ...DONE, status: 'canceled' } } },
  };
  const errorResult: ParentToBlockMessage = {
    type: 'CANCEL_APP_WORKFLOW_RESULT',
    payload: { requestId: 'c-1', error: 'workflow is not in this app subqueue' },
  };

  it('accepts CANCEL_APP_WORKFLOW (workflowId is a top-level string)', () => {
    expect(
      isMessage<BlockToParentMessage, 'CANCEL_APP_WORKFLOW'>(request, 'CANCEL_APP_WORKFLOW'),
    ).toBe(true);
    if (isMessage<BlockToParentMessage, 'CANCEL_APP_WORKFLOW'>(request, 'CANCEL_APP_WORKFLOW')) {
      expect(request.payload.workflowId).toBe('wf_1');
    }
  });

  it('accepts CANCEL_APP_WORKFLOW_RESULT success + error variants', () => {
    expect(
      isMessage<ParentToBlockMessage, 'CANCEL_APP_WORKFLOW_RESULT'>(
        successResult,
        'CANCEL_APP_WORKFLOW_RESULT',
      ),
    ).toBe(true);
    expect(
      isMessage<ParentToBlockMessage, 'CANCEL_APP_WORKFLOW_RESULT'>(
        errorResult,
        'CANCEL_APP_WORKFLOW_RESULT',
      ),
    ).toBe(true);
  });

  it('narrows the success payload to { workflow } (terminal canceled)', () => {
    if (
      isMessage<ParentToBlockMessage, 'CANCEL_APP_WORKFLOW_RESULT'>(
        successResult,
        'CANCEL_APP_WORKFLOW_RESULT',
      )
    ) {
      expect(successResult.payload.result?.workflow.status).toBe('canceled');
      expect(successResult.payload.result?.workflow.workflowId).toBe('wf_1');
    } else {
      expect.unreachable('successResult should narrow to CANCEL_APP_WORKFLOW_RESULT');
    }
  });
});
