import type { PostManager } from '../posting/post.js';
import { DEFAULT_ACTIONS, type CardAction } from './lib/actions.js';
import type { MediaKind } from './lib/media.js';

const POST: CardAction = { id: 'post', label: 'Post to Civitai' };

/** A result's menu, with Post wherever this chat can post that kind of file (before Download). */
export function mediaActions(posts: Pick<PostManager, 'available' | 'takesVideos'>): Record<MediaKind, CardAction[]> {
  const withPost = (actions: CardAction[], can: boolean) => (can ? [...actions.slice(0, -1), POST, ...actions.slice(-1)] : actions);
  return {
    image: withPost(DEFAULT_ACTIONS.image, posts.available),
    video: withPost(DEFAULT_ACTIONS.video, posts.available && posts.takesVideos),
    audio: DEFAULT_ACTIONS.audio,
  };
}
