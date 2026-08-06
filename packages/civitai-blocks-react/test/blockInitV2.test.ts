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
 * it return `false` — and a rejected `BLOCK_INIT` is never re-sent, so the block
 * never becomes ready. Those are fleet-wide blank-block outages, not type
 * changes. The guards below are the regression fence around that finding.
 *
 * FIXTURES. Values are non-default and pairwise distinct on purpose: a fixture
 * of `0` / `''` / `'test'` collapses distinct implementations into identical
 * output, so a total failure of an init path can pass. The one exception is
 * `HOST_DERIVED_*`, which is copied verbatim from civitai/civitai's own pinned
 * fixture — the point of that one is to pin the SDK type against the REAL wire
 * contract rather than against the same mental model that produced it.
 */
import { describe, expect, it } from 'vitest';

import { isModelSlotContext, isPageSlotContext } from '@civitai/app-sdk/blocks';

import {
  isValidBlockInitPayload,
  isValidTokenRefreshResponse,
  payloadValidatorFor,
} from '../src/internal/validate.js';
import { snapshotFromInit, withContextTheme } from '../src/internal/transport.js';

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
    // Every registered slot id, exercised through the RUNTIME guards.
    // `model.actions_extra` is registered and live but has no production
    // producer yet, so it is the arm most likely to be dropped by a "tidy the
    // union" edit and least likely to be noticed — which is exactly why each
    // arm gets its own case rather than one representative model slot.
    const ctx = { slotId } as never;
    expect(isModelSlotContext(ctx)).toBe(isModel);
    expect(isPageSlotContext(ctx)).toBe(isPage);
  });

  it('still rejects a context with no usable slotId', () => {
    expect(isValidBlockInitPayload({ ...structuredClone(v2Init), context: { slotId: '' } })).toBe(
      false,
    );
    expect(isValidBlockInitPayload(without(v2Init, 'context'))).toBe(false);
  });

  it('withContextTheme never invents `theme` on a context that lacks it', () => {
    // The unknown arm carries `slotId` only. Bolting a theme onto it would
    // fabricate a field the host never sent, on exactly the contexts this SDK
    // understands least. Same test `applyThemeChange` applies to a push.
    expect(withContextTheme({ slotId: 'image.below_actions' }, 'dark')).toEqual({
      slotId: 'image.below_actions',
    });
    // …and it DOES update one that carries the field.
    expect(
      withContextTheme(
        { slotId: 'app.page', slug: 'notepad', subPath: '', viewerUserId: null, theme: 'light' },
        'dark',
      ),
    ).toMatchObject({ slotId: 'app.page', theme: 'dark' });
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
    // executing their copy against this payload returns false, and a rejected
    // BLOCK_INIT is never retried. Removing the field from the host is a
    // fleet-wide blank-block outage. THIS TEST IS THE FENCE — if a future change
    // makes it pass, the wire removal it unblocks is the outage.
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

  it('rejects a signedIn that is present but not `true`', () => {
    // `signedIn: false` inside a NON-NULL viewer is a contradiction — anonymous
    // is `viewer: null`. Letting it through would let a block gate its UI on a
    // malformed claim about identity state.
    expect(
      isValidBlockInitPayload({
        ...structuredClone(v2Init),
        viewer: { id: 8888, username: 'alice', signedIn: false },
      }),
    ).toBe(false);
    expect(
      isValidBlockInitPayload({
        ...structuredClone(v2Init),
        viewer: { id: 8888, username: 'alice', signedIn: 'yes' },
      }),
    ).toBe(false);
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
    // 5 of the 9 live apps read `viewer.id` for load-bearing logic (ownership
    // filters, optimistic row authorship). It stays until those migrate.
    const snap = snapshotFromInit(v2Init as never);
    expect(snap.viewer?.id).toBe(8888);
    expect(snap.viewer?.username).toBe('alice');
  });
});
