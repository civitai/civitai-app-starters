import { describe, expect, it } from 'vitest';

import { throwOnFailedReply, throwOnReplyError } from '../src/internal/replyError.js';

/**
 * Direct truth table for the single-sourced reply-reject predicate.
 *
 * These helpers are exercised indirectly at every hook site that uses them, and
 * a hook test can miss a defect here: a hook that throws a second, longer
 * message beginning with the helper's fallback lets an unanchored `toThrow('…')`
 * substring-match either throw. (A mutation sweep found exactly that at two
 * legacy-store hook sites, since removed.) Every assertion below is anchored
 * (`/^…$/`) for that reason; the anchors are load-bearing, not stylistic.
 *
 * So the predicate gets its own test, keyed on nothing but its inputs.
 */
describe('throwOnReplyError — for replies with no `ok` field', () => {
  const FB = 'fallback copy';

  it('does not throw when `error` is absent', () => {
    expect(() => throwOnReplyError({}, FB)).not.toThrow();
  });

  it('does not throw when `error` is explicitly undefined', () => {
    expect(() => throwOnReplyError({ error: undefined }, FB)).not.toThrow();
  });

  // The whole point: falsy but PRESENT.
  it('throws the fallback on an EMPTY error string', () => {
    expect(() => throwOnReplyError({ error: '' }, FB)).toThrow(/^fallback copy$/);
  });

  it('throws the host text on a non-empty error', () => {
    expect(() => throwOnReplyError({ error: 'RATE_LIMITED' }, FB)).toThrow(/^RATE_LIMITED$/);
  });
});

describe('throwOnFailedReply — for replies carrying the `{ ok, error }` pair', () => {
  const FB = 'fallback copy';

  it('does not throw on ok:true with no error', () => {
    expect(() => throwOnFailedReply({ ok: true }, FB)).not.toThrow();
  });

  // Kills the mutant that drops `!result.ok`.
  it('throws the fallback on ok:false with NO error', () => {
    expect(() => throwOnFailedReply({ ok: false }, FB)).toThrow(/^fallback copy$/);
  });

  // `ok` is optional on the wire because an error reply omits it; a reply that
  // carries NEITHER is a failure, not a success.
  it('throws the fallback when `ok` is absent and no error is given', () => {
    expect(() => throwOnFailedReply({}, FB)).toThrow(/^fallback copy$/);
  });

  // Kills the mutant that flips presence back to truthiness.
  it('throws the fallback on ok:true with an EMPTY error string', () => {
    expect(() => throwOnFailedReply({ ok: true, error: '' }, FB)).toThrow(/^fallback copy$/);
  });

  // The string is ARBITRARY on purpose — this helper is protocol-agnostic and
  // passes through whatever the host sent. It used to read `PAYLOAD_TOO_LARGE`,
  // which is a TRPC CODE the bridge never forwards — it forwards the MESSAGE
  // (#343). A fixture that spells a fiction teaches the fiction.
  it('throws the host text on ok:false with a non-empty error', () => {
    expect(() => throwOnFailedReply({ ok: false, error: 'host text' }, FB)).toThrow(/^host text$/);
  });

  // Host text wins over the fallback even when `ok` would also have rejected —
  // pins that the message expression is `error || fallback`, not `fallback`.
  it('prefers the host text to the fallback when both would reject', () => {
    expect(() => throwOnFailedReply({ ok: false, error: 'REASON' }, FB)).toThrow(/^REASON$/);
  });

  // `??` would leave an Error with an empty message here; `||` must not.
  it('never raises an Error with an empty message', () => {
    let caught: unknown;
    try {
      throwOnFailedReply({ ok: true, error: '' }, FB);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe(FB);
    expect((caught as Error).message.length).toBeGreaterThan(0);
  });
});
