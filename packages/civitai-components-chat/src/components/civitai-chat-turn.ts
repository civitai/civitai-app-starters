import { html, nothing, type PropertyDeclarations, type TemplateResult } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { until } from 'lit/directives/until.js';

import type { TurnPart } from '../agent/parts.js';
import type { JobManager } from '../orchestration/jobs.js';
import type { PanelManager } from '../panels/panel.js';
import { isPanelTool } from '../panels/tools.js';
import { POST_TOOL, type PostManager } from '../posting/post.js';
import { CUT_OFF } from '../store/thread-store.js';
import type { ModelDirectory } from '../store/models.js';
import { ASK_CHOICE } from '../tools/build.js';
import { isJobTool } from '../tools/catalog.js';
import type { Attachment, ChoiceOption, ModelRecommendation, Turn } from '../types.js';
import { renderMarkdown } from '../ux/markdown.js';
import type { StripItem } from './lib/civitai-chat-attachment-strip.js';
import { LightElement, emit } from './light.js';
import { mediaActions } from './media-actions.js';

const ACTIVITY: Record<string, string> = {
  find_services: 'Checking what fits best…',
  get_input_schema: 'Getting ready…',
  get_guide: 'Planning it out…',
  search_models: 'Searching Civitai…',
  get_model: 'Reading about that model…',
  get_model_version: 'Reading about that model…',
  search_images: 'Looking at examples…',
  caption_media: 'Looking at your file…',
  transcribe_audio: 'Listening…',
};

/** What a failed step said: a thrown error, or a tool that answered `{ error }`. */
function failureOf(part: Extract<TurnPart, { kind: 'tool' }>): string | undefined {
  if (part.state === 'error') return part.error || 'It failed.';
  const error = (part.output as { error?: unknown } | undefined)?.error;
  return part.state === 'done' && error ? String(error).slice(0, 600) : undefined;
}


/** One exchange: what the user sent, and everything the assistant said and made in reply. */
export class CivitaiChatTurn extends LightElement {
  // The agent and store update turns in place, so the same object can carry new content.
  static override properties: PropertyDeclarations = {
    turn: { attribute: false, hasChanged: () => true },
    parts: { attribute: false, hasChanged: () => true },
    live: { type: Boolean },
    latest: { type: Boolean },
    jobs: { attribute: false },
    posts: { attribute: false },
    panels: { attribute: false },
    files: { attribute: false },
    canShare: { type: Boolean, attribute: 'can-share' },
    dockPanels: { type: Boolean, attribute: 'dock-panels' },
    models: { attribute: false },
    resolve: { attribute: false },
    activity: { attribute: false },
  };

  declare turn: Turn;
  declare parts: TurnPart[];
  declare live: boolean;
  /** Only the newest turn's choices can still be picked. */
  declare latest: boolean;
  declare jobs: JobManager;
  declare posts: PostManager;
  declare panels?: PanelManager;
  declare files: () => Attachment[];
  declare canShare: boolean;
  /** Panels show in the page beside the chat; the thread only points at them. */
  declare dockPanels: boolean;
  declare models: ModelDirectory;
  declare resolve: (id: string) => Attachment | undefined;
  /** What a tool the embedding page added is doing, in its words. */
  declare activity?: (toolName: string) => string | undefined;

  constructor() {
    super();
    this.parts = [];
    this.live = false;
    this.latest = false;
    this.files = () => [];
  }

  #userFiles(): StripItem[] {
    const uploads = this.turn.user.attachments.map((a) => ({ key: a.id, kind: a.kind, src: a.url, label: a.name, blocked: a.blocked }));
    const refs = (this.turn.user.refs ?? []).flatMap((id) => {
      const a = this.resolve(id);
      return a ? [{ key: a.id, kind: a.kind, src: a.url, blocked: a.blocked }] : [];
    });
    return [...uploads, ...refs];
  }

  #tool(part: Extract<TurnPart, { kind: 'tool' }>): TemplateResult | typeof nothing {
    const failure = failureOf(part);
    if (failure) {
      const what = isPanelTool(part.toolName) ? 'Changing the controls' : (ACTIVITY[part.toolName] ?? this.activity?.(part.toolName) ?? 'A step').replace(/…$/, '');
      return html`<details class="cvt-step-failed"><summary>${what} didn't work</summary><code>${failure}</code></details>`;
    }
    if (isJobTool(part.toolName)) {
      const output = part.output as { job?: string } | undefined;
      const job = this.jobs.byToolCall(part.toolCallId) ?? (output?.job ? this.jobs.get(output.job) : undefined);
      if (job) return html`<civitai-chat-generation-card .job=${job} .actions=${mediaActions(this.posts)}></civitai-chat-generation-card>`;
      return part.state === 'calling' ? html`<div class="cvt-activity">Getting ready…</div>` : nothing;
    }
    if (isPanelTool(part.toolName)) {
      const handle = (part.output as { panel?: unknown } | undefined)?.panel;
      const panel = typeof handle === 'string' ? this.panels?.get(handle) : undefined;
      if (panel && this.dockPanels) {
        return html`<button type="button" class="cvt-panel-chip" @click=${() => emit(this, 'panel-focus', { panel })}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h10M4 12h16M4 18h7M17 4v4M10 10v4M14 16v4" /></svg>
          ${part.toolName === 'open_panel' ? 'Set up' : 'Changed'} “${panel.spec.title}”
        </button>`;
      }
      // A panel shows once, at the assistant's latest change to it.
      if (panel?.toolCallId === part.toolCallId) {
        return html`<civitai-chat-panel .panel=${panel} .files=${this.files} ?can-share=${this.canShare} .actions=${mediaActions(this.posts)}></civitai-chat-panel>`;
      }
      if (panel) return html`<div class="cvt-note">${part.toolName === 'open_panel' ? 'Set up' : 'Changed'} “${panel.spec.title}”; it is further down.</div>`;
      return part.state === 'calling' ? html`<div class="cvt-activity">Setting up the controls…</div>` : nothing;
    }
    if (part.toolName === POST_TOOL) {
      const post = this.posts.get(part.toolCallId);
      if (post) return html`<civitai-chat-post-card .post=${post}></civitai-chat-post-card>`;
      return part.state === 'calling' ? html`<div class="cvt-activity">Getting your post ready…</div>` : nothing;
    }
    if (part.toolName === ASK_CHOICE) {
      const input = part.input as { question?: string; options?: ChoiceOption[] } | undefined;
      if (!input?.options?.length) return nothing;
      return html`<civitai-chat-choice-card .question=${input.question ?? ''} .options=${input.options} .resolve=${this.resolve} ?disabled=${!this.latest || this.live}></civitai-chat-choice-card>`;
    }
    const models = (part.output as { models?: ModelRecommendation[] } | undefined)?.models;
    if (models?.length) {
      return html`<div class="cvt-models">
        ${models.slice(0, 8).map(
          (model) =>
            html`${until(
              this.models.get(model.id).then(
                (details) =>
                  html`<civitai-chat-model-card .name=${model.name} .creator=${details.creator ?? ''} .image=${details.image ?? ''} .href=${details.href} .kind=${details.kind ?? ''}></civitai-chat-model-card>`,
              ),
              html`<civitai-chat-model-card .name=${model.name}></civitai-chat-model-card>`,
            )}`,
        )}
      </div>`;
    }
    return part.state === 'calling' ? html`<div class="cvt-activity">${ACTIVITY[part.toolName] ?? this.activity?.(part.toolName) ?? 'Working on it…'}</div>` : nothing;
  }

  // Between steps the finished tool shows nothing and the next reply has not started streaming.
  #waiting(): boolean {
    const last = this.parts.at(-1);
    return !last || (last.kind === 'tool' && last.state !== 'calling');
  }

  #footer(): TemplateResult | typeof nothing {
    const { status, error, errorDetail } = this.turn.assistant;
    if (this.live) return this.#waiting() ? html`<div class="cvt-typing" aria-label="Assistant is replying"><span></span><span></span><span></span></div>` : nothing;
    if (status === 'aborted') return html`<div class="cvt-note">Stopped.</div>`;
    if (status === 'error' && error === CUT_OFF) return html`<div class="cvt-note">This reply was cut off. Ask again?</div>`;
    if (status === 'error') {
      return html`<civitai-alert color="error">
        ${error ?? 'Something went wrong.'}
        ${errorDetail && errorDetail !== error
          ? html`<details class="cvt-error-details"><summary>Details</summary><code>${errorDetail}</code></details>`
          : nothing}
      </civitai-alert>`;
    }
    return nothing;
  }

  override render(): TemplateResult {
    const files = this.#userFiles();
    return html`<div class="cvt-user">
        ${files.length ? html`<civitai-chat-attachment-strip size="sm" .items=${files}></civitai-chat-attachment-strip>` : nothing}
        ${this.turn.user.content ? html`<div class="cvt-bubble">${this.turn.user.content}</div>` : nothing}
      </div>
      <div class="cvt-assistant">
        ${this.parts.map((part) => (part.kind === 'text' ? html`<div class="cvt-md">${unsafeHTML(renderMarkdown(part.text))}</div>` : this.#tool(part)))}
        ${this.#footer()}
      </div>`;
  }
}
