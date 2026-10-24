import type { ModelMessage } from 'ai';
import { html, nothing, type PropertyDeclarations, type PropertyValues, type TemplateResult } from 'lit';
import { repeat } from 'lit/directives/repeat.js';

import type { LiveTurn } from '../agent/agent.js';
import type { SubagentTracker } from '../agent/subagents.js';
import { partsFromMessages, type TurnPart } from '../agent/parts.js';
import type { JobManager } from '../orchestration/jobs.js';
import type { PanelManager } from '../panels/panel.js';
import type { PostManager } from '../posting/post.js';
import type { ModelDirectory } from '../store/models.js';
import type { ChatToolView } from '../tools/host.js';
import type { Attachment, Turn } from '../types.js';
import { LightElement, emit } from './light.js';
import type { ToolCallsMode } from './tool-calls.js';

const NEAR_BOTTOM_PX = 48;
/** How long a new live region is on the page, empty, before its first words go in. */
const ANNOUNCE_AFTER_MS = 100;

/** A message the viewer sent that waits to go, as the thread shows it after the turns. */
export interface QueuedView {
  text: string;
  /** What it waits for, e.g. "Waiting for your app…". */
  status: string;
  files: Attachment[];
}

export class CivitaiChatThread extends LightElement {
  // The agent and store update turns in place, so the same object can carry new content.
  static override properties: PropertyDeclarations = {
    turns: { attribute: false, hasChanged: () => true },
    live: { attribute: false, hasChanged: () => true },
    jobs: { attribute: false },
    posts: { attribute: false },
    panels: { attribute: false },
    files: { attribute: false },
    canShare: { type: Boolean, attribute: 'can-share' },
    instructions: { attribute: false },
    dockPanels: { type: Boolean, attribute: 'dock-panels' },
    models: { attribute: false },
    resolve: { attribute: false },
    views: { attribute: false },
    toolCalls: { attribute: 'tool-calls' },
    mcpServerIds: { attribute: false },
    subagents: { attribute: false },
    canRetry: { type: Boolean, attribute: 'can-retry' },
    awaitingApproval: { type: Boolean, attribute: 'awaiting-approval' },
    queued: { attribute: false },
    atBottom: { state: true },
    announcement: { state: true },
  };

  declare turns: Turn[];
  declare live: LiveTurn | null;
  declare jobs: JobManager;
  declare posts: PostManager;
  declare panels: PanelManager;
  declare files: () => Attachment[];
  declare canShare: boolean;
  /** The viewer's custom instructions, for the cards that propose new ones. */
  declare instructions: string | undefined;
  /** Panels show in the page beside the chat; the thread only points at them. */
  declare dockPanels: boolean;
  declare models: ModelDirectory;
  declare resolve: (id: string) => Attachment | undefined;
  declare views: Record<string, ChatToolView>;
  declare toolCalls: ToolCallsMode;
  /** The added MCP servers' ids, so a call row can show which one a tool is from. */
  declare mcpServerIds: ReadonlySet<string>;
  /** The subagents running now, for their cards' live progress. */
  declare subagents?: SubagentTracker;
  /** Whether the chat can send now, so the latest reply's Retry is on. */
  declare canRetry: boolean;
  /** The live reply waits for the viewer to approve a call: its status line says so. */
  declare awaitingApproval: boolean;
  declare queued: QueuedView | null;
  declare atBottom: boolean;
  declare announcement: string;

  #parts = new WeakMap<ModelMessage[], TurnPart[]>();
  #scroller?: HTMLElement;
  // Media sizes itself as it loads, long after the first scroll; following it keeps the end in view.
  #resize = new ResizeObserver(() => {
    if (this.atBottom) this.#jumpToEnd();
  });
  #gliding = false;
  #end?: HTMLSlotElement;
  #wasLive = false;
  #queuedStatus?: string;

  constructor() {
    super();
    this.views = {};
    this.toolCalls = 'activity';
    this.mcpServerIds = new Set();
    this.canRetry = false;
    this.awaitingApproval = false;
    this.queued = null;
    this.turns = [];
    this.live = null;
    this.atBottom = true;
    this.announcement = '';
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#resize.disconnect();
  }

  scrollToEnd(): void {
    const el = this.#scroller;
    if (!el) return;
    this.atBottom = true;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.#jumpToEnd();
      return;
    }
    this.#gliding = true;
    const landed = () => (this.#gliding = false);
    el.addEventListener('scrollend', landed, { once: true });
    setTimeout(landed, 1000);
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }

  #jumpToEnd(): void {
    const el = this.#scroller;
    if (el) el.scrollTop = el.scrollHeight;
  }

  // A smooth scroll passes through positions short of the end; only the reader leaving it unpins.
  #onScroll = (): void => {
    const el = this.#scroller;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    if (near || !this.#gliding) this.atBottom = near;
  };

  // Setting state here rather than in updated() folds it into this update instead of scheduling another.
  protected override willUpdate(changed: PropertyValues): void {
    if (changed.has('live')) this.#announce();
    // A message that starts waiting, and each change of what it waits for, is said once (the polite
    // announcer). A thread just made for it (an empty chat's first message) puts its live region on the
    // page first, empty, and the words a moment later: text present as the region appears is not read.
    const status = this.queued?.status;
    if (status !== undefined && status !== this.#queuedStatus) {
      if (this.hasUpdated) this.announcement = status;
      else setTimeout(() => this.queued?.status === status && (this.announcement = status), ANNOUNCE_AFTER_MS);
    }
    this.#queuedStatus = status;
  }

  protected override updated(changed: PropertyValues): void {
    // A message that starts waiting is the newest thing in the chat: it is brought into view.
    if (changed.has('queued') && this.queued && !changed.get('queued')) this.#jumpToEnd();
    const scroller = this.querySelector<HTMLElement>('.cvt-thread-scroll');
    if (scroller && scroller !== this.#scroller) {
      this.#scroller = scroller;
      const list = scroller.querySelector('.cvt-thread-list');
      if (list) this.#resize.observe(list);
      this.#jumpToEnd();
    }
    // The page's content after the last message grows like a message does: followed while at the end.
    const end = this.querySelector<HTMLSlotElement>('slot[name="thread-end"]');
    if (end && end !== this.#end) {
      this.#end = end;
      this.#resize.observe(end);
    }
  }

  // Content the page puts after the last message is the newest thing in the chat: it is brought into view.
  #onEndChange = (event: Event): void => {
    const slot = event.target as HTMLSlotElement;
    if (slot.assignedElements({ flatten: true }).length) void this.updateComplete.then(() => this.scrollToEnd());
  };

  // Screen readers hear a reply start and the finished text once, never token by token.
  #announce(): void {
    const live = this.live !== null;
    if (live && !this.#wasLive) this.announcement = 'Assistant is replying…';
    if (!live && this.#wasLive) {
      const last = this.turns.at(-1);
      const text = last ? this.#partsOf(last).filter((p) => p.kind === 'text').map((p) => (p as { text: string }).text).join(' ') : '';
      this.announcement = text.slice(0, 500);
    }
    this.#wasLive = live;
  }

  #partsOf(turn: Turn): TurnPart[] {
    if (this.live?.seq === turn.seq) return this.live.parts;
    let parts = this.#parts.get(turn.assistant.messages);
    if (!parts) {
      parts = partsFromMessages(turn.assistant.messages);
      this.#parts.set(turn.assistant.messages, parts);
    }
    return parts;
  }

  #queuedMessage(): TemplateResult | typeof nothing {
    const queued = this.queued;
    if (!queued) return nothing;
    const files = queued.files.map((a) => ({ key: a.id, kind: a.kind, src: a.url, label: a.name, blocked: a.blocked }));
    return html`<div class="cvt-user cvt-queued">
      ${files.length ? html`<civitai-chat-attachment-strip size="sm" .items=${files}></civitai-chat-attachment-strip>` : nothing}
      ${queued.text ? html`<div class="cvt-bubble">${queued.text}</div>` : nothing}
      <div class="cvt-queued-status">
        <span>${queued.status}</span>
        <civitai-button size="sm" variant="subtle" @click=${() => emit(this, 'cvt-queued-edit')}>Edit</civitai-button>
      </div>
    </div>`;
  }

  override render(): TemplateResult {
    const last = this.turns.at(-1)?.seq;
    return html`<div class="cvt-thread-scroll" @scroll=${this.#onScroll}>
        <div class="cvt-thread-list" role="log" aria-live="off" aria-label="Conversation">
          ${repeat(
            this.turns,
            (turn) => turn.seq,
            (turn) =>
              html`<civitai-chat-turn
                .turn=${turn}
                .parts=${this.#partsOf(turn)}
                ?live=${this.live?.seq === turn.seq}
                .liveTurn=${this.live?.seq === turn.seq ? this.live : null}
                ?awaiting-approval=${this.live?.seq === turn.seq && this.awaitingApproval}
                ?latest=${turn.seq === last}
                ?can-retry=${turn.seq === last && this.canRetry}
                .jobs=${this.jobs}
                .posts=${this.posts}
                .panels=${this.panels}
                .files=${this.files}
                ?can-share=${this.canShare}
                .instructions=${this.instructions}
                ?dock-panels=${this.dockPanels}
                .models=${this.models}
                .resolve=${this.resolve}
                .views=${this.views}
                .toolCalls=${this.toolCalls}
                .mcpServerIds=${this.mcpServerIds}
                .subagents=${this.subagents}
              ></civitai-chat-turn>`,
          )}
          ${this.#queuedMessage()}
        </div>
        <slot name="thread-end" class="cvt-thread-end" @slotchange=${this.#onEndChange}></slot>
      </div>
      ${this.atBottom
        ? nothing
        : html`<civitai-button class="cvt-jump" size="sm" variant="light" @click=${() => this.scrollToEnd()}>Jump to latest</civitai-button>`}
      <div class="cvt-visually-hidden" aria-live="polite">${this.announcement}</div>`;
  }
}
