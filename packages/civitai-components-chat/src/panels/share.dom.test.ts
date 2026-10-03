import { describe, expect, it } from 'vitest';

import { encodePanel, holdSharedPanel, takeSharedPanel } from './share.js';

describe('a shared panel link', () => {
  it('survives a sign-in redirect that drops the hash, and opens once', async () => {
    const encoded = await encodePanel({
      v: 1,
      id: 'P1',
      version: 1,
      spec: { title: 'Beat maker', inputs: { mood: { kind: 'choice', options: ['Calm', 'Bold'] } }, run: { stepType: 'aceStepAudio', input: { prompt: '{{mood}}' } } },
      values: { mood: 'Bold' },
    });
    history.replaceState(null, '', `/chat#panel=${encoded}`);

    holdSharedPanel();
    expect(location.hash).toBe('');
    expect(location.pathname).toBe('/chat');

    expect(await takeSharedPanel()).toMatchObject({ id: 'P1', spec: { title: 'Beat maker' }, values: { mood: 'Bold' } });
    expect(await takeSharedPanel()).toBeNull();
  });
});
