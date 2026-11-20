import { describe, expect, it } from 'vitest';

import { stripToolMarkup } from './tool-markup.js';

describe('stripToolMarkup', () => {
  it.each([
    ['GLM <tool_call> with <arg_key>/<arg_value>', 'Done so far.<tool_call>sandbox__list_dir<arg_key>path</arg_key><arg_value>app</arg_value></tool_call>', 'Done so far.'],
    ['special-token sections', 'Next: <|tool_calls_section_begin|><|tool_call_begin|>functions.read:0<|tool_call_argument_begin|>{"path":"a"}<|tool_call_end|><|tool_calls_section_end|>', 'Next:'],
    ['<function=…> calls', 'Paused. <function=list_dir><parameter=path>.</parameter></function>', 'Paused.'],
    ['a bare JSON call, nested braces and all', 'Stopping here. {"name": "write_file", "arguments": {"path": "a.ts", "content": "const x = { y: \\"}\\" };"}} Say continue.', 'Stopping here.  Say continue.'],
    ['a fenced JSON call', 'Here:\n```json\n{"name":"run_command","arguments":{"command":"npm test"}}\n```', 'Here:'],
    ['an opener that never closes, as mid-stream', 'Almost there <tool_call>sandbox__read_fi', 'Almost there'],
  ])('removes %s', (_name, input, expected) => {
    expect(stripToolMarkup(input)).toBe(expected);
  });

  it('leaves ordinary words, code and JSON alone', () => {
    const plain = 'Set `{"theme": "dark"}` in settings.json, then run `npm test`. Use a <div> for it.';
    expect(stripToolMarkup(plain)).toBe(plain);
  });
});
