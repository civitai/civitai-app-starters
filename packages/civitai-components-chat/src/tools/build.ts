import type { SiteClient } from '@civitai/sdk';
import { dynamicTool, jsonSchema, tool, type ToolSet } from 'ai';

import type { McpConnection, McpTool } from '../mcp/clients.js';
import { mcpResultToText, structuredOf } from '../mcp/result.js';
import { toolInfo } from '../orchestration/job.js';
import type { JobManager } from '../orchestration/jobs.js';
import type { PanelManager } from '../panels/panel.js';
import { panelTools } from '../panels/tools.js';
import { POST_TOOL, type PostManager } from '../posting/post.js';
import { ATTACHMENT_ID, jobId } from '../store/attachments.js';
import type { Attachment, ModelRecommendation } from '../types.js';
import { chatConfig } from '../config.js';
import { isJobTool, WEB_TOOLS, withoutControls, type ToolCatalog } from './catalog.js';
import { FALLBACK_SEARCH_SCHEMA, searchModelsViaApi, type FallbackSearchArgs } from './site-fallback.js';

export interface TurnToolContext {
  conversationId: string;
  seq: number;
  jobs: JobManager;
  orchestration: McpConnection;
  site: McpConnection;
  siteApi: SiteClient;
  posts: PostManager;
  /** Panels are offered only where the assistant can make things. */
  panels?: PanelManager;
  findAttachment(id: string): Attachment | undefined;
  resolveArgs(args: Record<string, unknown>): Promise<Record<string, unknown>>;
  onCaption(attachmentId: string, caption: string): void;
}

const JOB_SUFFIX =
  ' Runs in the background: the user sees the price, progress and result in the chat. Pass attachment ids (like up1-1 or gen2-1-1) wherever a URL is asked for.';
const MEDIA_SUFFIX = ' Pass attachment ids (like up1-1 or gen2-1-1) wherever a URL is asked for.';
const CAPTION_TOOLS = new Set(['caption_media', 'transcribe_audio']);
const REFUSED_NOTE =
  'Nothing was run: the request was refused. Fix the input (get_input_schema shows what it needs) and call again. If it is refused again, tell the user in plain words.';
const FAILED_NOTE = 'This service failed. Do not call it again this turn; tell the user in plain words and offer another way.';

export const ASK_CHOICE = 'ask_choice';

/**
 * The assistant's tools for one turn: every MCP tool as the server defines it,
 * plus `ask_choice`. Generation tools go through a job instead of blocking.
 */
export function buildToolSet(catalog: ToolCatalog, ctx: TurnToolContext): ToolSet {
  const tools: ToolSet = {};
  let jobCount = 0;

  for (const mcpTool of catalog.orchestration) {
    if (!chatConfig.webSearch && WEB_TOOLS.has(mcpTool.name)) continue;
    if (isJobTool(mcpTool.name)) {
      const info = toolInfo(mcpTool.name, mcpTool.inputSchema);
      tools[mcpTool.name] = dynamicTool({
        description: `${mcpTool.description ?? ''}${JOB_SUFFIX}`,
        inputSchema: jsonSchema(withoutControls(mcpTool.inputSchema)),
        execute: async (input, { toolCallId }) => {
          // Taken before any await, so parallel calls number in call order.
          const index = ++jobCount;
          const job = ctx.jobs.create({
            id: jobId(ctx.seq, index),
            conversationId: ctx.conversationId,
            seq: ctx.seq,
            toolCallId,
            tool: info,
            args: (input ?? {}) as Record<string, unknown>,
          });
          await job.start();
          if (job.refusedAtQuote) {
            ctx.jobs.discard(job.id);
            return { error: job.error?.detail ?? job.error?.message, note: REFUSED_NOTE };
          }
          return job.summary();
        },
      });
    } else {
      tools[mcpTool.name] = passthrough(mcpTool, ctx.orchestration, ctx);
    }
  }

  if (ctx.panels && catalog.orchestration.some((t) => t.name === 'run_step')) Object.assign(tools, panelTools({ conversationId: ctx.conversationId, seq: ctx.seq, panels: ctx.panels }));

  if (catalog.site) {
    for (const siteTool of catalog.site) {
      if (!(siteTool.name in tools)) tools[siteTool.name] = passthrough(siteTool, ctx.site, ctx);
    }
  } else {
    tools.search_models = tool({
      description: 'Search Civitai community models (checkpoints, LoRAs, embeddings) that can be used for generation.',
      inputSchema: jsonSchema<FallbackSearchArgs>(FALLBACK_SEARCH_SCHEMA as never),
      execute: (input, { abortSignal }) => searchModelsViaApi(ctx.siteApi, input, abortSignal),
    });
  }

  if (ctx.posts.available) tools[POST_TOOL] = tool({
    description: `Post ${postableKinds(ctx.posts)} made in this chat to Civitai, when the user asks to share or post them. Shows a card; the user confirms the post themselves, and nothing goes public until they do. Uploads and audio cannot be posted.`,
    inputSchema: jsonSchema<{ files: string[]; title?: string; description?: string; tags?: string[] }>({
      type: 'object',
      properties: {
        files: { type: 'array', minItems: 1, maxItems: 10, items: { type: 'string' }, description: 'Ids of pictures made in this chat, in the order they should appear' },
        title: { type: 'string', description: 'A short title suggestion' },
        description: { type: 'string', description: 'An optional one or two sentence description' },
        tags: { type: 'array', maxItems: 5, items: { type: 'string' } },
      },
      required: ['files'],
      additionalProperties: false,
    }),
    execute: async (input, { toolCallId }) => {
      const items = input.files.map((id) => ctx.findAttachment(id));
      const missing = input.files.filter((_, index) => !items[index]);
      if (missing.length) return { error: `No such files in this chat: ${missing.join(', ')}`, note: FAILED_NOTE };
      const unpostable = (items as Attachment[]).filter((item) => !ctx.posts.accepts(item)).map((item) => item.id);
      if (unpostable.length) return { error: `Only ${postableKinds(ctx.posts)} made in this chat can be posted; not ${unpostable.join(', ')}.`, note: 'Tell the user in plain words.' };
      const post = ctx.posts.create({ id: toolCallId, items: items as Attachment[], title: input.title, detail: input.description, tags: input.tags });
      return post.summary();
    },
  });

  tools[ASK_CHOICE] = tool({
    description:
      'Show the user 2 to 4 clickable options when they need to pick a direction (a style, which picture to continue with, a mood). Stop after calling it; their pick comes back as their next message.',
    inputSchema: jsonSchema<{ question: string; options: { label: string; description?: string; image?: string }[] }>({
      type: 'object',
      properties: {
        question: { type: 'string' },
        options: {
          type: 'array',
          minItems: 2,
          maxItems: 4,
          items: {
            type: 'object',
            properties: {
              label: { type: 'string', description: 'Short, 1-5 words' },
              description: { type: 'string' },
              image: { type: 'string', description: 'Optional attachment id to show on the option' },
            },
            required: ['label'],
            additionalProperties: false,
          },
        },
      },
      required: ['question', 'options'],
      additionalProperties: false,
    }),
    execute: async () => ({
      shown: true,
      note: 'The options are on screen. Stop and wait for the user to choose; do not list them again.',
    }),
  });

  return tools;
}

function postableKinds(posts: PostManager): string {
  return posts.takesVideos ? 'pictures and videos' : 'pictures';
}

function passthrough(mcpTool: McpTool, connection: McpConnection, ctx: TurnToolContext) {
  const takesMedia = Object.keys((mcpTool.inputSchema.properties ?? {}) as object).some((key) => /url|image|video|audio/i.test(key));
  return dynamicTool({
    description: `${mcpTool.description ?? ''}${takesMedia ? MEDIA_SUFFIX : ''}`,
    inputSchema: jsonSchema(withoutControls(mcpTool.inputSchema)),
    execute: async (input, { abortSignal }) => {
      const raw = (input ?? {}) as Record<string, unknown>;
      const result = await connection.callTool(mcpTool.name, await ctx.resolveArgs(raw), { signal: abortSignal });
      const text = mcpResultToText(result);
      if (result.isError) return { error: text, note: FAILED_NOTE };
      if (CAPTION_TOOLS.has(mcpTool.name) && typeof raw.mediaUrl === 'string' && ATTACHMENT_ID.test(raw.mediaUrl)) {
        ctx.onCaption(raw.mediaUrl, text);
      }
      const models = modelsOf(result);
      return models ? { text, models } : text;
    },
  });
}

function modelsOf(result: Parameters<typeof structuredOf>[0]): ModelRecommendation[] | undefined {
  const models = structuredOf(result)?.models;
  if (!Array.isArray(models)) return undefined;
  return models.flatMap((model): ModelRecommendation[] => {
    if (!model || typeof model !== 'object') return [];
    const record = model as { id?: unknown; name?: unknown; type?: unknown; air?: unknown };
    if (typeof record.id !== 'number' || typeof record.name !== 'string') return [];
    const air = Array.isArray(record.air) ? (record.air[0] as { air?: string } | undefined)?.air : undefined;
    return [{ id: record.id, name: record.name, type: typeof record.type === 'string' ? record.type : undefined, air }];
  });
}
