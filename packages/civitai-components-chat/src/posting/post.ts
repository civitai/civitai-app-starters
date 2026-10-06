import { chatConfig } from '../config.js';
import type { Attachment } from '../types.js';
import type { SitePoster } from './site.js';

export const POST_TOOL = 'post_to_civitai';

/** The host call from `@civitai/sdk`'s `host.createPost`; only a block framed in civitai.com has it. */
export interface PostHost {
  createPost(
    request: {
      sources: { kind: 'workflow'; workflowId: string; imageIndexes?: number[] }[];
      title?: string;
      detail?: string;
      tags?: string[];
    },
    opts?: { signal?: AbortSignal },
  ): Promise<{ postId: number; url: string } | null>;
}

export type PostState = 'ready' | 'posting' | 'drafting' | 'drafted' | 'publishing' | 'posted' | 'failed' | 'dismissed';

/** What survives a reload; a post not yet sent is rebuilt from the tool call. */
export interface SavedPost {
  state: 'posted' | 'dismissed' | 'drafted';
  postId?: number;
  url?: string;
}

export interface PostDeps {
  /** `null` outside civitai.com, where there is no host to post through. */
  host: PostHost | null;
  /** Without a host: the site MCP, as the viewer, when the page lets the chat use it. */
  site?(): SitePoster | null;
  /** Asks for `posts:write:self`; inside civitai.com the host asks in place. */
  authorize(): Promise<boolean>;
  saved(post: PostDraft): void;
}

export interface PostInit {
  id: string;
  items: Attachment[];
  title?: string;
  detail?: string;
  tags?: string[];
  saved?: SavedPost;
}

export interface PostSummary {
  status: 'awaiting_user' | 'posting' | 'draft' | 'posted' | 'failed' | 'not_posted';
  url?: string;
  reason?: string;
  note: string;
}

const IMAGE_INDEX = /\.images\[(\d+)\]$/;

/**
 * Only what this chat made can be posted: civitai.com's host takes pictures from workflow outputs; the
 * site, posting outside civitai.com, takes their videos too.
 */
export function isPostable(attachment: Attachment, videos = false): boolean {
  if (attachment.source.type !== 'result') return false;
  if (attachment.kind === 'image') return IMAGE_INDEX.test(attachment.source.path);
  return videos && attachment.kind === 'video';
}

function sourcesOf(items: Attachment[]) {
  const byWorkflow = new Map<string, number[]>();
  for (const item of items) {
    if (item.source.type !== 'result') continue;
    const index = Number(IMAGE_INDEX.exec(item.source.path)?.[1]);
    byWorkflow.set(item.source.workflowId, [...(byWorkflow.get(item.source.workflowId) ?? []), index]);
  }
  return [...byWorkflow].map(([workflowId, imageIndexes]) => ({ kind: 'workflow' as const, workflowId, imageIndexes }));
}

/**
 * A post the assistant suggested or the viewer started. The host shows its own
 * post dialog; nothing is posted unless the viewer publishes it there.
 */
export class PostDraft extends EventTarget {
  readonly id: string;
  readonly items: Attachment[];
  readonly title: string;
  readonly detail: string;
  readonly tags: string[];
  state: PostState = 'ready';
  postId?: number;
  url?: string;
  error?: { message: string; detail?: string };

  #deps: PostDeps;

  constructor(deps: PostDeps, init: PostInit) {
    super();
    this.#deps = deps;
    this.id = init.id;
    this.items = init.items;
    this.title = init.title ?? '';
    this.detail = init.detail ?? '';
    this.tags = init.tags ?? [];
    if (init.saved) {
      this.state = init.saved.state;
      this.postId = init.saved.postId;
      this.url = init.saved.url;
    }
  }

  async submit(): Promise<void> {
    if (this.state !== 'ready' && this.state !== 'failed') return;
    const host = this.#deps.host;
    if (!host) return this.#viaSite();
    this.#set('posting', undefined);
    try {
      if (!(await this.#deps.authorize())) return this.#set('failed', { message: 'Posting needs your permission on Civitai.' });
      const post = await host.createPost({
        sources: sourcesOf(this.items),
        ...(this.title.trim() ? { title: this.title.trim().slice(0, 255) } : {}),
        ...(this.detail.trim() ? { detail: this.detail.trim().slice(0, 2000) } : {}),
        ...(this.tags.length ? { tags: this.tags } : {}),
      });
      if (!post) return this.#set('ready', undefined);
      this.postId = post.postId;
      this.url = post.url;
      this.#set('posted', undefined);
      this.#deps.saved(this);
    } catch (error) {
      this.#set('failed', humanizePostError(error));
    }
  }

  /** Posts outside civitai.com start as a draft the viewer publishes from the card. */
  get drafts(): boolean {
    return this.#deps.host === null && Boolean(this.#deps.site?.());
  }

  /** Makes a draft made through the site public; on civitai.com the host's own dialog publishes. */
  async publish(): Promise<void> {
    const site = this.#deps.site?.();
    if (!site || this.postId === undefined || (this.state !== 'drafted' && this.state !== 'failed')) return;
    this.#set('publishing', undefined);
    try {
      await site.publish(this.postId);
      this.#set('posted', undefined);
      this.#deps.saved(this);
    } catch (error) {
      this.#set('failed', humanizePostError(error));
    }
  }

  async #viaSite(): Promise<void> {
    // A draft already made is published on retry, not made twice.
    if (this.postId !== undefined) return this.publish();
    const site = this.#deps.site?.();
    if (!site) return this.#set('failed', { message: `Posting works when ${chatConfig.name} is opened on civitai.com.` });
    this.#set('drafting', undefined);
    try {
      if (!(await this.#deps.authorize())) return this.#set('failed', { message: 'Posting needs your permission on Civitai.' });
      const draft = await site.createDraft({
        images: this.items.flatMap((item) => (item.url ? [{ url: item.url, width: item.width, height: item.height, type: item.kind === 'video' ? ('video' as const) : ('image' as const) }] : [])),
        ...(this.title.trim() ? { title: this.title.trim().slice(0, 255) } : {}),
        ...(this.detail.trim() ? { detail: this.detail.trim().slice(0, 2000) } : {}),
        ...(this.tags.length ? { tags: this.tags } : {}),
      });
      this.postId = draft.postId;
      this.url = draft.url;
      this.#set('drafted', undefined);
      this.#deps.saved(this);
    } catch (error) {
      this.#set('failed', humanizePostError(error));
    }
  }

  dismiss(): void {
    if (this.state !== 'ready' && this.state !== 'failed') return;
    this.#set('dismissed', undefined);
    this.#deps.saved(this);
  }

  toSaved(): SavedPost | undefined {
    if (this.state === 'posted' || this.state === 'drafted') return { state: this.state, ...(this.postId !== undefined ? { postId: this.postId } : {}), ...(this.url ? { url: this.url } : {}) };
    if (this.state === 'dismissed') return { state: 'dismissed' };
    return undefined;
  }

  summary(): PostSummary {
    switch (this.state) {
      case 'ready':
        return { status: 'awaiting_user', note: 'A card is on screen; the user posts it from there and confirms on Civitai. Do not say it is posted.' };
      case 'posting':
        return { status: 'posting', note: 'The user is confirming the post on Civitai.' };
      case 'drafting':
      case 'drafted':
      case 'publishing':
        return { status: 'draft', url: this.url, note: 'A draft is being made or waits on Civitai; it goes public only when the user presses Publish on the card. Do not say it is posted.' };
      case 'posted':
        return { status: 'posted', url: this.url, note: 'It is live on Civitai. You may share the link.' };
      case 'failed':
        return { status: 'failed', reason: this.error?.detail ?? this.error?.message, note: 'Posting did not work. Tell the user why in plain words; they can try again on the card.' };
      case 'dismissed':
        return { status: 'not_posted', note: 'The user decided not to post it.' };
    }
  }

  #set(state: PostState, error: PostDraft['error']): void {
    this.state = state;
    this.error = error;
    this.dispatchEvent(new Event('change'));
  }
}

export function humanizePostError(error: unknown): { message: string; detail?: string } {
  const detail = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: unknown } | null)?.code;
  if (code === 'unauthenticated' || /sign in/i.test(detail)) return { message: 'Sign in to Civitai to post.', detail };
  if (code === 'rate-limited') return { message: 'You are posting a lot right now; wait a while and try again.', detail };
  if (/subqueue|not .*this app/i.test(detail)) return { message: `Civitai cannot post this picture from ${chatConfig.name} yet.`, detail };
  if (/review-mode|not ready/i.test(detail)) return { message: 'Posting is not available here right now.', detail };
  return { message: 'Civitai could not create the post.', detail };
}

/** The open conversation's posts, plus any started from a result's Post button. */
export class PostManager extends EventTarget {
  #posts = new Map<string, PostDraft>();
  readonly deps: PostDeps;

  constructor(deps: PostDeps) {
    super();
    this.deps = deps;
  }

  get available(): boolean {
    return this.deps.host !== null || Boolean(this.deps.site?.());
  }

  create(init: PostInit): PostDraft {
    const post = new PostDraft(this.deps, init);
    post.addEventListener('change', () => this.dispatchEvent(new CustomEvent('post-change', { detail: post })));
    this.#posts.set(post.id, post);
    return post;
  }

  get(id: string): PostDraft | undefined {
    return this.#posts.get(id);
  }

  /** Videos can be posted only through the site; civitai.com's own dialog takes pictures. */
  get takesVideos(): boolean {
    return this.deps.host === null && Boolean(this.deps.site?.());
  }

  accepts(attachment: Attachment): boolean {
    return this.available && isPostable(attachment, this.takesVideos);
  }

  clear(): void {
    this.#posts.clear();
  }
}
