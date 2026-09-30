import { describe, expect, it, vi } from 'vitest';

import type { Attachment } from '../types.js';
import { PostManager, isPostable, type PostDeps, type PostHost } from './post.js';

const made = (id: string, workflowId: string, index: number): Attachment => ({
  id,
  kind: 'image',
  source: { type: 'result', workflowId, job: 'gen1-1', path: `output.images[${index}]` },
});

function setup(overrides: Partial<PostDeps> = {}) {
  const createPost = vi.fn<PostHost['createPost']>(async () => ({ postId: 123, url: 'https://civitai.com/posts/123' }));
  const deps: PostDeps = { host: { createPost }, authorize: vi.fn(async () => true), saved: vi.fn(), ...overrides };
  const posts = new PostManager(deps);
  const post = posts.create({ id: 'call-1', items: [made('gen1-1-1', '6-1', 0), made('gen1-1-2', '6-1', 1), made('gen2-1-1', '6-2', 0)], title: 'Red bike' });
  return { posts, deps, createPost, post };
}

describe('PostDraft', () => {
  it("asks Civitai to show the chat's pictures as a post, grouped by the workflow that made them", async () => {
    const { post, createPost, deps } = setup();
    await post.submit();
    expect(deps.authorize).toHaveBeenCalled();
    expect(createPost).toHaveBeenCalledWith({
      sources: [
        { kind: 'workflow', workflowId: '6-1', imageIndexes: [0, 1] },
        { kind: 'workflow', workflowId: '6-2', imageIndexes: [0] },
      ],
      title: 'Red bike',
    });
    expect(post).toMatchObject({ state: 'posted', url: 'https://civitai.com/posts/123' });
    expect(deps.saved).toHaveBeenCalledWith(post);
  });

  it('can be posted again after the viewer cancels on Civitai', async () => {
    const { post, createPost } = setup();
    createPost.mockResolvedValueOnce(null);
    await post.submit();
    expect(post.state).toBe('ready');
  });

  it('sends nothing without the permission to post', async () => {
    const { post, createPost } = setup({ authorize: async () => false });
    await post.submit();
    expect(createPost).not.toHaveBeenCalled();
    expect(post.error?.message).toMatch(/permission/);
  });

  it('explains a refusal in plain words', async () => {
    const { post, createPost } = setup();
    createPost.mockRejectedValueOnce(new Error('workflow is not in this app subqueue'));
    await post.submit();
    expect(post).toMatchObject({ state: 'failed', error: { message: 'Civitai cannot post this picture from ChatCVT yet.' } });
  });

  it('tells the assistant how the post ended', () => {
    const { post } = setup();
    expect(post.summary().status).toBe('awaiting_user');
    post.dismiss();
    expect(post.summary().status).toBe('not_posted');
  });
});

describe('isPostable', () => {
  it('takes pictures this chat made, not uploads or videos', () => {
    expect(isPostable(made('gen1-1-1', 'w', 0))).toBe(true);
    expect(isPostable({ id: 'up1-1', kind: 'image', source: { type: 'upload', blobId: 'b' } })).toBe(false);
    expect(isPostable({ id: 'gen1-1-1', kind: 'video', source: { type: 'result', workflowId: 'w', job: 'gen1-1', path: 'output.video' } })).toBe(false);
  });
});
