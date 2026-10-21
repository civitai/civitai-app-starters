import { html, nothing, type PropertyDeclarations, type PropertyValues, type TemplateResult } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';

import { describeTrace } from '../agent/error-trace.js';
import type { TurnPart } from '../agent/parts.js';
import type { SubagentTracker } from '../agent/subagents.js';
import { groupToolCalls } from '../agent/tool-groups.js';
import type { JobManager } from '../orchestration/jobs.js';
import type { PanelManager } from '../panels/panel.js';
import type { PostManager } from '../posting/post.js';
import { CUT_OFF, liveRedrawIn, replyElsewhere } from '../store/thread-store.js';
import type { ModelDirectory } from '../store/models.js';
import type { ChatToolView } from '../tools/host.js';
import type { Attachment, Turn } from '../types.js';
import { RETRYABLE_ERRORS } from '../ux/humanize.js';
import { renderMarkdown } from '../ux/markdown.js';
import type { StripItem } from './lib/civitai-chat-attachment-strip.js';
import { LightElement, emit } from './light.js';
import { renderCall, renderCallGroup, type CallRowState, type ToolCallsMode } from './tool-calls.js';
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
    canRetry: { type: Boolean, attribute: 'can-retry' },
    jobs: { attribute: false },
    posts: { attribute: false },
    panels: { attribute: false },
    files: { attribute: false },
    canShare: { type: Boolean, attribute: 'can-share' },
    dockPanels: { type: Boolean, attribute: 'dock-panels' },
    models: { attribute: false },
    resolve: { attribute: false },
    views: { attribute: false },
    toolCalls: { attribute: 'tool-calls' },
    mcpServerIds: { attribute: false },
    subagents: { attribute: false },
  };

  declare turn: Turn;
  declare parts: TurnPart[];
  declare live: boolean;
  /** Only the newest turn's choices can still be picked. */
  declare latest: boolean;
  /** The chat can send now: Retry is on. While it holds, Retry shows but is off, and the hold's words say why. */
  declare canRetry: boolean;
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
  /** `details`: calls with no view of their own show as rows to open, and calls in a row as one group. */
  declare toolCalls: ToolCallsMode;
  /** The added MCP servers' ids: a call row shows the server of one of their tools. */
  declare mcpServerIds: ReadonlySet<string>;
  /** The subagents running now, for their cards' live progress. */
  declare subagents?: SubagentTracker;

  /** Call rows and groups the viewer opened, by key; kept while the turn is on the page. */
  #open = new Set<string>();
  #opened = new Set<string>();
  #rows: CallRowState = {
    isOpen: (key) => this.#open.has(key),
    wasOpened: (key) => this.#opened.has(key),
    toggle: (key) => {
      if (!this.#open.delete(key)) {
        this.#open.add(key);
        this.#opened.add(key);
      }
      this.requestUpdate();
    },
    failure: (part) => failureOf(part),
    servers: () => this.mcpServerIds,
  };

  constructor() {
    super();
    this.parts = [];
    this.live = false;
    this.latest = false;
    this.canRetry = false;
    this.files = () => [];
    this.views = {};
    this.toolCalls = 'activity';
    this.mcpServerIds = new Set();
  }

  #userFiles(): StripItem[] {
    const uploads = this.turn.user.attachments.map((a) => ({ key: a.id, kind: a.kind, src: a.url, label: a.name, blocked: a.blocked }));
    const refs = (this.turn.user.refs ?? []).flatMap((id) => {
      const a = this.resolve(id);
      return a ? [{ key: a.id, kind: a.kind, src: a.url, blocked: a.blocked }] : [];
    });
    return [...uploads, ...refs];
  }

  /**
   * What a call shows of its own, or `undefined` when nothing would show it: the page's or the built-in
   * `render` (returning `undefined` keeps the default), else model cards. A failed call shows its
   * "didn't work" note instead; `failedNote` says whether it does so without a `render` (`activity`).
   */
  #own(part: ToolPart, failedNote: boolean): unknown {
    const view = viewFor(part.toolName, this.views);
    const failure = failureOf(part);
    if (failure && this.#recovered(part)) return failedNote ? nothing : undefined;
    if (failure && !view?.ownsFailure?.(part, this.#context())) {
      if (!failedNote && !view?.render) return undefined;
      const what = (view?.activity ?? 'A step').replace(/…$/, '');
      return html`<details class="cvt-step-failed"><summary>${what} didn't work</summary><code>${failure}</code></details>`;
    }
    const rendered = view?.render?.(part, this.#context());
    return rendered !== undefined ? rendered : modelCards(part, this.models);
  }

  /** The assistant fixed the call itself: the same tool worked later in the reply, so the viewer has nothing to act on. */
  #recovered(part: ToolPart): boolean {
    const later = this.parts.slice(this.parts.indexOf(part) + 1);
    return later.some((next) => next.kind === 'tool' && next.toolName === part.toolName && next.state === 'done' && !failureOf(next));
  }

  #tool(part: ToolPart): unknown {
    const own = this.#own(part, true);
    if (own !== undefined) return own;
    return part.state === 'calling' ? html`<div class="cvt-activity">${viewFor(part.toolName, this.views)?.activity ?? 'Working on it…'}</div>` : nothing;
  }

  /**
   * With `details`, a call shows as a row when it shows nothing of its own (`#own` is `undefined`).
   * Each call is rendered once, and that one result both decides the grouping and is what shows.
   */
  #detailed(md: (text: string) => unknown): unknown {
    const own = new Map<ToolPart, unknown>();
    for (const part of this.parts) if (part.kind === 'tool') own.set(part, this.#own(part, false));
    return groupToolCalls(this.parts, (part) => own.get(part) === undefined).map((segment) => {
      if (segment.kind === 'part') return segment.part.kind === 'text' ? md(segment.part.text) : own.get(segment.part);
      const first = segment.calls[0]!;
      if (segment.calls.length === 1) return renderCall(first, this.#rows);
      // A lone row the viewer opened, now the first of a group as the reply streams: the group opens with it.
      const group = `group:${first.toolCallId}`;
      if (!this.#opened.has(group) && this.#open.has(`call:${first.toolCallId}`)) {
        this.#open.add(group);
        this.#opened.add(group);
      }
      return renderCallGroup(segment.calls, this.#rows);
    });
  }

  #assistantParts(): unknown {
    // A reply can stream a text part that is only whitespace so far: no empty bubble for it.
    const md = (text: string) => (text.trim() === '' ? nothing : html`<div class="cvt-md">${unsafeHTML(renderMarkdown(text))}</div>`);
    if (this.toolCalls === 'details') return this.#detailed(md);
    return this.parts.map((part) => (part.kind === 'text' ? md(part.text) : this.#tool(part)));
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
      ...(this.subagents ? { subagents: this.subagents } : {}),
      rows: this.#rows,
    };
  }

  // Between steps the finished tool shows nothing and the next reply has not started streaming.
  #waiting(): boolean {
    const last = this.parts.at(-1);
    return !last || (last.kind === 'tool' && last.state !== 'calling');
  }

  /** Draws the turn again once a reply that may still be running elsewhere stops counting as live. */
  #liveTimer?: ReturnType<typeof setTimeout>;
  /** This turn was last drawn as still running elsewhere. */
  #shownLive = false;

  /**
   * A reply read back from a save made before it ended. While that save is recent (the latest turn
   * only) whoever made it may still be running it, so nothing is offered: asking again would pay for
   * it twice. After, it is gone: a v3 reply with finished steps it can carry on from offers Continue
   * (Retry's path, from those steps), and any other says it was cut off.
   */
  #cutOff(): TemplateResult {
    const state = this.latest ? replyElsewhere(this.turn) : undefined;
    if (state === 'live') return html`<div class="cvt-note cvt-elsewhere" role="status">Still replying in another tab or window…</div>`;
    if (state === 'stale' && this.turn.assistant.resume !== undefined && this.turn.assistant.errorKind === 'interrupted') {
      return html`<div class="cvt-note cvt-interrupted">
        This reply stopped before it finished.
        <civitai-button class="cvt-continue-saved" size="sm" variant="light" ?disabled=${!this.canRetry} @click=${() => emit(this, 'cvt-retry')}>Continue</civitai-button>
      </div>`;
    }
    return html`<div class="cvt-note">This reply was cut off. Ask again?</div>`;
  }

  protected override updated(changed: PropertyValues): void {
    super.updated(changed);
    clearTimeout(this.#liveTimer);
    const state = this.latest && !this.live ? replyElsewhere(this.turn) : undefined;
    // Drawn live before and gone now: the chat reads itself once more, as the reply may have ended or
    // saved a newer step meanwhile. Whichever comes first draws it again: the timer, or the chat on wake.
    if (this.#shownLive && state === 'stale') emit(this, 'cvt-recheck');
    this.#shownLive = state === 'live';
    const wait = this.#shownLive ? liveRedrawIn(this.turn) : undefined;
    if (wait !== undefined) {
      this.#liveTimer = setTimeout(() => {
        this.requestUpdate();
        // Live because a tab holds its lock: only reading the chat again tells whether it still does.
        if (this.turn.assistant.heldElsewhere) emit(this, 'cvt-recheck');
      }, wait);
    }
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    clearTimeout(this.#liveTimer);
  }

  #footer(): TemplateResult | typeof nothing {
    const { status, error, errorDetail, errorTrace } = this.turn.assistant;
    if (this.live) return this.#waiting() ? html`<div class="cvt-typing" aria-label="Assistant is replying"><span></span><span></span><span></span></div>` : nothing;
    if (status === 'aborted') return html`<div class="cvt-note">Stopped.</div>`;
    // A reply the page ended reads like one that ran out of steps, in the page's words.
    const { ranOut, stopped } = this.turn.assistant;
    if (status === 'done' && (ranOut || stopped !== undefined)) {
      return html`<div class="cvt-note cvt-ran-out">
        ${stopped ?? 'This took more steps than one reply allows.'}
        ${this.latest ? html`<civitai-button size="sm" variant="light" @click=${() => emit(this, 'cvt-continue')}>Continue</civitai-button>` : nothing}
      </div>`;
    }
    if (status === 'error' && error === CUT_OFF) return this.#cutOff();
    if (status === 'error' && this.turn.assistant.errorKind === 'free_tier_exhausted') {
      return html`<civitai-alert color="info">
        ${error} You can keep going on Buzz (about 1 per reply).
        ${this.latest ? html`<civitai-button size="sm" variant="light" @click=${() => emit(this, 'cvt-continue-paid')}>Continue with Buzz</civitai-button>` : nothing}
      </civitai-alert>`;
    }
    // Free only, and this model has no free replies (or they could not be checked). What a paid reply
    // costs depends on the model, so the offer names no price.
    if (status === 'error' && this.turn.assistant.errorKind === 'free_tier_not_free') {
      return html`<civitai-alert color="info">
        ${error}
        ${this.latest ? html`<civitai-button size="sm" variant="light" @click=${() => emit(this, 'cvt-continue-paid')}>Allow paid replies and try again</civitai-button>` : nothing}
      </civitai-alert>`;
    }
    if (status === 'error') {
      const shown = errorDetail && errorDetail !== error ? errorDetail : '';
      const where = errorTrace ? describeTrace(errorTrace) : '';
      // Only where asking again can carry on without running a tool twice (`resume`, this session only).
      const retry = this.latest && this.turn.assistant.resume !== undefined && RETRYABLE_ERRORS.has(this.turn.assistant.errorKind ?? '');
      return html`<civitai-alert color="error">
        ${error ?? 'Something went wrong.'}
        ${retry ? html`<civitai-button class="cvt-retry" size="sm" variant="light" ?disabled=${!this.canRetry} @click=${() => emit(this, 'cvt-retry')}>Retry</civitai-button>` : nothing}
        ${shown || where
          ? html`<details class="cvt-error-details"><summary>Details</summary>${shown ? html`<code>${shown}</code>` : nothing}${where ? html`<code class="cvt-error-trace">${where}</code>` : nothing}</details>`
          : nothing}
      </civitai-alert>`;
    }
    return nothing;
  }

  // A row that becomes part of a group as the reply streams is drawn anew inside it: a viewer on its
  // button stays on the same call's button rather than falling to the page.
  protected override update(changed: PropertyValues): void {
    const root = this.getRootNode() as Document | ShadowRoot;
    const focused = root.activeElement;
    const call = focused instanceof HTMLElement && this.contains(focused) && focused.classList.contains('cvt-call-head') ? focused.dataset.call : undefined;
    super.update(changed);
    if (call === undefined || focused!.isConnected) return;
    const again = [...this.querySelectorAll<HTMLElement>('.cvt-call-head')].find((head) => head.dataset.call === call);
    again?.focus();
  }

  override render(): TemplateResult {
    const files = this.#userFiles();
    return html`<div class="cvt-user">
        ${files.length ? html`<civitai-chat-attachment-strip size="sm" .items=${files}></civitai-chat-attachment-strip>` : nothing}
        ${this.turn.user.content ? html`<div class="cvt-bubble">${this.turn.user.content}</div>` : nothing}
      </div>
      <div class="cvt-assistant">
        ${this.#assistantParts()}
        ${this.#footer()}
      </div>`;
  }
}
