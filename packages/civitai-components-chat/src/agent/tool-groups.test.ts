import type { ModelMessage } from 'ai';
import { describe, expect, it } from 'vitest';

import { partsFromMessages, type TurnPart } from './parts.js';
import { capText, groupToolCalls, prettyValue, splitToolName, summarizeInput, type Segment } from './tool-groups.js';

type ToolPart = Extract<TurnPart, { kind: 'tool' }>;

const call = (id: string, state: ToolPart['state'] = 'done', toolName = `tool_${id}`): ToolPart => ({
  kind: 'tool',
  toolCallId: id,
  toolName,
  input: { id },
  state,
  ...(state === 'done' ? { output: { ok: id } } : state === 'error' ? { error: `failed ${id}` } : {}),
});
const text = (words: string): TurnPart => ({ kind: 'text', text: words });

// Calls named `view_*` stand for ones with a view of their own (the page's, or a built-in card).
const listed = (part: ToolPart) => !part.toolName.startsWith('view_');

/** Each segment as a short string: `T:<text>`, `P:<id>` for a call shown as before, `[a,b]` for a run. */
function shape(segments: Segment[]): string[] {
  return segments.map((s) =>
    s.kind === 'calls' ? `[${s.calls.map((c) => c.toolCallId).join(',')}]` : s.part.kind === 'text' ? `T:${s.part.text}` : `P:${s.part.toolCallId}`,
  );
}

describe('groupToolCalls', () => {
  it('keeps a single call as a run of one, which the turn shows unwrapped', () => {
    expect(shape(groupToolCalls([text('a'), call('c1'), text('b')], listed))).toEqual(['T:a', '[c1]', 'T:b']);
  });

  it('puts two calls in a row into one run', () => {
    expect(shape(groupToolCalls([call('c1'), call('c2')], listed))).toEqual(['[c1,c2]']);
  });

  it('puts three calls in a row into one run, in order', () => {
    const segments = groupToolCalls([text('a'), call('c1'), call('c2'), call('c3')], listed);
    expect(shape(segments)).toEqual(['T:a', '[c1,c2,c3]']);
    // The run carries the very parts, so a call updated in place shows its new state.
    expect(segments[1]).toEqual({ kind: 'calls', calls: [call('c1'), call('c2'), call('c3')] });
  });

  it('starts a new run after text with words in it', () => {
    expect(shape(groupToolCalls([call('c1'), call('c2'), text('then'), call('c3'), call('c4'), call('c5')], listed))).toEqual([
      '[c1,c2]',
      'T:then',
      '[c3,c4,c5]',
    ]);
  });

  it('lets a call with its own view break a run and show as before', () => {
    const parts = [call('c1'), call('c2'), call('v1', 'done', 'view_card'), call('c3')];
    expect(shape(groupToolCalls(parts, listed))).toEqual(['[c1,c2]', 'P:v1', '[c3]']);
  });

  it('groups a run whose calls are all still running', () => {
    const segments = groupToolCalls([call('c1', 'calling'), call('c2', 'calling'), call('c3', 'calling')], listed);
    expect(shape(segments)).toEqual(['[c1,c2,c3]']);
    expect(segments[0]!.kind === 'calls' && segments[0].calls.map((c) => c.state)).toEqual(['calling', 'calling', 'calling']);
  });

  it('keeps a failed call inside its run', () => {
    const segments = groupToolCalls([call('c1'), call('c2', 'error'), call('c3')], listed);
    expect(shape(segments)).toEqual(['[c1,c2,c3]']);
    expect(segments[0]!.kind === 'calls' && segments[0].calls[1]).toMatchObject({ state: 'error', error: 'failed c2' });
  });

  it('does not let whitespace-only text break a run, and drops it', () => {
    expect(shape(groupToolCalls([call('c1'), text('\n\n'), call('c2'), text(' '), text('done')], listed))).toEqual(['[c1,c2]', 'T:done']);
  });

  it('groups a reply rebuilt from storage the same as the live one', () => {
    const live: TurnPart[] = [text('Looking.'), call('c1'), text('\n'), call('c2', 'error'), call('c3'), text('Found it.')];
    const messages: ModelMessage[] = [
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Looking.' },
          { type: 'tool-call', toolCallId: 'c1', toolName: 'tool_c1', input: { id: 'c1' } },
          { type: 'text', text: '\n' },
          { type: 'tool-call', toolCallId: 'c2', toolName: 'tool_c2', input: { id: 'c2' } },
          { type: 'tool-call', toolCallId: 'c3', toolName: 'tool_c3', input: { id: 'c3' } },
        ],
      },
      {
        role: 'tool',
        content: [
          { type: 'tool-result', toolCallId: 'c1', toolName: 'tool_c1', output: { type: 'json', value: { ok: 'c1' } } },
          { type: 'tool-result', toolCallId: 'c2', toolName: 'tool_c2', output: { type: 'error-text', value: 'failed c2' } },
          { type: 'tool-result', toolCallId: 'c3', toolName: 'tool_c3', output: { type: 'json', value: { ok: 'c3' } } },
        ],
      },
      { role: 'assistant', content: [{ type: 'text', text: 'Found it.' }] },
    ];
    const rebuilt = groupToolCalls(partsFromMessages(messages), listed);
    expect(shape(rebuilt)).toEqual(['T:Looking.', '[c1,c2,c3]', 'T:Found it.']);
    expect(shape(rebuilt)).toEqual(shape(groupToolCalls(live, listed)));
    expect(rebuilt[1]!.kind === 'calls' && rebuilt[1].calls.map((c) => c.state)).toEqual(['done', 'error', 'done']);
  });
});

describe('call row helpers', () => {
  it('splits an added server tool name, and leaves others whole', () => {
    expect(splitToolName('sandbox__run_command')).toEqual({ server: 'sandbox', tool: 'run_command' });
    expect(splitToolName('search_models')).toEqual({ tool: 'search_models' });
    expect(splitToolName('__x')).toEqual({ tool: '__x' });
  });

  it('summarizes an input on one line, cut to fit', () => {
    expect(summarizeInput({ path: '/src', depth: 2 })).toBe('path: /src, depth: 2');
    expect(summarizeInput({ text: 'a\n  b' })).toBe('text: a b');
    expect(summarizeInput(undefined)).toBe('');
    const long = summarizeInput({ q: 'x'.repeat(500) });
    expect(long).toHaveLength(80);
    expect(long.endsWith('…')).toBe(true);
  });

  it('pretty-prints a value and caps it', () => {
    expect(prettyValue({ a: [1] })).toBe('{\n  "a": [\n    1\n  ]\n}');
    expect(prettyValue('as is')).toBe('as is');
    expect(capText('abcdef', 4)).toEqual({ text: 'abcd\n…(2 more characters)', cut: true });
    expect(capText('abc', 4)).toEqual({ text: 'abc', cut: false });
  });
});
