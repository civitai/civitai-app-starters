import { describe, expect, it } from 'vitest';

import * as core from '../core.js';
import { buildToolSet, type TurnToolContext } from './build.js';

/**
 * A server runner offers `ask_choice` from `@civitai/components-chat/core`; the page builds its own in
 * `buildToolSet`. Both must be the same tool, or the runner's assistant asks with a schema or a result
 * the page's card and history do not read the same way.
 */

type Executable = { description?: string; inputSchema: { jsonSchema: unknown }; execute: (input: unknown, opts: unknown) => Promise<unknown> };

function pageAskChoice(): Executable {
  const ctx = {
    conversationId: 'C1',
    seq: 1,
    posts: { available: false },
    findAttachment: () => undefined,
    resolveArgs: async (args: Record<string, unknown>) => args,
  } as unknown as TurnToolContext;
  return buildToolSet({ orchestration: [], site: [] }, ctx)['ask_choice'] as unknown as Executable;
}

const opts = { toolCallId: 'c', messages: [] };

describe('askChoiceTool from @civitai/components-chat/core', () => {
  it('is exported under the name ask_choice', () => {
    expect(core.ASK_CHOICE).toBe('ask_choice');
    expect(typeof core.askChoiceTool).toBe('function');
  });

  it('has the description and input schema of the page tool', async () => {
    const runner = core.askChoiceTool() as unknown as Executable;
    const page = pageAskChoice();
    expect(runner.description).toBe(page.description);
    expect(await runner.inputSchema.jsonSchema).toEqual(await page.inputSchema.jsonSchema);
    expect(runner.description).toBe(
      'Show the user 2 to 4 clickable options when they need to pick a direction (a style, which picture to continue with, a mood). Stop after calling it; their pick comes back as their next message.'
    );
    expect(await runner.inputSchema.jsonSchema).toEqual({
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
    });
  });

  it('shows a valid choice and ends the reply, as the page tool does', async () => {
    const input = { question: 'Which layout?', options: [{ label: 'Grid' }, { label: 'List', description: 'One per row' }] };
    const result = await (core.askChoiceTool() as unknown as Executable).execute(input, opts);
    expect(result).toEqual({ shown: true, awaitsUser: true, note: 'The options are on screen. Stop and wait for the user to choose; do not list them again.' });
    expect(result).toEqual(await pageAskChoice().execute(input, opts));
  });

  it('refuses a choice the card could not show without ending the reply, as the page tool does', async () => {
    const input = { question: 'Which layout?', options: [{ label: 'Only one' }] };
    const result = await (core.askChoiceTool() as unknown as Executable).execute(input, opts);
    expect(result).toEqual({
      error: 'options must be an array of 2 to 4 objects, each with a "label" string.',
      note: 'Nothing was shown. Call ask_choice again with options as an array.',
    });
    expect(result).not.toHaveProperty('awaitsUser');
    expect(result).toEqual(await pageAskChoice().execute(input, opts));
  });
});
