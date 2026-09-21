import { describe, expect, it } from 'vitest';

import { createTokenSession } from '../../src/session/index.js';

describe('createTokenSession', () => {
  it('hands out a fixed token, fresh or not, when there is no refresh', async () => {
    const session = createTokenSession({ token: 'civitai_abc' });

    await expect(session.getToken()).resolves.toBe('civitai_abc');
    await expect(session.getToken({ fresh: true })).resolves.toBe('civitai_abc');
  });

  it('reads a token source on every call, so a rotated token is picked up', async () => {
    let current = 'first';
    const session = createTokenSession({ token: () => current });

    await expect(session.getToken()).resolves.toBe('first');
    current = 'second';
    await expect(session.getToken()).resolves.toBe('second');
  });

  it('asks the app’s own refresh only for a fresh token', async () => {
    const session = createTokenSession({ token: 'held', refresh: async () => 'fresh' });

    await expect(session.getToken()).resolves.toBe('held');
    await expect(session.getToken({ fresh: true })).resolves.toBe('fresh');
  });

  it('refuses grants when the app has no way to ask for them', async () => {
    await expect(createTokenSession({ token: 't' }).requestGrants(['buzz:read:self'])).resolves.toBe(
      false,
    );
  });

  it('asks the app for grants when it can', async () => {
    const asked: string[][] = [];
    const session = createTokenSession({
      token: 't',
      requestGrants: (scopes) => {
        asked.push([...scopes]);
        return true;
      },
    });

    await expect(session.requestGrants(['buzz:read:self'])).resolves.toBe(true);
    expect(asked).toEqual([['buzz:read:self']]);
  });
});
