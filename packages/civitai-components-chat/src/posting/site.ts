import type { McpConnection } from '../mcp/clients.js';
import { mcpResultToText, structuredOf } from '../mcp/result.js';
import { SITE_URL } from '../config.js';

export interface DraftRequest {
  images: { url: string; width?: number; height?: number; type: 'image' | 'video' }[];
  title?: string;
  detail?: string;
  tags?: string[];
}

/** Posting outside civitai.com, through the site MCP as the viewer: a draft first, public only on Publish. */
export interface SitePoster {
  createDraft(request: DraftRequest): Promise<{ postId: number; url: string }>;
  publish(postId: number): Promise<void>;
}

const POST_ID = [/civitai\.com\/posts\/(\d+)/i, /\bpost\s*(?:id)?\s*[:#]?\s*(\d+)/i];

export function sitePoster(site: Pick<McpConnection, 'callTool'>): SitePoster {
  return {
    async createDraft(request) {
      const result = await site.callTool('create_post', { ...request, publish: false });
      const text = mcpResultToText(result);
      if (result.isError) throw new Error(text);
      const structured = structuredOf(result) ?? {};
      const fromStructure = Number(structured.postId ?? structured.id ?? (structured.post as { id?: unknown } | undefined)?.id);
      const postId = Number.isInteger(fromStructure) && fromStructure > 0 ? fromStructure : Number(POST_ID.map((pattern) => pattern.exec(text)?.[1]).find(Boolean));
      if (!Number.isInteger(postId) || postId <= 0) throw new Error(`Civitai did not say which post it made: ${text.slice(0, 300)}`);
      return { postId, url: `${SITE_URL}/posts/${postId}` };
    },
    async publish(postId) {
      const result = await site.callTool('publish_post', { id: postId });
      if (result.isError) throw new Error(mcpResultToText(result));
    },
  };
}
