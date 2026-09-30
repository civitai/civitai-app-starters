import type { Workflow } from '@civitai/sdk';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export function workflow(partial: Partial<Workflow> & { id: string }): Workflow {
  return { status: 'processing', steps: [], tags: [], metadata: {}, ...partial } as unknown as Workflow;
}

export function imageStep(images: { id: string; url?: string; available?: boolean; width?: number; height?: number }[], extra: Record<string, unknown> = {}) {
  return {
    $type: 'imageGen',
    name: '$0',
    status: 'succeeded',
    // As the orchestrator writes them: ImageBlob-typed fields carry no `type`.
    output: { images: images.map((image) => ({ available: true, ...image })) },
    ...extra,
  };
}

export function toolResult(structured?: Record<string, unknown>, text = 'ok', isError = false): CallToolResult {
  return {
    content: [{ type: 'text', text }],
    ...(structured ? { structuredContent: structured } : {}),
    ...(isError ? { isError: true } : {}),
  } as CallToolResult;
}

/** An async generator fed by the test, so a watch loop can be driven step by step. */
export function controllable<T>() {
  const queue: T[] = [];
  let wake: (() => void) | null = null;
  let done = false;
  return {
    push(value: T) {
      queue.push(value);
      wake?.();
    },
    end() {
      done = true;
      wake?.();
    },
    async *iterate(): AsyncGenerator<T, void, undefined> {
      for (;;) {
        if (queue.length > 0) {
          yield queue.shift()!;
          continue;
        }
        if (done) return;
        await new Promise<void>((resolve) => (wake = resolve));
        wake = null;
      }
    },
  };
}

export const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
