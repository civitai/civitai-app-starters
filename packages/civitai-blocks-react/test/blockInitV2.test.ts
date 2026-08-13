/**
 * Runtime coverage for the v2 `BLOCK_INIT` contract changes.
 *
 * Four changes, and for two of them the interesting assertion is that the wire
 * did NOT change:
 *
 *  1. `BlockContext` became a `slotId`-discriminated union. Type-level narrowing
 *     is pinned in `@civitai/app-sdk`'s `block-context.test-d.ts`; what belongs
 *     HERE is that the guard still accepts every real slot shape, including a
 *     slot id this SDK version has no member for.
 *  2. `TOKEN_REFRESH_RESPONSE.payload.requestId` became REQUIRED in the type.
 *     The guard deliberately stays permissive — see the `@deprecated`-adjacent
 *     block comment on `isValidTokenRefreshResponse`. That gap is the NEW-SDK-
 *     against-OLD-HOST back-compat path and it is asserted here, because a
 *     future "make the guard match the type" cleanup is exactly the change that
 *     would silently break it.
 *  3. `blockId` / `appId` are `@deprecated` but STILL REQUIRED on the wire.
 *  4. `viewer` gained `signedIn` and its identity fields are `@deprecated`, but
 *     the object-or-null SHAPE is unchanged.
 *
 * 🔴 WHY 3 AND 4 ARE "STILL REQUIRED" TESTS RATHER THAN REMOVAL TESTS.
 * This exact `isValidBlockInitPayload` is compiled into every already-built,
 * already-deployed block bundle.
 *
 * 🔴 THE POPULATION — one story, stated once, here. The changeset
 * (`.changeset/block-init-payload-v2.md`) is the source; every other comment in
 * this file defers to it rather than restating a denominator. `app_blocks` has
 * 21 rows (9 `approved`, 12 `suspended`), of which 20 are deployed and
 * reachable at `<slug>.civit.ai`. The guard was extracted and EXECUTED out of 19
 * of those 20 bundles, unanimously: dropping `blockId`, dropping `appId`, or
 * replacing `viewer` with a boolean each returns `false`. So the measured
 * denominator is 19/20 of the compatibility population — not "all of them", and
 * not a handful. The 9 is a DIFFERENT number and answers a different question:
 * it is the currently-SERVED set (both surfaces gate on `status='approved'`).
 * It is not the compatibility population, because suspension is reversible, so
 * a wire change must stay compatible with every deployed bundle.
 *
 * A rejected `BLOCK_INIT` IS re-sent — one immediately, then one every
 * `INIT_RETRY_INTERVAL_MS` (400ms) until `BLOCK_READY`, ~25 inside a
 * `BLOCK_READY_TIMEOUT_MS` (10s) window.
 *
 * 🔴 THE RETRIES ARE NOT BYTE-IDENTICAL, and an earlier revision of these
 * comments said they were. `IframeHost` and `PageBlockHost` both re-point
 * `buildInitPayloadRef.current` on EVERY render, so each tick posts the
 * FRESHEST payload. The structural conclusion survives — the freshness varies
 * query-resolved VALUES (checkpoint, showcase images, theme), never whether a
 * required FIELD is present, so a guard rejecting for a missing field rejects
 * every retry as well — but the mechanism is "the defect is invariant across
 * retries", not "the payload is".
 *
 * What happens when the window closes is PER-SURFACE, and only one of the two
 * is over at 10s:
 *  - MODEL SLOT (`IframeHost`): no auto-retry. Status `timeout` →
 *    `hostRenderDecision` returns `collapse` → renders `null`, so the slot takes
 *    no space. Done at ~10s.
 *  - PAGE HOST (`PageBlockHost`): `timeout` is auto-retryable, budget
 *    `MAX_AUTO_RETRIES = 2`, backoff `[2s, 5s]`. Each attempt disposes the
 *    controller and remounts the iframe, so it is a FULL fresh handshake with
 *    its own ~25 posts and its own 10s window. Three rounds, ~37s, then the
 *    terminal fallback with a prominent manual Retry.
 *
 * The block never becomes ready either way. Those are fleet-wide outages, not
 * type changes. The guards below are the regression fence around that finding.
 *
 * FIXTURES. Values are non-default and pairwise distinct on purpose: a fixture
 * of `0` / `''` / `'test'` collapses distinct implementations into identical
 * output, so a total failure of an init path can pass. The one exception is
 * `HOST_DERIVED_*`, which is copied verbatim from civitai/civitai's own pinned
 * fixture — the point of that one is to pin the SDK type against the REAL wire
 * contract rather than against the same mental model that produced it.
 */
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { isModelSlotContext, isPageSlotContext } from '@civitai/app-sdk/blocks';

import { useBlockContext } from '../src/hooks/useBlockContext.js';
import { getTransport } from '../src/internal/singleton.js';
import { createMockHost, resetTransport } from '../src/testing.js';
import {
  isValidBlockInitPayload,
  isValidTokenRefreshResponse,
  payloadValidatorFor,
} from '../src/internal/validate.js';
import { hostContextWithTheme, snapshotFromInit } from '../src/internal/transport.js';

// ============================================================
// Fixtures
// ============================================================

/**
 * Derived from civitai/civitai's `src/components/AppBlocks/__tests__/projectBlockInit.test.ts`
 * — the host's own pinned fixture, copied verbatim (ids, names and all) so this
 * pins the SDK's understanding against the REAL host payload. Do not "tidy" the
 * values; their provenance is the point.
 *
 * `fullContext` there is what a PRODUCER passes to `<BlockSlot>`; the host's
 * `CONTEXT_ALLOWLIST` then projects it down to exactly the key set below, which
 * that same test pins as an exact set. So this is what reaches an iframe.
 */
const HOST_DERIVED_CHECKPOINT = {
  versionId: 999,
  modelId: 50,
  modelName: 'Some Checkpoint',
  versionName: 'v1',
  baseModel: 'Flux.1 D',
};

const HOST_DERIVED_SHOWCASE = [
  {
    id: 1,
    url: 'https://example.com/1.jpg',
    width: 512,
    height: 512,
    prompt: 'a cat',
    negativePrompt: null,
    cfgScale: 7,
    steps: 20,
    seed: 42,
    sampler: 'Euler',
    clipSkip: 2,
  },
];

/** The projected model context — the host test pins exactly these 9 keys. */
const HOST_DERIVED_MODEL_CONTEXT = {
  slotId: 'model.sidebar_top',
  modelId: 123,
  modelVersionId: 456,
  modelName: 'My Model',
  modelType: 'Checkpoint',
  modelNsfwLevel: 1,
  theme: 'dark',
  checkpoint: HOST_DERIVED_CHECKPOINT,
  showcaseImages: HOST_DERIVED_SHOWCASE,
};

/**
 * civitai/civitai `main`'s own contract test pins the viewer projection as
 * exactly `{ id: 8888, username: 'alice' }`. `signedIn` is added by
 * civitai/civitai#3707 (OPEN, unmerged) — see the DEFAULT-viewer fence below.
 */
const HOST_DERIVED_VIEWER = { id: 8888, username: 'alice', signedIn: true as const };

/**
 * A v2 init payload built from the host-derived pieces. Every remaining value is
 * distinct from every other so a field swapped for a neighbour is visible.
 */
const v2Init = {
  blockInstanceId: 'inst_7f3a91',
  blockId: 'model-benchmarking',
  appId: 'app_2Kq8LmZ',
  token: {
    raw: 'eyJhbGciOiJI.pinned.v2',
    scopes: ['ai:write:budgeted', 'storage:write'],
    expiresAt: '2026-08-06T18:42:11.000Z',
    buzzBudget: 137,
  },
  context: HOST_DERIVED_MODEL_CONTEXT,
  settings: { publisherSettings: { buzz_budget_per_gen: 22 }, userSettings: { grid: 5 } },
  viewer: HOST_DERIVED_VIEWER,
  theme: 'light',
  renderMode: 'iframe',
  domain: 'blue',
  maxBrowsingLevel: 3,
};

/** Structured deep clone minus the named top-level keys. */
const without = (base: object, ...keys: string[]) => {
  const copy: Record<string, unknown> = structuredClone(base) as Record<string, unknown>;
  for (const k of keys) delete copy[k];
  return copy;
};

// ============================================================
// 1. Slot context — the discriminated union at runtime
// ============================================================

describe('BlockContext union (change 1)', () => {
  it('accepts the host-derived MODEL context and narrows to the model member', () => {
    expect(isValidBlockInitPayload(v2Init)).toBe(true);
    const ctx = snapshotFromInit(v2Init as never).context;
    expect(isModelSlotContext(ctx)).toBe(true);
    expect(isPageSlotContext(ctx)).toBe(false);
    // The narrowed read is the whole reason the union exists.
    if (!isModelSlotContext(ctx)) throw new Error('expected a model slot context');
    expect(ctx.modelId).toBe(123);
    expect(ctx.modelVersionId).toBe(456);
    expect(ctx.modelName).toBe('My Model');
  });

  it('accepts the PAGE context PageBlockHost actually sends, and narrows to it', () => {
    // Mirrors `PageBlockHost.buildContext()` — this host does NOT run the
    // model-slot allowlist, which is why viewerUserId/viewerUsername survive here.
    const pageInit = {
      ...structuredClone(v2Init),
      context: {
        slotId: 'app.page',
        entityType: 'none',
        slug: 'seed-explorer',
        subPath: 'compare/42',
        viewerUserId: 8888,
        viewerUsername: 'alice',
        theme: 'dark',
      },
    };
    expect(isValidBlockInitPayload(pageInit)).toBe(true);
    const ctx = snapshotFromInit(pageInit as never).context;
    expect(isPageSlotContext(ctx)).toBe(true);
    expect(isModelSlotContext(ctx)).toBe(false);
    if (!isPageSlotContext(ctx)) throw new Error('expected a page slot context');
    expect(ctx.slug).toBe('seed-explorer');
    expect(ctx.subPath).toBe('compare/42');
  });

  it('accepts a PAGE context that legitimately lacks its optional fields', () => {
    // On an app's own index `subPath` is `''` (present, empty) and the host may
    // have resolved neither `theme` nor a username. A guard tuned only against
    // the fully-populated shape would wrongly reject this real payload — the
    // too-strict-guard trap that hangs a hook to its timeout.
    const bare = {
      ...structuredClone(v2Init),
      context: { slotId: 'app.page', slug: 'notepad', subPath: '', viewerUserId: null },
    };
    expect(isValidBlockInitPayload(bare)).toBe(true);
    const ctx = snapshotFromInit(bare as never).context;
    expect(isPageSlotContext(ctx)).toBe(true);
    if (!isPageSlotContext(ctx)) throw new Error('expected a page slot context');
    expect(ctx.theme).toBeUndefined();
    expect(ctx.viewerUsername).toBeUndefined();
    expect(ctx.subPath).toBe('');
  });

  it('accepts a slot id this SDK version has no member for (forward compat)', () => {
    // A host that registers a new slot must not brick a deployed block. The
    // guard only requires `slotId` to be a non-empty string, and the union's
    // unknown arm absorbs it.
    const future = {
      ...structuredClone(v2Init),
      context: { slotId: 'image.below_actions' },
    };
    expect(isValidBlockInitPayload(future)).toBe(true);
    const ctx = snapshotFromInit(future as never).context;
    expect(isModelSlotContext(ctx)).toBe(false);
    expect(isPageSlotContext(ctx)).toBe(false);
    expect(ctx.slotId).toBe('image.below_actions');
  });

  it.each([
    ['model.sidebar_top', true, false],
    ['model.below_images', true, false],
    ['model.actions_extra', true, false],
    ['app.page', false, true],
    ['image.below_actions', false, false],
  ])('guards classify slotId %s as model=%s page=%s', (slotId, isModel, isPage) => {
    // Every registered slot id, exercised through the RUNTIME guards on a
    // COMPLETE context for that slot — the guards check the fields they assert,
    // so a bare `{ slotId }` would not isolate the slot-id arm (that case is the
    // structural-completeness block below).
    // `model.actions_extra` is registered and live but has no production
    // producer yet, so it is the arm most likely to be dropped by a "tidy the
    // union" edit and least likely to be noticed — which is exactly why each
    // arm gets its own case rather than one representative model slot.
    const ctx = {
      ...HOST_DERIVED_MODEL_CONTEXT,
      slug: 'seed-explorer',
      subPath: '',
      viewerUserId: 8888,
      slotId,
    } as never;
    expect(isModelSlotContext(ctx)).toBe(isModel);
    expect(isPageSlotContext(ctx)).toBe(isPage);
  });

  // 🔴 The reason the guards check more than `slotId`. `UnknownSlotContext`
  // declares `slotId: string`, so a structurally-INCOMPLETE known slot is a
  // legal `BlockContext` that compiles (verified with tsc against
  // `const c: BlockContext = { slotId: 'model.sidebar_top' }`). A slotId-only
  // guard would return true for it and hand the block `ctx.modelId` typed
  // `number` and valued `undefined` — straight into a generation body. Each case
  // drops exactly ONE required field so no case can pass for a neighbour's
  // reason.
  describe('a known slotId with MISSING required fields does not narrow', () => {
    const completeModel = {
      slotId: 'model.below_images',
      modelId: 8813,
      modelVersionId: 21774,
      modelName: 'Aurora Mix',
      modelType: 'Checkpoint',
      modelNsfwLevel: 4,
    };

    it('the complete model context DOES narrow (positive control)', () => {
      expect(isModelSlotContext(completeModel as never)).toBe(true);
    });

    it.each(['modelId', 'modelVersionId', 'modelName', 'modelType', 'modelNsfwLevel'])(
      'a model context missing %s does not narrow',
      (field) => {
        expect(isModelSlotContext(without(completeModel, field) as never)).toBe(false);
      },
    );

    it('a bare { slotId } model context does not narrow', () => {
      expect(isModelSlotContext({ slotId: 'model.sidebar_top' } as never)).toBe(false);
    });

    it('a model context with a WRONG-TYPED field does not narrow', () => {
      // Deletion is not the only shape of a broken payload; a stringified id is
      // what a JSON round-trip through a sloppy producer actually yields.
      expect(isModelSlotContext({ ...completeModel, modelId: '8813' } as never)).toBe(false);
      expect(isModelSlotContext({ ...completeModel, modelNsfwLevel: null } as never)).toBe(false);
    });

    const completePage = {
      slotId: 'app.page',
      slug: 'seed-explorer',
      subPath: '',
      viewerUserId: null,
    };

    it('the complete page context DOES narrow, with subPath: "" and a null viewer (positive control)', () => {
      // Both of these are REAL values — `''` on an app's own index, `null` for an
      // anonymous viewer. A guard that reached for `isNonEmptyString`/truthiness
      // would reject every app landing page and every logged-out visit.
      expect(isPageSlotContext(completePage as never)).toBe(true);
    });

    it.each(['slug', 'subPath', 'viewerUserId'])(
      'a page context missing %s does not narrow',
      (field) => {
        expect(isPageSlotContext(without(completePage, field) as never)).toBe(false);
      },
    );

    it('a bare { slotId } page context does not narrow', () => {
      expect(isPageSlotContext({ slotId: 'app.page' } as never)).toBe(false);
    });
  });

  it('still rejects a context with no usable slotId', () => {
    expect(isValidBlockInitPayload({ ...structuredClone(v2Init), context: { slotId: '' } })).toBe(
      false,
    );
    expect(isValidBlockInitPayload(without(v2Init, 'context'))).toBe(false);
  });

  describe('hostContextWithTheme (the HOST-side theme merge)', () => {
    it('never invents `theme` on a slot whose shape has no place for it', () => {
      // The unknown arm carries `slotId` only. Bolting a theme onto it would
      // fabricate a field for a slot this SDK has no shape for.
      expect(hostContextWithTheme({ slotId: 'image.below_actions' }, 'dark')).toEqual({
        slotId: 'image.below_actions',
      });
    });

    it('updates `theme` on a context that already carries it', () => {
      expect(
        hostContextWithTheme(
          { slotId: 'app.page', slug: 'notepad', subPath: '', viewerUserId: null, theme: 'light' },
          'dark',
        ),
      ).toMatchObject({ slotId: 'app.page', theme: 'dark' });
    });

    it.each(['model.sidebar_top', 'model.below_images', 'model.actions_extra', 'app.page'])(
      '🔴 SETS `theme` on a %s context that omits it',
      (slotId) => {
        // The distinguishing case, and the one the block-side `'theme' in ctx`
        // rule gets WRONG here. On the block side, omission is the host's
        // decision and must be respected. On the HOST side we ARE the host: a
        // dev-supplied `options.context` that omits `theme` is an incomplete
        // description of a slot, and the real host sends `theme` on every one of
        // these four unconditionally. Honouring the omission left the harness's
        // theme toggle unable to reach `context.theme` — not at init, and not on
        // a later THEME_CHANGE either, because `applyThemeChange` only UPDATES a
        // key that already exists.
        const out = hostContextWithTheme({ slotId } as never, 'dark') as { theme?: string };
        expect(out.theme).toBe('dark');
      },
    );

    it('returns a FRESH object on every path — never the caller’s own', () => {
      // `options.context` belongs to the dev harness that passed it. Aliasing it
      // into the block's snapshot would let a later harness mutation reach
      // through a `BlockSnapshot` the block may treat as immutable. The
      // no-theme-field path is the one that used to return the input verbatim.
      const themed = { slotId: 'app.page', slug: 'n', subPath: '', viewerUserId: null } as const;
      expect(hostContextWithTheme(themed, 'dark')).not.toBe(themed);
      const unknown = { slotId: 'image.below_actions' } as const;
      expect(hostContextWithTheme(unknown, 'dark')).not.toBe(unknown);
      expect(hostContextWithTheme(unknown, 'dark')).toEqual(unknown);
    });

    // ----------------------------------------------------------
    // DEEP copy — production parity, not defensiveness.
    //
    // Both call sites are DEV hosts, and both deliver host→block messages with
    // `win.dispatchEvent(new MessageEvent('message', …))` — a same-realm
    // synthetic event that passes `data` BY REFERENCE, with no structured clone
    // anywhere on the path. Production's cross-origin `postMessage` DOES
    // structured-clone, but production never calls this function. So the clone
    // here is what makes the harness behave like the boundary it simulates.
    //
    // The shallow `{ ...ctx }` these replace fenced off only whole-KEY
    // reassignment; every nested value stayed the caller's.
    // ----------------------------------------------------------

    /**
     * A realistic `ModelSlotContext` carrying the two nested values the function's
     * doc comment names: `checkpoint` (an object) and `showcaseImages` (an array).
     *
     * Built FRESH per test, because these tests mutate it. Every value is
     * pairwise-distinct from every other so an assertion that reads the wrong
     * field cannot pass by coincidence.
     */
    const makeNestedModelContext = () => ({
      slotId: 'model.below_images' as const,
      modelId: 8801,
      modelVersionId: 4417,
      modelName: 'Aurora Mix',
      modelType: 'LORA',
      modelNsfwLevel: 6,
      checkpoint: {
        versionId: 2093,
        modelId: 7712,
        modelName: 'Pony Realism',
        versionName: 'v3.2-turbo',
        baseModel: 'SDXL 1.0',
      },
      showcaseImages: [
        {
          id: 5501,
          url: 'https://image.civitai.com/showcase-first.jpeg',
          width: 1216,
          height: 832,
          prompt: 'a lighthouse at dusk',
          negativePrompt: 'blurry, watermark',
          cfgScale: 3.5,
          steps: 28,
          seed: 190347,
          sampler: 'DPM++ 2M Karras',
          clipSkip: 1,
        },
      ],
    });

    it('🔴 HARNESS→BLOCK: an IN-PLACE mutation of the caller’s nested values after the call does not reach the returned context', () => {
      const mine = makeNestedModelContext();
      const out = hostContextWithTheme(mine, 'dark');
      if (!isModelSlotContext(out)) throw new Error('expected a model slot context');

      // All IN PLACE — no whole-key reassignment anywhere. This is exactly the
      // class the shallow copy let through: the block's `BlockSnapshot` is
      // something a block is entitled to treat as immutable, and under
      // `{ ...ctx }` a harness could still rewrite it after init.
      mine.showcaseImages.push({
        ...mine.showcaseImages[0]!,
        id: 5502,
        prompt: 'a second image the block never received',
      });
      mine.showcaseImages[0]!.seed = 777777;
      mine.checkpoint.modelName = 'Swapped Checkpoint';
      mine.checkpoint.baseModel = 'Flux.1 D';

      expect(out.showcaseImages).toHaveLength(1);
      expect(out.showcaseImages![0]!.seed).toBe(190347);
      expect(out.showcaseImages![0]!.prompt).toBe('a lighthouse at dusk');
      expect(out.checkpoint!.modelName).toBe('Pony Realism');
      expect(out.checkpoint!.baseModel).toBe('SDXL 1.0');
      // Identity, not just value: nothing nested is shared with the caller.
      expect(out.checkpoint).not.toBe(mine.checkpoint);
      expect(out.showcaseImages).not.toBe(mine.showcaseImages);
    });

    it('🔴 BLOCK→HARNESS: mutating the RETURNED context’s nested values does not reach the caller’s object', () => {
      const mine = makeNestedModelContext();
      const out = hostContextWithTheme(mine, 'dark');
      if (!isModelSlotContext(out)) throw new Error('expected a model slot context');

      // The other direction, and a genuinely different bug: under a shallow copy
      // a block (or anything downstream of the snapshot) writing through its own
      // context corrupted the harness's fixture, so a second `install()` in the
      // same test file would replay the first block's writes.
      out.showcaseImages!.push({ ...out.showcaseImages![0]!, id: 9903, prompt: 'block-authored' });
      out.showcaseImages![0]!.steps = 4;
      out.checkpoint!.versionName = 'v0-block-authored';

      expect(mine.showcaseImages).toHaveLength(1);
      expect(mine.showcaseImages[0]!.steps).toBe(28);
      expect(mine.checkpoint.versionName).toBe('v3.2-turbo');
      // The caller's object is byte-for-byte what it was built as.
      expect(mine).toEqual(makeNestedModelContext());
    });

    it('🔴 deep-copies on the NO-THEME-FIELD path too — that early return is its own `return`', () => {
      // `UnknownSlotContext` declares `slotId` only, but a harness can hand the
      // host an object carrying more, and a clone that lived only in the
      // theme-carrying branch would alias it. Keyed on the slot id, so this
      // takes the early return.
      const mine = { slotId: 'image.below_actions', extras: { tags: ['alpha'] } };
      const out = hostContextWithTheme(mine as never, 'dark') as unknown as typeof mine;

      mine.extras.tags.push('beta');
      expect(out.extras.tags).toEqual(['alpha']);
      expect(out.extras).not.toBe(mine.extras);
      // And it still does not invent a `theme` on a slot with no place for it.
      expect('theme' in out).toBe(false);
    });

    it('🔴 THROWS on a non-cloneable context rather than falling back to a shallow copy', () => {
      // Fidelity, not a regression: production's cross-origin `postMessage`
      // raises `DataCloneError` on the same input. A silent shallow fallback
      // would re-open the very dev-host/production divergence the clone closes,
      // so the throw is load-bearing and pinned here.
      const withFn = {
        slotId: 'model.sidebar_top',
        modelId: 4471,
        modelVersionId: 90233,
        modelName: 'Nocturne XL',
        modelType: 'LORA',
        modelNsfwLevel: 2,
        onPick: () => 'not cloneable',
      };

      expect(() => hostContextWithTheme(withFn as never, 'dark')).toThrow(
        /hostContextWithTheme: the context for slot "model\.sidebar_top" is not structured-cloneable/,
      );

      // The original `DataCloneError` is preserved as `cause` — the wrapper adds
      // provenance, it does not hide the platform error.
      let caught: unknown;
      try {
        hostContextWithTheme(withFn as never, 'dark');
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).cause).toBeDefined();
      expect((caught as Error).cause).not.toBe(caught);
      // And it names the likely cause, so a harness author knows what to remove.
      expect((caught as Error).message).toMatch(/function, a class instance, a proxy or a DOM node/);
    });
  });
});

// ============================================================
// 2. TOKEN_REFRESH_RESPONSE.requestId
// ============================================================

describe('TOKEN_REFRESH_RESPONSE requestId (change 2)', () => {
  const token = {
    raw: 'eyJhbGciOiJI.rotated.v2',
    scopes: ['buzz:read:self'],
    expiresAt: '2026-08-06T19:07:03.000Z',
  };

  it('accepts the v2 reply, which always names its request', () => {
    expect(isValidTokenRefreshResponse({ requestId: 'q7x2b1-14', token })).toBe(true);
  });

  it('🔴 STILL accepts a reply with NO requestId — old-host back-compat', () => {
    // A pre-v2 host spreads the field in via `...(requestId ? {…} : {})`, so it
    // omits it whenever the block sent none. The transport applies the token to
    // the snapshot regardless of correlation, so tolerating this reply is what
    // keeps a NEW SDK working against an OLD host. Tightening this guard to
    // match the (now-required) type would DROP the message before that side
    // effect runs — turning a degraded path into a broken one.
    expect(isValidTokenRefreshResponse({ token })).toBe(true);
  });

  it('🔴 STILL accepts a reply with an EMPTY-STRING requestId', () => {
    // The old host's spread is a TRUTHINESS test, so `requestId: ''` was dropped
    // too — but a host mid-migration can emit it. Same reasoning: tolerate.
    expect(isValidTokenRefreshResponse({ requestId: '', token })).toBe(true);
  });

  it('rejects a non-string requestId — a number cannot be a correlation id', () => {
    expect(isValidTokenRefreshResponse({ requestId: 4711, token })).toBe(false);
    expect(isValidTokenRefreshResponse({ requestId: { id: 'q7x2b1' }, token })).toBe(false);
  });

  it('still rejects a reply with no usable token', () => {
    expect(isValidTokenRefreshResponse({ requestId: 'q7x2b1-14' })).toBe(false);
    expect(isValidTokenRefreshResponse({ requestId: 'q7x2b1-14', token: { raw: '' } })).toBe(false);
  });

  it('is the validator the dispatcher maps TOKEN_REFRESH_RESPONSE to', () => {
    // A guard is only reachable once `payloadValidatorFor` routes to it; that
    // switch's `default:` arm returns `null`, a STRUCTURAL PASS, so a missing
    // entry means the payload reaches state-mutating code unvalidated.
    expect(payloadValidatorFor('TOKEN_REFRESH_RESPONSE')).toBe(isValidTokenRefreshResponse);
  });
});

// ============================================================
// 3. blockId / appId — deprecated in the type, REQUIRED on the wire
// ============================================================

describe('blockId + appId are deprecated but MUST still be sent (change 3)', () => {
  it('🔴 rejects an init with blockId removed — deployed blocks would never become ready', () => {
    // Not a preference. This guard is compiled into every deployed block bundle;
    // executing their own copy against this payload returned false unanimously
    // (see the population note in this file's header — 19 of the 20 deployed
    // bundles). The host DOES retry, and it does not help: the missing field is
    // invariant across every retry, and both surfaces end in a terminal failure
    // state (model slot at ~10s, page host after three rounds / ~37s). Removing
    // the field from the host is a fleet-wide outage. THIS TEST IS THE FENCE —
    // if a future change makes it pass, the wire removal it unblocks is the
    // outage.
    expect(isValidBlockInitPayload(without(v2Init, 'blockId'))).toBe(false);
  });

  it('🔴 rejects an init with appId removed — same fleet-wide outage', () => {
    expect(isValidBlockInitPayload(without(v2Init, 'appId'))).toBe(false);
  });

  it('rejects both removed together', () => {
    expect(isValidBlockInitPayload(without(v2Init, 'blockId', 'appId'))).toBe(false);
  });

  it('rejects them present-but-empty (the shape an over-eager migration produces)', () => {
    expect(isValidBlockInitPayload({ ...structuredClone(v2Init), blockId: '' })).toBe(false);
    expect(isValidBlockInitPayload({ ...structuredClone(v2Init), appId: '' })).toBe(false);
  });

  it('still surfaces both on the snapshot for blocks that read them today', () => {
    const snap = snapshotFromInit(v2Init as never);
    expect(snap.blockId).toBe('model-benchmarking');
    expect(snap.appId).toBe('app_2Kq8LmZ');
    // Distinct from each other and from blockInstanceId — a fixture where these
    // collapsed would hide a projection that returns the wrong one.
    expect(new Set([snap.blockId, snap.appId, snap.blockInstanceId]).size).toBe(3);
  });
});

// ============================================================
// 4. viewer — signedIn added, identity deprecated, SHAPE unchanged
// ============================================================

describe('viewer thinning (change 4)', () => {
  it('accepts a v2 viewer carrying signedIn and surfaces it on the snapshot', () => {
    expect(isValidBlockInitPayload(v2Init)).toBe(true);
    const snap = snapshotFromInit(v2Init as never);
    expect(snap.viewer?.signedIn).toBe(true);
    // The sign-in gate a block should build against, and the legacy test it
    // replaces, agree — that equivalence is what makes the migration safe.
    expect(snap.viewer?.signedIn === true).toBe(snap.viewer !== null);
  });

  it('accepts a viewer WITHOUT signedIn — a host predating the field', () => {
    const oldHost = {
      ...structuredClone(v2Init),
      viewer: { id: 8888, username: 'alice' },
    };
    expect(isValidBlockInitPayload(oldHost)).toBe(true);
    const snap = snapshotFromInit(oldHost as never);
    expect(snap.viewer?.signedIn).toBeUndefined();
    // The fallback: absent `signedIn` on a non-null viewer still means signed in.
    expect(snap.viewer !== null).toBe(true);
  });

  it('🔴 a MALFORMED signedIn does NOT reject the payload', () => {
    // `signedIn: false` inside a NON-NULL viewer is a contradiction — anonymous
    // is `viewer: null` — but `isValidBlockInitPayload` gates the WHOLE init, so
    // returning false costs the block its token, context, settings and theme
    // over one advisory flag. The host retries the identical payload for 10s and
    // then abandons the launch, so a strict check here is a BRICKED block; an
    // ignored flag is a degraded one (the block reads `signedIn` as falsy and
    // may show a sign-in CTA, while `viewer !== null` still answers correctly).
    //
    // Currently unreachable from the real host (`projectBlockInitViewer` writes
    // a literal `true`) — which is the point: the strict version bought nothing
    // and cost a fleet-wide brick the day a host started writing
    // `signedIn: !!user`.
    for (const signedIn of [false, 'yes', 0, 1, null]) {
      expect(
        isValidBlockInitPayload({
          ...structuredClone(v2Init),
          viewer: { id: 8888, username: 'alice', signedIn },
        }),
      ).toBe(true);
    }
  });

  it('a malformed signedIn still reaches the snapshot verbatim — not coerced', () => {
    // The guard tolerating it must not be mistaken for the SDK sanitising it.
    // A block reading `viewer?.signedIn === true` sees `false` here; the
    // documented `viewer !== null` fallback is what still reads correctly.
    const snap = snapshotFromInit({
      ...structuredClone(v2Init),
      viewer: { id: 8888, username: 'alice', signedIn: false },
    } as never);
    expect(snap.viewer?.signedIn).toBe(false);
    expect(snap.viewer !== null).toBe(true);
  });

  it('🔴 rejects a viewer thinned to a bare boolean — deployed blocks would never become ready', () => {
    // The obvious reading of "thin viewer to a signed-in flag". Executing the
    // deployed bundles' own copy of this guard against it returned false
    // unanimously across the sweep in this file's header (19 of the 20 deployed
    // bundles). THIS TEST IS THE FENCE around that finding.
    expect(isValidBlockInitPayload({ ...structuredClone(v2Init), viewer: true })).toBe(false);
  });

  it('🔴 rejects a viewer thinned to `{ signedIn: true }` with no id', () => {
    // The other obvious reading, and equally fatal: the deployed guard requires
    // a NUMERIC `id` on any non-null viewer.
    expect(
      isValidBlockInitPayload({ ...structuredClone(v2Init), viewer: { signedIn: true } }),
    ).toBe(false);
  });

  // 🔴 The two cases above are killed by the guard's `id` clause, NOT by the
  // clause each one names — `viewer: true` and `{ signedIn: true }` both have an
  // `undefined` id, so the `username` and `id` checks fire as well. Redundant
  // clauses mean "a test failed" is much weaker than "THIS clause is load-
  // bearing". These two isolate the `id` clause: everything else about the
  // viewer is well-formed, so ONLY a numeric-`id` requirement can reject them.
  it('rejects a NON-NUMERIC viewer.id (isolates the id clause)', () => {
    expect(
      isValidBlockInitPayload({
        ...structuredClone(v2Init),
        viewer: { id: '8888', username: 'alice', signedIn: true },
      }),
    ).toBe(false);
  });

  it('rejects a viewer whose id is absent but is otherwise well-formed', () => {
    expect(
      isValidBlockInitPayload({
        ...structuredClone(v2Init),
        viewer: { username: 'alice', signedIn: true },
      }),
    ).toBe(false);
  });

  it('accepts viewer: null (anonymous) — unchanged in v2', () => {
    const anon = { ...structuredClone(v2Init), viewer: null };
    expect(isValidBlockInitPayload(anon)).toBe(true);
    expect(snapshotFromInit(anon as never).viewer).toBeNull();
  });

  it('still surfaces the deprecated identity fields for the blocks reading them today', () => {
    // 5 of the 9 approved apps read `viewer.id` for load-bearing logic (ownership
    // filters, optimistic row authorship). It stays until those migrate.
    const snap = snapshotFromInit(v2Init as never);
    expect(snap.viewer?.id).toBe(8888);
    expect(snap.viewer?.username).toBe('alice');
  });

  it('🔴 rejects a viewer whose `username` is ABSENT, but accepts an explicit null', () => {
    // Measured against the deployed bundles: an absent `username` is rejected,
    // an explicit `null` accepted. 🔴 NO DENOMINATOR IS QUOTED HERE ON PURPOSE.
    // An earlier revision said "16/16", a third number this file could not
    // relate to the 21/20/19 sweep in the header or to the 9 served apps, and
    // nothing recorded which subset it was. Rather than invent a
    // reconciliation, the count is dropped: the population statement lives in
    // the header and in the changeset, and only what was actually re-derivable
    // is stated. `ViewerInfo.username` is `string |
    // null` — REQUIRED-but-nullable, never optional — so a host "tidying" the
    // field away (e.g. `...(username ? { username } : {})`, the same truthiness
    // spread that dropped `requestId`) is a wire removal with the same
    // fleet-wide blast radius as dropping `blockId`.
    expect(
      isValidBlockInitPayload({
        ...structuredClone(v2Init),
        viewer: { id: 8888, signedIn: true },
      }),
    ).toBe(false);
    expect(
      isValidBlockInitPayload({
        ...structuredClone(v2Init),
        viewer: { id: 8888, username: null, signedIn: true },
      }),
    ).toBe(true);
  });
});

// ============================================================
// 5. The DEV HOSTS must send what the real host sends
// ============================================================
//
// A fake that encodes a shape the platform does not send is how a both-wrong-
// blind bug survives a green suite: the block compiles against the fake, the
// harness proves nothing, and the divergence only surfaces in production. The
// wire truth these pin is civitai/civitai's `projectBlockInitViewer` +
// `PageBlockHost.buildContext()`.
//
// 🔴 ONE of the viewer assertions below deliberately runs AHEAD of that wire
// truth rather than mirroring it — see the comment on the DEFAULT-viewer test.
// Do not read this section as "everything here is asserted host-side today".

describe('createMockHost BLOCK_INIT fidelity', () => {
  const ORIGIN = window.location.origin;
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

  it('🔴 the DEFAULT viewer is exactly { id, username, signedIn } — no `status`', async () => {
    // 🔴 THIS FENCE STAYS — and it is deliberately NOT a mirror of a shipped
    // host assertion. An earlier revision claimed it was. Its two halves have
    // different provenance:
    //
    //  - `status` ABSENT mirrors production TODAY. civitai/civitai `main`'s
    //    `projectBlockInitViewer` builds `{ id, username }`, and
    //    `src/components/AppBlocks/__tests__/projectBlockInit.test.ts:154` pins
    //    `Object.keys(viewer).sort()` as exactly `['id', 'username']`. `status`
    //    is @deprecated because the platform withholds the viewer's moderation
    //    state from third-party iframes (civitai #2521).
    //  - `signedIn` PRESENT pins the INTENDED post-#3707 contract, not a shipped
    //    one. `signedIn` appears ZERO times under `src/components/AppBlocks/` on
    //    `main`. civitai/civitai#3707 (OPEN, unmerged) is what adds it, and what
    //    moves the host's pinned key set to ['id','signedIn','username'].
    //
    // WHY KEEP IT. The mock is what makes `signedIn` exercisable locally ahead
    // of the host; without a fence the field can be dropped from the mock by an
    // unrelated edit and nothing goes red. The cost of running ahead — a block
    // gating on `viewer?.signedIn` that passes here and renders its anonymous
    // branch to every signed-in user in production — is carried elsewhere, on
    // purpose: `ViewerInfo.signedIn`'s doc, the changeset, and the migrated
    // starter + `hello-world`, which all gate on `viewer !== null` instead.
    //
    // 🔴 IF #3707 NEVER LANDS, this assertion is what has to change first. Drop
    // `signedIn` from `DEFAULT_VIEWER` (mockHost), from `anonFallbackViewer`
    // (liveHost), from the two expectations below, from `HOST_DERIVED_VIEWER`
    // above, and from the two `payload.viewer` fences in `liveHost.test.tsx`
    // (~L229 and ~L277) — in ONE change — do not
    // leave a fence pinning a contract nobody ships, which is the same
    // both-wrong-blind defect this section exists to prevent, pointed the other
    // way.
    //
    // `toEqual` is load-bearing — `toMatchObject` cannot see an extra key.
    uninstall = createMockHost().install();
    const { result } = renderHook(() => useBlockContext());
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.viewer).toEqual({ id: 2, username: 'dev-viewer', signedIn: true });
    expect(Object.keys(result.current.viewer ?? {}).sort()).toEqual([
      'id',
      'signedIn',
      'username',
    ]);
  });

  it('🔴 the DEFAULT context is a complete PageSlotContext, not a { slotId } stub', async () => {
    // The mutant this kills: reverting the default back to `{ slotId: 'app.page' }`.
    // A stub lets a page author compile against slug/subPath/viewerUserId while
    // the harness never delivers them — and, since `isPageSlotContext` now checks
    // the fields it asserts, a stub does not even narrow, so every guarded read
    // in a page block silently takes the else branch in local dev.
    uninstall = createMockHost({ viewer: { id: 42, username: 'tester' } }).install();
    const { result } = renderHook(() => useBlockContext());
    await waitFor(() => expect(result.current.ready).toBe(true));

    const ctx = result.current.context;
    expect(isPageSlotContext(ctx)).toBe(true);
    if (!isPageSlotContext(ctx)) throw new Error('expected a page slot context');
    expect(ctx.slug).toBe('mock-app');
    expect(ctx.subPath).toBe('');
    expect(ctx.entityType).toBe('none');
    // Derived from the resolved viewer, not hardcoded — a constant here would
    // pass with the viewer wiring severed.
    expect(ctx.viewerUserId).toBe(42);
    expect(ctx.viewerUsername).toBe('tester');
    // The mock host's default theme is 'dark' (MockHostOptions.theme).
    expect(ctx.theme).toBe('dark');
  });

  it('🔴 a caller-supplied context that omits `theme` still receives the harness theme', async () => {
    // The mutant this kills: dropping the `hostContextWithTheme(...)` call and
    // using `baseContext` directly. It survived the whole suite because the
    // DEFAULT context already carries `theme`, so only a caller-supplied context
    // can see the difference. The real host sends `theme` on every model and
    // page slot unconditionally, so a harness that does not is simulating a host
    // that does not exist — and `applyThemeChange` can never repair it later,
    // because it only UPDATES a key that already exists.
    uninstall = createMockHost({
      theme: 'dark',
      context: {
        slotId: 'model.sidebar_top',
        modelId: 4471,
        modelVersionId: 90233,
        modelName: 'Nocturne XL',
        modelType: 'LORA',
        modelNsfwLevel: 2,
      },
    }).install();
    const { result } = renderHook(() => useBlockContext());
    await waitFor(() => expect(result.current.ready).toBe(true));

    const ctx = result.current.context;
    expect(isModelSlotContext(ctx)).toBe(true);
    if (!isModelSlotContext(ctx)) throw new Error('expected a model slot context');
    expect(ctx.theme).toBe('dark');
    // Top-level and in-context theme agree — the two fields the SDK's own types
    // invite a block to read interchangeably.
    expect(result.current.theme).toBe('dark');
  });

  it('does not alias the caller’s own context object into the snapshot', async () => {
    const mine = {
      slotId: 'app.page' as const,
      slug: 'notepad',
      subPath: '',
      viewerUserId: null,
    };
    uninstall = createMockHost({ context: mine }).install();
    const { result } = renderHook(() => useBlockContext());
    await waitFor(() => expect(result.current.ready).toBe(true));
    // Identity is already broken by `hostContextWithTheme`'s `structuredClone` —
    // NOT by the transport: the mock host dispatches a same-realm synthetic
    // `MessageEvent`, which passes `data` by reference and clones nothing. The
    // assertion that matters here is that the harness's object was not MUTATED
    // by the host layering `theme` onto it.
    expect(mine).toEqual({
      slotId: 'app.page',
      slug: 'notepad',
      subPath: '',
      viewerUserId: null,
    });
    expect('theme' in mine).toBe(false);
  });
});
