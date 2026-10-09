import { cleanup, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTransport } from '../src/transport/singleton.js';
import { createMockHost, resetTransport } from '../src/testing.js';
import { IDEMPOTENT_MESSAGES } from '../src/internal/mockHostIdempotency.js';

const ORIGIN = window.location.origin;

/**
 * The dev host's IDEMPOTENCY-KEY FORMAT GATE.
 *
 * THE DEFECT THESE PIN (2026-10-02). A block sent an `idempotencyKey` of the
 * form `sheetId:panelId:nonce`. It passed **201 unit tests**, the dev harness
 * and review, then failed EVERY save in production with
 * `invalid_format` / `must match pattern /^[A-Za-z0-9_-]{1,64}$/` — 400 on
 * `blocks.submitWorkflow` — because `createMockHost` had zero occurrences of
 * `idempotencyKey` and could not produce the one submit failure that ships.
 *
 * 🔴 THESE DRIVE THE TRANSPORT DIRECTLY, NOT A HOOK, AND THAT IS THE POINT.
 * `useBuzzWorkflow().submit` now refuses a malformed key before sending (see
 * `transport.resolveIdempotencyKey`), so a hook-driven test could never reach
 * this gate — it would be killed by the EARLIER check and would prove nothing
 * about the mock. `getTransport().sendRequest(...)` is a real, exported, public
 * path a block can take, and it is the path that reaches the gate.
 *
 * 🔴 THE DISCRIMINATING CASES MATTER MORE THAN THE REFUSALS. A gate that refuses
 * everything also "passes" a refusal test, so these cover both directions:
 *   - a VALID key goes through to the ordinary submit lifecycle (reachable, not
 *     a blanket deny);
 *   - an ABSENT key goes through (the field is `.optional()` on this host path —
 *     validating absence would refuse nearly every submit in the suite);
 *   - and a malformed key is refused with THIS gate's own wording, in the
 *     host's own snapshot shape.
 */
describe('createMockHost — idempotencyKey format gate', () => {
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

  async function ready() {
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
  }

  /**
   * Submit straight down the transport with an arbitrary `idempotencyKey`.
   *
   * `as never` on the payload is deliberate and narrow: `OutboundRequest` types
   * the field as `string`, and these cases deliberately send values a
   * well-typed caller could not — which is exactly what a block compiled
   * against an older SDK, or plain JS, can put on the wire.
   */
  async function submitRaw(idempotencyKey?: unknown) {
    const payload =
      idempotencyKey === undefined
        ? { body: { $type: 'image' as const, params: {} } }
        : { body: { $type: 'image' as const, params: {} }, idempotencyKey };
    return (await getTransport().sendRequest(
      { type: 'SUBMIT_WORKFLOW', payload } as never,
      'WORKFLOW_SUBMITTED',
    )) as { snapshot?: { workflowId?: string; status?: string; error?: string; cost?: unknown } };
  }

  it('🔴 refuses the EXACT reported shape `sheetId:panelId:nonce`, naming the pattern', async () => {
    uninstall = createMockHost({}).install();
    await ready();

    const reply = await submitRaw('sheet_42:panel_7:a1b2c3');
    expect(reply.snapshot?.status).toBe('failed');
    expect(reply.snapshot?.error).toMatch(/must match pattern \/\^\[A-Za-z0-9_-\]\{1,64\}\$\//);
    // The specific diagnosis, not just the pattern: the colon is called out by
    // name because it is the character that looks most like valid input.
    expect(reply.snapshot?.error).toContain('":"');
  });

  it('refuses a 65-char key, naming the length and the 64 bound', async () => {
    uninstall = createMockHost({}).install();
    await ready();

    const reply = await submitRaw('a'.repeat(65));
    expect(reply.snapshot?.status).toBe('failed');
    expect(reply.snapshot?.error).toContain('65 characters');
    expect(reply.snapshot?.error).toContain('at most 64');
  });

  it('refuses an empty-string key (distinct from absent)', async () => {
    uninstall = createMockHost({}).install();
    await ready();

    const reply = await submitRaw('');
    expect(reply.snapshot?.status).toBe('failed');
    expect(reply.snapshot?.error).toContain('it is empty');
  });

  it('refuses a non-string key — the wire type is not a runtime guarantee', async () => {
    uninstall = createMockHost({}).install();
    await ready();

    const reply = await submitRaw(12345);
    expect(reply.snapshot?.status).toBe('failed');
    expect(reply.snapshot?.error).toContain('must be a string');
  });

  it("mirrors the host's errorSnapshot shape: the 'failed' sentinel id and NO cost", async () => {
    uninstall = createMockHost({}).install();
    await ready();

    const reply = await submitRaw('bad:key');
    // These two together are what make `submit()` reject as `'exception'`
    // rather than resolve a priced refusal — see useBuzzWorkflow's docs.
    expect(reply.snapshot?.workflowId).toBe('failed');
    expect(reply.snapshot).not.toHaveProperty('cost');
  });

  it('🔴 a VALID key goes THROUGH — the gate is reachable, not a blanket deny', async () => {
    uninstall = createMockHost({}).install();
    await ready();

    const reply = await submitRaw('sheet_42-panel_7-a1b2c3');
    // Not the refusal: an ordinary submit lifecycle, with a real workflow id.
    expect(reply.snapshot?.workflowId).not.toBe('failed');
    expect(reply.snapshot?.error).toBeUndefined();
  });

  it('🔴 an ABSENT key goes through — the field is optional on this host path', async () => {
    uninstall = createMockHost({}).install();
    await ready();

    const reply = await submitRaw(undefined);
    expect(reply.snapshot?.workflowId).not.toBe('failed');
    expect(reply.snapshot?.error).toBeUndefined();
  });

  /**
   * 🔴 THE GATE RUNS AHEAD OF EVERY SCENARIO DECISION, because the host's rule
   * is a zod `.regex()` on the procedure INPUT and fires before the procedure
   * body. This is the REACHABILITY case in its strongest form: the scenario here
   * would otherwise produce a DIFFERENT failure (`insufficient` Buzz), so if the
   * gate ran late — or not at all — this test would see that other failure's
   * message instead. It passes only if THIS gate is what rejected.
   */
  it('🔴 refuses ahead of the insufficient-Buzz scenario — ordering, and whose error wins', async () => {
    uninstall = createMockHost({ buzz: { insufficient: true } }).install();
    await ready();

    const reply = await submitRaw('bad:key');
    expect(reply.snapshot?.error).toMatch(/must match pattern/);
    // The neighbour's error must NOT be what we are reading. Without this the
    // assertion above could pass while the insufficient path produced a message
    // that merely happens to contain the pattern. The message is the ONLY thing
    // that tells the two apart: out of Buzz is also a cost-less `'failed'`
    // snapshot (the host's `failureSnapshot(err)`, as in production).
    expect(reply.snapshot?.error).not.toMatch(/insufficient/i);
    expect(reply.snapshot).not.toHaveProperty('cost');
  });

  /**
   * THE LEDGER. Pins the SET of governed message types so it fails when the set
   * GROWS (a new money message joined the protocol ungated) or SHRINKS (a row
   * went stale). A structural assertion, not a behavioural one — which is why it
   * sits beside the behavioural cases above rather than replacing them.
   */
  it('governs exactly the message types that carry an idempotencyKey today', () => {
    expect([...IDEMPOTENT_MESSAGES].sort()).toEqual(['SUBMIT_WORKFLOW']);
  });
});
