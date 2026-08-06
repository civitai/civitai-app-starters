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
 * already-deployed block bundle. Fetching the 9 live bundles served from
 * `<slug>.civit.ai` and executing their copy of it shows that dropping
 * `blockId`, dropping `appId`, or replacing `viewer` with a boolean each makes
 * it return `false`.
 *
 * A rejected `BLOCK_INIT` IS re-sent — the host re-posts it every
 * `INIT_RETRY_INTERVAL_MS` (400ms) until `BLOCK_READY` — but every retry carries
 * the same payload, so a rejecting validator rejects all of them, and at
 * `BLOCK_READY_TIMEOUT_MS` (10s) the host settles on its terminal failure state
 * (model slot collapses to nothing; page host renders its fallback). The block
 * never becomes ready either way; it fails in 10s rather than hanging forever.
 * Those are fleet-wide outages, not type changes. The guards below are the
 * regression fence around that finding.
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

/** The host test pins the viewer projection as exactly `{ id: 8888, username: 'alice' }` (+ `signedIn` in v2). */
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
    // Not a preference. This guard is compiled into all 9 live block bundles;
    // executing their copy against this payload returns false. The host DOES
    // retry (every 400ms for 10s) but each retry is byte-identical, so it is
    // rejected too and the launch ends in the host's terminal failure state.
    // Removing the field from the host is a fleet-wide outage. THIS TEST IS THE
    // FENCE — if a future change makes it pass, the wire removal it unblocks is
    // the outage.
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
    // deployed bundles' own copy of this guard against it returns false for all
    // 9 live apps. THIS TEST IS THE FENCE around that finding.
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
    // Measured against the deployed bundles: an absent `username` is rejected
    // 16/16, an explicit `null` accepted. `ViewerInfo.username` is `string |
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
// `PageBlockHost.buildContext()`, whose own contract tests assert the viewer key
// set EXACTLY.

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
    // `status` is @deprecated precisely because the platform withholds the
    // viewer's moderation state from third-party iframes (civitai #2521). The
    // host's own contract test pins `Object.keys(init.viewer).sort()` as
    // ['id','signedIn','username']; this is the mirror of that assertion.
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
    // structuredClone across the postMessage boundary already breaks identity;
    // the assertion that matters is that the harness's object was not MUTATED by
    // the host layering `theme` onto it.
    expect(mine).toEqual({
      slotId: 'app.page',
      slug: 'notepad',
      subPath: '',
      viewerUserId: null,
    });
    expect('theme' in mine).toBe(false);
  });
});
