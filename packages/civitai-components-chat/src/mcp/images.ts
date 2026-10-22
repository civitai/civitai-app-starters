import type { ModelMessage, UserContent } from 'ai';

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

/** The image types a tool's reply may show the assistant; any other binary content is left out. */
export const TOOL_IMAGE_TYPES: readonly string[] = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
/** The most images one tool result shows. */
export const MAX_IMAGES_PER_RESULT = 2;
/** The most bytes (decoded) one tool result's images may hold in all. */
export const MAX_IMAGE_BYTES_PER_RESULT = 512 * 1024;
/** The most images a reply shows at once: every step sends them again, so the oldest go first. */
export const MAX_IMAGES_PER_REPLY = 4;

/** One image a tool returned, as base64. */
export interface ToolImage {
  mediaType: string;
  data: string;
}

const SHOWN = (type: string) =>
  `[${type} image: shown to you after this step's tool results while this reply runs (the latest ${MAX_IMAGES_PER_REPLY} at most); it is not saved]`;
const NOT_SHOWN = (type: string) => `[${type} image not shown: this caller cannot show images to the assistant]`;
const NOT_AN_IMAGE = (type: string) => `[${type} content left out: only JPEG, PNG, WebP and GIF images are shown]`;
const TOO_BIG = (type: string, bytes: number) =>
  `[${type} image left out: ${Math.ceil(bytes / 1024)} KiB is over the ${MAX_IMAGE_BYTES_PER_RESULT / 1024} KiB a tool result may show]`;
const TOO_MANY = (type: string) => `[${type} image left out: a tool result shows at most ${MAX_IMAGES_PER_RESULT} images]`;
const MALFORMED = (type: string) => `[${type} image left out: its data is not valid base64]`;

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** Decoded bytes of well-formed base64, or `undefined` when it is not. */
function decodedBytes(data: string): number | undefined {
  if (data.length % 4 !== 0 || !BASE64.test(data)) return undefined;
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
  return (data.length / 4) * 3 - padding;
}

/**
 * A tool result's binary content: the images the assistant may see, within the caps, and one note
 * line for each binary part, in order, saying what became of it (shown, or left out and why). Text
 * and resource links are not read here (`mcpResultToText` keeps them); a result with no binary part
 * has no note. `canShow` false: no image is kept, each one's note says it was not shown.
 */
export function toolImagesOf(result: CallToolResult, canShow: boolean): { images: ToolImage[]; notes: string[] } {
  const images: ToolImage[] = [];
  const notes: string[] = [];
  let bytes = 0;
  for (const block of result.content) {
    let type: string;
    let data: string;
    if (block.type === 'image' || block.type === 'audio') ({ mimeType: type, data } = block);
    else if (block.type === 'resource' && 'blob' in block.resource) {
      notes.push(NOT_AN_IMAGE(block.resource.mimeType || 'binary'));
      continue;
    } else continue;
    if (block.type !== 'image' || !TOOL_IMAGE_TYPES.includes(type)) {
      notes.push(NOT_AN_IMAGE(type || 'binary'));
      continue;
    }
    const size = decodedBytes(data);
    if (size === undefined) notes.push(MALFORMED(type));
    else if (!canShow) notes.push(NOT_SHOWN(type));
    else if (images.length >= MAX_IMAGES_PER_RESULT) notes.push(TOO_MANY(type));
    else if (bytes + size > MAX_IMAGE_BYTES_PER_RESULT) notes.push(TOO_BIG(type, size));
    else {
      bytes += size;
      images.push({ mediaType: type, data });
      notes.push(SHOWN(type));
    }
  }
  return { images, notes };
}

/**
 * The images one reply's tools returned, by tool call id: made by `AgentCore` for each reply and handed
 * to its tools as `experimental_context` (see {@link toolImagesIn}), so nothing outlives the reply or
 * reaches another. They never enter a tool's output, so the reply's messages, its saves and the parts
 * it shows hold only the note in their place.
 */
export class ToolImages {
  readonly #byCall = new Map<string, { toolName: string; images: ToolImage[] }>();

  add(toolCallId: string, toolName: string, images: ToolImage[]): void {
    this.#byCall.delete(toolCallId);
    if (images.length === 0) return;
    this.#byCall.set(toolCallId, { toolName, images });
    // The oldest images go first once the reply holds more than it shows.
    let held = 0;
    for (const entry of this.#byCall.values()) held += entry.images.length;
    for (const [id, entry] of this.#byCall) {
      if (held <= MAX_IMAGES_PER_REPLY) break;
      const drop = Math.min(entry.images.length, held - MAX_IMAGES_PER_REPLY);
      held -= drop;
      if (drop === entry.images.length) this.#byCall.delete(id);
      else entry.images = entry.images.slice(drop);
    }
  }

  get size(): number {
    return this.#byCall.size;
  }

  /**
   * `messages` with, after each run of tool messages from `from` on, one user message holding the
   * images their results returned, in call order: the OpenAI-compatible chat API takes images only in
   * a user message. A call id used more than once gets them after its last result only. `undefined`
   * when no result there has any, so the request goes exactly as it would have.
   */
  withImages(messages: ModelMessage[], from = 0): ModelMessage[] | undefined {
    if (this.#byCall.size === 0) return undefined;
    // The last result of each call id that has images.
    const lastAt = new Map<string, number>();
    messages.forEach((message, index) => {
      if (index < from || message.role !== 'tool') return;
      for (const part of message.content) if (part.type === 'tool-result' && this.#byCall.has(part.toolCallId)) lastAt.set(part.toolCallId, index);
    });
    if (lastAt.size === 0) return undefined;
    const out: ModelMessage[] = [];
    let pending: Exclude<UserContent, string> = [];
    messages.forEach((message, index) => {
      out.push(message);
      if (message.role === 'tool') {
        for (const part of message.content) {
          if (part.type !== 'tool-result' || lastAt.get(part.toolCallId) !== index) continue;
          const { toolName, images } = this.#byCall.get(part.toolCallId)!;
          pending.push({ type: 'text', text: `Returned by ${toolName} (${part.toolCallId}):` });
          for (const image of images) pending.push({ type: 'image', image: image.data, mediaType: image.mediaType });
        }
      }
      if (pending.length > 0 && messages[index + 1]?.role !== 'tool') {
        out.push({ role: 'user', content: pending });
        pending = [];
      }
    });
    return out;
  }
}

/** What `AgentCore` hands its tools as `experimental_context`. */
export interface ToolImagesContext {
  toolImages: ToolImages;
}

/** The reply's image store a tool was handed, if its caller has one. */
export function toolImagesIn(context: unknown): ToolImages | undefined {
  const images = (context as Partial<ToolImagesContext> | null | undefined)?.toolImages;
  return images instanceof ToolImages ? images : undefined;
}
