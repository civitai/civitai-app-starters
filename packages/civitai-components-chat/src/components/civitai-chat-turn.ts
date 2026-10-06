import { html, nothing, type PropertyDeclarations, type TemplateResult } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';

import type { TurnPart } from '../agent/parts.js';
import type { JobManager } from '../orchestration/jobs.js';
import type { PanelManager } from '../panels/panel.js';
import type { PostManager } from '../posting/post.js';
import { CUT_OFF } from '../store/thread-store.js';
import type { ModelDirectory } from '../store/models.js';
import type { ChatToolView } from '../tools/host.js';
import type { Attachment, Turn } from '../types.js';
import { renderMarkdown } from '../ux/markdown.js';
import type { StripItem } from './lib/civitai-chat-attachment-strip.js';
import { LightElement, emit } from './light.js';
import { modelCards, viewFor, type ToolPart, type ToolViewContext } from './tool-views.js';

function failureOf(part: ToolPart): string | undefined {
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
    views: { attribute: false },
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
  /** The embedding page's views, by tool name. */
  declare views: Record<string, ChatToolView>;

  constructor() {
    super();
    this.parts = [];
    this.live = false;
    this.latest = false;
    this.files = () => [];
    this.views = {};
  }

  #userFiles(): StripItem[] {
    const uploads = this.turn.user.attachments.map((a) => ({ key: a.id, kind: a.kind, src: a.url, label: a.name, blocked: a.blocked }));
    const refs = (this.turn.user.refs ?? []).flatMap((id) => {
      const a = this.resolve(id);
      return a ? [{ key: a.id, kind: a.kind, src: a.url, blocked: a.blocked }] : [];
    });
    return [...uploads, ...refs];
  }

  #tool(part: ToolPart): unknown {
    const view = viewFor(part.toolName, this.views);
    const failure = failureOf(part);
    if (failure) {
      const what = (view?.activity ?? 'A step').replace(/…$/, '');
      return html`<details class="cvt-step-failed"><summary>${what} didn't work</summary><code>${failure}</code></details>`;
    }
    const rendered = view?.render?.(part, this.#context());
    if (rendered !== undefined) return rendered;
    return modelCards(part, this.models) ?? (part.state === 'calling' ? html`<div class="cvt-activity">${view?.activity ?? 'Working on it…'}</div>` : nothing);
  }

  #context(): ToolViewContext {
    return {
      host: this,
      jobs: this.jobs,
      posts: this.posts,
      panels: this.panels,
      files: this.files,
      canShare: this.canShare,
      dockPanels: this.dockPanels,
      latest: this.latest,
      live: this.live,
      models: this.models,
      resolve: this.resolve,
    };
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
    if (status === 'error' && this.turn.assistant.errorKind === 'free_tier_exhausted') {
      return html`<civitai-alert color="info">
        ${error} You can keep going on Buzz (about 1 per reply).
        ${this.latest ? html`<civitai-button size="sm" variant="light" @click=${() => emit(this, 'cvt-continue-paid')}>Continue with Buzz</civitai-button>` : nothing}
      </civitai-alert>`;
    }
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
