import { describe, expect, it } from 'vitest';

import {
  isValidAppWorkflowsResult,
  isValidCancelAppWorkflowResult,
  isValidAppStorageDeleteResult,
  isValidAppStorageGetResult,
  isValidAppStorageListResult,
  isValidAppStorageQuotaResult,
  isValidAppStorageSetResult,
  isValidBlockInitPayload,
  isValidBuzzBalanceResult,
  isValidBuzzPurchaseResult,
  isValidCheckpointPickerResult,
  isValidImageUploadResult,
  isValidResourcePickerResult,
  isValidSharedAppendResult,
  isValidSharedCountResult,
  isValidSharedCountsResult,
  isValidSharedGetResult,
  isValidSharedListResult,
  isValidSharedReportResult,
  isValidSharedUpdateResult,
  isValidSharedWithdrawResult,
  isValidSaveImageResult,
  isValidThemeChange,
  isValidTokenRefresh,
  isValidTokenRefreshResponse,
  isValidUserCheckpointSetResult,
  isValidViewerResult,
  isValidWorkflowReply,
  isValidWorkflowSnapshot,
  payloadValidatorFor,
} from '../src/internal/validate.js';

const validInit = {
  blockInstanceId: 'inst-1',
  blockId: 'b',
  appId: 'app_test',
  token: { raw: 'jwt-1', scopes: ['models:read:self'], expiresAt: new Date().toISOString() },
  context: { slotId: 'model.sidebar_top' },
  settings: { publisherSettings: {}, userSettings: {} },
  viewer: { id: 1, username: 'a', status: 'active' },
  theme: 'light',
  renderMode: 'iframe',
};

describe('isValidBlockInitPayload', () => {
  it('accepts a complete payload', () => {
    expect(isValidBlockInitPayload(validInit)).toBe(true);
  });

  it('accepts a payload with viewer=null (anonymous viewer)', () => {
    expect(isValidBlockInitPayload({ ...validInit, viewer: null })).toBe(true);
  });

  it('accepts the #2670 domain/maxBrowsingLevel fields when present', () => {
    expect(isValidBlockInitPayload({ ...validInit, domain: 'green', maxBrowsingLevel: 3 })).toBe(true);
    expect(isValidBlockInitPayload({ ...validInit, domain: 'red', maxBrowsingLevel: 31 })).toBe(true);
    expect(isValidBlockInitPayload({ ...validInit, domain: null })).toBe(true);
  });

  it('accepts a payload without the #2670 fields (host predating it)', () => {
    expect(isValidBlockInitPayload(validInit)).toBe(true);
  });

  it.each([
    ['domain unknown string', { ...validInit, domain: 'purple' }],
    ['domain wrong type', { ...validInit, domain: 1 }],
    ['maxBrowsingLevel non-finite', { ...validInit, maxBrowsingLevel: Infinity }],
    ['maxBrowsingLevel NaN', { ...validInit, maxBrowsingLevel: NaN }],
    ['maxBrowsingLevel wrong type', { ...validInit, maxBrowsingLevel: '4' }],
  ])('rejects %s', (_, payload) => {
    expect(isValidBlockInitPayload(payload)).toBe(false);
  });

  it.each([
    ['missing token', { ...validInit, token: undefined }],
    ['token.raw not a string', { ...validInit, token: { ...validInit.token, raw: 123 } }],
    ['token.expiresAt not parseable', { ...validInit, token: { ...validInit.token, expiresAt: 'tomorrow' } }],
    ['token.expiresAt missing', { ...validInit, token: { raw: 'j', scopes: [] } }],
    ['scopes not array', { ...validInit, token: { ...validInit.token, scopes: 'models' } }],
    ['scopes contains non-string', { ...validInit, token: { ...validInit.token, scopes: [42] } }],
    ['renderMode unknown', { ...validInit, renderMode: 'hybrid' }],
    ['viewer.id missing', { ...validInit, viewer: { username: 'a', status: 'active' } }],
    ['viewer.status unknown', { ...validInit, viewer: { id: 1, username: 'a', status: 'shadow' } }],
    ['theme not a known string', { ...validInit, theme: 'sepia' }],
    ['theme as object', { ...validInit, theme: { colorScheme: 'light' } }],
    ['missing appId', { ...validInit, appId: undefined }],
    ['context.slotId empty', { ...validInit, context: { slotId: '' } }],
    ['null payload', null],
    ['string payload', 'oops'],
    ['undefined payload', undefined],
  ])('rejects %s', (_, payload) => {
    expect(isValidBlockInitPayload(payload)).toBe(false);
  });
});

describe('isValidWorkflowSnapshot', () => {
  it('accepts a minimal snapshot', () => {
    expect(isValidWorkflowSnapshot({ workflowId: 'w1', status: 'pending' })).toBe(true);
  });
  it('accepts a populated snapshot', () => {
    expect(
      isValidWorkflowSnapshot({
        workflowId: 'w1',
        status: 'succeeded',
        cost: { total: 5 },
        imageUrls: ['https://x/a.png'],
      }),
    ).toBe(true);
  });
  it('accepts a snapshot carrying a well-formed autoClaim (dailyBoost)', () => {
    expect(
      isValidWorkflowSnapshot({
        workflowId: 'w1',
        status: 'succeeded',
        autoClaim: { type: 'dailyBoost', amount: 25, accountType: 'blue' },
      }),
    ).toBe(true);
  });
  it.each([
    ['unknown status', { workflowId: 'w', status: 'queued' }],
    ['missing workflowId', { status: 'pending' }],
    ['imageUrls contains non-string', { workflowId: 'w', status: 'succeeded', imageUrls: [1] }],
    ['cost.total not number', { workflowId: 'w', status: 'succeeded', cost: { total: 'free' } }],
    [
      'autoClaim.type unknown',
      {
        workflowId: 'w',
        status: 'succeeded',
        autoClaim: { type: 'jackpot', amount: 25, accountType: 'blue' },
      },
    ],
    [
      'autoClaim.amount NaN',
      {
        workflowId: 'w',
        status: 'succeeded',
        autoClaim: { type: 'dailyBoost', amount: Number.NaN, accountType: 'blue' },
      },
    ],
    [
      'autoClaim.accountType unknown',
      {
        workflowId: 'w',
        status: 'succeeded',
        autoClaim: { type: 'dailyBoost', amount: 25, accountType: 'purple' },
      },
    ],
  ])('rejects %s', (_, payload) => {
    expect(isValidWorkflowSnapshot(payload)).toBe(false);
  });
});

describe('isValidTokenRefresh', () => {
  it('accepts a well-formed host-pushed refresh (no requestId)', () => {
    expect(
      isValidTokenRefresh({
        token: { raw: 'jwt-2', scopes: ['models:read:self'], expiresAt: new Date().toISOString() },
      }),
    ).toBe(true);
  });
  it('rejects missing token wrapper', () => {
    expect(isValidTokenRefresh({})).toBe(false);
  });
  it('rejects token.expiresAt unparseable', () => {
    expect(
      isValidTokenRefresh({ token: { raw: 'jwt', scopes: [], expiresAt: 'soon' } }),
    ).toBe(false);
  });
});

describe('isValidTokenRefreshResponse', () => {
  it('accepts a well-formed reply with requestId', () => {
    expect(
      isValidTokenRefreshResponse({
        requestId: 'r1',
        token: { raw: 'jwt-2', scopes: ['models:read:self'], expiresAt: new Date().toISOString() },
      }),
    ).toBe(true);
  });
  it('accepts a reply without requestId (host omits it when block did not supply one)', () => {
    expect(
      isValidTokenRefreshResponse({
        token: { raw: 'jwt-2', scopes: ['models:read:self'], expiresAt: new Date().toISOString() },
      }),
    ).toBe(true);
  });
  it('rejects when token wrapper is the old flat string shape', () => {
    expect(
      isValidTokenRefreshResponse({
        requestId: 'r1',
        token: 'jwt-2',
        expiresAt: new Date().toISOString(),
      }),
    ).toBe(false);
  });
  it('rejects missing token', () => {
    expect(isValidTokenRefreshResponse({ requestId: 'r1' })).toBe(false);
  });
});

describe('isValidWorkflowReply', () => {
  it('accepts a reply wrapping a valid snapshot', () => {
    expect(
      isValidWorkflowReply({ snapshot: { workflowId: 'w', status: 'pending' }, requestId: 'r' }),
    ).toBe(true);
  });
  it('rejects when snapshot is malformed', () => {
    expect(isValidWorkflowReply({ snapshot: { status: 'pending' }, requestId: 'r' })).toBe(false);
  });
});

describe('isValidBuzzPurchaseResult', () => {
  it('accepts a minimal reply', () => {
    expect(isValidBuzzPurchaseResult({ purchased: true })).toBe(true);
  });
  it('rejects when purchased is not boolean', () => {
    expect(isValidBuzzPurchaseResult({ purchased: 'yes' })).toBe(false);
  });
});

describe('isValidBuzzBalanceResult', () => {
  it('accepts a success reply carrying the { blue, green, yellow } balance', () => {
    expect(
      isValidBuzzBalanceResult({ requestId: 'r', balance: { blue: 0, green: 12, yellow: 340 } }),
    ).toBe(true);
  });
  it('accepts an error-only reply', () => {
    expect(isValidBuzzBalanceResult({ requestId: 'r', error: 'RATE_LIMITED' })).toBe(true);
  });
  it.each([
    ['neither balance nor error', { requestId: 'r' }],
    ['balance missing a pool', { requestId: 'r', balance: { blue: 1, green: 2 } }],
    ['balance pool not a number', { requestId: 'r', balance: { blue: 1, green: 2, yellow: '3' } }],
    ['balance pool NaN', { requestId: 'r', balance: { blue: 1, green: 2, yellow: Number.NaN } }],
    ['balance not an object', { requestId: 'r', balance: 5 }],
    ['error not a string', { requestId: 'r', error: 500 }],
    ['requestId not a string', { requestId: 5, balance: { blue: 1, green: 2, yellow: 3 } }],
    ['null payload', null],
    ['string payload', 'oops'],
  ])('rejects %s', (_, payload) => {
    expect(isValidBuzzBalanceResult(payload)).toBe(false);
  });
});

describe('isValidViewerResult', () => {
  it('accepts a success reply carrying the { id, username, status, buzzBudget } viewer', () => {
    expect(
      isValidViewerResult({
        requestId: 'r',
        viewer: { id: 7, username: 'v', status: 'active', buzzBudget: 200 },
      }),
    ).toBe(true);
  });
  // THE NULL-VS-UNDEFINED TRAP (host PR #3152): `username` and `buzzBudget` are
  // present-but-NULLABLE. A too-strict guard that rejected `null` would drop a
  // valid reply → hang the reading hook to its timeout (the exact bug that hung
  // useBuzzTransactions on the null cursor). Both nulls MUST be accepted.
  it('accepts a viewer with NULL username AND NULL buzzBudget', () => {
    expect(
      isValidViewerResult({
        requestId: 'r',
        viewer: { id: 7, username: null, status: 'muted', buzzBudget: null },
      }),
    ).toBe(true);
  });
  it('accepts a viewer with a null username but a numeric buzzBudget', () => {
    expect(
      isValidViewerResult({
        requestId: 'r',
        viewer: { id: 7, username: null, status: 'active', buzzBudget: 0 },
      }),
    ).toBe(true);
  });
  it('accepts an error-only reply', () => {
    expect(isValidViewerResult({ requestId: 'r', error: 'not signed in' })).toBe(true);
  });
  it.each([
    ['neither viewer nor error', { requestId: 'r' }],
    ['viewer missing id', { requestId: 'r', viewer: { username: 'v', status: 'active', buzzBudget: 1 } }],
    ['viewer id not a number', { requestId: 'r', viewer: { id: '7', username: 'v', status: 'active', buzzBudget: 1 } }],
    ['viewer id NaN', { requestId: 'r', viewer: { id: Number.NaN, username: 'v', status: 'active', buzzBudget: 1 } }],
    ['viewer username a number', { requestId: 'r', viewer: { id: 7, username: 5, status: 'active', buzzBudget: 1 } }],
    ['viewer status unknown', { requestId: 'r', viewer: { id: 7, username: 'v', status: 'banned', buzzBudget: 1 } }],
    ['viewer status missing', { requestId: 'r', viewer: { id: 7, username: 'v', buzzBudget: 1 } }],
    ['buzzBudget missing (required present)', { requestId: 'r', viewer: { id: 7, username: 'v', status: 'active' } }],
    ['buzzBudget not a number', { requestId: 'r', viewer: { id: 7, username: 'v', status: 'active', buzzBudget: 'x' } }],
    ['buzzBudget NaN', { requestId: 'r', viewer: { id: 7, username: 'v', status: 'active', buzzBudget: Number.NaN } }],
    ['viewer not an object', { requestId: 'r', viewer: 5 }],
    ['error not a string', { requestId: 'r', error: 500 }],
    ['requestId not a string', { requestId: 5, viewer: { id: 7, username: 'v', status: 'active', buzzBudget: 1 } }],
    ['null payload', null],
    ['string payload', 'oops'],
  ])('rejects %s', (_, payload) => {
    expect(isValidViewerResult(payload)).toBe(false);
  });
});

describe('isValidImageUploadResult', () => {
  const selected = {
    imageId: 12345,
    nsfwLevel: 1,
    contentRating: 'pg',
    url: 'https://image.civitai.com/x/original=true/a.jpeg',
  };

  it('accepts a successful upload (moderated image)', () => {
    expect(isValidImageUploadResult({ requestId: 'r', selected })).toBe(true);
  });
  it('accepts a cancelled upload (no `selected`)', () => {
    expect(isValidImageUploadResult({ requestId: 'r' })).toBe(true);
    expect(isValidImageUploadResult({})).toBe(true);
  });
  it('accepts every content-rating ladder value', () => {
    for (const cr of ['g', 'pg', 'pg13', 'r', 'x']) {
      expect(isValidImageUploadResult({ selected: { ...selected, contentRating: cr } })).toBe(true);
    }
  });

  const source = {
    url: 'https://image.civitai.com/x/original=true/source.jpeg',
    width: 1024,
    height: 768,
  };
  it("accepts the generationSource shape ({ url, width, height }, no imageId)", () => {
    expect(isValidImageUploadResult({ requestId: 'r', selected: source })).toBe(true);
  });
  it.each([
    ['source width missing', { selected: { url: source.url, height: 768 } }],
    ['source height missing', { selected: { url: source.url, width: 1024 } }],
    ['source width not a number', { selected: { ...source, width: '1024' } }],
    ['source width non-positive', { selected: { ...source, width: 0 } }],
    ['source height NaN', { selected: { ...source, height: Number.NaN } }],
    ['source url empty', { selected: { ...source, url: '' } }],
    ['neither moderated nor source (url only)', { selected: { url: source.url } }],
  ])('rejects %s', (_, payload) => {
    expect(isValidImageUploadResult(payload)).toBe(false);
  });
  it.each([
    ['imageId not a number', { selected: { ...selected, imageId: '12' } }],
    ['imageId non-integer', { selected: { ...selected, imageId: 1.5 } }],
    ['imageId non-positive', { selected: { ...selected, imageId: 0 } }],
    ['nsfwLevel not a number', { selected: { ...selected, nsfwLevel: 'sfw' } }],
    ['nsfwLevel NaN', { selected: { ...selected, nsfwLevel: Number.NaN } }],
    ['contentRating unknown', { selected: { ...selected, contentRating: 'xxx' } }],
    ['contentRating wrong type', { selected: { ...selected, contentRating: 3 } }],
    ['url empty', { selected: { ...selected, url: '' } }],
    ['url wrong type', { selected: { ...selected, url: 42 } }],
    ['selected not an object', { selected: 5 }],
    ['requestId not a string', { requestId: 7, selected }],
    ['null payload', null],
    ['string payload', 'oops'],
  ])('rejects %s', (_, payload) => {
    expect(isValidImageUploadResult(payload)).toBe(false);
  });
});

describe('isValidSharedUpdateResult', () => {
  it('accepts an ok reply (with or without an error)', () => {
    expect(isValidSharedUpdateResult({ requestId: 'r', ok: true })).toBe(true);
    expect(isValidSharedUpdateResult({ ok: true })).toBe(true);
    expect(isValidSharedUpdateResult({ requestId: 'r', ok: false, error: 'FORBIDDEN' })).toBe(true);
    expect(isValidSharedUpdateResult({ requestId: 'r', ok: false, error: 'NOT_FOUND' })).toBe(true);
  });
  it('rejects a malformed reply', () => {
    expect(isValidSharedUpdateResult(null)).toBe(false);
    expect(isValidSharedUpdateResult({})).toBe(false); // missing ok
    expect(isValidSharedUpdateResult({ ok: 'yes' })).toBe(false); // ok not boolean
    expect(isValidSharedUpdateResult({ ok: true, error: 5 })).toBe(false); // error not string
    expect(isValidSharedUpdateResult({ ok: true, requestId: 5 })).toBe(false); // requestId not string
  });
});

// ============================================================
// App-storage reply validators
// ============================================================

describe('isValidAppStorageGetResult', () => {
  it('accepts any value incl. null (unset key / anon)', () => {
    expect(isValidAppStorageGetResult({ requestId: 'r', value: { any: 'json' } })).toBe(true);
    expect(isValidAppStorageGetResult({ requestId: 'r', value: null })).toBe(true);
    expect(isValidAppStorageGetResult({ requestId: 'r', value: 42 })).toBe(true);
  });
  it('accepts an error reply (host sends value:null + error)', () => {
    expect(isValidAppStorageGetResult({ requestId: 'r', value: null, error: 'NOT_FOUND' })).toBe(true);
  });
  it.each([
    ['neither value nor error', { requestId: 'r' }],
    ['error not a string', { requestId: 'r', value: null, error: 5 }],
    ['requestId not a string', { requestId: 5, value: 1 }],
    ['null payload', null],
  ])('rejects %s', (_, payload) => {
    expect(isValidAppStorageGetResult(payload)).toBe(false);
  });
});

describe('isValidAppStorageSetResult', () => {
  it('accepts ok:true with sizeBytes', () => {
    expect(isValidAppStorageSetResult({ requestId: 'r', ok: true, sizeBytes: 23 })).toBe(true);
  });
  it('accepts ok:false with error (no sizeBytes)', () => {
    expect(isValidAppStorageSetResult({ requestId: 'r', ok: false, error: 'PAYLOAD_TOO_LARGE' })).toBe(true);
  });
  it.each([
    ['missing ok', { requestId: 'r' }],
    ['ok not boolean', { requestId: 'r', ok: 'yes' }],
    ['sizeBytes not a number', { requestId: 'r', ok: true, sizeBytes: '23' }],
    ['sizeBytes NaN', { requestId: 'r', ok: true, sizeBytes: Number.NaN }],
  ])('rejects %s', (_, payload) => {
    expect(isValidAppStorageSetResult(payload)).toBe(false);
  });
});

describe('isValidAppStorageDeleteResult', () => {
  it('accepts ok + deleted booleans (both success and error paths)', () => {
    expect(isValidAppStorageDeleteResult({ requestId: 'r', ok: true, deleted: true })).toBe(true);
    expect(isValidAppStorageDeleteResult({ requestId: 'r', ok: true, deleted: false })).toBe(true);
    expect(isValidAppStorageDeleteResult({ requestId: 'r', ok: false, deleted: false, error: 'X' })).toBe(true);
  });
  it.each([
    ['missing ok', { requestId: 'r', deleted: true }],
    ['missing deleted', { requestId: 'r', ok: true }],
    ['deleted not boolean', { requestId: 'r', ok: true, deleted: 'yes' }],
  ])('rejects %s', (_, payload) => {
    expect(isValidAppStorageDeleteResult(payload)).toBe(false);
  });
});

describe('isValidAppStorageListResult', () => {
  const iso = '2026-05-27T10:11:12.000Z';
  it('accepts keys with ISO updatedAt + cursor', () => {
    expect(
      isValidAppStorageListResult({ requestId: 'r', keys: [{ key: 'k', updatedAt: iso }], nextCursor: 'Zm9v' }),
    ).toBe(true);
  });
  it('accepts an empty keys array', () => {
    expect(isValidAppStorageListResult({ requestId: 'r', keys: [] })).toBe(true);
  });
  it('accepts a Date-instance updatedAt (structured-clone tolerance)', () => {
    expect(isValidAppStorageListResult({ requestId: 'r', keys: [{ key: 'k', updatedAt: new Date() }] })).toBe(true);
  });
  it('accepts an error reply (host sends keys:[] + error)', () => {
    expect(isValidAppStorageListResult({ requestId: 'r', keys: [], error: 'BOOM' })).toBe(true);
  });
  it.each([
    ['keys not an array', { requestId: 'r', keys: 'nope' }],
    ['key entry missing key', { requestId: 'r', keys: [{ updatedAt: iso }] }],
    ['key entry updatedAt not date-like', { requestId: 'r', keys: [{ key: 'k', updatedAt: 'never' }] }],
    ['nextCursor not a string', { requestId: 'r', keys: [], nextCursor: 5 }],
  ])('rejects %s', (_, payload) => {
    expect(isValidAppStorageListResult(payload)).toBe(false);
  });
});

describe('isValidAppStorageQuotaResult', () => {
  it('accepts the four numeric counters', () => {
    expect(
      isValidAppStorageQuotaResult({ requestId: 'r', usedBytes: 1, rowCount: 2, limitBytes: 3, limitRows: 4 }),
    ).toBe(true);
  });
  it('accepts an error reply (host zeroes the counters + adds error)', () => {
    expect(
      isValidAppStorageQuotaResult({ requestId: 'r', usedBytes: 0, rowCount: 0, limitBytes: 0, limitRows: 0, error: 'X' }),
    ).toBe(true);
  });
  it.each([
    ['usedBytes missing', { requestId: 'r', rowCount: 2, limitBytes: 3, limitRows: 4 }],
    ['rowCount not a number', { requestId: 'r', usedBytes: 1, rowCount: '2', limitBytes: 3, limitRows: 4 }],
    ['limitBytes NaN', { requestId: 'r', usedBytes: 1, rowCount: 2, limitBytes: Number.NaN, limitRows: 4 }],
  ])('rejects %s', (_, payload) => {
    expect(isValidAppStorageQuotaResult(payload)).toBe(false);
  });
});

// ============================================================
// Shared-storage reply validators
// ============================================================

describe('isValidSharedListResult', () => {
  const item = {
    key: 'req:1',
    authorUserId: 7,
    value: { title: 'Dark mode', body: 'please' },
    count: 3,
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-02T00:00:00.000Z',
  };
  it('accepts a well-formed list', () => {
    expect(isValidSharedListResult({ requestId: 'r', items: [item], nextCursor: 'bmV4dA==' })).toBe(true);
  });
  it('accepts an empty list', () => {
    expect(isValidSharedListResult({ requestId: 'r', items: [] })).toBe(true);
  });
  it('accepts a value with only a title (body/data optional)', () => {
    expect(isValidSharedListResult({ requestId: 'r', items: [{ ...item, value: { title: 't' } }] })).toBe(true);
  });
  it('accepts an item WITH viewerVoted (additive) and one WITHOUT it (absent-safe)', () => {
    expect(isValidSharedListResult({ requestId: 'r', items: [{ ...item, viewerVoted: true }] })).toBe(true);
    expect(isValidSharedListResult({ requestId: 'r', items: [{ ...item, viewerVoted: false }] })).toBe(true);
    // Absent is fine — an old host omits it (the hook defaults false).
    expect(isValidSharedListResult({ requestId: 'r', items: [item] })).toBe(true);
  });
  it('accepts an error reply', () => {
    expect(isValidSharedListResult({ requestId: 'r', items: [], error: 'SHARED_UNAVAILABLE' })).toBe(true);
  });
  it.each([
    ['items not an array', { requestId: 'r', items: 'x' }],
    ['item missing key', { requestId: 'r', items: [{ ...item, key: undefined }] }],
    ['item authorUserId not a number', { requestId: 'r', items: [{ ...item, authorUserId: '7' }] }],
    ['item value missing title', { requestId: 'r', items: [{ ...item, value: { body: 'x' } }] }],
    ['item value not an object', { requestId: 'r', items: [{ ...item, value: 5 }] }],
    ['item count not a number', { requestId: 'r', items: [{ ...item, count: '3' }] }],
    ['item createdAt not date-like', { requestId: 'r', items: [{ ...item, createdAt: 'never' }] }],
    ['item viewerVoted not a boolean', { requestId: 'r', items: [{ ...item, viewerVoted: 'yes' }] }],
    ['nextCursor not a string', { requestId: 'r', items: [], nextCursor: 5 }],
  ])('rejects %s', (_, payload) => {
    expect(isValidSharedListResult(payload)).toBe(false);
  });
});

describe('isValidSharedGetResult (SHARED_GET)', () => {
  const item = {
    key: 'req:1',
    authorUserId: 7,
    value: { title: 'Dark mode', body: 'please' },
    count: 3,
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-02T00:00:00.000Z',
    viewerVoted: true,
  };
  it('accepts a found item', () => {
    expect(isValidSharedGetResult({ requestId: 'r', item })).toBe(true);
  });
  it('accepts a null item (missing/hidden — a valid non-error result)', () => {
    expect(isValidSharedGetResult({ requestId: 'r', item: null })).toBe(true);
  });
  it('accepts an item without viewerVoted (absent-safe)', () => {
    const { viewerVoted: _drop, ...rest } = item;
    expect(isValidSharedGetResult({ requestId: 'r', item: rest })).toBe(true);
  });
  it('accepts an error reply', () => {
    expect(isValidSharedGetResult({ requestId: 'r', item: null, error: 'SHARED_UNAVAILABLE' })).toBe(true);
  });
  it.each([
    ['item missing (undefined), no error', { requestId: 'r' }],
    ['item missing key', { requestId: 'r', item: { ...item, key: undefined } }],
    ['item count not a number', { requestId: 'r', item: { ...item, count: '3' } }],
    ['item value missing title', { requestId: 'r', item: { ...item, value: { body: 'x' } } }],
    ['item viewerVoted not boolean', { requestId: 'r', item: { ...item, viewerVoted: 1 } }],
    ['error not a string', { requestId: 'r', item: null, error: 5 }],
  ])('rejects %s', (_, payload) => {
    expect(isValidSharedGetResult(payload)).toBe(false);
  });
});

describe('isValidSharedReportResult (SHARED_REPORT)', () => {
  it('accepts ok true/false', () => {
    expect(isValidSharedReportResult({ requestId: 'r', ok: true })).toBe(true);
    expect(isValidSharedReportResult({ requestId: 'r', ok: false, error: 'NOT_FOUND' })).toBe(true);
  });
  it.each([
    ['ok missing', { requestId: 'r' }],
    ['ok not boolean', { requestId: 'r', ok: 'yes' }],
    ['error not a string', { requestId: 'r', ok: false, error: 5 }],
  ])('rejects %s', (_, payload) => {
    expect(isValidSharedReportResult(payload)).toBe(false);
  });
});

describe('isValidSaveImageResult (SAVE_IMAGE)', () => {
  it('accepts ok true/false', () => {
    expect(isValidSaveImageResult({ requestId: 'r', ok: true })).toBe(true);
    expect(isValidSaveImageResult({ requestId: 'r', ok: false, error: 'image url is not allowed' })).toBe(true);
  });
  it.each([
    ['ok missing', { requestId: 'r' }],
    ['ok not boolean', { requestId: 'r', ok: 1 }],
    ['error not a string', { requestId: 'r', ok: false, error: {} }],
  ])('rejects %s', (_, payload) => {
    expect(isValidSaveImageResult(payload)).toBe(false);
  });
});

describe('isValidSharedCountResult (GET_COUNT / VOTE / UNVOTE)', () => {
  it('accepts a finite count', () => {
    expect(isValidSharedCountResult({ requestId: 'r', count: 42 })).toBe(true);
    expect(isValidSharedCountResult({ requestId: 'r', count: 0 })).toBe(true);
  });
  it('accepts an error reply', () => {
    expect(isValidSharedCountResult({ requestId: 'r', error: 'NOT_FOUND' })).toBe(true);
  });
  it.each([
    ['count missing, no error', { requestId: 'r' }],
    ['count not a number', { requestId: 'r', count: '5' }],
    ['count NaN', { requestId: 'r', count: Number.NaN }],
    ['error not a string', { requestId: 'r', error: 5 }],
  ])('rejects %s', (_, payload) => {
    expect(isValidSharedCountResult(payload)).toBe(false);
  });
});

describe('isValidSharedCountsResult', () => {
  it('accepts a map of key → finite count', () => {
    expect(isValidSharedCountsResult({ requestId: 'r', counts: { a: 1, b: 0, c: 5 } })).toBe(true);
    expect(isValidSharedCountsResult({ requestId: 'r', counts: {} })).toBe(true);
  });
  it('accepts an error reply', () => {
    expect(isValidSharedCountsResult({ requestId: 'r', error: 'X' })).toBe(true);
  });
  it.each([
    ['counts missing, no error', { requestId: 'r' }],
    ['counts not an object', { requestId: 'r', counts: 5 }],
    ['a count value not a number', { requestId: 'r', counts: { a: '1' } }],
    ['a count value NaN', { requestId: 'r', counts: { a: Number.NaN } }],
  ])('rejects %s', (_, payload) => {
    expect(isValidSharedCountsResult(payload)).toBe(false);
  });
});

describe('isValidSharedAppendResult', () => {
  it('accepts a minted key', () => {
    expect(isValidSharedAppendResult({ requestId: 'r', key: 'shared_9' })).toBe(true);
  });
  it('accepts an error reply (key may be empty alongside error)', () => {
    expect(isValidSharedAppendResult({ requestId: 'r', key: '', error: 'INVALID_VALUE' })).toBe(true);
  });
  it.each([
    ['key missing, no error', { requestId: 'r' }],
    ['key empty, no error', { requestId: 'r', key: '' }],
    ['key not a string', { requestId: 'r', key: 5 }],
  ])('rejects %s', (_, payload) => {
    expect(isValidSharedAppendResult(payload)).toBe(false);
  });
});

describe('isValidSharedWithdrawResult', () => {
  it('accepts ok + deleted booleans', () => {
    expect(isValidSharedWithdrawResult({ requestId: 'r', ok: true, deleted: true })).toBe(true);
    expect(isValidSharedWithdrawResult({ requestId: 'r', ok: true, deleted: false })).toBe(true);
  });
  it('accepts an error reply', () => {
    expect(isValidSharedWithdrawResult({ requestId: 'r', error: 'SHARED_UNAVAILABLE' })).toBe(true);
  });
  it.each([
    ['ok missing, no error', { requestId: 'r', deleted: true }],
    ['deleted missing, no error', { requestId: 'r', ok: true }],
    ['deleted not boolean', { requestId: 'r', ok: true, deleted: 'yes' }],
  ])('rejects %s', (_, payload) => {
    expect(isValidSharedWithdrawResult(payload)).toBe(false);
  });
});

// ============================================================
// Picker + user-checkpoint reply validators
// ============================================================

describe('isValidCheckpointPickerResult', () => {
  const selected = { versionId: 9001, modelId: 700, modelName: 'M', versionName: 'v2', baseModel: 'SDXL 1.0' };
  it('accepts a full checkpoint pick', () => {
    expect(isValidCheckpointPickerResult({ requestId: 'r', selected })).toBe(true);
  });
  it('accepts a dismiss (no `selected`)', () => {
    expect(isValidCheckpointPickerResult({ requestId: 'r' })).toBe(true);
    expect(isValidCheckpointPickerResult({})).toBe(true);
  });
  it('accepts an id-only projection (display fields optional)', () => {
    expect(isValidCheckpointPickerResult({ requestId: 'r', selected: { versionId: 1, modelId: 2, baseModel: 'X' } })).toBe(true);
  });
  it.each([
    ['versionId missing', { requestId: 'r', selected: { modelId: 2 } }],
    ['versionId not a number', { requestId: 'r', selected: { ...selected, versionId: '9001' } }],
    ['versionId non-integer', { requestId: 'r', selected: { ...selected, versionId: 1.5 } }],
    ['versionId non-positive', { requestId: 'r', selected: { ...selected, versionId: 0 } }],
    ['modelId non-positive', { requestId: 'r', selected: { ...selected, modelId: 0 } }],
    ['modelName wrong type', { requestId: 'r', selected: { ...selected, modelName: 5 } }],
    ['selected not an object', { requestId: 'r', selected: 5 }],
  ])('rejects %s', (_, payload) => {
    expect(isValidCheckpointPickerResult(payload)).toBe(false);
  });
});

describe('isValidResourcePickerResult', () => {
  const selected = {
    versionId: 9001,
    modelId: 700,
    modelName: 'M',
    versionName: 'v2',
    baseModel: 'Flux.1 D',
    modelType: 'Checkpoint',
    strength: 1,
    minStrength: -1,
    maxStrength: 2,
    trainedWords: ['a', 'b'],
    clipSkip: null,
  };
  it('accepts a full resource pick (with recommended settings)', () => {
    expect(isValidResourcePickerResult({ requestId: 'r', selected })).toBe(true);
  });
  it('accepts a clipSkip number', () => {
    expect(isValidResourcePickerResult({ requestId: 'r', selected: { ...selected, clipSkip: 2 } })).toBe(true);
  });
  it('accepts an id-only projection', () => {
    expect(isValidResourcePickerResult({ requestId: 'r', selected: { versionId: 42, modelId: 7, baseModel: 'X', modelType: 'LORA' } })).toBe(true);
  });
  it('accepts a dismiss (no `selected`)', () => {
    expect(isValidResourcePickerResult({ requestId: 'r' })).toBe(true);
  });
  it.each([
    ['versionId missing', { requestId: 'r', selected: { modelType: 'LORA' } }],
    ['strength not a number', { requestId: 'r', selected: { ...selected, strength: 'x' } }],
    ['trainedWords not an array', { requestId: 'r', selected: { ...selected, trainedWords: 'a' } }],
    ['trainedWords contains non-string', { requestId: 'r', selected: { ...selected, trainedWords: [1] } }],
    ['clipSkip wrong type (not number|null)', { requestId: 'r', selected: { ...selected, clipSkip: 'x' } }],
    ['modelType wrong type', { requestId: 'r', selected: { ...selected, modelType: 5 } }],
  ])('rejects %s', (_, payload) => {
    expect(isValidResourcePickerResult(payload)).toBe(false);
  });
});

describe('isValidUserCheckpointSetResult', () => {
  it('accepts ok:true and ok:false+error', () => {
    expect(isValidUserCheckpointSetResult({ requestId: 'r', ok: true })).toBe(true);
    expect(isValidUserCheckpointSetResult({ requestId: 'r', ok: false, error: 'wrong-ecosystem' })).toBe(true);
  });
  it.each([
    ['missing ok', { requestId: 'r' }],
    ['ok not boolean', { requestId: 'r', ok: 'yes' }],
    ['error not a string', { requestId: 'r', ok: false, error: 5 }],
  ])('rejects %s', (_, payload) => {
    expect(isValidUserCheckpointSetResult(payload)).toBe(false);
  });
});

describe('isValidAppWorkflowsResult', () => {
  const validWorkflow = {
    workflowId: 'wf_1',
    status: 'succeeded',
    images: [
      { url: 'https://image.civitai.com/x/a.jpeg', width: 1024, height: 1024, nsfwLevel: 1 },
      // legitimate nullish dims/rating — must be accepted (the too-strict trap).
      { url: 'https://image.civitai.com/x/b.jpeg', width: null, height: null, nsfwLevel: null },
    ],
    cost: 12,
    createdAt: '2026-07-14T12:00:00.000Z',
  };

  it('accepts a success result with a page of workflows + a null cursor', () => {
    expect(
      isValidAppWorkflowsResult({
        requestId: 'q',
        result: { workflows: [validWorkflow], cursor: null },
      }),
    ).toBe(true);
  });

  it('accepts a string cursor (has a next page) + a pending workflow with null cost', () => {
    expect(
      isValidAppWorkflowsResult({
        result: {
          workflows: [
            { workflowId: 'wf_2', status: 'processing', images: [], cost: null, createdAt: '2026-07-14T11:00:00.000Z' },
          ],
          cursor: 'next-page-abc',
        },
      }),
    ).toBe(true);
  });

  it('accepts an EMPTY workflows array (a fresh app with no gens)', () => {
    expect(isValidAppWorkflowsResult({ result: { workflows: [], cursor: null } })).toBe(true);
  });

  it('accepts the free-text error variant', () => {
    expect(isValidAppWorkflowsResult({ requestId: 'q', error: 'block lacks scope' })).toBe(true);
  });

  it('rejects a reply that resolves to NOTHING (no result, no error)', () => {
    expect(isValidAppWorkflowsResult({ requestId: 'q' })).toBe(false);
  });

  it('rejects a malformed workflow (empty workflowId / bad status / non-string url / NaN cost)', () => {
    expect(
      isValidAppWorkflowsResult({ result: { workflows: [{ ...validWorkflow, workflowId: '' }], cursor: null } }),
    ).toBe(false);
    expect(
      isValidAppWorkflowsResult({ result: { workflows: [{ ...validWorkflow, status: 'bogus' }], cursor: null } }),
    ).toBe(false);
    expect(
      isValidAppWorkflowsResult({
        result: { workflows: [{ ...validWorkflow, images: [{ url: 42, width: null, height: null, nsfwLevel: null }] }], cursor: null },
      }),
    ).toBe(false);
    expect(
      isValidAppWorkflowsResult({ result: { workflows: [{ ...validWorkflow, cost: 'free' }], cursor: null } }),
    ).toBe(false);
    // a non-string, non-null cursor is malformed.
    expect(
      isValidAppWorkflowsResult({ result: { workflows: [validWorkflow], cursor: 42 } }),
    ).toBe(false);
    // `workflows` must be an array.
    expect(isValidAppWorkflowsResult({ result: { workflows: 'nope', cursor: null } })).toBe(false);
  });
});

describe('isValidCancelAppWorkflowResult', () => {
  const canceled = {
    workflowId: 'wf_1',
    status: 'canceled',
    images: [],
    cost: null,
    createdAt: '2026-07-14T12:00:00.000Z',
  };

  it('accepts a success result carrying the terminal workflow', () => {
    expect(isValidCancelAppWorkflowResult({ requestId: 'c', result: { workflow: canceled } })).toBe(true);
  });

  it('accepts the free-text error variant (FORBIDDEN / transport)', () => {
    expect(
      isValidCancelAppWorkflowResult({ requestId: 'c', error: 'workflow is not in this app subqueue' }),
    ).toBe(true);
  });

  it('rejects a reply that resolves to NOTHING', () => {
    expect(isValidCancelAppWorkflowResult({ requestId: 'c' })).toBe(false);
  });

  it('rejects a malformed workflow', () => {
    expect(isValidCancelAppWorkflowResult({ result: { workflow: { ...canceled, workflowId: '' } } })).toBe(false);
    expect(isValidCancelAppWorkflowResult({ result: {} })).toBe(false);
  });
});

describe('payloadValidatorFor', () => {
  it('returns a validator for each documented inbound type', () => {
    expect(payloadValidatorFor('BLOCK_INIT')).toBeTypeOf('function');
    expect(payloadValidatorFor('TOKEN_REFRESH')).toBeTypeOf('function');
    expect(payloadValidatorFor('TOKEN_REFRESH_RESPONSE')).toBeTypeOf('function');
    // 🔴 The mapping is the whole guard. `payloadValidatorFor`'s `default:` arm
    // returns null (a STRUCTURAL PASS), so a THEME_CHANGE with no entry here
    // would reach the snapshot UNVALIDATED — writing the validator and
    // forgetting the switch is the bug this line exists to catch.
    expect(payloadValidatorFor('THEME_CHANGE')).toBe(isValidThemeChange);
    expect(payloadValidatorFor('ESTIMATE_RESULT')).toBeTypeOf('function');
    expect(payloadValidatorFor('WORKFLOW_SUBMITTED')).toBeTypeOf('function');
    expect(payloadValidatorFor('WORKFLOW_STATUS')).toBeTypeOf('function');
    expect(payloadValidatorFor('WORKFLOW_CANCELED')).toBeTypeOf('function');
    expect(payloadValidatorFor('BUZZ_PURCHASE_RESULT')).toBeTypeOf('function');
    expect(payloadValidatorFor('BUZZ_BALANCE_RESULT')).toBeTypeOf('function');
    expect(payloadValidatorFor('VIEWER_RESULT')).toBeTypeOf('function');
    expect(payloadValidatorFor('BUZZ_TRANSACTIONS_RESULT')).toBeTypeOf('function');
    expect(payloadValidatorFor('BUZZ_ACCOUNTS_RESULT')).toBeTypeOf('function');
    expect(payloadValidatorFor('DAILY_COMPENSATION_RESULT')).toBeTypeOf('function');
    expect(payloadValidatorFor('WILDCARD_PACK_RESULT')).toBeTypeOf('function');
    expect(payloadValidatorFor('APP_WORKFLOWS_RESULT')).toBeTypeOf('function');
    expect(payloadValidatorFor('CANCEL_APP_WORKFLOW_RESULT')).toBeTypeOf('function');
    expect(payloadValidatorFor('IMAGE_UPLOAD_RESULT')).toBeTypeOf('function');
    expect(payloadValidatorFor('SHARED_UPDATE_RESULT')).toBeTypeOf('function');
    // The 15 reply types added in this PR (previously `default: null`).
    for (const t of [
      'APP_STORAGE_GET_RESULT',
      'APP_STORAGE_SET_RESULT',
      'APP_STORAGE_DELETE_RESULT',
      'APP_STORAGE_LIST_RESULT',
      'APP_STORAGE_QUOTA_RESULT',
      'SHARED_LIST_RESULT',
      'SHARED_GET_COUNT_RESULT',
      'SHARED_GET_COUNTS_RESULT',
      'SHARED_APPEND_RESULT',
      'SHARED_VOTE_RESULT',
      'SHARED_UNVOTE_RESULT',
      'SHARED_WITHDRAW_RESULT',
      'SHARED_GET_RESULT',
      'SHARED_REPORT_RESULT',
      'SAVE_IMAGE_RESULT',
      'CHECKPOINT_PICKER_RESULT',
      'RESOURCE_PICKER_RESULT',
      'USER_CHECKPOINT_SET',
    ]) {
      expect(payloadValidatorFor(t)).toBeTypeOf('function');
    }
  });
  it('returns null for payload-less lifecycle messages', () => {
    expect(payloadValidatorFor('SUSPEND')).toBeNull();
    expect(payloadValidatorFor('RESUME')).toBeNull();
  });
});

describe('isValidThemeChange', () => {
  it('accepts both theme values', () => {
    expect(isValidThemeChange({ theme: 'light' })).toBe(true);
    expect(isValidThemeChange({ theme: 'dark' })).toBe(true);
  });

  it('rejects a non-object payload', () => {
    expect(isValidThemeChange(null)).toBe(false);
    expect(isValidThemeChange(undefined)).toBe(false);
    expect(isValidThemeChange('dark')).toBe(false);
    expect(isValidThemeChange(1)).toBe(false);
  });

  it('rejects a missing / wrong-typed theme', () => {
    expect(isValidThemeChange({})).toBe(false);
    expect(isValidThemeChange({ theme: undefined })).toBe(false);
    expect(isValidThemeChange({ theme: null })).toBe(false);
    expect(isValidThemeChange({ theme: 1 })).toBe(false);
  });

  it('rejects an off-ladder theme string (the value lands on data-theme)', () => {
    // A block puts this straight onto `data-theme`; an arbitrary string would
    // silently match no themed selector. Mirrors the enum check
    // `isValidBlockInitPayload` applies to the SAME field.
    expect(isValidThemeChange({ theme: 'Dark' })).toBe(false);
    expect(isValidThemeChange({ theme: 'system' })).toBe(false);
    expect(isValidThemeChange({ theme: '' })).toBe(false);
  });

  it('ignores extra fields (a newer host may widen the payload)', () => {
    expect(isValidThemeChange({ theme: 'dark', requestId: 'r-1' })).toBe(true);
  });
});
