import type { TurnPart } from './parts.js';

type ToolPart = Extract<TurnPart, { kind: 'tool' }>;

/** What a turn shows with `tool-calls="details"`: a part as before, or a run of calls with no view of their own. */
export type Segment = { kind: 'part'; part: TurnPart } | { kind: 'calls'; calls: ToolPart[] };

/**
 * Splits a turn's parts into what the thread shows. `listed(part)` says whether a call is one that
 * shows as a call row (it has no view of its own, so it would otherwise show nothing once finished).
 * Consecutive listed calls become one `calls` segment; text with words in it, or any call that is not
 * listed, ends the run. Whitespace-only text is dropped: a reply streamed live can carry it between two
 * calls, while one rebuilt from storage never does, so both group the same.
 */
export function groupToolCalls(parts: readonly TurnPart[], listed: (part: ToolPart) => boolean): Segment[] {
  const segments: Segment[] = [];
  let run: ToolPart[] | null = null;
  for (const part of parts) {
    if (part.kind === 'text' && part.text.trim() === '') continue;
    if (part.kind === 'tool' && listed(part)) {
      if (!run) segments.push({ kind: 'calls', calls: (run = []) });
      run.push(part);
      continue;
    }
    run = null;
    segments.push({ kind: 'part', part });
  }
  return segments;
}

/** An added MCP server's tool is offered as `${server}__${tool}`; built-in and page tools have no server. */
export function splitToolName(name: string): { server?: string; tool: string } {
  const at = name.indexOf('__');
  return at > 0 && at < name.length - 2 ? { server: name.slice(0, at), tool: name.slice(at + 2) } : { tool: name };
}

const SUMMARY_MAX = 80;

/** One short line for a call's input: `key: value` pairs, cut to fit. */
export function summarizeInput(input: unknown): string {
  let line: string;
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    line = Object.entries(input as Record<string, unknown>)
      .map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
      .join(', ');
  } else {
    line = input === undefined ? '' : typeof input === 'string' ? input : (JSON.stringify(input) ?? '');
  }
  line = line.replace(/\s+/g, ' ').trim();
  return line.length > SUMMARY_MAX ? `${line.slice(0, SUMMARY_MAX - 1)}…` : line;
}

/** A value as readable text: a string as it is, anything else as indented JSON. */
export function prettyValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined) return '';
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

/** Shown until the viewer asks for more. */
export const PREVIEW_CHARS = 1_500;
/** The most a call row ever shows of one value, so a huge reply cannot freeze the page. */
export const FULL_CHARS = 50_000;

/** `text` cut to `max`, and whether anything was cut. */
export function capText(text: string, max: number): { text: string; cut: boolean } {
  return text.length > max ? { text: `${text.slice(0, max)}\n…(${text.length - max} more characters)`, cut: true } : { text, cut: false };
}
