import { describe, expect, it } from 'vitest';

import {
  APP_REACTIONS,
  ENTITY_REACTION_ERROR_CODES,
  REACT_TICKET_MAX_LENGTH,
  REACTION_ENTITY_TYPES,
  REACTION_READ_MAX_IDS,
  STORED_REACTIONS,
  isAppReaction,
  isEntityReactionErrorCode,
} from '../../src/blocks/reactions.js';
import { BLOCK_SCOPES, BLOCK_TO_PARENT_MESSAGE_TYPES } from '../../src/blocks/index.js';

/**
 * The app-reactions vocabulary, pinned LITERALLY against the host that shipped
 * it: civitai/civitai#6144, `src/shared/constants/block-reaction.constants.ts`
 * and `src/components/AppBlocks/reactionGate.ts` at `cd79a91fe4`.
 *
 * Each expectation is typed out from the host source, never derived from this
 * package's own constants, so a constant edited on its own goes red here.
 */
describe('app reactions vocabulary (host #6144)', () => {
  it('lets an app set exactly Like, Heart, Laugh and Cry, in the host order', () => {
    expect(APP_REACTIONS).toEqual(['Like', 'Heart', 'Laugh', 'Cry']);
  });

  it('never lets an app set a Dislike, though the site stores one', () => {
    expect(APP_REACTIONS).not.toContain('Dislike');
    expect(isAppReaction('Dislike')).toBe(false);
    expect(STORED_REACTIONS).toContain('Dislike');
  });

  it('reports a stored reaction in the five-value ReviewReactions set', () => {
    expect([...STORED_REACTIONS].sort()).toEqual(['Cry', 'Dislike', 'Heart', 'Laugh', 'Like']);
  });

  it('accepts only image as an entity type in v1', () => {
    expect(REACTION_ENTITY_TYPES).toEqual(['image']);
  });

  it('carries the host read cap and ticket length', () => {
    expect(REACTION_READ_MAX_IDS).toBe(100);
    expect(REACT_TICKET_MAX_LENGTH).toBe(256);
  });

  it('names the closed error set exactly, in the host order', () => {
    expect(ENTITY_REACTION_ERROR_CODES).toEqual([
      'invalid-request',
      'sign-in-required',
      'review-mode',
      'not-ready',
      'needs-consent',
      'entity-unavailable',
      'rate-limited',
    ]);
  });

  it('classifies codes by membership, not by shape', () => {
    for (const code of ENTITY_REACTION_ERROR_CODES) expect(isEntityReactionErrorCode(code)).toBe(true);
    // A follow-bridge code, a server sentence and non-strings are not reaction codes.
    expect(isEntityReactionErrorCode('declined')).toBe(false);
    expect(isEntityReactionErrorCode('reaction ticket is missing')).toBe(false);
    expect(isEntityReactionErrorCode(undefined)).toBe(false);
    expect(isEntityReactionErrorCode(7)).toBe(false);
  });

  it('classifies reactions by exact value', () => {
    for (const r of APP_REACTIONS) expect(isAppReaction(r)).toBe(true);
    expect(isAppReaction('like')).toBe(false);
    expect(isAppReaction('👍')).toBe(false);
    expect(isAppReaction(null)).toBe(false);
  });

  it('uses the social:react:self scope string', () => {
    expect(BLOCK_SCOPES.SOCIAL_REACT_SELF).toBe('social:react:self');
  });

  it('declares both bridge requests as block→host message types', () => {
    expect(BLOCK_TO_PARENT_MESSAGE_TYPES).toContain('SET_ENTITY_REACTION');
    expect(BLOCK_TO_PARENT_MESSAGE_TYPES).toContain('GET_ENTITY_REACTIONS');
  });
});
