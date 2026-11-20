/**
 * Tool-call syntax a model wrote as plain text, removed from the reply's last step only. That step is
 * sent with `toolChoice: 'none'`, so a tool call there is impossible by contract; some models (GLM)
 * still write their native call syntax as text, which the chat would show the viewer verbatim.
 *
 * HEURISTIC over model output, scoped to that one step: it knows the shapes seen or documented for
 * the models the chat offers (`<tool_call>…</tool_call>` with `<arg_key>`/`<arg_value>`,
 * `<|tool_call…|>` special tokens, `<function=…>…</function>`, and a bare JSON
 * `{"name": …, "arguments": …}` object). A shape it does not know passes through unchanged; a false
 * strip costs a sentence of a reply that could not call a tool anyway. An opener with no closer is
 * cut to the end, so a partial stream hides a call from its opener on; an opener still arriving
 * (`<tool_ca`) shows until the delta that completes it.
 */
export function stripToolMarkup(text: string): string {
  const out = withoutJsonCalls(
    text
      .replace(/<tool_call>[\s\S]*?(?:<\/tool_call>|$)/g, '')
      .replace(/<\|tool_calls?[a-z_]*\|>[\s\S]*?(?:<\|tool_calls?[a-z_]*end\|>|$)/g, '')
      .replace(/<function=[\s\S]*?(?:<\/function>|$)/g, '')
      .replace(/<\/?(?:tool_call|arg_key|arg_value|tool_calls?)>/g, '')
      .replace(/<\|[a-z_]{1,40}\|>/g, ''),
  );
  return out
    .replace(/```(?:json)?\s*```/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const JSON_CALL = /\{\s*"(?:name|tool|function)"\s*:\s*"[^"]*"\s*,\s*"(?:arguments|parameters|args|input)"\s*:/g;

/** Removes each `{"name": …, "arguments": …}` object, by its balanced braces (or to the end, if it never closes). */
function withoutJsonCalls(text: string): string {
  let result = '';
  let from = 0;
  for (const match of text.matchAll(JSON_CALL)) {
    if (match.index < from) continue;
    result += text.slice(from, match.index);
    from = closingBrace(text, match.index);
  }
  return result + text.slice(from);
}

function closingBrace(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (char === '\\') i++;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return i + 1;
  }
  return text.length;
}
