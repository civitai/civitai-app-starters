import { describe, expect, it, vi } from 'vitest';

import { toolResult } from '../test-support/fakes.js';
import { sitePoster } from './site.js';

describe('sitePoster', () => {
  it('makes a draft, never a public post, and finds the post it made', async () => {
    const callTool = vi.fn(async () => toolResult(undefined, 'Created draft post 4242: https://civitai.com/posts/4242 (2 images)'));
    const draft = await sitePoster({ callTool }).createDraft({ images: [{ url: 'https://x/a.png', width: 1024, height: 1024, type: 'image' }], title: 'Red bike' });
    expect(callTool).toHaveBeenCalledWith('create_post', { images: [{ url: 'https://x/a.png', width: 1024, height: 1024, type: 'image' }], title: 'Red bike', publish: false });
    expect(draft).toEqual({ postId: 4242, url: 'https://civitai.com/posts/4242' });
  });

  it('passes on what Civitai said when it refuses', async () => {
    const callTool = vi.fn(async () => toolResult(undefined, 'Account is not onboarded', true));
    await expect(sitePoster({ callTool }).createDraft({ images: [{ url: 'https://x/a.png', type: 'image' }] })).rejects.toThrow('Account is not onboarded');
  });

  it('publishes a draft by its id', async () => {
    const callTool = vi.fn(async () => toolResult(undefined, 'Published post 4242'));
    await sitePoster({ callTool }).publish(4242);
    expect(callTool).toHaveBeenCalledWith('publish_post', { id: 4242 });
  });
});
