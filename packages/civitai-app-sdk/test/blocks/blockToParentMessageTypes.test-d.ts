/**
 * Compile-time coverage for `BLOCK_TO_PARENT_MESSAGE_TYPES` — the runtime mirror
 * of the `BlockToParentMessage` union.
 *
 * This is a TYPE test: compiled by `tsc -p tsconfig.typecheck.json` (the
 * `test:types` script, which `pnpm test` runs), so a union that grows without the
 * array growing fails a TEST and not only a build step. That distinction is the
 * whole reason this file exists alongside the assertion already embedded in
 * `src/blocks/messages.ts`: the embedded gate fails `typecheck`/`build`, which is
 * earlier and catches consumers too, but a reader asking *"what test fails when
 * someone adds a message type?"* deserves an answer they can point at.
 *
 * 🔴 BOTH DIRECTIONS ARE ASSERTED, AND THEY FAIL DIFFERENTLY.
 *  - a union member MISSING from the array ⇒ `boundBlockToParentMessageType`
 *    clamps that type to `'other'`, so the host's
 *    `civitai_app_block_bridge_messages_total{outcome="validator_rejected"}` series
 *    exists for the new message and distinguishes nothing about it. Silent.
 *  - an array entry the union does NOT declare ⇒ a dead label value that reads as
 *    coverage for a message the protocol cannot send.
 *
 * ⚠️ FOUR GATES NOW COVER THIS ONE FACT, so do not read a red build as evidence
 * about any particular one of them: (1) the embedded gate in `messages.ts`,
 * (2) this file, (3) the runtime source-derived cross-check in
 * `blockToParentMessageTypes.test.ts`, and (4) `@civitai/blocks-react`'s
 * `internal/requestTimeouts.ts`, whose `satisfies Record<BlockToParentMessageType,
 * …>` forces every new message into a timeout class. (4) is in a DIFFERENT package
 * and fires only after this one publishes — which is the sequencing to remember
 * when adding a message type, not a defect.
 */
import { expectTypeOf } from 'vitest';

import {
  BLOCK_TO_PARENT_MESSAGE_TYPES,
  OTHER_MESSAGE_TYPE_LABEL,
  boundBlockToParentMessageType,
  type BlockToParentMessageType,
} from '../../src/blocks/index.js';

type ArrayMember = (typeof BLOCK_TO_PARENT_MESSAGE_TYPES)[number];

// Every union member is in the array…
expectTypeOf<BlockToParentMessageType>().toExtend<ArrayMember>();
// …and every array entry is a union member. `Exclude` both ways rather than a
// single `toEqualTypeOf`, so the failure names the offending member instead of
// printing two 47-member unions side by side.
expectTypeOf<Exclude<BlockToParentMessageType, ArrayMember>>().toEqualTypeOf<never>();
expectTypeOf<Exclude<ArrayMember, BlockToParentMessageType>>().toEqualTypeOf<never>();

// The array is readonly and its members are literals, not widened to `string` —
// an `as const` dropped by accident would silently un-gate both assertions above,
// because `string` extends nothing useful and `Exclude<string, …>` is not `never`.
expectTypeOf<ArrayMember>().not.toEqualTypeOf<string>();

// `BLOCK_MESSAGE_REJECTED` — the message this whole mirror exists to serve — is a
// declared member carrying the bounded `type` label and nothing else. No
// `requestId`: it reports a drop that already happened, so there is nothing to
// correlate and nothing for the host to reply to.
expectTypeOf<'BLOCK_MESSAGE_REJECTED'>().toExtend<BlockToParentMessageType>();

// The clamp widens to `string` deliberately (a JS caller, or a block built against
// a newer protocol, must reach it rather than bypass it on the strength of a type
// it does not satisfy) — pinned so a well-meaning narrowing to
// `BlockToParentMessageType` is a test failure rather than a silent hole.
expectTypeOf(boundBlockToParentMessageType).parameter(0).toEqualTypeOf<string>();
// `typeof` rather than `expectTypeOf(value)`: passing the value lets TS widen the
// literal to `string` during inference, which would make this assertion pass for a
// const declared `: string` — i.e. green while the sentinel had lost its literal
// type and every downstream narrowing on it had quietly stopped working.
expectTypeOf<typeof OTHER_MESSAGE_TYPE_LABEL>().toEqualTypeOf<'other'>();
