import { describe, expect, it } from 'vitest';

import {
  BLOCK_TO_PARENT_MESSAGE_TYPES,
  boundBlockToParentMessageType,
} from '../../src/blocks/index.js';

/**
 * Runtime half of the `GET_RESOURCE_FILE` bridge (civitai/civitai-app-starters#664,
 * phase 2). The type shapes are pinned in `resource-file.test-d.ts`.
 */
describe('GET_RESOURCE_FILE is a declared block→host message type', () => {
  it('is in the runtime list, so its telemetry label is not clamped to "other"', () => {
    expect(BLOCK_TO_PARENT_MESSAGE_TYPES).toContain('GET_RESOURCE_FILE');
    expect(boundBlockToParentMessageType('GET_RESOURCE_FILE')).toBe('GET_RESOURCE_FILE');
  });

  it('the REPLY is host→block, so it is NOT in the block→host list', () => {
    expect(BLOCK_TO_PARENT_MESSAGE_TYPES as readonly string[]).not.toContain(
      'RESOURCE_FILE_RESULT',
    );
    expect(boundBlockToParentMessageType('RESOURCE_FILE_RESULT')).toBe('other');
  });
});
