import { dynamicTool, jsonSchema, type JSONSchema7, type ToolSet } from 'ai';

import type { PanelManager, Probe } from './panel.js';
import { checkPanelSpec, mergeSpec, normalizeValues } from './spec.js';

export const OPEN_PANEL = 'open_panel';
export const UPDATE_PANEL = 'update_panel';
export const CLOSE_PANEL = 'close_panel';

export function isPanelTool(name: string): boolean {
  return name === OPEN_PANEL || name === UPDATE_PANEL || name === CLOSE_PANEL;
}

export interface PanelToolContext {
  conversationId: string;
  seq: number;
  panels: PanelManager;
}

const INPUT_SCHEMA: JSONSchema7 = {
  type: 'object',
  description: 'One control. kind is text, choice, slider, aspect, count, seed, toggle or image.',
  properties: {
    kind: { type: 'string', enum: ['text', 'choice', 'slider', 'aspect', 'count', 'seed', 'toggle', 'image'] },
    label: { type: 'string', description: 'Short, in plain words' },
    default: { description: 'Starting value' },
    placeholder: { type: 'string', description: 'text: an example of what to type' },
    required: { type: 'boolean', description: 'text or image: Run waits until it is filled in' },
    multiline: { type: 'boolean' },
    options: { type: 'array', items: { type: 'string' }, description: 'choice: 2-12 short labels; aspect: ratios like "1:1", "2:3", "16:9"' },
    map: {
      type: 'object',
      description:
        'choice: what each option puts in the run, by option label: prompt text, or a whole block of inputs (e.g. one model\'s settings) where "{{name}}" is the whole value. toggle: {"on": text, "off": text}.',
      additionalProperties: { anyOf: [{ type: 'string' }, { type: 'object' }] },
    },
    min: { type: 'number' },
    max: { type: 'number' },
    step: { type: 'number' },
    base: { type: 'number', description: 'aspect: about how many pixels a side of a square is (default 1024)' },
  },
  required: ['kind'],
};

const RUN_DESCRIPTION =
  'What the button does. To generate: exactly the arguments run_step takes ({"stepType": ..., "input": {...}}) or run_workflow takes ({"steps": [...]}), built from get_input_schema\'s example, with "{{name}}" where an input\'s value goes. A string that is only "{{name}}" becomes the value itself (a number stays a number); "{{shape.width}}" and "{{shape.height}}" give an aspect input\'s size; a choice or toggle with a map puts its mapped text. Put fixed technical settings in directly. For anything else (posting, acting on the page, asking you to work on something): {"ask": "a message to you with {{name}} placeholders"}; pressing the button sends you that message as the user, and an image input puts its picture with it.';

const BUTTON_SCHEMA = { type: 'string', description: 'The button label, 1-3 words, e.g. "Post" or "Make it"; Run by default' } as const;

const FIX_NOTE = 'Nothing was shown. Fix the definition and call again; if it fails twice, tell the user in plain words.';
const REFUSED_NOTE =
  'Nothing was shown: the service refused the run with these settings. Check run against get_input_schema and call again; if it is refused again, tell the user in plain words.';

const OPEN_DESCRIPTION = `Show a panel of controls in the chat for one kind of thing to make (logos, beats, portraits in different scenes), so the user can try settings and press Run themselves, as often as they like, without asking you each time. A panel can also be a form for anything else you can do (a post with its title and description, a request with options): its button then sends you a message filled from its fields. Use it when the user wants to explore or iterate, or asks for controls or settings; for a one-off, just call run_step. First pick the service and call get_input_schema, then expose only the 2 to 6 settings that matter to them in plain words (subject, style, mood, colors, shape, how many) and fix everything technical in run.`;

/** The assistant's tools for building panels; offered only where it can make things. */
export function panelTools(ctx: PanelToolContext): ToolSet {
  return {
    [OPEN_PANEL]: dynamicTool({
      description: OPEN_DESCRIPTION,
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          title: { type: 'string', description: 'What it makes, 1-5 words, e.g. "Logo maker"' },
          description: { type: 'string', description: 'One sentence for the user' },
          inputs: { type: 'object', description: 'The controls by name (letters, digits, _)', additionalProperties: INPUT_SCHEMA },
          layout: { type: 'array', items: { type: 'array', items: { type: 'string' } }, description: 'Optional rows of input names, e.g. [["subject"], ["style", "shape"]]' },
          run: { type: 'object', description: RUN_DESCRIPTION },
          button: BUTTON_SCHEMA,
          values: { type: 'object', description: 'Optional starting values by input name, e.g. what the user already said' },
        },
        required: ['title', 'inputs', 'run'],
      }),
      execute: async (input, { toolCallId }) => {
        const raw = (input ?? {}) as Record<string, unknown>;
        const checked = checkPanelSpec(raw);
        if (checked.errors) return { error: checked.errors.join(' '), note: FIX_NOTE };
        const values = normalizeValues(checked.spec, raw.values as Record<string, unknown> | undefined);
        const probe = await ctx.panels.probe(ctx, checked.spec, values);
        if (refused(probe)) return { error: probe.error?.detail ?? probe.error?.message, note: REFUSED_NOTE };
        const panel = ctx.panels.open({ ...ctx, toolCallId, spec: checked.spec, values, price: probe.price });
        return panel.summary();
      },
    }),
    [UPDATE_PANEL]: dynamicTool({
      description:
        'Change a panel already in the chat: fill in values for the user, add, change or remove controls (inputs merge by name; null removes one), add options to a choice (addOptions keeps the ones it has), or change the run. The panel moves to the end of the chat with its runs, and a closed one opens again. Use it whenever the user asks to change, extend or set up a panel, rather than opening a new one. Never use it to close or remove a panel: that is close_panel.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          panel: { type: 'string', description: 'Its handle, e.g. p1' },
          title: { type: 'string' },
          description: { type: 'string' },
          inputs: { type: 'object', description: 'Controls to add or replace by name; null removes one', additionalProperties: { anyOf: [INPUT_SCHEMA, { type: 'null' }] } },
          layout: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
          run: { type: 'object', description: `Replaces what the button does. ${RUN_DESCRIPTION}` },
          button: BUTTON_SCHEMA,
          values: { type: 'object', description: 'Values to set by input name' },
          addOptions: {
            type: 'object',
            description: 'New options for choices, keeping the current ones: {"<input name>": {"<option label>": what it puts in the run}}. For a model, copy the settings the selected option puts (in the panel context) and swap in the new model. Label it with the model\'s name only: never a price, which the Run button quotes from the service. A LoRA goes in its own lora choice, not the model one.',
            additionalProperties: { type: 'object', additionalProperties: { anyOf: [{ type: 'string' }, { type: 'object' }] } },
          },
        },
        required: ['panel'],
      }),
      execute: async (input, { toolCallId }) => {
        const raw = (input ?? {}) as Record<string, unknown>;
        const panel = ctx.panels.get(String(raw.panel));
        if (!panel) return { error: `There is no panel ${String(raw.panel)}.`, note: 'Use the handle of a panel in this chat, or open_panel for a new one.' };
        const changesDefinition = ['title', 'description', 'inputs', 'layout', 'run', 'button', 'addOptions'].some((key) => raw[key] !== undefined);
        const checked = changesDefinition ? checkPanelSpec(mergeSpec(panel.spec, raw)) : { spec: panel.spec };
        if (checked.errors) return { error: checked.errors.join(' '), note: 'The panel was not changed. Fix it and call again.' };
        // An option added for the viewer is the one they want next, unless the call picks another.
        const added = Object.fromEntries(
          Object.entries((raw.addOptions ?? {}) as Record<string, unknown>).flatMap(([key, options]) => {
            const first = options && typeof options === 'object' ? Object.keys(options)[0] : undefined;
            return first === undefined ? [] : [[key, first]];
          }),
        );
        const values = normalizeValues(checked.spec, { ...panel.values, ...added, ...(raw.values as Record<string, unknown> | undefined) });
        const probe = await panel.probe(checked.spec, values);
        if (refused(probe)) return { error: probe.error?.detail ?? probe.error?.message, note: 'The panel was not changed: the service refused the run with these settings. Check run against get_input_schema and call again.' };
        panel.apply({ spec: changesDefinition ? checked.spec : undefined, values, toolCallId });
        panel.price = probe.price;
        return panel.summary();
      },
    }),
    [CLOSE_PANEL]: dynamicTool({
      description: 'Close panels the user no longer wants, when they ask to close, remove, cancel or get rid of them. Each folds to one line in the chat, with what it made kept, and the user can reopen it.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: { panels: { type: 'array', minItems: 1, items: { type: 'string' }, description: 'Their handles, e.g. ["p1", "p2"]' } },
        required: ['panels'],
      }),
      execute: async (input) => {
        const handles = ((input ?? {}) as { panels?: unknown }).panels;
        const found = (Array.isArray(handles) ? handles : []).map((handle) => ctx.panels.get(String(handle)));
        const missing = (Array.isArray(handles) ? handles : []).filter((_, index) => !found[index]);
        if (missing.length || found.length === 0) return { error: `There is no panel ${missing.join(', ') || '(none given)'}.`, note: 'Use the handles of panels in this chat.' };
        for (const panel of found) panel!.close();
        return { closed: found.map((panel) => panel!.handle), note: 'They are closed. Say so in one short sentence.' };
      },
    }),
  };
}

/** Too little Buzz is not a broken panel: the user sees that on the Run button. */
function refused(probe: Probe): boolean {
  return probe.state === 'failed';
}
