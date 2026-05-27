import { describe, expect, it } from 'vitest';

import {
  isValidBlockInitPayload,
  isValidBuzzPurchaseResult,
  isValidTokenRefresh,
  isValidTokenRefreshResponse,
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

describe('payloadValidatorFor', () => {
  it('returns a validator for each documented inbound type', () => {
    expect(payloadValidatorFor('BLOCK_INIT')).toBeTypeOf('function');
    expect(payloadValidatorFor('TOKEN_REFRESH')).toBeTypeOf('function');
    expect(payloadValidatorFor('TOKEN_REFRESH_RESPONSE')).toBeTypeOf('function');
    expect(payloadValidatorFor('ESTIMATE_RESULT')).toBeTypeOf('function');
    expect(payloadValidatorFor('WORKFLOW_SUBMITTED')).toBeTypeOf('function');
    expect(payloadValidatorFor('WORKFLOW_STATUS')).toBeTypeOf('function');
    expect(payloadValidatorFor('BUZZ_PURCHASE_RESULT')).toBeTypeOf('function');
  });
  it('returns null for payload-less lifecycle messages', () => {
    expect(payloadValidatorFor('SUSPEND')).toBeNull();
    expect(payloadValidatorFor('RESUME')).toBeNull();
  });
});
