/**
 * Compile-time pin for the OPTIONALITY of `ok` (and its success-only sibling
 * `deleted`) on the seven `{ ok, error }` host→block reply payloads.
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
 * `@civitai/blocks-react`'s `src/internal/validate.ts` early-accepts an error
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
 * ## What it pins, for each of the seven
 *
 *  - `ok` is OPTIONAL — an error-only literal `{ requestId, error }` is
 *    assignable, and `'ok'` is a member of the payload's optional-key set;
 *  - `deleted` is OPTIONAL on the two that carry it (`APP_STORAGE_DELETE_RESULT`,
 *    `SHARED_WITHDRAW_RESULT`);
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
 * `@civitai/blocks-react`'s `src/internal/validate.ts` and the union header
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
// 2. APP_STORAGE_SET_RESULT
// ─────────────────────────────────────────────────────────────────────────────

type AppStorageSetResult = ReplyPayload<'APP_STORAGE_SET_RESULT'>;

expectTypeOf<AppStorageSetResult>().not.toBeNever();
expectTypeOf<'ok'>().toExtend<OptionalKeys<AppStorageSetResult>>();
expectTypeOf<AppStorageSetResult>().toEqualTypeOf<{
  requestId: string;
  ok?: boolean;
  error?: string;
  sizeBytes?: number;
}>();

const appStorageSetError: AppStorageSetResult = { requestId: 'r', error: 'boom' };
void appStorageSetError;

expectTypeOf<AppStorageSetResult['ok']>().toEqualTypeOf<boolean | undefined>();
expectTypeOf<AppStorageSetResult['ok']>().not.toBeAny();
expectTypeOf<AppStorageSetResult['error']>().toEqualTypeOf<string | undefined>();

// @ts-expect-error — wrong-typed `ok` is still a compile error.
const appStorageSetBadOk: AppStorageSetResult = { requestId: 'r', ok: 'yes' };
void appStorageSetBadOk;

// ─────────────────────────────────────────────────────────────────────────────
// 3. APP_STORAGE_DELETE_RESULT — also carries the success-only `deleted`
// ─────────────────────────────────────────────────────────────────────────────

type AppStorageDeleteResult = ReplyPayload<'APP_STORAGE_DELETE_RESULT'>;

expectTypeOf<AppStorageDeleteResult>().not.toBeNever();
expectTypeOf<'ok'>().toExtend<OptionalKeys<AppStorageDeleteResult>>();
// 🔴 `deleted` is read only AFTER the hook has thrown on a present `error`, so
// the host is not obliged to send it on the error path either.
expectTypeOf<'deleted'>().toExtend<OptionalKeys<AppStorageDeleteResult>>();
expectTypeOf<AppStorageDeleteResult>().toEqualTypeOf<{
  requestId: string;
  ok?: boolean;
  deleted?: boolean;
  error?: string;
}>();

// Neither `ok` NOR `deleted` — the shape `validate.ts` early-accepts.
const appStorageDeleteError: AppStorageDeleteResult = { requestId: 'r', error: 'boom' };
void appStorageDeleteError;

expectTypeOf<AppStorageDeleteResult['ok']>().toEqualTypeOf<boolean | undefined>();
expectTypeOf<AppStorageDeleteResult['deleted']>().toEqualTypeOf<boolean | undefined>();
expectTypeOf<AppStorageDeleteResult['deleted']>().not.toBeAny();
expectTypeOf<AppStorageDeleteResult['error']>().toEqualTypeOf<string | undefined>();

// @ts-expect-error — wrong-typed `ok` is still a compile error.
const appStorageDeleteBadOk: AppStorageDeleteResult = { requestId: 'r', ok: 'yes' };
void appStorageDeleteBadOk;

// @ts-expect-error — and so is a wrong-typed `deleted`.
const appStorageDeleteBadDeleted: AppStorageDeleteResult = { requestId: 'r', deleted: 'no' };
void appStorageDeleteBadDeleted;

// ─────────────────────────────────────────────────────────────────────────────
// 4. SHARED_WITHDRAW_RESULT — also carries the success-only `deleted`
// ─────────────────────────────────────────────────────────────────────────────

type SharedWithdrawResult = ReplyPayload<'SHARED_WITHDRAW_RESULT'>;

expectTypeOf<SharedWithdrawResult>().not.toBeNever();
expectTypeOf<'ok'>().toExtend<OptionalKeys<SharedWithdrawResult>>();
expectTypeOf<'deleted'>().toExtend<OptionalKeys<SharedWithdrawResult>>();
expectTypeOf<SharedWithdrawResult>().toEqualTypeOf<{
  requestId: string;
  ok?: boolean;
  deleted?: boolean;
  error?: string;
}>();

const sharedWithdrawError: SharedWithdrawResult = { requestId: 'r', error: 'boom' };
void sharedWithdrawError;

expectTypeOf<SharedWithdrawResult['ok']>().toEqualTypeOf<boolean | undefined>();
expectTypeOf<SharedWithdrawResult['deleted']>().toEqualTypeOf<boolean | undefined>();
expectTypeOf<SharedWithdrawResult['deleted']>().not.toBeAny();
expectTypeOf<SharedWithdrawResult['error']>().toEqualTypeOf<string | undefined>();

// @ts-expect-error — wrong-typed `ok` is still a compile error.
const sharedWithdrawBadOk: SharedWithdrawResult = { requestId: 'r', ok: 'yes' };
void sharedWithdrawBadOk;

// @ts-expect-error — and so is a wrong-typed `deleted`.
const sharedWithdrawBadDeleted: SharedWithdrawResult = { requestId: 'r', deleted: 'no' };
void sharedWithdrawBadDeleted;

// ─────────────────────────────────────────────────────────────────────────────
// 5. SHARED_UPDATE_RESULT
// ─────────────────────────────────────────────────────────────────────────────

type SharedUpdateResult = ReplyPayload<'SHARED_UPDATE_RESULT'>;

expectTypeOf<SharedUpdateResult>().not.toBeNever();
expectTypeOf<'ok'>().toExtend<OptionalKeys<SharedUpdateResult>>();
expectTypeOf<SharedUpdateResult>().toEqualTypeOf<{
  requestId: string;
  ok?: boolean;
  error?: string;
}>();

const sharedUpdateError: SharedUpdateResult = { requestId: 'r', error: 'boom' };
void sharedUpdateError;

expectTypeOf<SharedUpdateResult['ok']>().toEqualTypeOf<boolean | undefined>();
expectTypeOf<SharedUpdateResult['ok']>().not.toBeAny();
expectTypeOf<SharedUpdateResult['error']>().toEqualTypeOf<string | undefined>();

// @ts-expect-error — wrong-typed `ok` is still a compile error.
const sharedUpdateBadOk: SharedUpdateResult = { requestId: 'r', ok: 'yes' };
void sharedUpdateBadOk;

// ─────────────────────────────────────────────────────────────────────────────
// 6. SHARED_REPORT_RESULT
// ─────────────────────────────────────────────────────────────────────────────

type SharedReportResult = ReplyPayload<'SHARED_REPORT_RESULT'>;

expectTypeOf<SharedReportResult>().not.toBeNever();
expectTypeOf<'ok'>().toExtend<OptionalKeys<SharedReportResult>>();
expectTypeOf<SharedReportResult>().toEqualTypeOf<{
  requestId: string;
  ok?: boolean;
  error?: string;
}>();

const sharedReportError: SharedReportResult = { requestId: 'r', error: 'boom' };
void sharedReportError;

expectTypeOf<SharedReportResult['ok']>().toEqualTypeOf<boolean | undefined>();
expectTypeOf<SharedReportResult['ok']>().not.toBeAny();
expectTypeOf<SharedReportResult['error']>().toEqualTypeOf<string | undefined>();

// @ts-expect-error — wrong-typed `ok` is still a compile error.
const sharedReportBadOk: SharedReportResult = { requestId: 'r', ok: 'yes' };
void sharedReportBadOk;

// ─────────────────────────────────────────────────────────────────────────────
// 7. SAVE_IMAGE_RESULT
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
// LEDGER — the SET of `{ ok, error }` replies is exactly these seven
//
// Every assertion above is scoped to one type, so together they can only cover
// the types someone remembered to list. This derives the set from the union
// itself and pins it, so an EIGHTH `{ ok, error }` reply cannot land unpinned,
// and a member cannot silently lose its `ok` field.
// ─────────────────────────────────────────────────────────────────────────────

type OkBearingReplyType = {
  [T in ParentToBlockMessageType]: 'ok' extends keyof ReplyPayload<T> ? T : never;
}[ParentToBlockMessageType];

expectTypeOf<OkBearingReplyType>().toEqualTypeOf<
  | 'USER_CHECKPOINT_SET'
  | 'APP_STORAGE_SET_RESULT'
  | 'APP_STORAGE_DELETE_RESULT'
  | 'SHARED_WITHDRAW_RESULT'
  | 'SHARED_UPDATE_RESULT'
  | 'SHARED_REPORT_RESULT'
  | 'SAVE_IMAGE_RESULT'
>();

// …and exactly two of them carry the success-only `deleted`.
type DeletedBearingReplyType = {
  [T in ParentToBlockMessageType]: 'deleted' extends keyof ReplyPayload<T> ? T : never;
}[ParentToBlockMessageType];

expectTypeOf<DeletedBearingReplyType>().toEqualTypeOf<
  'APP_STORAGE_DELETE_RESULT' | 'SHARED_WITHDRAW_RESULT'
>();

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
