import { dynamicTool, jsonSchema, type ToolSet } from 'ai';

import { ATTACHMENT_ID } from '../store/attachments.js';
import type { Attachment, MediaKind } from '../types.js';

/** A tool the page embedding the chat offers the assistant, acting on that page. */
export interface ChatTool {
  /** Tells the assistant what the tool does and when to use it. */
  description: string;
  /** JSON Schema of the input object. */
  inputSchema: Record<string, unknown>;
  /**
   * Its return value goes back to the assistant as JSON; a throw becomes an error the assistant
   * reports in plain words. File ids in the input arrive swapped for their URLs.
   */
  execute(input: Record<string, unknown>, context: ChatToolContext): unknown;
  /** Shown while it runs, e.g. "Pinning it to your board…". */
  activity?: string;
}

export interface ChatToolContext {
  signal: AbortSignal;
  conversationId: string;
  /** The chat's files the input named, with the id the assistant used. */
  files: ChatFile[];
}

export interface ChatFile {
  id: string;
  kind: MediaKind;
  url?: string;
  mime?: string;
  width?: number;
  height?: number;
  durationSec?: number;
}

export interface HostToolDeps {
  conversationId: string;
  findAttachment(id: string): Attachment | undefined;
  resolveArgs(args: Record<string, unknown>): Promise<Record<string, unknown>>;
}

const NAME = /^[A-Za-z0-9_-]{1,64}$/;
const MEDIA_NOTE = ' Pass attachment ids (like up1-1 or gen2-1-1) for files from this chat.';
const FAILED_NOTE = 'This did not work. Tell the user in plain words; do not retry it this turn.';

/** Host tools as the assistant sees them; a built-in tool of the same name wins. */
export function hostToolSet(tools: Record<string, ChatTool>, builtIn: ToolSet, deps: HostToolDeps): ToolSet {
  const set: ToolSet = {};
  for (const [name, hostTool] of Object.entries(tools)) {
    if (!NAME.test(name) || name in builtIn) {
      console.warn(`[chat-cvt] host tool "${name}" is skipped: ${name in builtIn ? 'a built-in tool has that name' : 'names are letters, digits, _ and - only'}`);
      continue;
    }
    set[name] = dynamicTool({
      description: `${hostTool.description}${MEDIA_NOTE}`,
      inputSchema: jsonSchema({ type: 'object', ...hostTool.inputSchema }),
      execute: async (input, { abortSignal }) => {
        const raw = (input ?? {}) as Record<string, unknown>;
        const files = [...new Set(idsIn(raw))].flatMap((id) => {
          const attachment = deps.findAttachment(id);
          return attachment ? [fileOf(attachment)] : [];
        });
        try {
          const resolved = await deps.resolveArgs(raw);
          // Resolving refreshes expired URLs on the attachments themselves.
          const fresh = files.map((file) => ({ ...file, url: deps.findAttachment(file.id)?.url ?? file.url }));
          const result = await hostTool.execute(resolved, { signal: abortSignal ?? new AbortController().signal, conversationId: deps.conversationId, files: fresh });
          return result === undefined ? { ok: true } : result;
        } catch (error) {
          return { error: error instanceof Error ? error.message : String(error), note: FAILED_NOTE };
        }
      },
    });
  }
  return set;
}

function idsIn(value: unknown): string[] {
  if (typeof value === 'string') return ATTACHMENT_ID.test(value) ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(idsIn);
  if (value && typeof value === 'object') return Object.values(value).flatMap(idsIn);
  return [];
}

function fileOf({ id, kind, url, mime, width, height, durationSec }: Attachment): ChatFile {
  return { id, kind, url, mime, width, height, durationSec };
}
