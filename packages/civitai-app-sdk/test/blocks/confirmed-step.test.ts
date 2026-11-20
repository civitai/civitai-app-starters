import { describe, expect, it } from 'vitest';

import {
  BLOCK_CONFIRMED_STEP_MAX_BUZZ_PER_JOB,
  BLOCK_STEP_QUOTE_ID_REGEX,
  BLOCK_TO_PARENT_MESSAGE_TYPES,
  boundBlockToParentMessageType,
} from '../../src/blocks/index.js';

/**
 * Runtime half of the confirmed-step mirror (civitai/civitai#5786). The values
 * are pinned as LITERALS, never derived from the constants under test: they are
 * copies of the host's `BLOCK_CONFIRMED_STEP_MAX_BUZZ_PER_JOB` and
 * `BLOCK_STEP_QUOTE_ID_REGEX`, and a copy that drifts is the defect.
 */
describe('confirmed-step host bounds', () => {
  it('the per-job ceiling is 5,000 Buzz', () => {
    expect(BLOCK_CONFIRMED_STEP_MAX_BUZZ_PER_JOB).toBe(5000);
  });

  it('the quote id regex is the host pattern, source and flags', () => {
    expect(BLOCK_STEP_QUOTE_ID_REGEX.source).toBe('^sq_[a-f0-9]{32}$');
    expect(BLOCK_STEP_QUOTE_ID_REGEX.flags).toBe('');
  });

  it('accepts an sq_ id and rejects every near miss, one property at a time', () => {
    const ok = `sq_${'0123456789abcdef'.repeat(2)}`;
    expect(BLOCK_STEP_QUOTE_ID_REGEX.test(ok)).toBe(true);
    const nearMisses = [
      `tq_${'0123456789abcdef'.repeat(2)}`, // a TRAINING quote — the other kind
      `sq_${'0123456789abcdef'.repeat(2).slice(1)}`, // 31 hex
      `sq_${'0123456789abcdef'.repeat(2)}0`, // 33 hex
      `sq_${'0123456789ABCDEF'.repeat(2)}`, // uppercase hex
      `sq_${'g'.repeat(32)}`, // not hex
      `SQ_${'0'.repeat(32)}`, // uppercase prefix
      ` ${ok}`, // leading space
      `${ok}\n`, // trailing newline (`$` without `m` still rejects a char after it)
      `x${ok}`,
      'sq_',
      '',
    ];
    for (const id of nearMisses) {
      expect(BLOCK_STEP_QUOTE_ID_REGEX.test(id), JSON.stringify(id)).toBe(false);
    }
  });
});

describe('RUN_CONFIRMED_STEP is a declared block→host message type', () => {
  it('is in the runtime list, so its telemetry label is not clamped to "other"', () => {
    expect(BLOCK_TO_PARENT_MESSAGE_TYPES).toContain('RUN_CONFIRMED_STEP');
    expect(boundBlockToParentMessageType('RUN_CONFIRMED_STEP')).toBe('RUN_CONFIRMED_STEP');
    // The REPLY is host→block: it must NOT be in the block→host list.
    expect(BLOCK_TO_PARENT_MESSAGE_TYPES).not.toContain('CONFIRMED_STEP_RESULT');
    expect(boundBlockToParentMessageType('CONFIRMED_STEP_RESULT')).toBe('other');
  });
});
