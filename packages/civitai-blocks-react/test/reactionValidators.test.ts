import { describe, expect, it } from 'vitest';

import {
  isValidEntityReactionResult,
  isValidEntityReactionsResult,
  payloadValidatorFor,
} from '../src/transport/validate.js';

/**
 * The transport validators for the two app-reaction replies. Fixtures follow
 * civitai/civitai#6144's `blocks.setReactionFromApp` / `getReactionsForApp`
 * return literals and `reactionGate.ts`'s reply latch: `{ requestId, result }`
 * or `{ requestId, error }`.
 */
const STATE = {
  counts: { Like: 4, Heart: 1, Laugh: 0, Cry: 0 },
  viewerReactions: ['Heart'],
  statsUnknown: false,
};

const SET_RESULT = {
  entityType: 'image',
  entityId: 11,
  reaction: 'Like',
  reacted: true,
  changed: true,
  ...STATE,
};

const GET_RESULT = { entityType: 'image', byId: { '11': STATE }, unavailable: [12] };

describe('isValidEntityReactionResult', () => {
  it('accepts the host success literal and an error', () => {
    expect(isValidEntityReactionResult({ requestId: 'r1', result: SET_RESULT })).toBe(true);
    expect(isValidEntityReactionResult({ requestId: 'r1', error: 'rate-limited' })).toBe(true);
  });

  it('accepts an error string outside the closed set, so a newer host code still rejects', () => {
    expect(isValidEntityReactionResult({ requestId: 'r1', error: 'some-new-code' })).toBe(true);
  });

  it('accepts reaction names it does not know, in counts and viewerReactions', () => {
    const r = { ...SET_RESULT, counts: { ...STATE.counts, Wow: 2 }, viewerReactions: ['Dislike', 'Wow'] };
    expect(isValidEntityReactionResult({ requestId: 'r1', result: r })).toBe(true);
  });

  it.each([
    ['neither result nor error', { requestId: 'r1' }],
    ['a non-string error', { requestId: 'r1', error: 3 }],
    ['a string entityId', { requestId: 'r1', result: { ...SET_RESULT, entityId: '11' } }],
    ['a zero entityId', { requestId: 'r1', result: { ...SET_RESULT, entityId: 0 } }],
    ['a non-boolean reacted', { requestId: 'r1', result: { ...SET_RESULT, reacted: 'yes' } }],
    ['no changed', { requestId: 'r1', result: { ...SET_RESULT, changed: undefined } }],
    ['an empty reaction', { requestId: 'r1', result: { ...SET_RESULT, reaction: '' } }],
    ['a non-numeric count', { requestId: 'r1', result: { ...SET_RESULT, counts: { Like: '4' } } }],
    ['viewerReactions not an array', { requestId: 'r1', result: { ...SET_RESULT, viewerReactions: 'Like' } }],
    ['no statsUnknown', { requestId: 'r1', result: { ...SET_RESULT, statsUnknown: undefined } }],
  ])('drops a reply with %s', (_label, payload) => {
    expect(isValidEntityReactionResult(payload)).toBe(false);
  });
});

describe('isValidEntityReactionsResult', () => {
  it('accepts the host success literal, an empty answer and an error', () => {
    expect(isValidEntityReactionsResult({ requestId: 'r1', result: GET_RESULT })).toBe(true);
    expect(
      isValidEntityReactionsResult({
        requestId: 'r1',
        result: { entityType: 'image', byId: {}, unavailable: [] },
      }),
    ).toBe(true);
    expect(isValidEntityReactionsResult({ requestId: 'r1', error: 'needs-consent' })).toBe(true);
  });

  it.each([
    ['neither result nor error', { requestId: 'r1' }],
    ['a non-numeric byId key', { requestId: 'r1', result: { ...GET_RESULT, byId: { abc: STATE } } }],
    ['a zero byId key', { requestId: 'r1', result: { ...GET_RESULT, byId: { '0': STATE } } }],
    ['a malformed state', { requestId: 'r1', result: { ...GET_RESULT, byId: { '11': { counts: {} } } } }],
    ['no unavailable', { requestId: 'r1', result: { entityType: 'image', byId: {} } }],
    ['a string in unavailable', { requestId: 'r1', result: { ...GET_RESULT, unavailable: ['12'] } }],
    ['no entityType', { requestId: 'r1', result: { byId: {}, unavailable: [] } }],
  ])('drops a reply with %s', (_label, payload) => {
    expect(isValidEntityReactionsResult(payload)).toBe(false);
  });
});

describe('the reply → validator mapping', () => {
  it('routes each reaction reply to its own validator', () => {
    expect(payloadValidatorFor('ENTITY_REACTION_RESULT')).toBe(isValidEntityReactionResult);
    expect(payloadValidatorFor('ENTITY_REACTIONS_RESULT')).toBe(isValidEntityReactionsResult);
  });
});
