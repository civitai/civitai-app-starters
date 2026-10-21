import { html, nothing, type TemplateResult } from 'lit';
import { until } from 'lit/directives/until.js';

import type { TurnPart } from '../agent/parts.js';
import { DISPATCH_AGENT, isSubagentOutput, subagentResultOf, type SubagentStatus } from '../agent/subagent-result.js';
import type { SubagentTracker } from '../agent/subagents.js';
import type { JobManager } from '../orchestration/jobs.js';
import type { PanelManager } from '../panels/panel.js';
import { CLOSE_PANEL, OPEN_PANEL, UPDATE_PANEL } from '../panels/tools.js';
import { POST_TOOL, type PostManager } from '../posting/post.js';
import { UPDATE_INSTRUCTIONS, proposedInstructions } from '../tools/instructions.js';
import { CUSTOM_INSTRUCTIONS_MAX } from '../config.js';
import type { ModelDirectory } from '../store/models.js';
import { ASK_CHOICE } from '../tools/build.js';
import { JOB_TOOLS } from '../tools/catalog.js';
import { normalizeChoice } from '../tools/choice.js';
import type { ChatToolCall, ChatToolView } from '../tools/host.js';
import type { Attachment, ModelRecommendation } from '../types.js';
import { emit } from './light.js';
import type { CallRowState } from './tool-calls.js';
import { mediaActions } from './media-actions.js';

export type ToolPart = Extract<TurnPart, { kind: 'tool' }>;

export interface ToolViewContext {
  host: HTMLElement;
  jobs: JobManager;
  posts: PostManager;
  panels?: PanelManager;
  files: () => Attachment[];
  canShare: boolean;
  dockPanels: boolean;
  /** Only the newest turn's choices can still be picked. */
  latest: boolean;
  live: boolean;
  models: ModelDirectory;
  resolve: (id: string) => Attachment | undefined;
  /** The subagents running now: a running `dispatch_agent` card reads its progress here. */
  subagents?: SubagentTracker;
  /** Which disclosures in the turn are open. */
  rows?: Pick<CallRowState, 'isOpen' | 'wasOpened' | 'toggle'>;
  /** The viewer's saved custom instructions, so a proposal already saved reads as saved. */
  instructions?: string;
}

/** `render` returning `undefined` leaves the call to the default: its activity while it runs, nothing after. */
export interface ToolView {
  activity?: string;
  render?(part: ToolPart, ctx: ToolViewContext): unknown;
  /** `render` also draws this call when it failed, instead of the "didn't work" note. Built-in views only. */
  ownsFailure?(part: ToolPart, ctx: ToolViewContext): boolean;
}

const job: ToolView = {
  activity: 'Starting it…',
  render(part, ctx) {
    const output = part.output as { job?: string } | undefined;
    const found = ctx.jobs.byToolCall(part.toolCallId) ?? (output?.job ? ctx.jobs.get(output.job) : undefined);
    if (!found) return undefined;
    return html`<civitai-chat-generation-card .job=${found} ?adjustable=${found.tool.name === 'run_step' && !found.panel} .actions=${mediaActions(ctx.posts)}></civitai-chat-generation-card>`;
  },
};

function renderPanel(part: ToolPart, ctx: ToolViewContext): unknown {
  const handle = (part.output as { panel?: unknown } | undefined)?.panel;
  const found = typeof handle === 'string' ? ctx.panels?.get(handle) : undefined;
  if (!found) return undefined;
  const verb = part.toolName === OPEN_PANEL ? 'Set up' : 'Changed';
  if (ctx.dockPanels) {
    return html`<button type="button" class="cvt-panel-chip" @click=${() => emit(ctx.host, 'panel-focus', { panel: found })}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h10M4 12h16M4 18h7M17 4v4M10 10v4M14 16v4" /></svg>
      ${verb} “${found.spec.title}”
    </button>`;
  }
  // A panel shows once, at the assistant's latest change to it.
  if (found.toolCallId === part.toolCallId) {
    return html`<civitai-chat-panel .panel=${found} .files=${ctx.files} ?can-share=${ctx.canShare} .actions=${mediaActions(ctx.posts)}></civitai-chat-panel>`;
  }
  return html`<div class="cvt-note">${verb} “${found.spec.title}”; it is further down.</div>`;
}

const post: ToolView = {
  activity: 'Getting your post ready…',
  render(part, ctx) {
    const found = ctx.posts.get(part.toolCallId);
    return found ? html`<civitai-chat-post-card .post=${found}></civitai-chat-post-card>` : undefined;
  },
};

// The viewer's edits and "Not now" last until a reload; nothing is saved without Save.
const edited = new Map<string, string>();
const declined = new Set<string>();

const instructions: ToolView = {
  activity: 'Writing new instructions…',
  render(part, ctx) {
    const proposed = proposedInstructions(part.input);
    if (!proposed || part.state !== 'done') return undefined;
    const text = edited.get(part.toolCallId) ?? proposed;
    const rerender = () => (ctx.host as HTMLElement & { requestUpdate(): void }).requestUpdate();
    if (ctx.instructions?.trim() === text.trim()) {
      return html`<section class="cvt-instructions-card" aria-label="New instructions">
        <h3>New instructions for every chat</h3>
        <blockquote>${text}</blockquote>
        <p class="cvt-instructions-state">Saved. They apply from the next reply; change them any time in Settings.</p>
      </section>`;
    }
    if (declined.has(part.toolCallId)) {
      return html`<section class="cvt-instructions-card" aria-label="New instructions">
        <h3>New instructions for every chat</h3>
        <blockquote>${text}</blockquote>
        <p class="cvt-instructions-state">Not saved.</p>
      </section>`;
    }
    return html`<section class="cvt-instructions-card" aria-label="New instructions">
      <h3>New instructions for every chat</h3>
      <textarea
        class="cvt-instructions-text"
        aria-label="New instructions"
        maxlength=${CUSTOM_INSTRUCTIONS_MAX}
        rows="5"
        .value=${text}
        @input=${(event: Event) => edited.set(part.toolCallId, (event.currentTarget as HTMLTextAreaElement).value)}
        @change=${rerender}
      ></textarea>
      <div class="cvt-instructions-actions">
        <civitai-button size="sm" @click=${() => {
          const value = (edited.get(part.toolCallId) ?? proposed).trim();
          if (value) emit(ctx.host, 'cvt-settings-change', { customInstructions: value });
        }}>Save</civitai-button>
        <civitai-button
          size="sm"
          variant="subtle"
          @click=${() => {
            declined.add(part.toolCallId);
            rerender();
          }}
          >Not now</civitai-button
        >
      </div>
    </section>`;
  },
};

const choice: ToolView = {
  render(part, ctx) {
    // The same reading the tool reported on, so a choice it called shown is one that renders.
    const choice = normalizeChoice(part.input);
    if (!choice) return nothing;
    return html`<civitai-chat-choice-card .question=${choice.question} .options=${choice.options} .resolve=${ctx.resolve} ?disabled=${!ctx.latest || ctx.live}></civitai-chat-choice-card>`;
  },
};

const SUBAGENT_STATUS: Record<SubagentStatus | 'calling' | 'refused', string> = {
  calling: 'Working…',
  done: 'Done',
  ran_out: 'Hit its limit',
  stopped: 'Stopped',
  error: 'Failed',
  interrupted: 'Interrupted',
  unreceived: 'Result not received',
  refused: 'Not started',
};

const plural = (n: number, one: string) => `${n.toLocaleString()} ${one}${n === 1 ? '' : 's'}`;

/** A `dispatch_agent` call that is the chat's own: running and tracked, or with an output it marked. */
function isOwnSubagent(part: ToolPart, ctx: ToolViewContext): boolean {
  return part.state === 'calling' ? ctx.subagents?.get(part.toolCallId) !== undefined : isSubagentOutput(part.output);
}

/**
 * A subagent's card: its task, steps and tool calls, and how it went (a write subagent also says it edits,
 * and how many files it changed and commands it ran); opened, its summary, what it changed and what it
 * looked at. While it runs it reads its progress from the session; after, only from the saved result,
 * so it shows the same after a reload.
 */
function renderSubagent(part: ToolPart, ctx: ToolViewContext): TemplateResult | undefined {
  // A page tool of the same name (offered while subagents are off) shows as any other call.
  if (!isOwnSubagent(part, ctx)) return undefined;
  const task = String((part.input as { task?: unknown } | undefined)?.task ?? '').trim();
  const firstLine = task.split('\n').find((line) => line.trim() !== '')?.trim() ?? 'Research';
  const result = part.state === 'done' ? subagentResultOf(part.output) : undefined;
  const live = part.state === 'calling' ? ctx.subagents?.get(part.toolCallId) : undefined;
  const refusal = part.state === 'done' && !result ? String((part.output as { error?: unknown } | undefined)?.error ?? '') : '';
  const status: keyof typeof SUBAGENT_STATUS = result ? result.status : part.state === 'calling' ? 'calling' : 'refused';
  const steps = result?.steps ?? live?.steps ?? 0;
  const calls = result?.toolCalls ?? live?.toolCalls ?? 0;
  const key = `subagent:${part.toolCallId}`;
  const rows = ctx.rows;
  const open = rows?.isOpen(key) ?? false;
  const body = `cvt-subagent-${part.toolCallId.replace(/[^A-Za-z0-9_-]/g, '')}`;
  const problem = result?.error ?? (part.state === 'error' ? part.error : refusal) ?? '';
  const writes = result ? result.mode === 'write' : live?.mode === 'write';
  const changed = result?.changed ?? [];
  // An `unreceived` result has no paths, only how many there were when last seen.
  const files = result ? (result.changedCount ?? new Set(changed.map((change) => change.path)).size) : (live?.changed ?? 0);
  const commands = (result ? result.ranCommands : live?.ranCommands) ?? 0;
  return html`<div class="cvt-subagent" data-status=${status} data-call=${part.toolCallId}>
    <button type="button" class="cvt-subagent-head" aria-expanded=${open ? 'true' : 'false'} aria-controls=${body} @click=${() => rows?.toggle(key)}>
      <span class="cvt-call-chevron" aria-hidden="true"></span>
      <span class="cvt-subagent-title">
        <span class="cvt-subagent-kind">${writes ? 'Subagent · edits' : 'Subagent'}</span>
        <span class="cvt-subagent-task">${firstLine}</span>
      </span>
      <span class="cvt-subagent-meta">
        <span class="cvt-subagent-counts" data-subagent="counts">${plural(steps, 'step')} · ${plural(calls, 'tool call')}</span>
        ${writes ? html`<span class="cvt-subagent-counts" data-subagent="edits">${plural(files, 'file')} changed · ${plural(commands, 'command')}</span>` : nothing}
        <span class="cvt-subagent-status" data-subagent="status">${SUBAGENT_STATUS[status]}</span>
      </span>
    </button>
    <div class="cvt-call-body" id=${body} ?inert=${!open} data-open=${open ? 'true' : 'false'}>
      <div class="cvt-call-inner">
        ${rows?.wasOpened(key)
          ? html`<div class="cvt-subagent-body">
              ${task ? html`<div class="cvt-call-label">Task</div><p class="cvt-subagent-text">${task}</p>` : nothing}
              ${live?.lastTool ? html`<div class="cvt-call-label">Now using</div><p class="cvt-subagent-text">${live.lastTool}</p>` : nothing}
              ${problem ? html`<div class="cvt-call-label">Why it stopped</div><p class="cvt-subagent-text" data-subagent="error">${problem}</p>` : nothing}
              ${result?.summary ? html`<div class="cvt-call-label">What it found</div><p class="cvt-subagent-text" data-subagent="summary">${result.summary}</p>` : nothing}
              ${changed.length
                ? html`<div class="cvt-call-label">What it changed</div>
                    <ol class="cvt-subagent-activity" data-subagent="changed">
                      ${changed.map((entry) => html`<li><span class="cvt-call-name">${entry.op}</span> <span class="cvt-subagent-arg">${entry.path}</span></li>`)}
                    </ol>`
                : nothing}
              ${result?.activity.length
                ? html`<div class="cvt-call-label">What it looked at</div>
                    <ol class="cvt-subagent-activity">
                      ${result.activity.map((entry) => html`<li><span class="cvt-call-name">${entry.tool}</span>${entry.arg ? html` <span class="cvt-subagent-arg">${entry.arg}</span>` : nothing}</li>`)}
                    </ol>`
                : nothing}
            </div>`
          : nothing}
      </div>
    </div>
  </div>`;
}

export const BUILT_IN_VIEWS: Record<string, ToolView> = {
  [DISPATCH_AGENT]: { render: renderSubagent, ownsFailure: isOwnSubagent },
  ...Object.fromEntries([...JOB_TOOLS].map((name) => [name, job])),
  [OPEN_PANEL]: { activity: 'Setting up the controls…', render: renderPanel },
  [UPDATE_PANEL]: { activity: 'Changing the controls…', render: renderPanel },
  [UPDATE_INSTRUCTIONS]: instructions,
  [CLOSE_PANEL]: { activity: 'Closing…', render: () => nothing },
  [POST_TOOL]: post,
  [ASK_CHOICE]: choice,
  find_services: { activity: 'Checking what fits best…' },
  get_input_schema: { activity: 'Getting ready…' },
  get_guide: { activity: 'Planning it out…' },
  search_models: { activity: 'Searching Civitai…' },
  get_model: { activity: 'Reading about that model…' },
  get_model_version: { activity: 'Reading about that model…' },
  search_images: { activity: 'Looking at examples…' },
  caption_media: { activity: 'Looking at your file…' },
  transcribe_audio: { activity: 'Listening…' },
};

/** The page's views come first; a view without `render` keeps the built-in card and only renames the activity. */
export function viewFor(name: string, pageViews: Record<string, ChatToolView>): ToolView | undefined {
  const builtIn = BUILT_IN_VIEWS[name];
  const page = pageViews[name];
  if (!page) return builtIn;
  const render = page.render;
  return {
    activity: page.activity ?? builtIn?.activity,
    render: render ? (part) => render(callOf(part)) : builtIn?.render,
    ...(!render && builtIn?.ownsFailure ? { ownsFailure: builtIn.ownsFailure } : {}),
  };
}

function callOf(part: ToolPart): ChatToolCall {
  return { name: part.toolName, input: part.input, state: part.state, output: part.output, error: part.error };
}

function recommended(part: ToolPart): ModelRecommendation[] | undefined {
  const found = (part.output as { models?: ModelRecommendation[] } | undefined)?.models;
  return found?.length ? found : undefined;
}

/** A tool without a view of its own that answered with model recommendations shows them as cards. */
export function modelCards(part: ToolPart, models: ModelDirectory): TemplateResult | undefined {
  const found = recommended(part);
  if (!found) return undefined;
  return html`<div class="cvt-models">
    ${found.slice(0, 8).map(
      (model) =>
        html`${until(
          models.get(model.id).then(
            (details) =>
              html`<civitai-chat-model-card .name=${model.name} .creator=${details.creator ?? ''} .image=${details.image ?? ''} .href=${details.href} .kind=${details.kind ?? ''}></civitai-chat-model-card>`,
          ),
          html`<civitai-chat-model-card .name=${model.name}></civitai-chat-model-card>`,
        )}`,
    )}
  </div>`;
}
