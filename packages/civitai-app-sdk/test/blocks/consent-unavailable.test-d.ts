/**
 * Compile-time coverage for the `CONSENT_UNAVAILABLE` host→block push.
 *
 * This is a TYPE test: compiled by `tsc -p tsconfig.typecheck.json` (the
 * `test:types` script, run by `pnpm test`). There is nothing to execute — and
 * that is exactly why it exists here rather than in `messages.test.ts`.
 * `isMessage` is a DISCRIMINATOR-ONLY guard, so a runtime assertion that a
 * `{ type: 'CONSENT_UNAVAILABLE' }` object narrows passes whether or not the
 * union has the member; only the compiler can tell the difference. A runtime
 * test of a type change is an invariant guard wearing a regression test's
 * clothes.
 *
 * What it pins:
 *  - `CONSENT_UNAVAILABLE` is a MEMBER of `ParentToBlockMessage` carrying
 *    `ConsentUnavailablePayload`;
 *  - the payload is `{ reason; scopes: string[] }` and NOTHING else — in
 *    particular no `requestId`. It is an uncorrelated PUSH, like `TOKEN_REFRESH`
 *    / `THEME_CHANGE`, not a `*_RESULT` reply; `REQUEST_CONSENT` carries no
 *    `requestId`, so there is nothing for a reply to correlate against, and a
 *    block that tried to match one would wait forever;
 *  - 🔴 `scopes` is `string[]`, so the EMPTY array is a legal value of the type.
 *    The host refuses on its unfiltered un-grantable set but names only scopes
 *    in the public vocabulary, so `scopes: []` is a real refusal. Pinning the
 *    element type (rather than, say, a non-empty tuple) is what keeps that case
 *    representable;
 *  - `reason` is a UNION, not `string`, so a consumer's `switch` is exhaustive
 *    and an unknown reason is a compile error rather than a silent default arm.
 */
import { expectTypeOf } from 'vitest';

import type {
  ConsentUnavailablePayload,
  ConsentUnavailableReason,
  ParentToBlockMessage,
  ParentToBlockMessageType,
} from '../../src/blocks/messages.js';

// ============================================================
// The union member exists and carries the exported payload type
// ============================================================

type ConsentUnavailableMessage = Extract<
  ParentToBlockMessage,
  { type: 'CONSENT_UNAVAILABLE' }
>;

// Non-`never` is the real assertion: `Extract` of an absent member collapses to
// `never`, so this line is what goes red if the union loses the variant.
expectTypeOf<ConsentUnavailableMessage>().not.toBeNever();
expectTypeOf<ConsentUnavailableMessage['payload']>().toEqualTypeOf<ConsentUnavailablePayload>();

// The type-level discriminator list includes it, so a `ParentToBlockMessageType`
// switch (e.g. `payloadValidatorFor`'s consumers) can name it.
expectTypeOf<'CONSENT_UNAVAILABLE'>().toExtend<ParentToBlockMessageType>();

// ============================================================
// Payload shape — exactly two fields, and NO requestId
// ============================================================

expectTypeOf<ConsentUnavailablePayload>().toEqualTypeOf<{
  reason: ConsentUnavailableReason;
  scopes: string[];
}>();

// 🔴 An uncorrelated PUSH. If `requestId` is ever added here the message has
// silently become a reply, and every consumer's "this is not correlated"
// assumption breaks.
expectTypeOf<ConsentUnavailablePayload>().not.toHaveProperty('requestId');

// Neither field is optional — a host that omits one is not sending this message.
expectTypeOf<ConsentUnavailablePayload['reason']>().not.toBeNullable();
expectTypeOf<ConsentUnavailablePayload['scopes']>().not.toBeNullable();

// ============================================================
// 🔴 `scopes: []` is a LEGAL value, not a degenerate one
// ============================================================

expectTypeOf<ConsentUnavailablePayload['scopes']>().toEqualTypeOf<string[]>();

// The empty refusal must be constructible. A future "tightening" to a non-empty
// tuple (`[string, ...string[]]`) would make the host's real `scopes: []` push
// unrepresentable in the SDK, which is how a consumer ends up believing an empty
// refusal cannot happen.
const emptyRefusal: ConsentUnavailablePayload = { reason: 'ungrantable', scopes: [] };
const namedRefusal: ConsentUnavailablePayload = {
  reason: 'ungrantable',
  scopes: ['ai:write:budgeted', 'buzz:read:self'],
};
const emptyMessage: ParentToBlockMessage = {
  type: 'CONSENT_UNAVAILABLE',
  payload: emptyRefusal,
};
const namedMessage: ParentToBlockMessage = {
  type: 'CONSENT_UNAVAILABLE',
  payload: namedRefusal,
};
void emptyMessage;
void namedMessage;

// ============================================================
// `reason` is an enum a consumer can switch on exhaustively
// ============================================================

expectTypeOf<ConsentUnavailableReason>().toEqualTypeOf<'ungrantable'>();
// Not widened to `string` — that would silently accept anything a host sent and
// make every consumer's switch non-exhaustive.
expectTypeOf<ConsentUnavailableReason>().not.toEqualTypeOf<string>();

// @ts-expect-error — an unknown reason must not be assignable.
const badReason: ConsentUnavailablePayload = { reason: 'denied', scopes: [] };
void badReason;

// @ts-expect-error — `scopes` is required; the refusal always carries the field,
// even when the array inside it is empty.
const missingScopes: ConsentUnavailablePayload = { reason: 'ungrantable' };
void missingScopes;

// @ts-expect-error — non-string members are not part of the contract; block UI
// renders these.
const badScopes: ConsentUnavailablePayload = { reason: 'ungrantable', scopes: [42] };
void badScopes;
