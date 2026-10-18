import type { CivitaiConfirmDialog } from '@civitai/components/civitai-confirm-dialog';
import type { CivitaiToastRegion } from '@civitai/components/civitai-toast-region';
import type { AppClient, BlockAppClient } from '@civitai/sdk';
import { LitElement, html, nothing, type PropertyDeclarations, type PropertyValues, type TemplateResult } from 'lit';
import { keyed } from 'lit/directives/keyed.js';

import type { AgentErrorDetail, AgentRetryDetail } from '../agent/agent.js';
import { backendModels, type ChatBackend } from '../backend.js';
import { usableModels, type ChatModelEntry } from '../agent/model-list.js';
import { takeResume } from '../auth/resume.js';
import { SCOPE_PATTERN, chatConfig, outputTokenCap, type ChatModelOption } from '../config.js';
import type { Panel } from '../panels/panel.js';
import { panelLink, sharedPanelOf, takeSharedPanel, type SharedPanel } from '../panels/share.js';
import { modelName, parseCommand, resolveCommands, resolveModel, type ChatCommand, type ChatCommands, type ChatCommandsOption } from '../ux/commands.js';
import { humanize } from '../ux/humanize.js';
import { conversationSpend, type Spend } from '../ux/spend.js';
import type { GenerationJob } from '../orchestration/job.js';
import type { ChatMcpOptions, ChatMcpServer } from '../mcp/servers.js';
import type { ChatSession, McpServerErrorDetail, PendingUpload } from '../session.js';
import { applyTheme } from '../settings.js';
import { isSuperseded } from '../store/conversation-store.js';
import type { ModelDirectory } from '../store/models.js';
import type { ChatToolGate, ChatToolResult } from '../tools/gate.js';
import type { ChatTool, ChatToolView } from '../tools/host.js';
import { ACCEPT_ATTRIBUTE, MAX_UPLOAD_BYTES } from '../uploads/upload.js';
import type { Attachment, Settings } from '../types.js';
import { voiceLanguage } from '../voice/languages.js';
import { LiveTranscript, type VoiceTranscript } from '../voice/live-transcript.js';
import type { StreamingTranscript } from '../voice/streaming-transcript.js';
import { DEFAULT_PLACEHOLDER, type CivitaiChatComposer } from './civitai-chat-composer.js';
import type { FreeAllowance } from './civitai-chat-settings-dialog.js';
import type { CivitaiChatThread } from './civitai-chat-thread.js';
import { chatStyles } from './chat.styles.js';
import { mediaActions } from './media-actions.js';
import { DEFAULT_ACTIONS, type CardAction } from './lib/actions.js';
import type { MediaKind } from './lib/media.js';

import { panelStyles } from './panel.styles.js';
import type { Example as ChatExample } from './civitai-chat-welcome.js';

/** How long a send waits for the viewer to answer the Buzz permission request before it counts as not given. */
const GRANT_WAIT_MS = 2 * 60_000;

/** A finished file, or a job that has none yet (the viewer then shows its details alone). */
type Lightboxed = { attachment: Attachment; job?: undefined } | { job: GenerationJob; attachment?: undefined };

export type ChatLayout = 'auto' | 'compact' | 'wide';

/** `chat-change`'s detail: the chat now open, or `null` while none is. */
export interface ChatChangeDetail {
  chatId: string | null;
}

/** `before-send`'s detail: the message about to go as the viewer's (`''` when it is only files). */
export interface BeforeSendDetail {
  text: string;
}

/** `can-send-change`'s detail: `canSend` as it now reads. */
export interface CanSendChangeDetail {
  canSend: boolean;
}

/**
 * The whole chat as one element, for a page of its own or a panel inside another app. The page
 * hands it a signed-in `app` and may add `tools` and `instructions` of its own; its own shadow
 * root carries the chat's styles, so the page's CSS and the chat's stay apart. Slot `welcome`
 * replaces what an empty chat shows.
 */
export class CivitaiChat extends LitElement {
  static override styles = [chatStyles, panelStyles];

  static override properties: PropertyDeclarations = {
    app: { attribute: false },
    backend: { attribute: false },
    signIn: { attribute: false },
    tools: { attribute: false },
    commands: { attribute: false },
    toolViews: { attribute: false },
    instructions: { attribute: false },
    systemPrompt: { attribute: false },
    mcp: { attribute: false },
    mcpServers: { attribute: false },
    holdReason: { attribute: 'hold-reason' },
    beforeToolCall: { attribute: false },
    scope: {},
    panelLinkBase: { attribute: 'panel-link-base' },
    dockPanels: { type: Boolean, attribute: 'dock-panels' },
    fullPage: { type: Boolean, attribute: 'full-page', reflect: true },
    // Reflected so the stylesheet can key on it, including the default.
    layout: { reflect: true },
    canSignOut: { type: Boolean, attribute: 'can-sign-out' },
    examples: { attribute: false },
    placeholder: {},
    userName: { state: true },
    uploads: { state: true },
    refs: { state: true },
    settingsOpen: { state: true },
    historyOpen: { state: true },
    lightbox: { state: true },
    loading: { state: true },
    signingIn: { state: true },
    transcribing: { state: true },
    heard: { state: true },
    modelList: { state: true },
    modelsLoading: { state: true },
  };

  /** Signed in with at least `ai:write:budgeted`; the chat starts once it is set. */
  declare app?: AppClient;
  /**
   * The host's own model gateway and conversation storage. Once set the chat starts without `app`
   * (which it then ignores, with `signIn`), and everything that runs on Civitai's services is off and
   * hidden. See "Your own backend" in the README.
   */
  declare backend?: ChatBackend;
  /**
   * Without `app`, the chat still opens and calls this when the viewer first sends a message or
   * adds a file, straight from that click or key press so a popup is allowed. Resolve with the
   * signed-in `app`; reject with an error whose `code` is `'canceled'` when the viewer gave up.
   */
  declare signIn?: (options: { signal: AbortSignal }) => Promise<AppClient>;
  /** The page's own tools, by name; changes apply from the next reply. */
  declare tools: Record<string, ChatTool>;
  /**
   * Slash commands: a record over the built-ins (`clear`, `model`, `help`), where a name adds or replaces one
   * and `null` removes it, or a function from the built-ins to the whole set.
   */
  declare commands?: ChatCommandsOption;
  /** How calls of any tool show in the chat, by tool name: an `activity` line, or a `render` that replaces the card. */
  declare toolViews: Record<string, ChatToolView>;
  /** What the assistant should know about the page, read at the start of every reply. */
  declare instructions?: string | (() => string | undefined);
  /** Replaces the built-in persona and rules, or edits them (a function gets the defaults); read at every reply. */
  declare systemPrompt?: string | ((defaults: string) => string);
  /**
   * Switches the assistant's Civitai tool servers: `orchestration` makes things, `site` finds Civitai models.
   * `orchestration: { exclude: [...] }` keeps it on without the named tools, e.g. `['run_step', 'run_workflow']`.
   */
  declare mcp: Pick<ChatMcpOptions, 'orchestration' | 'site'>;
  /**
   * More MCP servers whose tools the assistant may use, e.g. ones made for this viewer whose address is
   * known only at runtime. Each tool is offered as `${id}__${tool}`. A new array opens the servers it adds
   * and closes the ones it drops (or whose `url` changed), keeping the conversation; an array equal in
   * value to the current one changes nothing.
   */
  declare mcpServers?: ReadonlyArray<ChatMcpServer>;
  /**
   * While set, nothing is sent to the assistant: the message box keeps what the viewer typed and shows
   * this instead, e.g. "The sandbox is starting…" until the tools a first reply needs are there. A reply
   * already running can still be stopped. The chat also holds on its own while an added MCP server is
   * still listing its tools (at most 15 s).
   */
  declare holdReason?: string;
  /**
   * Asked before every tool call the assistant makes, Civitai's, an added server's or the page's own:
   * return `{ refuse: 'why' }` to stop it (nothing runs; the assistant gets the reason as the tool's
   * error), anything else to let it run. A hook that throws refuses. Each finished call is then
   * reported as a `tool-result` event.
   */
  declare beforeToolCall?: ChatToolGate;
  /** Keeps this page's conversations and preferences apart; set it before `app`. */
  declare scope?: string;
  /**
   * The page that opens a shared panel's link (by calling `openPanel`, or as a full-page chat). A
   * full-page chat shares links to itself; elsewhere Share shows only once this is set.
   */
  declare panelLinkBase?: string;
  /**
   * Leaves panels to the page: the thread shows a chip where each one was built or changed, and the
   * chat fires `active-panel-change` with the panel to show (the latest, or the one whose chip was
   * clicked). Pair it with `<civitai-chat-studio>`.
   */
  declare dockPanels: boolean;
  /** The chat is the whole page: it sets the theme, takes keyboard shortcuts and picks up after a sign-in redirect. */
  declare fullPage: boolean;
  /** Where the chat list goes: a column beside the chat (`wide`), a dropdown under the title (`compact`), or by the chat's own width (`auto`, compact at 900px or less). */
  declare layout: ChatLayout;
  declare canSignOut: boolean;
  /**
   * What an empty chat offers to start from, in place of the built-in ones (making a picture, a video, a
   * song…). Clicking one puts its `prompt` in the message box; `wantsFile` also opens the file picker.
   * An empty list shows none. A host backend's chat shows none either way.
   */
  declare examples?: readonly ChatExample[];
  /** The message box's hint while it is empty, in place of the built-in one. */
  declare placeholder?: string;
  declare userName: string;
  declare uploads: PendingUpload[];
  declare refs: Attachment[];
  declare settingsOpen: boolean;
  declare historyOpen: boolean;
  declare lightbox: Lightboxed | null;
  declare loading: boolean;
  declare signingIn: boolean;
  declare transcribing: boolean;
  declare heard: string;
  /** What the model picker offers; the default and the page's models until the full list loads. */
  declare modelList: ChatModelEntry[] | null;
  declare modelsLoading: boolean;

  #session?: ChatSession;
  #models?: ModelDirectory;
  #startedWith?: AppClient | ChatBackend;
  #started: Promise<ChatSession>;
  #markStarted!: (session: ChatSession) => void;
  #rerender = (): void => this.requestUpdate();
  #signInAbort?: AbortController;
  #focusedPanel?: Panel;
  #activePanel?: Panel;
  #voice?: VoiceTranscript;
  #aiGrant?: { app: AppClient; granted: Promise<boolean> };
  /** What the signed-out message box held when sign-in finished, for the signed-in one to start with. */
  #carriedDraft?: string;
  /** Counts the chats opened, so only the latest one's end clears the loader. */
  #opening = 0;
  /** The chat `chat-change` last named, so each change is announced once. */
  #announcedChat: string | null = null;
  /** The open chat being deleted: the moment with no chat open, before the new one, is not announced. */
  #leaving?: string;
  /** What `can-send-change` last said, so each change is announced once. */
  #announcedCanSend = false;
  /** What the session now open was started for; differs from `#startedWith` while a new one starts. */
  #sessionFor?: AppClient | ChatBackend;
  /** The session a send was taken for and not yet handed to its agent (it may be asking for the viewer's grant). */
  #sendingFor?: ChatSession;

  constructor() {
    super();
    this.tools = {};
    this.toolViews = {};
    this.mcp = {};
    this.fullPage = false;
    this.dockPanels = false;
    this.layout = 'auto';
    this.canSignOut = false;
    this.userName = '';
    this.uploads = [];
    this.refs = [];
    this.settingsOpen = false;
    this.historyOpen = false;
    this.lightbox = null;
    this.loading = false;
    this.signingIn = false;
    this.transcribing = false;
    this.heard = '';
    this.modelList = null;
    this.modelsLoading = false;
    this.#started = new Promise((resolve) => (this.#markStarted = resolve));
  }

  override connectedCallback(): void {
    super.connectedCallback();
    document.addEventListener('keydown', this.#onShortcut);
    window.addEventListener('dragover', this.#onStrayDrag);
    window.addEventListener('drop', this.#onStrayDrag);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    document.removeEventListener('keydown', this.#onShortcut);
    window.removeEventListener('dragover', this.#onStrayDrag);
    window.removeEventListener('drop', this.#onStrayDrag);
  }

  // A file dropped outside the chat panel would otherwise replace the app with the file.
  #onStrayDrag = (event: DragEvent): void => {
    if (this.fullPage && !event.defaultPrevented && event.dataTransfer?.types.includes('Files')) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'none';
    }
  };

  protected override willUpdate(changed: PropertyValues): void {
    // A backend wins over an app: with one, the chat never signs in to Civitai.
    const source = this.#source();
    if ((changed.has('app') || changed.has('backend')) && source && source !== this.#startedWith) {
      this.#startedWith = source;
      void this.#start(source);
    }
    // While a new session starts this reaches the old one, whose closed pool ignores it.
    if (changed.has('mcpServers')) this.#session?.syncMcpServers();
  }

  // Each change `canSend` reads either re-renders the chat (the session starting, `holdReason`, a reply
  // starting or ending, a server's listing ending, a chat opening, a send being taken) or happens inside
  // an update before this runs (a server's listing starting, in `willUpdate` or `#start`; a new `app` or
  // `backend` while its session starts), so this sees every change.
  protected override updated(changed: PropertyValues): void {
    super.updated(changed);
    const canSend = this.canSend;
    if (canSend === this.#announcedCanSend) return;
    this.#announcedCanSend = canSend;
    this.dispatchEvent(new CustomEvent<CanSendChangeDetail>('can-send-change', { detail: { canSend }, bubbles: true, composed: true }));
  }

  /** What the chat runs on: the backend when set, else the signed-in app. */
  #source(): AppClient | ChatBackend | undefined {
    return this.backend ?? this.app;
  }

  /** Whether the chat signs in to Civitai on its own, through `signIn`: never with a backend. */
  get #signsIn(): boolean {
    return Boolean(this.signIn) && !this.backend;
  }

  /**
   * Sends a message as if the user typed it, once the chat has started; signed out, it asks to sign in
   * first. Like a typed message it fires `before-send`, which the page can cancel.
   */
  async send(text: string): Promise<void> {
    if (!this.#session && this.#signsIn) return this.#signInThen(() => this.#send(text), text);
    await this.#started;
    await this.#send(text);
  }

  /** Puts text in the message box for the user to finish or send. */
  async compose(text: string): Promise<void> {
    if (!this.#signsIn) await this.#started;
    const composer = await this.#composer();
    if (!composer) return;
    composer.draft = text;
    composer.focus();
  }

  get panels(): Panel[] {
    return this.#session?.panels.all() ?? [];
  }

  get activePanel(): Panel | undefined {
    const panels = this.#session?.panels;
    if (!panels) return undefined;
    const focused = this.#focusedPanel;
    return focused && panels.get(focused.handle) === focused ? focused : panels.latest;
  }

  files(): Attachment[] {
    return this.#session?.attachments() ?? [];
  }

  /** Pass to `<civitai-chat-studio>` so its menus match the chat's. */
  get mediaActions(): Record<MediaKind, CardAction[]> {
    return this.#session ? mediaActions(this.#session.posts) : DEFAULT_ACTIONS;
  }

  mediaAction(id: string, action: string): Promise<void> {
    return this.#mediaAction(id, action);
  }

  #refsFor(ids: string[]): Attachment[] {
    return ids.flatMap((id) => this.#session?.findAttachment(id) ?? []);
  }

  #sendWith(message: string, refs: string[]): void {
    this.refs = this.#refsFor(refs);
    void this.#send(message);
  }

  #composeWith(message: string, refs: string[]): void {
    this.refs = this.#refsFor(refs);
    void this.compose(message);
  }

  /**
   * The id of the chat now open (`null` before the chat has started). A new chat has its id from the
   * start, before anything in it is saved. `chat-change` fires whenever this changes.
   */
  get chatId(): string | null {
    return this.#session?.store.current?.id ?? null;
  }

  /**
   * The text in the message box now: what the viewer typed, or what `compose()` (or an example) put
   * there. `''` while the chat has no message box, e.g. before it is on the page. Signed in or out.
   */
  get draft(): string {
    const draft = this.#composerNow()?.draft;
    return typeof draft === 'string' ? draft : '';
  }

  /**
   * Whether the viewer is dictating: true from the moment they start talking until what they said has
   * been joined to the end of `draft` (or sent, with "Send what you said", or thrown away). That covers
   * recording, the moment after they stop while the recorder hands over their last words, and turning
   * it all into text. Meanwhile the message box is hidden behind the recording or transcribing bar (but
   * for that moment), and `draft` is what it held before; the words are in `draft` by the time this is
   * false again.
   */
  get dictating(): boolean {
    return this.#voice !== undefined;
  }

  /**
   * Whether `send()` now would send: the chat has started, no reply is running, and nothing holds it
   * (`holdReason`, the chat starting again for a new `app` or `backend`, a saved chat still opening, a
   * message still on its way, or an added server still listing its tools).
   * `can-send-change` fires each time this changes. The page's own `before-send` can still cancel the
   * message, and a viewer who has not let the chat use their Buzz is asked first.
   */
  get canSend(): boolean {
    const session = this.#session;
    return session !== undefined && !this.#busy(session) && this.#held(session) === undefined;
  }

  #announceChat(): void {
    const chatId = this.chatId;
    if (chatId === this.#announcedChat) return;
    // Deleting the open chat leaves none open for a moment, then starts a new one: only that one is news.
    if (chatId === null && this.#leaving) return;
    this.#announcedChat = chatId;
    this.dispatchEvent(new CustomEvent<ChatChangeDetail>('chat-change', { detail: { chatId }, bubbles: true, composed: true }));
  }

  #announceActivePanel(): void {
    const active = this.activePanel;
    if (active === this.#activePanel) return;
    this.#activePanel = active;
    this.dispatchEvent(new CustomEvent('active-panel-change', { detail: { panel: active } }));
  }

  async openPanel(shared: SharedPanel): Promise<void> {
    const session = await this.#started;
    if (session.backend) return console.warn('[chat-cvt] panels run on Civitai; this chat uses its own backend');
    await session.openShared(shared);
    this.renderRoot.querySelector<CivitaiChatThread>('civitai-chat-thread')?.scrollToEnd();
  }

  async focusComposer(): Promise<void> {
    (await this.#composer())?.focus();
  }

  async #start(source: AppClient | ChatBackend): Promise<void> {
    this.#session?.agent.abort();
    this.#session?.mcpServers.close();
    // An open still loading in the old session is moot: the new session is not held behind it.
    this.loading = false;
    // The agent, its tools and the thread are most of the weight; a chat nobody opens never loads them.
    const { ChatSession, ModelDirectory, defineChatRuntime } = await import('../runtime.js');
    if (this.#source() !== source) return;
    const backend = source === this.backend ? this.backend : undefined;
    const app = backend ? null : (source as AppClient);
    defineChatRuntime();
    const scope = this.scope && SCOPE_PATTERN.test(this.scope) ? this.scope : undefined;
    if (this.scope && !scope) console.warn(`[chat-cvt] scope "${this.scope}" is ignored: use letters, digits, ".", "_" and "-", up to 64`);
    const session = new ChatSession(app, {
      scope,
      ...(backend ? { backend } : {}),
      hostTools: () => this.tools,
      hostInstructions: () => (typeof this.instructions === 'function' ? this.instructions() : this.instructions),
      systemPrompt: () => this.systemPrompt,
      mcp: () => ({ ...this.mcp, mcpServers: this.mcpServers }),
      beforeToolCall: () => this.beforeToolCall,
      // While a reply is still coming the message waits in the box instead of being dropped.
      ask: (message, refs) => (session.agent.running ? this.#composeWith(message, refs) : this.#sendWith(message, refs)),
      compose: (message, refs) => this.#composeWith(message, refs),
    });
    const { settings } = session;
    if (this.fullPage) applyTheme(settings.theme);
    this.#session = session;
    this.#sessionFor = source;
    this.modelList = null;
    this.#models = new ModelDirectory(session.app.site, () => session.settings.allowMature);
    for (const target of [session.store, session.agent, session.jobs, session.posts, session.panels] as EventTarget[]) {
      for (const type of ['change', 'list-change', 'conversation-change', 'job-change', 'post-change', 'panel-change']) target.addEventListener(type, this.#rerender);
    }
    // For the page's own telemetry: the words the viewer saw, and where the reply broke (`trace`).
    session.agent.addEventListener('error', (event) => {
      if (this.#session === session) this.dispatchEvent(new CustomEvent<AgentErrorDetail>('reply-error', { detail: (event as CustomEvent<AgentErrorDetail>).detail, bubbles: true, composed: true }));
    });
    // A reply the network cut off that is being asked for again by itself: not an error yet, but seen.
    session.agent.addEventListener('network-retry', (event) => {
      if (this.#session === session) this.dispatchEvent(new CustomEvent<AgentRetryDetail>('reply-retry', { detail: (event as CustomEvent<AgentRetryDetail>).detail, bubbles: true, composed: true }));
    });
    session.addEventListener('settings-change', this.#rerender);
    // A server's tools carry its label in the thread once they are listed.
    session.addEventListener('mcp-servers-change', this.#rerender);
    session.freeTier.addEventListener('change', this.#rerender);
    session.addEventListener('tool-result', (event) => {
      if (this.#session !== session) return;
      this.dispatchEvent(new CustomEvent<ChatToolResult>('tool-result', { detail: (event as CustomEvent<ChatToolResult>).detail, bubbles: true, composed: true }));
    });
    session.addEventListener('mcp-server-error', (event) => {
      const { server, error } = (event as CustomEvent<McpServerErrorDetail>).detail;
      this.#toast(`Could not reach ${server.label?.trim() || server.id}; its tools are off for now.`, error);
    });
    session.panels.addEventListener('panel-change', () => this.#announceActivePanel());
    // Only a host's store says so; the viewer learns a chat may not be kept, and that the next change tries again.
    session.store.addEventListener('save-error', () => this.#toast('Could not save this chat. It is saved again with your next message.'));
    session.store.addEventListener('conversation-change', () => {
      this.#announceActivePanel();
      this.#announceChat();
    });
    this.requestUpdate();
    // Into the new box as soon as it shows, before the last chat loads: nothing to flash empty or overwrite.
    const carried = this.#carriedDraft;
    this.#carriedDraft = undefined;
    if (carried) void this.#composer().then((composer) => composer && (composer.draft = carried));

    // In a block the host already handed over the viewer, so the name needs no request. And `/me`
    // must not be asked there: it accepts an OAuth token but refuses the block-scoped one, so a
    // block on the default token would fail that call on every mount. `blocks/me` is not the
    // answer either: it needs `user:read:self`, a consent prompt, to show a name.
    if (!app) this.userName = '';
    else if (isBlockClient(app)) this.userName = app.viewer?.username ?? '';
    else
      void app.site
        .get<{ username?: string }>('me')
        .then((me) => (this.userName = me.username ?? ''))
        .catch(() => undefined);
    void session.store.refreshList().catch((error: unknown) => this.#toast('Could not load your chats.', error));
    void session.catalog().catch((error: unknown) => this.#toast('Could not reach Civitai tools; some things may not work.', error));
    session.syncMcpServers();

    // Picking up after a sign-in redirect, and opening a shared panel, are Civitai's.
    const resume = this.fullPage && !backend ? takeResume() : null;
    const target = resume?.conversationId ?? settings.lastConversationId;
    if (target) await this.#open(target, false);
    else session.newConversation();
    const shared = this.fullPage && !backend ? await takeSharedPanel() : null;
    if (shared) {
      try {
        await session.openShared(shared);
      } catch (error) {
        this.#toast('Could not open that shared panel.', error);
      }
    }
    if (resume?.draft) {
      const composer = await this.#composer();
      if (composer) composer.draft = resume.draft;
    }
    this.#markStarted(session);
  }

  async #composer(): Promise<CivitaiChatComposer | null> {
    await this.updateComplete;
    return this.#composerNow();
  }

  /** The message box as rendered now; `null` before the chat has a render root or a box. */
  #composerNow(): CivitaiChatComposer | null {
    return this.renderRoot?.querySelector<CivitaiChatComposer>('civitai-chat-composer') ?? null;
  }

  async #open(id: string, announce = true): Promise<void> {
    const session = this.#session;
    if (!session) return;
    const ticket = ++this.#opening;
    this.loading = true;
    // Each pick opens at once, whatever is still loading: the stores drop an open that lands after a
    // later open or new chat, so the latest pick is the one that ends open, and only it lifts the hold.
    try {
      await session.openConversation(id);
    } catch (error) {
      // The viewer went to another chat meanwhile: nothing to undo or say, and theirs stays as it is.
      if (isSuperseded(error)) return;
      session.newConversation();
      if (announce) this.#toast('Could not open that chat.', error);
    } finally {
      // Only the latest open clears the loader: until it lands, the chat being left may still be open.
      if (ticket === this.#opening) this.loading = false;
      this.historyOpen = false;
    }
    this.renderRoot.querySelector<CivitaiChatThread>('civitai-chat-thread')?.scrollToEnd();
  }

  get #shareBase(): string | undefined {
    return this.panelLinkBase || (this.fullPage ? `${location.origin}${location.pathname}` : undefined);
  }

  /**
   * Copies a link that opens a copy of the panel; needs `panel-link-base` unless the chat is full-page.
   * Resolves `true` once it is on the clipboard, `false` when the viewer was shown it to copy instead.
   */
  async sharePanel(panel: Panel): Promise<boolean> {
    const base = this.#shareBase;
    if (!base) return false;
    const link = await panelLink(base, sharedPanelOf(panel.toSaved()));
    try {
      await navigator.clipboard.writeText(link);
      this.#notify('Link copied to clipboard.');
      return true;
    } catch {
      window.prompt('Copy this link to share the panel:', link);
      return false;
    }
  }

  #notify(message: string): void {
    this.renderRoot.querySelector<CivitaiToastRegion>('civitai-toast-region')?.show({ message, color: 'success' });
  }

  #toast(message: string, error?: unknown): void {
    if (error) console.warn('[chat-cvt]', message, error);
    this.renderRoot.querySelector<CivitaiToastRegion>('civitai-toast-region')?.show({ message, color: 'error' });
  }

  #onShortcut = (event: KeyboardEvent): void => {
    const mod = event.metaKey || event.ctrlKey;
    if (event.key === 'Escape' && this.historyOpen) {
      this.#closeHistory();
    } else if (!this.fullPage) {
      return;
    } else if (mod && event.shiftKey && event.key.toLowerCase() === 'o') {
      event.preventDefault();
      this.newChat();
    } else if (mod && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      void this.#composer().then((composer) => composer?.focus());
    }
  };

  /** Starts a new conversation and puts the cursor in the message box. */
  newChat(): void {
    // A chat still loading is left behind: its loader (and hold) goes, and the store drops its late end.
    this.loading = false;
    this.#session?.newConversation();
    this.uploads = [];
    this.refs = [];
    this.historyOpen = false;
    void this.#composer().then((composer) => composer?.focus());
  }

  /**
   * Runs `then` once the viewer is signed in. Called synchronously from their click or key press, so
   * the host may open a popup; `draft` stays in the message box until it is sent.
   */
  async #signInThen(then: () => Promise<void> | void, draft?: string): Promise<void> {
    if (!this.signIn || this.signingIn) return;
    const abort = new AbortController();
    this.#signInAbort = abort;
    this.signingIn = true;
    try {
      const pending = this.signIn({ signal: abort.signal });
      if (draft) void this.#composer().then((composer) => composer && (composer.draft = draft));
      const app = await pending;
      // Signed in, the chat renders a new message box: what the viewer typed (or an example put there)
      // goes into it. Not a `draft` being sent, which would come back after it went.
      this.#carriedDraft = draft === undefined ? ((await this.#composer())?.draft ?? '') : '';
      this.app = app;
      await this.#started;
      await then();
    } catch (error) {
      if ((error as { code?: unknown } | null)?.code !== 'canceled') this.#toast(error instanceof Error && error.message ? error.message : 'Sign-in did not finish.', error);
    } finally {
      this.signingIn = false;
      this.#signInAbort = undefined;
    }
  }

  #cancelSignIn(): void {
    this.#signInAbort?.abort();
  }

  // Asked from the click or key press itself, so a host that signs in with a popup may open one.
  #ensureAiGrant(app: AppClient): Promise<boolean> {
    if (this.#aiGrant?.app !== app) {
      // A viewer who closes the consent dialog answers nothing, so the wait is bounded: after
      // GRANT_WAIT_MS it counts as not granted, and is asked again next send. A new app is asked afresh.
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(new Error('the Buzz permission request was not answered')), GRANT_WAIT_MS);
      const ended = new Promise<boolean>((resolve) => abort.signal.addEventListener('abort', () => resolve(false), { once: true }));
      const asked = app.requestGrants(['ai:write:budgeted'], { signal: abort.signal }).catch(() => false);
      this.#aiGrant = { app, granted: Promise.race([asked, ended]).finally(() => clearTimeout(timer)) };
    }
    const { granted } = this.#aiGrant;
    void granted.then((ok) => {
      if (!ok && this.#aiGrant?.granted === granted) this.#aiGrant = undefined;
    });
    return granted;
  }

  #voiceStart(live: boolean): void {
    const session = this.#session;
    if (!session) return;
    this.#voice?.cancel();
    const changed = (): void => {
      if (this.#voice !== voice) return;
      this.heard = voice.text;
      // The server stopped listening (a long pause); what it heard goes in the box.
      if (live && !voice.pending && !voice.canceled) this.#composerNow()?.stopListening();
    };
    const voice: VoiceTranscript = live ? session.liveTranscript(changed) : new LiveTranscript((recording, signal) => session.transcribe(recording, signal), changed);
    this.#voice = voice;
    this.heard = '';
  }

  #voiceCancel(): void {
    this.#voice?.cancel();
    this.#voice = undefined;
    this.heard = '';
    this.transcribing = false;
  }

  async #voiceDone(send: boolean): Promise<void> {
    const voice = this.#voice;
    const session = this.#session;
    const composer = this.#composerNow();
    if (!voice || !session || !composer) return;
    voice.stop();
    this.transcribing = voice.pending;
    const words = await voice.settled();
    if (voice.canceled || this.#voice !== voice) return;
    this.#voice = undefined;
    this.transcribing = false;
    this.heard = '';
    if (voice.error) {
      const why = humanize(voice.error);
      this.#toast(words ? "Part of what you said couldn't be turned into text; check it before sending." : why.kind === 'unknown' ? 'Could not turn your recording into text. Try again, or type it.' : why.message, voice.error);
    } else if (!words) {
      this.#toast("Didn't catch any words. Try again a little closer to the microphone.");
    }
    if (!words) return;
    const text = [composer.draft.trim(), words].filter(Boolean).join(' ');
    if (send && !voice.error && !session.agent.running) {
      composer.draft = '';
      await this.#fromComposer(text);
    } else {
      composer.draft = text;
      composer.focus();
    }
  }

  /** What the viewer typed: a slash command runs here and never reaches the assistant. */
  async #fromComposer(text: string): Promise<void> {
    const parsed = parseCommand(text, this.#commands());
    if (!parsed) return this.#send(text);
    if ('unknown' in parsed) return this.#toast(`There is no /${parsed.unknown} command. Type /help to see them.`);
    try {
      await parsed.command.run(parsed.arg, {
        conversationId: this.#session?.store.current?.id,
        send: (message) => this.#send(message),
        compose: (message) => void this.compose(message),
        notify: (message) => this.#notify(message),
      });
    } catch (error) {
      this.#toast(`/${parsed.name} did not work.`, error);
    }
  }

  #freeAllowance(session: ChatSession): FreeAllowance | null {
    if (session.backend) return null;
    const free = session.freeTier.modelFor(chatConfig.model);
    return free ? { left: free.remaining, resetAt: session.freeTier.resetAt(chatConfig.model) } : null;
  }

  #continuePaid(): void {
    const session = this.#session;
    if (!session) return;
    this.#updateSettings({ assistantTier: 'auto' });
    void session.agent.retry();
  }

  /** The built-ins, then the page's `commands` over them. */
  #commands(): ChatCommands {
    return resolveCommands(this.#builtInCommands(), this.commands);
  }

  /** The models a chat may switch to besides the default, and whether any other id may be typed. */
  #modelOptions(session = this.#session): { models: ChatModelOption[]; typed: boolean } {
    const backend = session?.backend ?? this.backend;
    return backend ? { models: backendModels(backend), typed: false } : { models: chatConfig.models, typed: true };
  }

  #builtInCommands(): ChatCommands {
    const { models, typed } = this.#modelOptions();
    return {
      clear: { aliases: ['new'], usage: '/clear', help: 'Start a new chat', run: () => this.newChat() },
      // A backend with one model has nothing to switch to.
      ...(typed || models.length ? { model: this.#modelCommand(models, typed) } : {}),
      help: {
        usage: '/help',
        help: 'List these commands',
        run: (_arg, { notify }) => notify(Object.values(this.#commands()).map((command) => `${command.usage}: ${command.help}`).join('  ·  ')),
      },
    };
  }

  #modelCommand(models: ChatModelOption[], typed: boolean): ChatCommand {
    return {
      usage: `/model [${['default', ...models.map((model) => model.label.toLowerCase()), ...(typed ? ['model id'] : [])].join(' | ')}]`,
      help: "Show or switch this chat's model",
      run: async (arg, { notify }) => {
        const session = this.#session;
        if (!session) return notify('Sign in first to choose a model.');
        if (!arg) {
          const others = ['default', ...models.map((model) => model.label.toLowerCase())].join(', ');
          return notify(`This chat uses ${this.#modelName(session)}. Switch it with /model ${others}${typed ? ', or a model id' : ''}.`);
        }
        const picked = resolveModel(arg, models);
        if (!typed && picked !== undefined && !models.some((model) => model.id === picked)) return notify(`There is no model called ${arg.trim()} here.`);
        try {
          await session.setChatModel(picked);
        } catch (error) {
          // The switch holds for this session; only keeping it with the chat failed, as the picker says.
          return this.#toast("Could not save this chat's model; it applies until you reload.", error);
        }
        notify(this.#switchedModel(session));
      },
    };
  }

  /**
   * What `/model <x>` says it did. `/model` changes this chat only, so with a stored default it also says
   * which model new chats get, and where that default is changed.
   */
  #switchedModel(session: ChatSession): string {
    const stored = session.backend ? undefined : session.settings.assistantModel?.trim() || undefined;
    if (!stored) return `This chat now uses ${this.#modelName(session)}, from the next reply.`;
    const fallback = `your default, ${modelName(stored, chatConfig.models)} (Settings → Assistant)`;
    const own = session.store.current?.model;
    return own
      ? `This chat now uses ${modelName(own, chatConfig.models)}, from the next reply. New chats use ${fallback}.`
      : `This chat now follows ${fallback}, from the next reply.`;
  }

  /** The open chat's model in words: its own, or the default it follows. */
  #modelName(session: ChatSession): string {
    const { models } = this.#modelOptions(session);
    const own = session.store.current?.model;
    if (own) return modelName(own, models);
    return session.backend ? `the default (${session.backend.model})` : `the default (${modelName(session.settings.assistantModel?.trim() || undefined, models)})`;
  }

  #loadModels(): void {
    const session = this.#session;
    if (!session || this.modelsLoading) return;
    this.modelsLoading = true;
    void session.modelCatalog
      .load()
      .then((list) => {
        if (this.#session === session) this.modelList = list;
      })
      .catch((error: unknown) => console.warn('[chat-cvt] could not load the model list', error))
      .finally(() => {
        if (this.#session === session) this.modelsLoading = false;
      });
  }

  #pickModel(model: string | undefined): void {
    const session = this.#session;
    if (!session) return;
    void session.setChatModel(model).catch((error: unknown) => this.#toast("Could not save this chat's model; it applies until you reload.", error));
  }

  /** The open chat's model button; hidden on a backend that offers nothing to pick. */
  #modelPicker(session: ChatSession): TemplateResult | typeof nothing {
    const backend = session.backend;
    if (backend && backendModels(backend).length === 0) return nothing;
    return html`<civitai-chat-model-picker
      .value=${session.assistantModel()}
      ?own=${Boolean(session.store.current?.model)}
      ?no-custom=${Boolean(backend)}
      .defaultModel=${backend ? undefined : session.settings.assistantModel?.trim() || undefined}
      .models=${usableModels(this.modelList ?? session.modelChoices(), outputTokenCap(session.settings.maxOutputTokens), session.assistantModel())}
      ?loading=${this.modelsLoading}
      @cvt-model-open=${() => this.#loadModels()}
      @cvt-model-pick=${(e: CustomEvent<{ model?: string }>) => this.#pickModel(e.detail.model)}
    ></civitai-chat-model-picker>`;
  }

  /**
   * Why nothing may be sent right now (shown in the message box, which keeps what is sent meanwhile): the
   * page's `holdReason`, a new session starting in this one's place, a saved chat still opening (until
   * then the chat being left may be the open one), a message still on its way to the agent, or an added
   * server still listing its tools.
   */
  #held(session: ChatSession | undefined): string | undefined {
    const reason = this.holdReason?.trim();
    if (reason) return reason;
    if (session && this.#sessionFor !== this.#startedWith) return 'Starting…';
    if (this.loading) return 'Opening this chat…';
    if (session && this.#sendingFor === session) return 'Sending…';
    const listing = session?.mcpServers.listing ?? [];
    return listing.length ? `Connecting to ${listing.map((server) => server.label?.trim() || server.id).join(', ')}…` : undefined;
  }

  /** Why a send goes nowhere, with no message kept: a reply is still running, or there is no one to send as. */
  #busy(session: ChatSession): boolean {
    return session.agent.running || (!session.backend && !this.app);
  }

  async #send(text: string): Promise<void> {
    const session = this.#session;
    if (!session && this.#signsIn) return this.#signInThen(() => this.#send(text), text);
    // With a backend there is no Civitai sign-in to ask for a grant: the host's gateway decides.
    const app = session?.backend ? undefined : this.app;
    if (!session || this.#busy(session)) return;
    if (this.#held(session)) {
      // Kept for the viewer to send once the hold lifts, as a refused grant keeps it.
      const composer = await this.#composer();
      if (composer && !composer.draft) composer.draft = text;
      return;
    }
    // Taken: until the agent has it (past the grant, which may wait on the viewer), the chat holds, so
    // another message waits in the box and `canSend` says no.
    this.#sendingFor = session;
    this.requestUpdate();
    try {
      const granted = !app || (await this.#ensureAiGrant(app));
      // Replaced by a new app or backend meanwhile: nothing goes to the old session, and the message
      // waits in the box for the new one.
      if (this.#session !== session) {
        const composer = await this.#composer();
        if (composer && !composer.draft) composer.draft = text;
        return;
      }
      if (!granted) {
        const composer = await this.#composer();
        if (composer && !composer.draft) composer.draft = text;
        this.#toast('This chat needs permission to use your Buzz. Sign in again and allow it to send messages.');
        return;
      }
      // The last moment before the message goes: a page that cancels it keeps it out of the chat, and
      // the files and earlier results added to it stay for the next message.
      if (!this.dispatchEvent(new CustomEvent<BeforeSendDetail>('before-send', { detail: { text }, bubbles: true, composed: true, cancelable: true }))) return;
      const uploads = this.uploads.filter((upload) => upload.attachment);
      const refs = this.refs.map((ref) => ref.id);
      this.uploads = [];
      this.refs = [];
      // The reply starts inside this call, so from here the running reply keeps sends out, not the hold.
      const sent = session.send(text, uploads, refs);
      this.#sendingFor = undefined;
      this.requestUpdate();
      try {
        await sent;
      } catch (error) {
        this.#toast('That message did not go through.', error);
      }
    } finally {
      if (this.#sendingFor === session) {
        this.#sendingFor = undefined;
        this.requestUpdate();
      }
    }
  }

  /** Adds files to the next message, uploading them right away. */
  addFiles(files: File[]): void {
    const session = this.#session;
    // Files are uploaded to Civitai's orchestrator, which a chat on a backend does not use.
    if (this.backend || session?.backend) return;
    if (!session) {
      void this.#signInThen(() => this.addFiles(files));
      return;
    }
    const added = files.map((file) => ({ key: crypto.randomUUID(), file, progress: 0 }));
    this.uploads = [...this.uploads, ...added];
    for (const pending of added) {
      void session.upload(pending, () => {
        this.uploads = [...this.uploads];
      });
    }
  }

  #removeFile(key: string): void {
    this.uploads = this.uploads.filter((upload) => upload.key !== key);
    this.refs = this.refs.filter((ref) => ref.id !== key);
  }

  async #mediaAction(id: string, action: string): Promise<void> {
    const attachment = this.#session?.findAttachment(id);
    if (!attachment) return;
    if (action === 'download') {
      if (attachment.url) window.open(attachment.url, '_blank', 'noopener');
      return;
    }
    if (action === 'info') {
      if (attachment.url) this.lightbox = { attachment };
      return;
    }
    const request =
      action === 'post'
        ? attachment.kind === 'video' ? 'Post this video to Civitai.' : 'Post this picture to Civitai.'
        : action === 'upscale'
          ? attachment.kind === 'video' ? 'Make this video sharper.' : 'Make this picture sharper and bigger.'
          : undefined;
    if (request) {
      this.lightbox = null;
      // Mid-reply nothing can be sent; the request waits in the box instead of vanishing.
      if (this.#session?.agent.running) return this.#composeWith(request, [attachment.id]);
      this.refs = [attachment];
      await this.#send(request);
      return;
    }
    this.refs = [...this.refs.filter((ref) => ref.id !== id), attachment];
    this.lightbox = null;
    const composer = await this.#composer();
    if (!composer) return;
    if (action === 'animate') composer.draft = 'Animate this: ';
    composer.focus();
  }

  async #delete(id: string, title: string): Promise<void> {
    const dialog = this.renderRoot.querySelector<CivitaiConfirmDialog>('#cvt-delete-dialog');
    if (!dialog) return;
    dialog.message = `"${title}" and everything made in it will be removed.`;
    if (!(await dialog.ask())) return;
    const store = this.#session?.store;
    const wasCurrent = store?.current?.id === id;
    // A store that takes the chat off the list as its delete starts: off the open chat at once, so a
    // delete that is slow (or never answers) holds nothing up. Otherwise only once the delete worked.
    const leaveAtOnce = Boolean(store?.supersedesOpens);
    if (wasCurrent) this.#leaving = id;
    try {
      const removing = store?.remove(id);
      if (wasCurrent && leaveAtOnce) this.newChat();
      await removing;
      if (wasCurrent && !leaveAtOnce) this.newChat();
    } catch (error) {
      this.#toast('Could not delete that chat.', error);
    } finally {
      if (this.#leaving === id) this.#leaving = undefined;
    }
  }

  #export(): void {
    const session = this.#session;
    const conversation = session?.store.current;
    if (!session || !conversation) return;
    const data = {
      title: conversation.title,
      exportedAt: new Date().toISOString(),
      turns: conversation.turns.map((turn) => ({
        seq: turn.seq,
        at: turn.createdAt,
        user: turn.user,
        assistant: turn.assistant.messages,
        jobs: session.jobs.all().filter((job) => job.seq === turn.seq && !job.panel).map((job) => job.summary()),
      })),
      panels: session.panels.all().map((panel) => ({ ...panel.toSaved(), runs: panel.jobs.map((job) => job.summary()) })),
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const link = Object.assign(document.createElement('a'), { href: url, download: `${chatConfig.name.replace(/\s+/g, '-')}-${conversation.title.replace(/[^\w-]+/g, '-').slice(0, 40)}.json` });
    link.click();
    URL.revokeObjectURL(url);
  }

  #updateSettings(patch: Partial<Settings>): void {
    this.#session?.updateSettings(patch);
    if (patch.theme && this.fullPage) applyTheme(patch.theme);
  }

  /** An empty chat that asks to sign in only when the viewer sends something. */
  #signedOut(): TemplateResult {
    const signInButton = (label: string) =>
      html`<civitai-button size="sm" ?loading=${this.signingIn} @click=${() => void this.#signInThen(() => undefined)}>${label}</civitai-button>`;
    return html`<div class="cvt-shell cvt-signed-out">
        <aside class="cvt-signed-out-chats" aria-label="Your chats">
          <h2>Your chats</h2>
          <p>You are signed out. Sign in with Civitai to see your chats and pick up where you left off.</p>
          ${signInButton('Sign in')}
        </aside>
        <main class="cvt-main-host">
          <civitai-chat-dropzone
            class="cvt-main"
            accept=${ACCEPT_ATTRIBUTE}
            max-size=${MAX_UPLOAD_BYTES}
            multiple
            @files=${(e: CustomEvent<{ files: File[] }>) => this.addFiles(e.detail.files)}
          >
            <header class="cvt-topbar">
              <h1 class="cvt-title"><span class="cvt-title-text">New chat</span></h1>
              <span class="cvt-signed-out-badge">Signed out</span>
              ${signInButton('Sign in')}
            </header>
            <civitai-chat-welcome
              .examples=${this.examples}
              @cvt-example=${(e: CustomEvent<ChatExample>) =>
                void this.#composer().then((composer) => {
                  if (!composer) return;
                  composer.draft = e.detail.prompt;
                  if (e.detail.wantsFile) composer.browse();
                  composer.focus();
                })}
            ></civitai-chat-welcome>
            <div class="cvt-signed-out-foot">
              ${this.signingIn
                ? html`<p class="cvt-sign-in-status" role="status">
                    Finish signing in to Civitai in the window that opened.
                    <button type="button" @click=${() => this.#cancelSignIn()}>Cancel</button>
                  </p>`
                : html`<p class="cvt-sign-in-status">You are signed out. Sending a message signs you in with Civitai.</p>`}
              <civitai-chat-composer
                .commands=${this.#commands()}
                .placeholder=${this.placeholder ?? DEFAULT_PLACEHOLDER}
                ?running=${this.signingIn}
                @cvt-send=${(e: CustomEvent<{ text: string }>) => void this.#fromComposer(e.detail.text)}
                @cvt-stop=${() => this.#cancelSignIn()}
                @cvt-files=${(e: CustomEvent<{ files: File[] }>) => this.addFiles(e.detail.files)}
                @cvt-files-rejected=${(e: CustomEvent<{ reason: string }>) =>
                  this.#toast(e.detail.reason === 'size' ? 'That file is too big; the limit is 64 MB.' : 'That kind of file cannot be used here.')}
              ></civitai-chat-composer>
            </div>
          </civitai-chat-dropzone>
        </main>
      </div>
      <civitai-toast-region></civitai-toast-region>`;
  }

  /** The chat list: a column beside the chat, or a dropdown under the title where space is short. */
  #chats(session: ChatSession): TemplateResult {
    const conversation = session.store.current;
    return html`<civitai-chat-sidebar
      .summaries=${session.store.summaries}
      .currentId=${conversation?.id ?? null}
      .hasMore=${session.store.hasMore}
      .userName=${this.userName}
      @cvt-new-chat=${() => this.newChat()}
      @cvt-open=${(e: CustomEvent<{ id: string }>) => void this.#open(e.detail.id)}
      @cvt-rename=${(e: CustomEvent<{ id: string; title: string }>) =>
        void session.store.rename(e.detail.id, e.detail.title).catch((error: unknown) => this.#toast('Could not rename that chat.', error))}
      @cvt-delete=${(e: CustomEvent<{ id: string; title: string }>) => void this.#delete(e.detail.id, e.detail.title)}
      @cvt-load-more=${() => void session.store.loadMore().catch((error: unknown) => this.#toast('Could not load older chats.', error))}
      @cvt-open-settings=${() => {
        this.historyOpen = false;
        this.settingsOpen = true;
        void this.#session?.freeTier.refresh();
      }}
    ></civitai-chat-sidebar>`;
  }

  #toggleHistory(): void {
    this.historyOpen = !this.historyOpen;
    if (!this.historyOpen) return;
    void this.updateComplete.then(() => {
      const root = this.renderRoot;
      (root.querySelector<HTMLElement>('.cvt-history .cvt-chat-open[aria-current]') ?? root.querySelector<HTMLElement>('.cvt-history .cvt-chat-open'))?.focus();
    });
  }

  #closeHistory(): void {
    if (!this.historyOpen) return;
    this.historyOpen = false;
    this.renderRoot.querySelector<HTMLElement>('.cvt-history-toggle')?.focus();
  }

  #closeHistoryOutside = (event: PointerEvent): void => {
    if (!this.historyOpen) return;
    const inside = event.composedPath().some((node) => node instanceof Element && (node.classList.contains('cvt-history') || node.classList.contains('cvt-history-toggle')));
    if (!inside) this.historyOpen = false;
  };

  override render(): TemplateResult {
    const session = this.#session;
    if (!session) return this.#signsIn && !this.app ? this.#signedOut() : html`<div class="cvt-starting"><civitai-loader></civitai-loader></div>`;
    // On a host backend: no files, voice, Buzz, posting or sign-in, so none of it is shown.
    const hosted = Boolean(session.backend);
    const conversation = session.store.current;
    const boxed = this.lightbox;
    const details = boxed?.attachment ? session.detailsFor(boxed.attachment) : boxed?.job ? session.jobDetails(boxed.job) : null;
    const turns = conversation?.turns ?? [];
    const resolve = (id: string) => session.findAttachment(id);
    const title = conversation?.title ?? 'New chat';
    return html`<div class="cvt-shell" @pointerdown=${this.#closeHistoryOutside}>
        ${this.#chats(session)}
        <main
          class="cvt-main-host"
          @media-action=${(e: CustomEvent<{ id: string; action: string }>) => void this.#mediaAction(e.detail.id, e.detail.action)}
          @media-retry=${(e: CustomEvent<{ id: string }>) => {
            const attachment = session.findAttachment(e.detail.id);
            if (attachment) void session.refreshUrl(attachment).then(this.#rerender);
          }}
          @open=${(e: CustomEvent<{ id?: string; key?: string }>) => {
            const attachment = session.findAttachment(e.detail?.id ?? e.detail?.key ?? '');
            if (attachment?.url) this.lightbox = { attachment };
          }}
          @job-adjust=${(e: Event) => {
            const job = (e.target as { job?: GenerationJob }).job;
            if (!job) return;
            void session.adjust(job).then((made) => {
              if (made) this.renderRoot.querySelector<CivitaiChatThread>('civitai-chat-thread')?.scrollToEnd();
              else this.#toast(session.agent.running ? 'Wait for the assistant to finish, then try Adjust again.' : 'This one cannot be adjusted here.');
            });
          }}
          @job-info=${(e: Event) => {
            const job = (e.target as { job?: GenerationJob }).job;
            if (job) this.lightbox = { job };
          }}
          @cvt-choice=${(e: CustomEvent<{ label: string }>) => void this.#send(e.detail.label)}
          @panel-share=${(e: CustomEvent<{ panel: Panel; copied?: Promise<boolean> }>) => (e.detail.copied = this.sharePanel(e.detail.panel))}
          @panel-focus=${(e: CustomEvent<{ panel: Panel }>) => {
            this.#focusedPanel = e.detail.panel;
            this.#announceActivePanel();
          }}
        >
          <civitai-chat-dropzone
            class="cvt-main"
            accept=${ACCEPT_ATTRIBUTE}
            max-size=${MAX_UPLOAD_BYTES}
            multiple
            ?disabled=${hosted}
            @files=${(e: CustomEvent<{ files: File[] }>) => {
              this.addFiles(e.detail.files);
              void this.#composer().then((composer) => composer?.focus());
            }}
            @rejected=${(e: CustomEvent<{ reason: string }>) =>
              this.#toast(e.detail.reason === 'size' ? 'That file is too big; the limit is 64 MB.' : 'That kind of file cannot be used here.')}
          >
          <div slot="overlay" class="cvt-drop">
            <div class="cvt-drop-card">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4m0 0-4.5 4.5M12 4l4.5 4.5M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" /></svg>
              <strong>Drop to add to your message</strong>
              <span>Photos, videos and audio, up to 64 MB each</span>
            </div>
          </div>
          <header class="cvt-topbar">
            <h1 class="cvt-title">
              <span class="cvt-title-text">${title}</span>
              <button class="cvt-history-toggle" aria-expanded=${String(this.historyOpen)} aria-controls="cvt-history" @click=${() => this.#toggleHistory()}>
                <span class="cvt-visually-hidden">Your chats: </span><span class="cvt-history-title">${title}</span>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
              </button>
            </h1>
            ${hosted ? nothing : spendBadge(conversationSpend(conversation ?? null, session.jobs.all(), session.store.saveCost))}
            <button class="cvt-icon-button" aria-label="New chat" @click=${() => this.newChat()}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
            </button>
            ${this.historyOpen ? html`<div class="cvt-history" id="cvt-history">${this.#chats(session)}</div>` : nothing}
          </header>
          ${this.loading
            ? html`<div class="cvt-loading"><civitai-loader></civitai-loader></div>`
            : turns.length === 0
              ? html`<civitai-chat-welcome
                  .userName=${this.userName}
                  ?plain=${hosted}
                  .examples=${this.examples}
                  @cvt-example=${(e: CustomEvent<ChatExample>) =>
                    void this.#composer().then((composer) => {
                      if (!composer) return;
                      composer.draft = e.detail.prompt;
                      if (e.detail.wantsFile) composer.browse();
                      composer.focus();
                    })}
                ></civitai-chat-welcome>`
              : keyed(conversation?.id, html`<civitai-chat-thread .turns=${turns} .live=${session.agent.live} .jobs=${session.jobs} .posts=${session.posts} .panels=${session.panels} .files=${() => session.attachments()} ?can-share=${this.#shareBase !== undefined} ?dock-panels=${this.dockPanels} .models=${this.#models} .resolve=${resolve} .views=${{ ...session.mcpServerViews(), ...this.tools, ...this.toolViews }} @cvt-continue-paid=${() => this.#continuePaid()} @cvt-continue=${() => void this.#send('Continue where you left off.')}></civitai-chat-thread>`)}
          <civitai-chat-composer
            .commands=${this.#commands()}
            ?running=${session.agent.running}
            .holdReason=${this.#held(session)}
            .uploads=${this.uploads}
            .refs=${this.refs}
            ?voice=${!hosted}
            .placeholder=${this.placeholder ?? (hosted ? 'Ask anything' : DEFAULT_PLACEHOLDER)}
            ?no-files=${hosted}
            ?transcribing=${this.transcribing}
            .heard=${this.heard}
            .voiceLanguage=${voiceLanguage(session.settings.voiceLanguage)}
            .modelPicker=${this.#modelPicker(session)}
            @cvt-voice-language=${(e: CustomEvent<{ language: string }>) => session.updateSettings({ voiceLanguage: e.detail.language })}
            @cvt-voice-start=${(e: CustomEvent<{ live: boolean }>) => this.#voiceStart(e.detail.live)}
            @cvt-voice-phrase=${(e: CustomEvent<{ recording: Blob }>) => (this.#voice as LiveTranscript | undefined)?.add(e.detail.recording)}
            @cvt-voice-audio=${(e: CustomEvent<{ pcm: Int16Array }>) => (this.#voice as StreamingTranscript | undefined)?.add(e.detail.pcm)}
            @cvt-voice-done=${(e: CustomEvent<{ send: boolean }>) => void this.#voiceDone(e.detail.send)}
            @cvt-voice-cancel=${() => this.#voiceCancel()}
            @cvt-voice-error=${(e: CustomEvent<{ error: unknown }>) => this.#toast(microphoneProblem(e.detail.error), e.detail.error)}
            @cvt-send=${(e: CustomEvent<{ text: string }>) => void this.#fromComposer(e.detail.text)}
            @cvt-stop=${() => session.agent.abort()}
            @cvt-files=${(e: CustomEvent<{ files: File[] }>) => this.addFiles(e.detail.files)}
            @cvt-files-rejected=${(e: CustomEvent<{ reason: string }>) =>
              this.#toast(e.detail.reason === 'size' ? 'That file is too big; the limit is 64 MB.' : 'That kind of file cannot be used here.')}
            @cvt-remove-file=${(e: CustomEvent<{ key: string }>) => this.#removeFile(e.detail.key)}
          ></civitai-chat-composer>
          </civitai-chat-dropzone>
        </main>
      </div>
      <civitai-chat-settings-dialog
        .open=${this.settingsOpen}
        .settings=${session.settings}
        .freeAllowance=${this.#freeAllowance(session)}
        .userName=${this.userName}
        .canExport=${turns.length > 0}
        .canSignOut=${this.canSignOut}
        .canTheme=${this.fullPage}
        .hosted=${hosted}
        .models=${chatConfig.models}
        @cvt-close-settings=${() => (this.settingsOpen = false)}
        @cvt-settings-change=${(e: CustomEvent<Partial<Settings>>) => this.#updateSettings(e.detail)}
        @cvt-export=${() => this.#export()}
      ></civitai-chat-settings-dialog>
      <civitai-chat-lightbox
        .open=${boxed !== null}
        .heading=${boxed?.job ? boxed.job.subject : ''}
        .kind=${boxed?.attachment?.kind ?? 'image'}
        .src=${boxed?.attachment?.url ?? ''}
        ?with-details=${details !== null}
        @close=${() => (this.lightbox = null)}
      >
        ${details ? html`<civitai-chat-generation-details slot="details" .details=${details} .models=${this.#models}></civitai-chat-generation-details>` : nothing}
        ${boxed?.attachment
          ? html`<civitai-button slot="actions" size="sm" variant="light" @click=${() => void this.#mediaAction(boxed.attachment.id, 'reference')}>Use in chat</civitai-button>
              ${session.posts.accepts(boxed.attachment)
                ? html`<civitai-button slot="actions" size="sm" variant="light" @click=${() => void this.#mediaAction(boxed.attachment.id, 'post')}>Post to Civitai</civitai-button>`
                : nothing}
              <civitai-button slot="actions" size="sm" variant="subtle" @click=${() => void this.#mediaAction(boxed.attachment.id, 'download')}>Download</civitai-button>`
          : nothing}
      </civitai-chat-lightbox>
      <civitai-confirm-dialog id="cvt-delete-dialog" heading="Delete this chat?" confirm-label="Delete" cancel-label="Keep it" destructive></civitai-confirm-dialog>
      <civitai-toast-region></civitai-toast-region>`;
  }
}

function spendBadge(spend: Spend): TemplateResult | typeof nothing {
  if (spend.total === 0) return nothing;
  const detail = `About ${spend.total} Buzz so far in this chat: ${spend.generations} for what was made, ${spend.assistant} for the assistant.`;
  return html`<span class="cvt-spend" title=${detail} aria-label=${detail}>
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" /></svg>≈ ${spend.total.toLocaleString()}
  </span>`;
}

declare global {
  interface HTMLElementTagNameMap {
    'civitai-chat': CivitaiChat;
  }
}

function microphoneProblem(error: unknown): string {
  const name = (error as { name?: unknown } | null)?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'The microphone is blocked. Allow it for this site in your browser to talk instead of typing.';
  if (name === 'NotFoundError') return 'No microphone was found.';
  return 'Could not start the microphone.';
}

/**
 * A client `initialize()` made inside a civitai.com page, told apart by the members only that kind
 * has. Whichever token it holds, the host's `viewer` names the person, so no API call is needed.
 */
function isBlockClient(app: AppClient): app is BlockAppClient {
  return 'host' in app && 'viewer' in app;
}
