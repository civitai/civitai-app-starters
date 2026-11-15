/**
 * Compile-time pin for the OPTIONALITY of `ok` on the two `{ ok, error }`
 * host→block reply payloads.
 *
 * This is a TYPE test: compiled by `tsc -p tsconfig.typecheck.json` (the
 * `test:types` script, run by `pnpm test`, run by the required `SDK` CI job).
 * There is nothing to execute — and that is the whole point. The consuming
 * hooks in `@civitai/blocks-react` narrow these payloads at RUNTIME
 * (`if (p.error !== undefined) throw`), so they never dereference `ok` on the
 * error path. Reverting `ok?: boolean` to `ok: boolean` in `messages.ts`
 * therefore leaves every runtime suite green and both `--noEmit` typechecks
 * clean: nothing in the repo depends on the field being absent. Only a
 * type-level assertion can see the difference. A runtime test here would be an
 * invariant guard wearing a regression test's clothes.
 *
 * ## Why the optionality is load-bearing
 *
 * `@civitai/blocks-react`'s `src/transport/validate.ts` early-accepts an error
 * reply BEFORE requiring `ok`:
 *
 *     if (p.error !== undefined) return true;   // accepted with no `ok` at all
 *     if (typeof p.ok !== 'boolean') return false;
 *
 * So `{ requestId, error }` on its own is a VALID reply the host may send, and
 * the guard passes it through to the hook. If the type declares `ok` as
 * guaranteed, the type and the runtime guard disagree — the guard admits a
 * payload the type says cannot exist, and every consumer reading the type is
 * being told a lie about the wire. Widening the declarations was PR #273; this
 * file is what stops a "tidy-up" from quietly undoing it.
 *
 * ## What it pins, for each of the two
 *
 *  - `ok` is OPTIONAL — an error-only literal `{ requestId, error }` is
 *    assignable, and `'ok'` is a member of the payload's optional-key set;
 *  - the payload's FULL shape, exactly — `toEqualTypeOf` is invariant, so this
 *    also catches a field silently going missing or gaining one;
 *  - 🔴 optional is NOT `any`: `ok` is `boolean | undefined` (a wrong-typed
 *    `ok: 'yes'` is still rejected) and `error` is still `string | undefined`.
 *    Loosening a field's PRESENCE must never loosen its TYPE.
 *
 * A per-type check can only pin the types someone thought to list, so the
 * LEDGER at the bottom pins the SET: exactly which members of
 * `ParentToBlockMessage` carry an `ok` field. It fails when the set grows (a
 * new `{ ok, error }` reply landed without a pin) and when it shrinks.
 *
 * 🔴 KEEP IN LOCKSTEP with the block-side guards in
 * `@civitai/blocks-react`'s `src/transport/validate.ts` and the union header
 * note in `src/blocks/messages.ts`. If a validator ever stops early-accepting
 * an error reply, THAT is the change that makes `ok` required again — and it
 * must be made in `validate.ts` and here in the same commit.
 */
import { expectTypeOf } from 'vitest';

import type {
  ParentToBlockMessage,
  ParentToBlockMessageType,
} from '../../src/blocks/messages.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
//
// The reply payloads are declared INLINE on the union members rather than as
// exported interfaces, so they are reachable only through the discriminator.
// `Extract` of an absent member collapses to `never`, which is why every
// section below opens with a `not.toBeNever()` — that line is what goes red if
// a member is renamed or dropped outright.
// ─────────────────────────────────────────────────────────────────────────────

type ReplyPayload<T extends ParentToBlockMessageType> = Extract<
  ParentToBlockMessage,
  { type: T }
>['payload'];

/**
 * The keys of `T` that may be OMITTED.
 *
 * `{} extends Pick<T, K>` is true only when `K` is declared with `?`. It is
 * deliberately NOT `undefined extends T[K]` — that would also be satisfied by a
 * REQUIRED `ok: boolean | undefined`, which is a different contract (the host
 * must send the key, possibly holding `undefined`) and is not what the
 * validators accept.
 */
type OptionalKeys<T> = {
  [K in keyof T]-?: Record<string, never> extends Pick<T, K> ? K : never;
}[keyof T];

// ─────────────────────────────────────────────────────────────────────────────
// 1. USER_CHECKPOINT_SET
// ─────────────────────────────────────────────────────────────────────────────

type UserCheckpointSet = ReplyPayload<'USER_CHECKPOINT_SET'>;

expectTypeOf<UserCheckpointSet>().not.toBeNever();
expectTypeOf<'ok'>().toExtend<OptionalKeys<UserCheckpointSet>>();
expectTypeOf<UserCheckpointSet>().toEqualTypeOf<{
  requestId: string;
  ok?: boolean;
  error?: string;
}>();

// The error-only reply `validate.ts` early-accepts, as a value.
const userCheckpointSetError: UserCheckpointSet = { requestId: 'r', error: 'boom' };
void userCheckpointSetError;

// Optional is not `any`.
expectTypeOf<UserCheckpointSet['ok']>().toEqualTypeOf<boolean | undefined>();
expectTypeOf<UserCheckpointSet['ok']>().not.toBeAny();
expectTypeOf<UserCheckpointSet['error']>().toEqualTypeOf<string | undefined>();

// @ts-expect-error — `ok` is optional, NOT untyped. A string still fails.
const userCheckpointSetBadOk: UserCheckpointSet = { requestId: 'r', ok: 'yes' };
void userCheckpointSetBadOk;

// @ts-expect-error — `requestId` stays REQUIRED; a reply with nothing to
// correlate against is not a reply.
const userCheckpointSetNoId: UserCheckpointSet = { error: 'boom' };
void userCheckpointSetNoId;

// ─────────────────────────────────────────────────────────────────────────────
// 2. SAVE_IMAGE_RESULT
// ─────────────────────────────────────────────────────────────────────────────

type SaveImageResult = ReplyPayload<'SAVE_IMAGE_RESULT'>;

expectTypeOf<SaveImageResult>().not.toBeNever();
expectTypeOf<'ok'>().toExtend<OptionalKeys<SaveImageResult>>();
expectTypeOf<SaveImageResult>().toEqualTypeOf<{
  requestId: string;
  ok?: boolean;
  error?: string;
}>();

const saveImageError: SaveImageResult = { requestId: 'r', error: 'boom' };
void saveImageError;

expectTypeOf<SaveImageResult['ok']>().toEqualTypeOf<boolean | undefined>();
expectTypeOf<SaveImageResult['ok']>().not.toBeAny();
expectTypeOf<SaveImageResult['error']>().toEqualTypeOf<string | undefined>();

// @ts-expect-error — wrong-typed `ok` is still a compile error.
const saveImageBadOk: SaveImageResult = { requestId: 'r', ok: 'yes' };
void saveImageBadOk;

// ─────────────────────────────────────────────────────────────────────────────
// LEDGER — the SET of `{ ok, error }` replies is exactly these two
//
// Every assertion above is scoped to one type, so together they can only cover
// the types someone remembered to list. This derives the set from the union
// itself and pins it, so a THIRD `{ ok, error }` reply cannot land unpinned,
// and a member cannot silently lose its `ok` field.
// ─────────────────────────────────────────────────────────────────────────────

type OkBearingReplyType = {
  [T in ParentToBlockMessageType]: 'ok' extends keyof ReplyPayload<T> ? T : never;
}[ParentToBlockMessageType];

expectTypeOf<OkBearingReplyType>().toEqualTypeOf<
  'USER_CHECKPOINT_SET' | 'SAVE_IMAGE_RESULT'
>();

// …and none of them carries a success-only `deleted` (the two that did were
// legacy-store replies, removed with that store).
type DeletedBearingReplyType = {
  [T in ParentToBlockMessageType]: 'deleted' extends keyof ReplyPayload<T> ? T : never;
}[ParentToBlockMessageType];

expectTypeOf<DeletedBearingReplyType>().toBeNever();

// 🔴 `ok` is optional on ALL of them, asserted over the derived set rather than
// the hand-written list — so a new `{ ok, error }` reply that declares
// `ok: boolean` fails HERE even before anyone adds a section for it above.
type OkRequiredAnywhere = {
  [T in OkBearingReplyType]: 'ok' extends OptionalKeys<ReplyPayload<T>> ? never : T;
}[OkBearingReplyType];

expectTypeOf<OkRequiredAnywhere>().toBeNever();

type DeletedRequiredAnywhere = {
  [T in DeletedBearingReplyType]: 'deleted' extends OptionalKeys<ReplyPayload<T>>
    ? never
    : T;
}[DeletedBearingReplyType];

expectTypeOf<DeletedRequiredAnywhere>().toBeNever();
