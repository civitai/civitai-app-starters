/**
 * Compile-time coverage for the `ROUTE_CHANGED` host→block push.
 *
 * This is a TYPE test: compiled by `tsc -p tsconfig.typecheck.json` (the
 * `test:types` script, run by `pnpm test`). There is nothing to execute — and
 * that is exactly why it exists here rather than in `messages.test.ts`.
 * `isMessage` is a DISCRIMINATOR-ONLY guard, so a runtime assertion that a
 * `{ type: 'ROUTE_CHANGED' }` object narrows passes whether or not the union has
 * the member, and `tsconfig.json` EXCLUDES `test/`, so the annotation in such a
 * test is never compiled either. MEASURED, not assumed: the four runtime
 * `ROUTE_CHANGED` cases in `messages.test.ts` were copied onto the pre-change
 * branch and all four PASSED — 28/28 green against an SDK that did not model the
 * message at all. They are labelled as invariant guards there; this file is the
 * instrument that actually goes red.
 *
 * (The same reasoning, and the same wording, as
 * `consent-unavailable.test-d.ts` — the trap is a property of the guard, not of
 * the message.)
 *
 * What it pins:
 *  - `ROUTE_CHANGED` is a MEMBER of `ParentToBlockMessage`;
 *  - its payload is `{ subPath: string }` and NOTHING else — in particular no
 *    `requestId`. It is an uncorrelated PUSH, like `TOKEN_REFRESH` /
 *    `THEME_CHANGE`, not a `*_RESULT` reply: `NAVIGATE` is fire-and-forget and
 *    carries no `requestId`, so there is nothing for a reply to correlate
 *    against and a block that tried to match one would wait forever;
 *  - `subPath` is `string`, NOT a literal union and not a branded/non-empty
 *    type, so `''` — an app's own index — is a representable value. That is the
 *    destination a block reaches by navigating back to its root, and the one a
 *    "non-empty" shape would make unsendable;
 *  - the payload is assignable to and from `PageSlotContext['subPath']`, the
 *    field this message updates. One value, two carriers: if the two types ever
 *    diverge, a host could push a sub-path the init-seeded context cannot hold.
 */
import { expectTypeOf } from 'vitest';

import type {
  ParentToBlockMessage,
  ParentToBlockMessageType,
} from '../../src/blocks/messages.js';
import type { PageSlotContext } from '../../src/blocks/types.js';

// ============================================================
// The union member exists
// ============================================================

type RouteChangedMessage = Extract<ParentToBlockMessage, { type: 'ROUTE_CHANGED' }>;

// Non-`never` is the real assertion: `Extract` of an absent member collapses to
// `never`, so this line is what goes red if the union loses the variant.
expectTypeOf<RouteChangedMessage>().not.toBeNever();

// The type-level discriminator list includes it, so a `ParentToBlockMessageType`
// switch — `payloadValidatorFor`'s compile-time totality gate, above all — can
// name it, and omitting its validator is a build error rather than an
// unvalidated path into the snapshot.
expectTypeOf<'ROUTE_CHANGED'>().toExtend<ParentToBlockMessageType>();

// ============================================================
// Payload shape — exactly one field, and NO requestId
// ============================================================

expectTypeOf<RouteChangedMessage['payload']>().toEqualTypeOf<{ subPath: string }>();

// Spelled out as well as compared whole: `toEqualTypeOf` against the literal
// above already rejects an added `requestId`, but this says WHICH key must not
// appear, so a future widening cannot quietly make it a correlated reply.
expectTypeOf<RouteChangedMessage['payload']>().not.toHaveProperty('requestId');

// `string`, so `''` is representable. A literal union or a non-empty-string
// brand would make the app index unsendable — see the file header.
expectTypeOf<RouteChangedMessage['payload']['subPath']>().toEqualTypeOf<string>();

// ============================================================
// One value, two carriers: the message and the init context agree
// ============================================================

expectTypeOf<RouteChangedMessage['payload']['subPath']>().toEqualTypeOf<
  PageSlotContext['subPath']
>();

// And `subPath` is REQUIRED on the page context, not optional — the host always
// sends it (`''` on the index), which is why the transport's presence test is a
// statement about the SLOT and not about this host's mood.
expectTypeOf<PageSlotContext>().toHaveProperty('subPath');
expectTypeOf<Required<PageSlotContext>['subPath']>().toEqualTypeOf<
  PageSlotContext['subPath']
>();
