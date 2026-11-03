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
import type { CivitaiChatTurn } from './civitai-chat-turn.js';
import { LightElement, emit } from './light.js';
import { leaveThreadPlace, threadPlaceFor, type HeldPlace } from './thread-place.js';
import type { ToolCallsMode } from './tool-calls.js';

const NEAR_BOTTOM_PX = 48;
/** How long a new live region is on the page, empty, before its first words go in. */
const ANNOUNCE_AFTER_MS = 100;
/** How deep the element kept in place for a viewer who scrolled away is looked for. */
const ANCHOR_DEPTH = 8;

/** Keys that scroll the thread when focus is not in a text field. */
const SCROLL_KEYS = new Set(['PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', 'Home', 'End', ' ']);
/** Of those, the ones that scroll up (and Shift with the space bar). */
const UP_KEYS = new Set(['PageUp', 'ArrowUp', 'Home']);

/** Page content put after the last message that was already brought into view once (`thread-end`). */
const endShown = new WeakSet<Element>();

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
    hosted: { type: Boolean },
    canEdit: { type: Boolean, attribute: 'can-edit' },
    returnedEdit: { attribute: false },
    awaitingApproval: { type: Boolean, attribute: 'awaiting-approval' },
    queued: { attribute: false },
    conversationId: { attribute: false },
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
  /** On a host's own backend, whose refusals are not about Civitai Buzz: no reply offers to get more. */
  declare hosted: boolean;
  /** Whether the viewer's latest message can be edited now (no reply runs): its Edit shows. */
  declare canEdit: boolean;
  /** An edit of the latest message that waited and came back: that message's edit box reopens with it. */
  declare returnedEdit: { seq: number; text: string } | undefined;
  /** The live reply waits for the viewer to approve a call: its status line says so. */
  declare awaitingApproval: boolean;
  declare queued: QueuedView | null;
  /** The chat this thread shows: a thread made again for the same one keeps the viewer's place. */
  declare conversationId: string | undefined;
  /**
   * Whether the thread follows the end: true until the viewer scrolls away from it themselves, and
   * again once they scroll back to it (or send, open a chat, or the page puts new content at the end).
   * Only a move of the viewer's (or one the thread did not make) changes it: the thread's own jumps to
   * the end, and content growing between such a jump and its scroll event, never unpin it.
   */
  declare atBottom: boolean;
  declare announcement: string;

  #parts = new WeakMap<ModelMessage[], TurnPart[]>();
  #scroller?: HTMLElement;
  // Content that sizes itself late (media as it loads, a group opening, page content at the end) is
  // seen here, after layout and before paint: followed at the end, or kept in place when scrolled away.
  #resize = new ResizeObserver(() => this.#onResize());
  /** A smooth scroll to the end under way: its own scroll events are not the viewer's. */
  #glide = 0;
  /** Where the glide had got to: it only moves down, toward the end. */
  #glideTop = 0;
  /** Where the finger was on the last touch event: dragged down, the view scrolls up. */
  #touchY?: number;
  /** The root the thread is drawn in (the chat's shadow root): a kept place belongs to that chat. */
  #root?: Node;
  /** `scrollTop` right after the thread last set it: a scroll event still there is the thread's own. */
  #written?: number;
  /** What the viewer looks at, deepest first, each with its top relative to the visible area's top. */
  #anchor: { el: Element; top: number }[] = [];
  /** A place to open at, kept from the last thread of this chat, until the content is there to scroll to. */
  #restore?: HeldPlace;
  #place?: HeldPlace;
  #end?: HTMLSlotElement;
  #wasLive = false;
  #queuedStatus?: string;

  constructor() {
    super();
    this.views = {};
    this.toolCalls = 'activity';
    this.mcpServerIds = new Set();
    this.canRetry = false;
    this.hosted = false;
    this.canEdit = false;
    this.awaitingApproval = false;
    this.queued = null;
    this.turns = [];
    this.live = null;
    this.atBottom = true;
    this.announcement = '';
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.#root = this.getRootNode();
    document.addEventListener('visibilitychange', this.#onVisible);
    // Put back on the page after leaving it (moved, not made anew): watched again.
    for (const el of [this.#scroller?.querySelector('.cvt-thread-list'), this.#scroller, this.#end]) if (el) this.#resize.observe(el);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#resize.disconnect();
    document.removeEventListener('visibilitychange', this.#onVisible);
    if (this.conversationId && this.#root) leaveThreadPlace(this.#root, this.conversationId, this.atBottom ? undefined : (this.#restore ?? this.#place));
  }

  /**
   * Brings the end into view and follows it again: the viewer sent, opened a chat or asked to. With
   * `smooth: false` it jumps there (a message just sent: no glide still under way as the reply comes).
   */
  scrollToEnd({ smooth = true }: { smooth?: boolean } = {}): void {
    const el = this.#scroller;
    this.atBottom = true;
    this.#restore = undefined;
    if (!el) return;
    if (!smooth || window.matchMedia('(prefers-reduced-motion: reduce)').matches || this.#distanceToEnd(el) < NEAR_BOTTOM_PX) {
      this.#glide = 0;
      this.#jumpToEnd();
      return;
    }
    const glide = ++this.#glide;
    this.#glideTop = el.scrollTop;
    // Landed (or given up on): the content may have grown on the way, so the end is caught up with.
    const landed = () => {
      if (this.#glide !== glide) return;
      this.#glide = 0;
      if (this.atBottom) this.#jumpToEnd();
    };
    el.addEventListener('scrollend', landed, { once: true });
    setTimeout(landed, 1000);
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }

  #distanceToEnd(el: HTMLElement): number {
    return el.scrollHeight - el.scrollTop - el.clientHeight;
  }

  /** Every scroll the thread makes goes through here, so its scroll event is known for its own. */
  #write(top: number): void {
    const el = this.#scroller;
    if (!el) return;
    el.scrollTop = top;
    this.#written = el.scrollTop;
  }

  #jumpToEnd(): void {
    const el = this.#scroller;
    if (el) this.#write(el.scrollHeight);
  }

  /**
   * The viewer's own scrolling input. Any of it stops a glide to the end: from then on the scroll is
   * theirs. Input that scrolls UP leaves the end at once, however little it moves: a scroll event
   * alone cannot tell a gentle 15px of the viewer's from the end moving, and a stream that adds a line
   * between two of those would otherwise follow on and undo each one. Not keys typed into an edit box
   * in the thread, nor a click on a button in it.
   */
  #onInput = (event: Event): void => {
    let up = false;
    if (event instanceof KeyboardEvent) {
      const target = event.composedPath()[0];
      const typing = target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement || (target instanceof HTMLElement && target.isContentEditable);
      if (typing || !SCROLL_KEYS.has(event.key)) return;
      up = UP_KEYS.has(event.key) || (event.key === ' ' && event.shiftKey);
    } else if (event.type === 'pointerdown') {
      if (event.composedPath()[0] !== this.#scroller) return;
    } else if (event.type === 'wheel') {
      up = (event as WheelEvent).deltaY < 0;
    } else if (event.type === 'touchstart' || event.type === 'touchmove') {
      const y = (event as TouchEvent).touches[0]?.clientY;
      up = event.type === 'touchmove' && y !== undefined && this.#touchY !== undefined && y > this.#touchY;
      this.#touchY = y;
    }
    this.#glide = 0;
    if (up && (this.#scroller?.scrollTop ?? 0) > 0) this.#leaveEnd();
  };

  /** The viewer goes up from the end: the thread stops following, and holds what they look at. */
  #leaveEnd(): void {
    this.atBottom = false;
    this.#restore = undefined;
    this.#written = undefined;
    this.#anchor = [];
  }

  /**
   * A scroll event says where the view is, not who moved it. The thread's own jumps come back here a
   * frame later, by when a streaming reply may have added more than the threshold below the old end:
   * read as the viewer's, that unpinned the thread mid-reply and left it wherever it was. So only a move
   * away from where the thread last put it (a wheel, a touch, the scrollbar, a key, find in page) is
   * the viewer's; a glide to the end is the thread's until the viewer acts, it lands, or the view
   * moves up under it.
   */
  #onScroll = (): void => {
    const el = this.#scroller;
    if (!el) return;
    if (this.#glide) {
      // A glide only goes down. A move up under it is someone else's (the page, find in page): the
      // glide is given up and that move counts as below.
      if (el.scrollTop + 1 >= this.#glideTop) {
        this.#glideTop = el.scrollTop;
        return;
      }
      this.#glide = 0;
      // And stopped where it is, so the browser does not carry it on down past the move.
      el.scrollTo({ top: el.scrollTop, behavior: 'instant' });
    }
    const near = this.#distanceToEnd(el) < NEAR_BOTTOM_PX;
    if (this.#written !== undefined && Math.abs(el.scrollTop - this.#written) < 1) {
      if (this.atBottom && !near) this.#jumpToEnd();
      return;
    }
    this.#written = undefined;
    this.#restore = undefined;
    // Following, a move that lands away from the end leaves it (the scrollbar, find in page). Not
    // following, only reaching the end itself follows again: near it is not enough, as the viewer may
    // have gone up just a little (see #onInput).
    if (this.atBottom ? !near : this.#distanceToEnd(el) < 2) this.atBottom = !this.atBottom;
    if (this.atBottom) this.#anchor = [];
    else this.#capture();
  };

  #onResize(): void {
    if (this.#restore) this.#applyRestore(true);
    // Under a glide too: it was aimed at the end as it was, and lands short of one that grew since.
    if (this.atBottom) {
      this.#jumpToEnd();
      return;
    }
    this.#hold();
  }

  #onVisible = (): void => {
    if (document.visibilityState === 'visible') this.#onResize();
  };

  /** The children layout puts there: a slot's are the elements assigned to it. */
  #kids(el: Element): Element[] {
    return el instanceof HTMLSlotElement ? el.assignedElements({ flatten: true }) : [...el.children];
  }

  /**
   * Notes what the viewer looks at. First choice: the first element, in page order, that starts inside
   * the view: anything above it changing height moves it, so keeping it in place keeps the view. An
   * element straddling the view's top is a poor one (content inside it, above the view, changes height
   * without moving its top), so those come after, deepest first, for when the first choice is drawn
   * anew (a reply's text is, as it streams; its turn is not).
   */
  #capture(): void {
    const el = this.#scroller;
    if (!el) return;
    const top = el.getBoundingClientRect().top;
    const anchor: { el: Element; top: number }[] = [];
    const first = this.#firstInView(el, top, 0);
    if (first) anchor.push({ el: first, top: first.getBoundingClientRect().top - top });
    const straddling: { el: Element; top: number }[] = [];
    let parent: Element = el;
    for (let depth = 0; depth < ANCHOR_DEPTH; depth++) {
      const child = this.#kids(parent).find((kid) => {
        const box = kid.getBoundingClientRect();
        return box.height > 0 && box.bottom > top;
      });
      if (!child) break;
      const childTop = child.getBoundingClientRect().top - top;
      if (childTop >= 0) break;
      straddling.unshift({ el: child, top: childTop });
      parent = child;
    }
    this.#anchor = [...anchor, ...straddling];
    const turns = [...el.querySelectorAll<HTMLElement & { turn?: Turn }>('.cvt-thread-list > civitai-chat-turn')];
    const turn = turns.find((t) => t.getBoundingClientRect().bottom > top) ?? turns.at(-1);
    this.#place = turn?.turn ? { seq: turn.turn.seq, offset: turn.getBoundingClientRect().top - top } : undefined;
  }

  /** The first element under `parent`, in page order, whose top is at or below `top` (the view's). */
  #firstInView(parent: Element, top: number, depth: number): Element | undefined {
    for (const kid of this.#kids(parent)) {
      const box = kid.getBoundingClientRect();
      if (box.height === 0 || box.bottom <= top) continue;
      if (box.top >= top) return kid;
      const inner = depth < ANCHOR_DEPTH ? this.#firstInView(kid, top, depth + 1) : undefined;
      if (inner) return inner;
    }
    return undefined;
  }

  /** Scrolled away: whatever changed size, the content the viewer looks at stays where it was on screen. */
  #hold(): void {
    const el = this.#scroller;
    if (!el) return;
    const kept = this.#anchor.find((a) => a.el.isConnected);
    if (kept) {
      const delta = kept.el.getBoundingClientRect().top - el.getBoundingClientRect().top - kept.top;
      if (Math.abs(delta) >= 0.5) this.#write(el.scrollTop + delta);
    }
    this.#capture();
  }

  /**
   * A thread made again for a chat whose viewer had scrolled away: back to their place, once its turns
   * are drawn. A turn that is not there (the chat came back without it) gives the place up for the end,
   * as a new thread opens. One whose content below has not laid out yet is tried again on the first
   * size report (`laidOut`), and then kept as near as it gets: never left waiting, neither following
   * nor holding.
   */
  #applyRestore(laidOut: boolean): void {
    const el = this.#scroller;
    const place = this.#restore;
    if (!el || !place) return;
    const turn = [...el.querySelectorAll<HTMLElement & { turn?: Turn }>('.cvt-thread-list > civitai-chat-turn')].find((t) => t.turn?.seq === place.seq);
    if (!turn) {
      this.#restore = undefined;
      this.atBottom = true;
      this.#jumpToEnd();
      return;
    }
    const target = el.scrollTop + turn.getBoundingClientRect().top - el.getBoundingClientRect().top - place.offset;
    this.#write(target);
    if (!laidOut && Math.abs(el.scrollTop - target) > 1) return;
    this.#restore = undefined;
    this.#capture();
  }

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
    // A thread made again for the chat the viewer had scrolled away in opens where they were.
    const kept = !this.hasUpdated && this.conversationId ? threadPlaceFor(this.getRootNode(), this.conversationId) : undefined;
    if (kept) {
      this.#restore = kept;
      this.atBottom = false;
    }
  }

  protected override updated(changed: PropertyValues): void {
    const scroller = this.querySelector<HTMLElement>('.cvt-thread-scroll');
    if (scroller && scroller !== this.#scroller) {
      this.#scroller = scroller;
      for (const type of ['wheel', 'touchstart', 'touchmove', 'pointerdown', 'keydown']) scroller.addEventListener(type, this.#onInput, { passive: true });
      // A new thread goes to the end (or back to the viewer's place) once its turns are drawn and laid
      // out: as they finish drawing, and on the first size report, which comes after layout (and in a
      // hidden tab only once it shows). Going there now as well is only a start: the turns are empty yet.
      const list = scroller.querySelector('.cvt-thread-list');
      if (list) this.#resize.observe(list);
      this.#resize.observe(scroller);
      if (this.atBottom) this.#jumpToEnd();
      const turns = [...scroller.querySelectorAll<CivitaiChatTurn>('civitai-chat-turn')];
      void Promise.all(turns.map((turn) => turn.updateComplete)).then(() => (this.#restore ? this.#applyRestore(false) : this.#onResize()));
    }
    // A message that starts waiting is the newest thing in the chat: it is brought into view.
    // (Not a thread's first render: one made again for the same chat finds the same message waiting.)
    if (changed.has('queued') && this.queued && changed.get('queued') === null) {
      this.atBottom = true;
      this.#restore = undefined;
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
  // Only content not shown before: a thread made again for the same chat finds the same content there.
  #onEndChange = (event: Event): void => {
    const slot = event.target as HTMLSlotElement;
    const added = slot.assignedElements({ flatten: true }).filter((el) => !endShown.has(el));
    for (const el of added) endShown.add(el);
    if (added.length) void this.updateComplete.then(() => this.scrollToEnd());
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
                ?hosted=${this.hosted}
                ?can-edit=${turn.seq === last && this.canEdit}
                .returnedEdit=${this.returnedEdit?.seq === turn.seq ? this.returnedEdit : undefined}
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
