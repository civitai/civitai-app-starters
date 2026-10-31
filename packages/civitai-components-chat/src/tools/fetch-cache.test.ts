import { describe, expect, it } from 'vitest';

import type { McpConnection } from '../mcp/clients.js';
import { cachedReply, rememberReply } from './fetch-cache.js';

const connection = () => ({}) as McpConnection;
const page = (n: number) => `fetch_page:${n}`;

describe('the fetch_page cache', () => {
  it('keeps 32 pages a chat, dropping the oldest', () => {
    const c = connection();
    for (let n = 0; n <= 32; n++) rememberReply(c, 'chat', page(n), Promise.resolve(`page ${n}`));
    expect(cachedReply(c, 'chat', page(0))).toBeUndefined();
    expect(cachedReply(c, 'chat', page(1))).toBeDefined();
    expect(cachedReply(c, 'chat', page(32))).toBeDefined();
  });

  it('counts a page read again as recent, so it outlives pages read once since', () => {
    const c = connection();
    for (let n = 0; n < 32; n++) rememberReply(c, 'chat', page(n), Promise.resolve(`page ${n}`));
    expect(cachedReply(c, 'chat', page(0))).toBeDefined();
    rememberReply(c, 'chat', page(32), Promise.resolve('page 32'));
    expect(cachedReply(c, 'chat', page(0))).toBeDefined();
    expect(cachedReply(c, 'chat', page(1))).toBeUndefined();
  });

  it('keeps the pages of 4 chats, dropping the one used longest ago', () => {
    const c = connection();
    for (const chat of ['a', 'b', 'c', 'd']) rememberReply(c, chat, page(1), Promise.resolve(chat));
    rememberReply(c, 'a', page(2), Promise.resolve('a again'));
    rememberReply(c, 'e', page(1), Promise.resolve('e'));
    expect(cachedReply(c, 'b', page(1))).toBeUndefined();
    for (const chat of ['a', 'c', 'd', 'e']) expect(cachedReply(c, chat, page(1))).toBeDefined();
  });
});
