import { describe, expect, it } from 'vitest';

import {
  isValidBlockInitPayload,
  isValidBuzzBalanceResult,
  isValidBuzzPurchaseResult,
  isValidImageUploadResult,
  isValidSharedUpdateResult,
  isValidTokenRefresh,
  isValidTokenRefreshResponse,
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
  it('accepts a success reply carrying the { id, username, status } viewer', () => {
    expect(
      isValidViewerResult({ requestId: 'r', viewer: { id: 7, username: 'v', status: 'active' } }),
    ).toBe(true);
  });
  // THE OPTIONAL-FIELD TRAP: a valid reply with NO `buzzBudget` must be accepted.
  // Over-requiring the optional field is the class of guard bug that dropped a
  // valid reply and hung the reading hook — keep optionals optional.
  it('accepts a viewer WITHOUT the optional buzzBudget', () => {
    expect(
      isValidViewerResult({ requestId: 'r', viewer: { id: 7, username: 'v', status: 'muted' } }),
    ).toBe(true);
  });
  it('accepts a viewer WITH the optional buzzBudget', () => {
    expect(
      isValidViewerResult({
        requestId: 'r',
        viewer: { id: 7, username: 'v', status: 'active', buzzBudget: 200 },
      }),
    ).toBe(true);
  });
  it('accepts an error-only reply', () => {
    expect(isValidViewerResult({ requestId: 'r', error: 'not signed in' })).toBe(true);
  });
  it.each([
    ['neither viewer nor error', { requestId: 'r' }],
    ['viewer missing id', { requestId: 'r', viewer: { username: 'v', status: 'active' } }],
    ['viewer id not a number', { requestId: 'r', viewer: { id: '7', username: 'v', status: 'active' } }],
    ['viewer id NaN', { requestId: 'r', viewer: { id: Number.NaN, username: 'v', status: 'active' } }],
    ['viewer username empty', { requestId: 'r', viewer: { id: 7, username: '', status: 'active' } }],
    ['viewer username null', { requestId: 'r', viewer: { id: 7, username: null, status: 'active' } }],
    ['viewer status unknown', { requestId: 'r', viewer: { id: 7, username: 'v', status: 'banned' } }],
    ['viewer status missing', { requestId: 'r', viewer: { id: 7, username: 'v' } }],
    ['buzzBudget not a number', { requestId: 'r', viewer: { id: 7, username: 'v', status: 'active', buzzBudget: 'x' } }],
    ['viewer not an object', { requestId: 'r', viewer: 5 }],
    ['error not a string', { requestId: 'r', error: 500 }],
    ['requestId not a string', { requestId: 5, viewer: { id: 7, username: 'v', status: 'active' } }],
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

describe('payloadValidatorFor', () => {
  it('returns a validator for each documented inbound type', () => {
    expect(payloadValidatorFor('BLOCK_INIT')).toBeTypeOf('function');
    expect(payloadValidatorFor('TOKEN_REFRESH')).toBeTypeOf('function');
    expect(payloadValidatorFor('TOKEN_REFRESH_RESPONSE')).toBeTypeOf('function');
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
    expect(payloadValidatorFor('IMAGE_UPLOAD_RESULT')).toBeTypeOf('function');
    expect(payloadValidatorFor('SHARED_UPDATE_RESULT')).toBeTypeOf('function');
  });
  it('returns null for payload-less lifecycle messages', () => {
    expect(payloadValidatorFor('SUSPEND')).toBeNull();
    expect(payloadValidatorFor('RESUME')).toBeNull();
  });
});
