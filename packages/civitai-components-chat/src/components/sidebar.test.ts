import { describe, expect, it } from 'vitest';

import type { ConversationSummary } from '../types.js';
import { groupByDay } from './civitai-chat-sidebar.js';

const at = (id: string, updatedAt: string) => ({ id, title: id, updatedAt }) as ConversationSummary;

describe('groupByDay', () => {
  it('groups chats the way people think about them, dropping empty groups', () => {
    const now = new Date('2026-09-23T15:00:00');
    const groups = groupByDay(
      [at('a', '2026-09-23T09:00:00'), at('b', '2026-09-22T20:00:00'), at('c', '2026-09-19T10:00:00'), at('d', '2026-08-01T10:00:00')],
      now,
    );
    expect(groups.map((g) => [g.label, g.items.map((i) => i.id)])).toEqual([
      ['Today', ['a']],
      ['Yesterday', ['b']],
      ['Previous 7 days', ['c']],
      ['Earlier', ['d']],
    ]);
  });
});
