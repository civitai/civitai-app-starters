import { html, nothing, type TemplateResult } from 'lit';

import { FULL_CHARS, capText, prettyValue, splitToolName, summarizeInput } from '../agent/tool-groups.js';
import type { ToolPart } from './tool-views.js';

/** How the thread shows tool calls: `activity` (a line while one runs, the default) or `details` (a row per call). */
export type ToolCallsMode = 'activity' | 'details';

/** What the call rows need from the turn: which rows are open, a way to flip one, and the added servers. */
export interface CallRowState {
  isOpen(key: string): boolean;
  /** Opened at least once: its body stays rendered, so closing it can animate. */
  wasOpened(key: string): boolean;
  toggle(key: string): void;
  /** Why the call failed, when it did: an error, or a finished call whose result carries one. */
  failure(part: ToolPart): string | undefined;
  /** The added MCP servers' ids, so a call of one of their tools shows its server. */
  servers(): ReadonlySet<string>;
}

type Shown = 'calling' | 'done' | 'error';

const STATE_LABEL: Record<Shown, string> = { calling: 'Running', done: 'Done', error: 'Failed' };

function stateOf(part: ToolPart, rows: CallRowState): Shown {
  return rows.failure(part) !== undefined ? 'error' : part.state === 'calling' ? 'calling' : 'done';
}

let ids = 0;
const domIds = new WeakMap<object, string>();
/** A stable id per call object, so `aria-controls` points at its own body across re-renders. */
function domId(part: ToolPart, prefix: string): string {
  let id = domIds.get(part);
  if (!id) domIds.set(part, (id = `cvt-call-${++ids}`));
  return `${id}-${prefix}`;
}

function valueBlock(label: string, value: unknown): TemplateResult {
  return html`<div class="cvt-call-value">
    <div class="cvt-call-label">${label}</div>
    <pre class="cvt-call-pre" tabindex="0">${capText(prettyValue(value), FULL_CHARS).text}</pre>
  </div>`;
}

/** One call: its name (and server), what it was asked, and how it went; opened, the whole input and result. */
export function renderCall(part: ToolPart, rows: CallRowState): TemplateResult {
  const { server, tool } = splitToolName(part.toolName, rows.servers());
  const state = stateOf(part, rows);
  const key = `call:${part.toolCallId}`;
  const open = rows.isOpen(key);
  const body = domId(part, 'body');
  const failure = rows.failure(part);
  const summary = summarizeInput(part.input);
  return html`<div class="cvt-call" data-state=${state}>
    <button type="button" class="cvt-call-head" data-call=${part.toolCallId} aria-expanded=${open ? 'true' : 'false'} aria-controls=${body} @click=${() => rows.toggle(key)}>
      <span class="cvt-call-chevron" aria-hidden="true"></span>
      <span class="cvt-call-name">${tool}</span>
      ${server ? html`<span class="cvt-call-server">${server}</span>` : nothing}
      ${summary ? html`<span class="cvt-call-summary">${summary}</span>` : nothing}
      <span class="cvt-call-state">${STATE_LABEL[state]}</span>
    </button>
    <div class="cvt-call-body" id=${body} ?inert=${!open} data-open=${open ? 'true' : 'false'}>
      <div class="cvt-call-inner">
        ${rows.wasOpened(key)
          ? html`${valueBlock('Input', part.input)}
            ${failure !== undefined
              ? valueBlock('Error', failure)
              : state === 'calling'
                ? html`<div class="cvt-call-label">Still running…</div>`
                : valueBlock('Result', part.output)}`
          : nothing}
      </div>
    </div>
  </div>`;
}

/** Calls in a row as one collapsed line ("Used 3 tools"); opened, a row per call. */
export function renderCallGroup(calls: ToolPart[], rows: CallRowState): TemplateResult {
  const key = `group:${calls[0]!.toolCallId}`;
  const open = rows.isOpen(key);
  const body = domId(calls[0]!, 'group');
  const states = calls.map((part) => stateOf(part, rows));
  const running = states.includes('calling');
  const failed = states.filter((s) => s === 'error').length;
  const label = running ? `Using ${calls.length} tools…` : `Used ${calls.length} tools`;
  return html`<div class="cvt-tool-group" data-count=${calls.length} data-state=${running ? 'calling' : failed ? 'error' : 'done'}>
    <button type="button" class="cvt-tool-group-head" aria-expanded=${open ? 'true' : 'false'} aria-controls=${body} @click=${() => rows.toggle(key)}>
      <span class="cvt-call-chevron" aria-hidden="true"></span>
      <span class="cvt-tool-group-label">${label}</span>
      ${failed ? html`<span class="cvt-call-state">${failed} failed</span>` : nothing}
    </button>
    <div class="cvt-call-body" id=${body} ?inert=${!open} data-open=${open ? 'true' : 'false'}>
      <div class="cvt-call-inner">
        <div class="cvt-tool-group-list">${calls.map((part) => renderCall(part, rows))}</div>
      </div>
    </div>
  </div>`;
}
