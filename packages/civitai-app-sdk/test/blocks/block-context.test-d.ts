/**
 * Compile-time coverage for the v2 `BlockContext` contract:
 *  - `BlockContext` is a REAL discriminated union keyed on `slotId`
 *    (`ModelSlotContext | PageSlotContext | UnknownSlotContext`), replacing v1's
 *    `{ slotId: string; [key: string]: unknown }`;
 *  - the index signature is GONE — the whole point of the change. An arbitrary
 *    field is no longer a legal `unknown` read on any member, so a typo or a
 *    field the host never forwards is a compile error instead of a silent
 *    `undefined`;
 *  - the guards (`isModelSlotContext` / `isPageSlotContext`) narrow EXACTLY,
 *    which a bare `ctx.slotId === '…'` cannot do while `UnknownSlotContext`
 *    keeps the union open to slots this SDK version has no shape for;
 *  - `ModelSlotContext` matches what the host's `CONTEXT_ALLOWLIST` actually
 *    forwards. v1 declared `creatorUserId` / `viewerUserId` / `viewerNsfwEnabled`
 *    as REQUIRED fields that the host's projection does not send (it DID send
 *    them before the data-minimisation allowlist landed, which is what the
 *    allowlist was written to stop) — a block narrowing to `ModelSlotContext`
 *    was handed `number`/`boolean` by TypeScript and `undefined` at runtime.
 *    Their absence here is the fix, and is pinned;
 *  - `PageSlotContext` exists at all. `PageBlockHost` has always sent this
 *    object; v1 just had no name for it, so page authors read it untyped.
 *
 * This is a TYPE test: compiled by `tsc -p tsconfig.typecheck.json` (the
 * `test:types` script, run by `pnpm test`). If the shape regresses, tsc fails —
 * there is nothing to execute at runtime.
 */
import { expectTypeOf } from 'vitest';

import { isModelSlotContext, isPageSlotContext } from '../../src/blocks/types.js';
import type {
  BlockContext,
  KnownSlotId,
  ModelSlotContext,
  ModelSlotId,
  PageSlotContext,
  PageSlotId,
  UnknownSlotContext,
  ViewerInfo,
} from '../../src/blocks/types.js';

// ============================================================
// ViewerInfo.signedIn — pinned HERE because nothing else in this package does
// ============================================================
//
// 🔴 Deleting `signedIn?: true` from `ViewerInfo` was mutation-tested and
// SURVIVED both this package's vitest suite AND this type test — it was caught
// only by `@civitai/blocks-react`'s `tsc`, three packages-worth of indirection
// away, because that is where the dev hosts assign the field. A contract field
// whose only gate lives in a DOWNSTREAM package is one refactor from being
// silently droppable, so the SDK pins its own.
{
  const signedIn: ViewerInfo = { id: 1, username: 'alice', signedIn: true };
  expectTypeOf(signedIn.signedIn).toEqualTypeOf<true | undefined>();

  // OPTIONAL: an older host omits it entirely, and that must stay assignable.
  const oldHost: ViewerInfo = { id: 1, username: 'alice' };
  expectTypeOf(oldHost.signedIn).toEqualTypeOf<true | undefined>();

  // `true` LITERAL, not boolean: `viewer: null` is the anonymous case, so
  // `signedIn: false` inside a present viewer is a contradiction the type
  // refuses. (The runtime guard tolerates it rather than failing the whole
  // init — see `isValidBlockInitPayload`; the type is the contract on the host,
  // the guard is the defence against the wire.)
  // @ts-expect-error - `signedIn` is the literal `true`, never `false`
  const contradiction: ViewerInfo = { id: 1, username: 'alice', signedIn: false };
  void contradiction;

  // `username` is REQUIRED-but-nullable, never optional: the deployed guards
  // reject an ABSENT username and accept an explicit `null`.
  const nullHandle: ViewerInfo = { id: 1, username: null };
  void nullHandle;
  // @ts-expect-error - `username` is required (nullable ≠ optional)
  const noHandle: ViewerInfo = { id: 1 };
  void noHandle;
}

// ============================================================
// The union itself
// ============================================================

// Every member is assignable to the union.
expectTypeOf<ModelSlotContext>().toExtend<BlockContext>();
expectTypeOf<PageSlotContext>().toExtend<BlockContext>();
expectTypeOf<UnknownSlotContext>().toExtend<BlockContext>();

// The slot-id mirrors of civitai's SLOT_REGISTRY.
expectTypeOf<ModelSlotId>().toEqualTypeOf<
  'model.sidebar_top' | 'model.below_images' | 'model.actions_extra'
>();
expectTypeOf<PageSlotId>().toEqualTypeOf<'app.page'>();
expectTypeOf<KnownSlotId>().toEqualTypeOf<ModelSlotId | PageSlotId>();

// ============================================================
// The index signature is gone (the headline of the change)
// ============================================================

{
  const model: ModelSlotContext = {
    slotId: 'model.below_images',
    modelId: 8813,
    modelVersionId: 21774,
    modelName: 'Aurora Mix',
    modelType: 'Checkpoint',
    modelNsfwLevel: 4,
  };

  // A field nobody declared is NOT a legal read. Under v1's index signature
  // this compiled and typed as `unknown`, which is how a misspelling survived
  // review: `ctx.modelVerisonId` was a legal `unknown`, not an error.
  // @ts-expect-error - no index signature: unknown properties are errors now
  model.modelVerisonId;

  // @ts-expect-error - v1 declared this REQUIRED; the host's allowlist never sends it
  model.creatorUserId;
  // @ts-expect-error - dropped by the host's CONTEXT_ALLOWLIST (duplicate of viewer.id)
  model.viewerUserId;
  // @ts-expect-error - dropped by the host's CONTEXT_ALLOWLIST (viewer privacy preference)
  model.viewerNsfwEnabled;
  // @ts-expect-error - "not sent to the iframe at all" per the host's own allowlist comment
  model.viewerStatus;
}

{
  // The forward-compat arm carries `slotId` and nothing else — so a field on it
  // is a visible, reviewable cast rather than an accidental read.
  const unknownSlot: UnknownSlotContext = { slotId: 'image.below_actions' };
  expectTypeOf(unknownSlot.slotId).toEqualTypeOf<string>();
  // @ts-expect-error - the arm for "a slot we have no shape for" exposes no fields
  unknownSlot.modelId;
}

// ============================================================
// Guard narrowing
// ============================================================

declare const ctx: BlockContext;

if (isModelSlotContext(ctx)) {
  // Exact narrowing — the model fields are readable and correctly typed.
  expectTypeOf(ctx).toEqualTypeOf<ModelSlotContext>();
  expectTypeOf(ctx.modelId).toEqualTypeOf<number>();
  expectTypeOf(ctx.slotId).toEqualTypeOf<ModelSlotId>();
  // @ts-expect-error - a page field is not readable on a model context
  ctx.slug;
}

if (isPageSlotContext(ctx)) {
  expectTypeOf(ctx).toEqualTypeOf<PageSlotContext>();
  expectTypeOf(ctx.slug).toEqualTypeOf<string>();
  expectTypeOf(ctx.subPath).toEqualTypeOf<string>();
  expectTypeOf(ctx.viewerUserId).toEqualTypeOf<number | null>();
  // @ts-expect-error - a model field is not readable on a page context
  ctx.modelId;
}

// ============================================================
// 🔴 Why the guards are RUNTIME field checks and not `slotId` checks
// ============================================================
//
// The type system CANNOT close this hole, and that is the point of pinning it
// here rather than describing it in a comment: because `UnknownSlotContext`
// declares `slotId: string`, a structurally-INCOMPLETE known slot is a perfectly
// legal `BlockContext`. It satisfies the unknown arm, so it compiles — while
// looking, to a reader and to a `slotId`-only guard, exactly like a model
// context. `isModelSlotContext` therefore checks the five fields
// `ModelSlotContext` declares required; the runtime behaviour is pinned in
// blocks-react's `blockInitV2.test.ts`.
{
  // NOT a `@ts-expect-error`: this genuinely compiles, and MUST keep compiling —
  // if a future change made it an error, the union would have stopped being open
  // to new slots, which is the forward-compat property below.
  const structurallyIncomplete: BlockContext = { slotId: 'model.sidebar_top' };
  expectTypeOf(structurallyIncomplete.slotId).toEqualTypeOf<string>();
  // …and the fields are NOT readable on it without narrowing, which is what
  // stops the `undefined`-typed-as-`number` read at the type level.
  // @ts-expect-error - unnarrowed: `modelId` is not on every arm of the union
  structurallyIncomplete.modelId;
}

// A slot whose context legitimately LACKS its optional fields still satisfies
// the member — `theme` and `viewerUsername` are genuinely absent whenever the
// host has not resolved them, and `subPath` is `''` (not absent) on an app's
// own index. A test that only ever built the fully-populated shape would not
// notice a field being wrongly promoted to required.
{
  const minimalPage: PageSlotContext = {
    slotId: 'app.page',
    slug: 'seed-explorer',
    subPath: '',
    viewerUserId: null,
  };
  expectTypeOf(minimalPage.theme).toEqualTypeOf<'light' | 'dark' | undefined>();
  expectTypeOf(minimalPage.viewerUsername).toEqualTypeOf<string | null | undefined>();

  const minimalModel: ModelSlotContext = {
    slotId: 'model.actions_extra',
    modelId: 4471,
    modelVersionId: 90233,
    modelName: 'Nocturne XL',
    modelType: 'LORA',
    modelNsfwLevel: 2,
  };
  expectTypeOf(minimalModel.checkpoint).toEqualTypeOf<
    import('../../src/blocks/types.js').BlockCheckpointInfo | null | undefined
  >();
  expectTypeOf(minimalModel.showcaseImages).toEqualTypeOf<
    import('../../src/blocks/types.js').ShowcaseImage[] | undefined
  >();
}

// ============================================================
// Back-compat for the union staying OPEN
// ============================================================

// A host that starts sending a slot this SDK has no shape for must not break a
// block's typecheck: the unknown arm absorbs it. This is the assignment that
// would fail if `BlockContext` were narrowed to the two known members.
{
  const futureSlot: BlockContext = { slotId: 'article.footer' };
  expectTypeOf(futureSlot.slotId).toEqualTypeOf<string>();
}
