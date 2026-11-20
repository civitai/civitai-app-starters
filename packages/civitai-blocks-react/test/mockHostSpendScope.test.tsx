import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { WorkflowBody } from '@civitai/app-sdk/blocks';

import { BatchEstimateError, useBatchEstimate } from '../src/hooks/useBatchEstimate.js';
import {
  useBuzzWorkflow,
  WorkflowEstimateError,
  WorkflowSubmitError,
} from '../src/hooks/useBuzzWorkflow.js';
import { useBlockToken } from '../src/hooks/useBlockToken.js';
import { useRequestConsent } from '../src/hooks/useRequestConsent.js';
import { MOCK_SPEND_SCOPE_ERROR } from '../src/internal/mockHost.js';
import { getTransport } from '../src/transport/singleton.js';
import { createMockHost, resetTransport, type MockHostOptions } from '../src/testing.js';

/**
 * #608 — the mock host enforces `ai:write:budgeted` on the money paths, as the
 * real server does.
 *
 * civitai's `estimateWorkflow`, `estimateWorkflowBatch` and `submitWorkflow` each
 * throw `FORBIDDEN 'block lacks ai:write:budgeted scope'` before any pricing when
 * the token lacks the scope. The page host delivers that to the iframe as:
 *
 *   - single estimate → `ESTIMATE_RESULT { snapshot: failureSnapshot(err) }`
 *   - batch estimate  → `ESTIMATE_BATCH_RESULT { requestId, error: err.message }`
 *   - submit          → `WORKFLOW_SUBMITTED { snapshot: failureSnapshot(err) }`
 *
 * where `failureSnapshot(err)` is `{ workflowId: 'failed', status: 'failed',
 * error: err.message }` — no `cost`. Every literal below is that shape, written
 * out rather than derived from the mock.
 *
 * Driven through the REAL hooks and transport, so the refusal → consent →
 * retry loop asserted here is the one a block author's code runs.
 */

const ORIGIN = window.location.origin;
const SCOPE = 'ai:write:budgeted';
/** The server's message, spelled out — never read back from the implementation. */
const SERVER_MESSAGE = 'block lacks ai:write:budgeted scope';

const body = (prompt: string): WorkflowBody => ({
  kind: 'textToImage',
  modelId: 7,
  modelVersionId: 99,
  params: { prompt },
});

/** Per-body prices that differ, so a batch that priced nothing cannot pass. */
const PRICE: Record<string, number> = { a: 12, b: 31 };
const costPerGen = (b: WorkflowBody) =>
  PRICE[(b as { params?: { prompt?: string } }).params?.prompt ?? ''] ?? 23;

describe('createMockHost — spend-scope enforcement (#608)', () => {
  let uninstall: (() => void) | undefined;

  beforeEach(() => {
    getTransport({ allowedParentOrigins: [ORIGIN] });
  });
  afterEach(() => {
    cleanup();
    uninstall?.();
    uninstall = undefined;
    resetTransport();
  });

  /** Install, record outbound traffic, and mount every hook the loop needs. */
  async function setup(options: MockHostOptions = {}) {
    const outbound: Array<{ type: string; payload?: unknown }> = [];
    const host = createMockHost({
      generation: { costPerGen },
      pollsUntilDone: 1,
      ...options,
      onOutbound: (m) => outbound.push(m),
    });
    uninstall = host.install();
    const { result } = renderHook(() => ({
      workflow: useBuzzWorkflow(),
      batch: useBatchEstimate(),
      token: useBlockToken(),
      consent: useRequestConsent(),
    }));
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
    return { host, result, outbound };
  }

  /** Send a raw message and return the host's reply, bypassing every hook. */
  async function raw<T>(type: string, payload: Record<string, unknown>, reply: string): Promise<T> {
    return (await getTransport().sendRequest({ type, payload } as never, reply)) as T;
  }

  it('the shared constant IS the server message (one copy, not a second spelling)', () => {
    expect(MOCK_SPEND_SCOPE_ERROR).toBe(SERVER_MESSAGE);
  });

  // ── single estimate ────────────────────────────────────────────────────────

  describe('single estimate', () => {
    it('refuses on the wire with the host failureSnapshot shape — no cost', async () => {
      await setup();
      const reply = await raw<{ snapshot: unknown }>(
        'ESTIMATE_WORKFLOW',
        { body: body('a') },
        'ESTIMATE_RESULT',
      );
      expect(reply.snapshot).toEqual({
        workflowId: 'failed',
        status: 'failed',
        error: SERVER_MESSAGE,
      });
    });

    it('estimate() rejects WorkflowEstimateError "failed" carrying the server reason', async () => {
      const { result, outbound } = await setup();
      let caught: unknown;
      await act(async () => {
        caught = await result.current.workflow.estimate(body('a')).then(
          () => null,
          (e) => e,
        );
      });
      expect(caught).toBeInstanceOf(WorkflowEstimateError);
      expect((caught as WorkflowEstimateError).code).toBe('failed');
      expect((caught as WorkflowEstimateError).snapshot.error).toBe(SERVER_MESSAGE);
      // estimate() is deliberately NOT consent-retried: no prompt was sent.
      expect(outbound.filter((m) => m.type === 'REQUEST_CONSENT')).toHaveLength(0);
    });

    it('refusal → requestConsent → TOKEN_REFRESH → retry → priced', async () => {
      const { result } = await setup();
      expect(result.current.token.scopes).not.toContain(SCOPE);

      await act(async () => {
        await result.current.workflow.estimate(body('a')).catch(() => undefined);
      });
      expect(result.current.workflow.status).toBe('error');

      act(() => {
        result.current.consent.requestConsent({ scopes: [SCOPE] });
      });
      await waitFor(() => expect(result.current.token.scopes).toContain(SCOPE));

      let snap: Awaited<ReturnType<typeof result.current.workflow.estimate>> | undefined;
      await act(async () => {
        snap = await result.current.workflow.estimate(body('a'));
      });
      expect(snap?.cost?.total).toBe(12);
      expect(result.current.workflow.status).toBe('confirming');
    });

    it('consentGrantable: false — the refusal stays, and CONSENT_UNAVAILABLE is pushed', async () => {
      const { result } = await setup({ consentGrantable: false });
      const unavailable: unknown[] = [];
      const off = getTransport().onMessage('CONSENT_UNAVAILABLE', (p) => unavailable.push(p));
      try {
        act(() => {
          result.current.consent.requestConsent({ scopes: [SCOPE] });
        });
        await waitFor(() => expect(unavailable).toHaveLength(1));
        expect((unavailable[0] as { scopes?: string[] }).scopes).toEqual([SCOPE]);
        expect(result.current.token.scopes).not.toContain(SCOPE);

        let caught: unknown;
        await act(async () => {
          caught = await result.current.workflow.estimate(body('a')).then(
            () => null,
            (e) => e,
          );
        });
        expect((caught as WorkflowEstimateError).snapshot.error).toBe(SERVER_MESSAGE);
      } finally {
        off();
      }
    });
  });

  // ── batch estimate ─────────────────────────────────────────────────────────

  describe('batch estimate', () => {
    it('refuses the WHOLE call on the wire: `error`, no snapshots, no aggregate', async () => {
      await setup();
      const reply = await raw<Record<string, unknown>>(
        'ESTIMATE_WORKFLOW_BATCH',
        { bodies: [body('a'), body('b')] },
        'ESTIMATE_BATCH_RESULT',
      );
      expect(reply).toEqual({ requestId: expect.any(String), error: SERVER_MESSAGE });
    });

    it('estimateBatch() rejects BatchEstimateError "failed" with the server text on hostError', async () => {
      const { result } = await setup();
      let caught: unknown;
      await act(async () => {
        caught = await result.current.batch.estimateBatch([body('a'), body('b')]).then(
          () => null,
          (e) => e,
        );
      });
      expect(caught).toBeInstanceOf(BatchEstimateError);
      expect((caught as BatchEstimateError).code).toBe('failed');
      expect((caught as BatchEstimateError).hostError).toBe(SERVER_MESSAGE);
    });

    it('refusal → requestConsent → TOKEN_REFRESH → retry → priced', async () => {
      const { result } = await setup();
      await act(async () => {
        await result.current.batch.estimateBatch([body('a'), body('b')]).catch(() => undefined);
      });
      expect(result.current.batch.error?.code).toBe('failed');

      act(() => {
        result.current.consent.requestConsent({ scopes: [SCOPE] });
      });
      await waitFor(() => expect(result.current.token.scopes).toContain(SCOPE));

      let priced: Awaited<ReturnType<typeof result.current.batch.estimateBatch>> | undefined;
      await act(async () => {
        priced = await result.current.batch.estimateBatch([body('a'), body('b')]);
      });
      expect(priced?.aggregate).toEqual({ total: 43, pricedCells: 2, cellCount: 2 });
    });

    it('consentGrantable: false — the whole-call refusal stays after the prompt', async () => {
      const { result } = await setup({ consentGrantable: false });
      const unavailable: unknown[] = [];
      const off = getTransport().onMessage('CONSENT_UNAVAILABLE', (p) => unavailable.push(p));
      try {
        act(() => {
          result.current.consent.requestConsent({ scopes: [SCOPE] });
        });
        await waitFor(() => expect(unavailable).toHaveLength(1));

        let caught: unknown;
        await act(async () => {
          caught = await result.current.batch.estimateBatch([body('a')]).then(
            () => null,
            (e) => e,
          );
        });
        expect((caught as BatchEstimateError).hostError).toBe(SERVER_MESSAGE);
      } finally {
        off();
      }
    });

    it('the host request-shape gate still answers first (it runs before the server)', async () => {
      await setup();
      const reply = await raw<Record<string, unknown>>(
        'ESTIMATE_WORKFLOW_BATCH',
        { bodies: [] },
        'ESTIMATE_BATCH_RESULT',
      );
      expect(reply.error).toBe('invalid estimate batch');
    });
  });

  // ── submit ─────────────────────────────────────────────────────────────────

  describe('submit', () => {
    it('refuses on the wire with the host failureSnapshot shape — no cost, nothing debited', async () => {
      const { host } = await setup({ buzz: { balance: 100 } });
      const reply = await raw<{ snapshot: unknown }>(
        'SUBMIT_WORKFLOW',
        { body: body('a'), idempotencyKey: 'k-raw-1' },
        'WORKFLOW_SUBMITTED',
      );
      expect(reply.snapshot).toEqual({
        workflowId: 'failed',
        status: 'failed',
        error: SERVER_MESSAGE,
      });
      expect(host.buzz.getBalance()).toBe(100);
    });

    it('submit() still works by default: prompt, grant, SAME-KEY retry, debited ONCE', async () => {
      const { host, result, outbound } = await setup({ buzz: { balance: 100 } });

      let snap: Awaited<ReturnType<typeof result.current.workflow.submit>> | undefined;
      await act(async () => {
        snap = await result.current.workflow.submit(body('a'));
      });
      expect(snap?.workflowId).not.toBe('failed');
      expect(snap?.status).not.toBe('failed');

      const submits = outbound.filter((m) => m.type === 'SUBMIT_WORKFLOW');
      expect(submits).toHaveLength(2);
      const keys = submits.map((m) => (m.payload as { idempotencyKey?: unknown }).idempotencyKey);
      expect(typeof keys[0]).toBe('string');
      expect(keys[1]).toBe(keys[0]);

      const prompts = outbound.filter((m) => m.type === 'REQUEST_CONSENT');
      expect(prompts).toHaveLength(1);
      expect((prompts[0].payload as { scopes?: string[] }).scopes).toEqual([SCOPE]);

      expect(result.current.token.scopes).toContain(SCOPE);
      // costPerGen('a') = 12, textToImage fee defaults to 0: one debit, not two.
      expect(host.buzz.getBalance()).toBe(88);
    });

    it('consentGrantable: false — submit() rejects "exception" with the server reason, one wire call', async () => {
      const { host, result, outbound } = await setup({
        buzz: { balance: 100 },
        consentGrantable: false,
      });
      let caught: unknown;
      await act(async () => {
        caught = await result.current.workflow.submit(body('a')).then(
          () => null,
          (e) => e,
        );
      });
      expect(caught).toBeInstanceOf(WorkflowSubmitError);
      expect((caught as WorkflowSubmitError).code).toBe('exception');
      expect((caught as WorkflowSubmitError).snapshot.error).toBe(SERVER_MESSAGE);
      expect(outbound.filter((m) => m.type === 'SUBMIT_WORKFLOW')).toHaveLength(1);
      expect(host.buzz.getBalance()).toBe(100);
    });

    it('the idempotency-key format gate still answers first (zod input runs before the procedure)', async () => {
      await setup();
      const reply = await raw<{ snapshot?: { error?: string } }>(
        'SUBMIT_WORKFLOW',
        { body: body('a'), idempotencyKey: 'bad:key' },
        'WORKFLOW_SUBMITTED',
      );
      expect(reply.snapshot?.error).not.toBe(SERVER_MESSAGE);
      expect(reply.snapshot?.error).toContain('must match pattern');
    });
  });

  // ── control: a granted token is priced on all three paths ─────────────────

  it('control — consentGranted: true prices single, batch and submit with no prompt', async () => {
    const { result, outbound } = await setup({ consentGranted: true, buzz: { balance: 100 } });
    let single: Awaited<ReturnType<typeof result.current.workflow.estimate>> | undefined;
    let batch: Awaited<ReturnType<typeof result.current.batch.estimateBatch>> | undefined;
    await act(async () => {
      single = await result.current.workflow.estimate(body('b'));
      batch = await result.current.batch.estimateBatch([body('a'), body('b')]);
      await result.current.workflow.submit(body('a'));
    });
    expect(single?.cost?.total).toBe(31);
    expect(batch?.aggregate.total).toBe(43);
    expect(outbound.filter((m) => m.type === 'SUBMIT_WORKFLOW')).toHaveLength(1);
    expect(outbound.filter((m) => m.type === 'REQUEST_CONSENT')).toHaveLength(0);
  });
});
