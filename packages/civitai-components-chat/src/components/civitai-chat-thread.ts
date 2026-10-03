import type { ModelMessage } from 'ai';
import { html, nothing, type PropertyDeclarations, type PropertyValues, type TemplateResult } from 'lit';
import { repeat } from 'lit/directives/repeat.js';

import type { LiveTurn } from '../agent/agent.js';
import { partsFromMessages, type TurnPart } from '../agent/parts.js';
import type { JobManager } from '../orchestration/jobs.js';
import type { PanelManager } from '../panels/panel.js';
import type { PostManager } from '../posting/post.js';
import type { ModelDirectory } from '../store/models.js';
import type { Attachment, Turn } from '../types.js';
import { LightElement } from './light.js';

const NEAR_BOTTOM_PX = 48;

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
    dockPanels: { type: Boolean, attribute: 'dock-panels' },
    models: { attribute: false },
    resolve: { attribute: false },
    activity: { attribute: false },
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
  /** Panels show in the page beside the chat; the thread only points at them. */
  declare dockPanels: boolean;
  declare models: ModelDirectory;
  declare resolve: (id: string) => Attachment | undefined;
  /** What a tool the embedding page added is doing, in its words. */
  declare activity?: (toolName: string) => string | undefined;
  declare atBottom: boolean;
  declare announcement: string;

  #parts = new WeakMap<ModelMessage[], TurnPart[]>();
  #scroller?: HTMLElement;
  // Media sizes itself as it loads, long after the first scroll; following it keeps the end in view.
  #resize = new ResizeObserver(() => {
    if (this.atBottom) this.#jumpToEnd();
  });
  #gliding = false;
  #wasLive = false;

  constructor() {
    super();
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
  }

  protected override updated(): void {
    const scroller = this.querySelector<HTMLElement>('.cvt-thread-scroll');
    if (scroller && scroller !== this.#scroller) {
      this.#scroller = scroller;
      const list = scroller.querySelector('.cvt-thread-list');
      if (list) this.#resize.observe(list);
      this.#jumpToEnd();
    }
  }

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
                ?latest=${turn.seq === last}
                .jobs=${this.jobs}
                .posts=${this.posts}
                .panels=${this.panels}
                .files=${this.files}
                ?can-share=${this.canShare}
                ?dock-panels=${this.dockPanels}
                .models=${this.models}
                .resolve=${this.resolve}
                .activity=${this.activity}
              ></civitai-chat-turn>`,
          )}
        </div>
      </div>
      ${this.atBottom
        ? nothing
        : html`<civitai-button class="cvt-jump" size="sm" variant="light" @click=${() => this.scrollToEnd()}>Jump to latest</civitai-button>`}
      <div class="cvt-visually-hidden" aria-live="polite">${this.announcement}</div>`;
  }
}
