import { html, nothing, type TemplateResult } from 'lit';
import { until } from 'lit/directives/until.js';

import type { TurnPart } from '../agent/parts.js';
import type { JobManager } from '../orchestration/jobs.js';
import type { PanelManager } from '../panels/panel.js';
import { OPEN_PANEL, UPDATE_PANEL } from '../panels/tools.js';
import { POST_TOOL, type PostManager } from '../posting/post.js';
import type { ModelDirectory } from '../store/models.js';
import { ASK_CHOICE } from '../tools/build.js';
import { JOB_TOOLS } from '../tools/catalog.js';
import type { ChatToolCall, ChatToolView } from '../tools/host.js';
import type { Attachment, ChoiceOption, ModelRecommendation } from '../types.js';
import { emit } from './light.js';
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
}

/** `render` returning `undefined` leaves the call to the default: its activity while it runs, nothing after. */
export interface ToolView {
  activity?: string;
  render?(part: ToolPart, ctx: ToolViewContext): unknown;
}

const job: ToolView = {
  activity: 'Getting ready…',
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

const choice: ToolView = {
  render(part, ctx) {
    const input = part.input as { question?: string; options?: ChoiceOption[] } | undefined;
    if (!input?.options?.length) return nothing;
    return html`<civitai-chat-choice-card .question=${input.question ?? ''} .options=${input.options} .resolve=${ctx.resolve} ?disabled=${!ctx.latest || ctx.live}></civitai-chat-choice-card>`;
  },
};

export const BUILT_IN_VIEWS: Record<string, ToolView> = {
  ...Object.fromEntries([...JOB_TOOLS].map((name) => [name, job])),
  [OPEN_PANEL]: { activity: 'Setting up the controls…', render: renderPanel },
  [UPDATE_PANEL]: { activity: 'Changing the controls…', render: renderPanel },
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
  };
}

function callOf(part: ToolPart): ChatToolCall {
  return { name: part.toolName, input: part.input, state: part.state, output: part.output, error: part.error };
}

/** A tool without a view of its own that answered with model recommendations shows them as cards. */
export function modelCards(part: ToolPart, models: ModelDirectory): TemplateResult | undefined {
  const found = (part.output as { models?: ModelRecommendation[] } | undefined)?.models;
  if (!found?.length) return undefined;
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
