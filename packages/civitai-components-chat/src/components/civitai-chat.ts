import type { CivitaiConfirmDialog } from '@civitai/components/civitai-confirm-dialog';
import type { CivitaiToastRegion } from '@civitai/components/civitai-toast-region';
import type { AppClient } from '@civitai/sdk';
import { LitElement, html, nothing, type PropertyDeclarations, type PropertyValues, type TemplateResult } from 'lit';
import { keyed } from 'lit/directives/keyed.js';

import { takeResume } from '../auth/resume.js';
import { SCOPE_PATTERN, chatConfig } from '../config.js';
import type { Panel } from '../panels/panel.js';
import { panelLink, sharedPanelOf, takeSharedPanel, type SharedPanel } from '../panels/share.js';
import { COMMANDS, modelName, parseCommand, resolveModel } from '../ux/commands.js';
import { humanize } from '../ux/humanize.js';
import { conversationSpend, type Spend } from '../ux/spend.js';
import type { GenerationJob } from '../orchestration/job.js';
import type { ChatSession, PendingUpload } from '../session.js';
import { applyTheme } from '../settings.js';
import type { ModelDirectory } from '../store/models.js';
import type { ChatTool, ChatToolView } from '../tools/host.js';
import { ACCEPT_ATTRIBUTE, MAX_UPLOAD_BYTES } from '../uploads/upload.js';
import type { Attachment, Settings } from '../types.js';
import { voiceLanguage } from '../voice/languages.js';
import { LiveTranscript, type VoiceTranscript } from '../voice/live-transcript.js';
import type { StreamingTranscript } from '../voice/streaming-transcript.js';
import type { CivitaiChatComposer } from './civitai-chat-composer.js';
import type { CivitaiChatThread } from './civitai-chat-thread.js';
import { chatStyles } from './chat.styles.js';
import { mediaActions } from './media-actions.js';
import { DEFAULT_ACTIONS, type CardAction } from './lib/actions.js';
import type { MediaKind } from './lib/media.js';

import { panelStyles } from './panel.styles.js';
import type { Example } from './civitai-chat-welcome.js';

/** A finished file, or a job that has none yet (the viewer then shows its details alone). */
type Lightboxed = { attachment: Attachment; job?: undefined } | { job: GenerationJob; attachment?: undefined };

export type ChatLayout = 'auto' | 'compact' | 'wide';

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
    signIn: { attribute: false },
    tools: { attribute: false },
    toolViews: { attribute: false },
    instructions: { attribute: false },
    systemPrompt: { attribute: false },
    mcp: { attribute: false },
    scope: {},
    panelLinkBase: { attribute: 'panel-link-base' },
    dockPanels: { type: Boolean, attribute: 'dock-panels' },
    fullPage: { type: Boolean, attribute: 'full-page', reflect: true },
    // Reflected so the stylesheet can key on it, including the default.
    layout: { reflect: true },
    canSignOut: { type: Boolean, attribute: 'can-sign-out' },
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
  };

  /** Signed in with at least `ai:write:budgeted`; the chat starts once it is set. */
  declare app?: AppClient;
  /**
   * Without `app`, the chat still opens and calls this when the viewer first sends a message or
   * adds a file, straight from that click or key press so a popup is allowed. Resolve with the
   * signed-in `app`; reject with an error whose `code` is `'canceled'` when the viewer gave up.
   */
  declare signIn?: (options: { signal: AbortSignal }) => Promise<AppClient>;
  /** The page's own tools, by name; changes apply from the next reply. */
  declare tools: Record<string, ChatTool>;
  /** How calls of any tool show in the chat, by tool name: an `activity` line, or a `render` that replaces the card. */
  declare toolViews: Record<string, ChatToolView>;
  /** What the assistant should know about the page, read at the start of every reply. */
  declare instructions?: string | (() => string | undefined);
  /** Replaces the built-in persona and rules, or edits them (a function gets the defaults); read at every reply. */
  declare systemPrompt?: string | ((defaults: string) => string);
  /** Switches the assistant's Civitai tool servers: `orchestration` makes things, `site` finds Civitai models. */
  declare mcp: { orchestration?: boolean; site?: boolean };
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

  #session?: ChatSession;
  #models?: ModelDirectory;
  #startedWith?: AppClient;
  #started: Promise<ChatSession>;
  #markStarted!: (session: ChatSession) => void;
  #rerender = (): void => this.requestUpdate();
  #signInAbort?: AbortController;
  #focusedPanel?: Panel;
  #activePanel?: Panel;
  #voice?: VoiceTranscript;
  #aiGrant?: { app: AppClient; granted: Promise<boolean> };

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
    if (changed.has('app') && this.app && this.app !== this.#startedWith) {
      this.#startedWith = this.app;
      void this.#start(this.app);
    }
  }

  /** Sends a message as if the user typed it, once the chat has started; signed out, it asks to sign in first. */
  async send(text: string): Promise<void> {
    if (!this.#session && this.signIn) return this.#signInThen(() => this.#send(text), text);
    await this.#started;
    await this.#send(text);
  }

  /** Puts text in the message box for the user to finish or send. */
  async compose(text: string): Promise<void> {
    if (!this.signIn) await this.#started;
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

  #announceActivePanel(): void {
    const active = this.activePanel;
    if (active === this.#activePanel) return;
    this.#activePanel = active;
    this.dispatchEvent(new CustomEvent('active-panel-change', { detail: { panel: active } }));
  }

  async openPanel(shared: SharedPanel): Promise<void> {
    const session = await this.#started;
    await session.openShared(shared);
    this.renderRoot.querySelector<CivitaiChatThread>('civitai-chat-thread')?.scrollToEnd();
  }

  async focusComposer(): Promise<void> {
    (await this.#composer())?.focus();
  }

  async #start(app: AppClient): Promise<void> {
    this.#session?.agent.abort();
    // The agent, its tools and the thread are most of the weight; a chat nobody opens never loads them.
    const { ChatSession, ModelDirectory, defineChatRuntime } = await import('../runtime.js');
    if (this.app !== app) return;
    defineChatRuntime();
    const scope = this.scope && SCOPE_PATTERN.test(this.scope) ? this.scope : undefined;
    if (this.scope && !scope) console.warn(`[chat-cvt] scope "${this.scope}" is ignored: use letters, digits, ".", "_" and "-", up to 64`);
    const session = new ChatSession(app, {
      scope,
      hostTools: () => this.tools,
      hostInstructions: () => (typeof this.instructions === 'function' ? this.instructions() : this.instructions),
      systemPrompt: () => this.systemPrompt,
      mcp: () => this.mcp,
      // While a reply is still coming the message waits in the box instead of being dropped.
      ask: (message, refs) => (session.agent.running ? this.#composeWith(message, refs) : this.#sendWith(message, refs)),
      compose: (message, refs) => this.#composeWith(message, refs),
    });
    const { settings } = session;
    if (this.fullPage) applyTheme(settings.theme);
    this.#session = session;
    this.#models = new ModelDirectory(app.site, () => session.settings.allowMature);
    for (const target of [session.store, session.agent, session.jobs, session.posts, session.panels] as EventTarget[]) {
      for (const type of ['change', 'list-change', 'conversation-change', 'job-change', 'post-change', 'panel-change']) target.addEventListener(type, this.#rerender);
    }
    session.addEventListener('settings-change', this.#rerender);
    session.panels.addEventListener('panel-change', () => this.#announceActivePanel());
    session.store.addEventListener('conversation-change', () => this.#announceActivePanel());
    this.requestUpdate();

    void app.site
      .get<{ username?: string }>('me')
      .then((me) => (this.userName = me.username ?? ''))
      .catch(() => undefined);
    void session.store.refreshList().catch((error: unknown) => this.#toast('Could not load your chats.', error));
    void session.catalog().catch((error: unknown) => this.#toast('Could not reach Civitai tools; some things may not work.', error));

    const resume = this.fullPage ? takeResume() : null;
    const target = resume?.conversationId ?? settings.lastConversationId;
    if (target) await this.#open(target, false);
    else session.newConversation();
    const shared = this.fullPage ? await takeSharedPanel() : null;
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
    return this.renderRoot.querySelector<CivitaiChatComposer>('civitai-chat-composer');
  }

  async #open(id: string, announce = true): Promise<void> {
    const session = this.#session;
    if (!session) return;
    this.loading = true;
    try {
      await session.openConversation(id);
    } catch (error) {
      session.newConversation();
      if (announce) this.#toast('Could not open that chat.', error);
    } finally {
      this.loading = false;
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
      this.app = await pending;
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
    if (this.#aiGrant?.app !== app) this.#aiGrant = { app, granted: app.requestGrants(['ai:write:budgeted']).catch(() => false) };
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
      if (live && !voice.pending && !voice.canceled) this.renderRoot.querySelector<CivitaiChatComposer>('civitai-chat-composer')?.stopListening();
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
    const composer = this.renderRoot.querySelector<CivitaiChatComposer>('civitai-chat-composer');
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
    const parsed = parseCommand(text);
    if (!parsed) return this.#send(text);
    if ('unknown' in parsed) return this.#toast(`There is no /${parsed.unknown} command. Type /help to see them.`);
    switch (parsed.command.name) {
      case 'clear':
        this.newChat();
        return;
      case 'help':
        this.#notify(COMMANDS.map((command) => `${command.usage}: ${command.help}`).join('  ·  '));
        return;
      case 'model': {
        const session = this.#session;
        if (!session) return this.#toast('Sign in first to choose a model.');
        if (!parsed.arg) {
          const others = ['default', ...chatConfig.models.map((model) => model.label.toLowerCase())].join(', ');
          this.#notify(`The assistant uses ${modelName(session.settings.assistantModel, chatConfig.models)}. Switch with /model ${others}, or a model id.`);
          return;
        }
        const id = resolveModel(parsed.arg, chatConfig.models);
        this.#updateSettings({ assistantModel: id });
        this.#notify(`The assistant now uses ${modelName(id, chatConfig.models)}, from the next reply.`);
        return;
      }
    }
  }

  async #send(text: string): Promise<void> {
    const session = this.#session;
    if (!session && this.signIn) return this.#signInThen(() => this.#send(text), text);
    if (!session || session.agent.running || !this.app) return;
    if (!(await this.#ensureAiGrant(this.app))) {
      const composer = await this.#composer();
      if (composer && !composer.draft) composer.draft = text;
      this.#toast('This chat needs permission to use your Buzz. Sign in again and allow it to send messages.');
      return;
    }
    const uploads = this.uploads.filter((upload) => upload.attachment);
    const refs = this.refs.map((ref) => ref.id);
    this.uploads = [];
    this.refs = [];
    try {
      await session.send(text, uploads, refs);
    } catch (error) {
      this.#toast('That message did not go through.', error);
    }
  }

  /** Adds files to the next message, uploading them right away. */
  addFiles(files: File[]): void {
    const session = this.#session;
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
    const wasCurrent = this.#session?.store.current?.id === id;
    try {
      await this.#session?.store.remove(id);
      if (wasCurrent) this.newChat();
    } catch (error) {
      this.#toast('Could not delete that chat.', error);
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
    const link = Object.assign(document.createElement('a'), { href: url, download: `Civitai-Chat-${conversation.title.replace(/[^\w-]+/g, '-').slice(0, 40)}.json` });
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
              @cvt-example=${(e: CustomEvent<Example>) =>
                void this.#composer().then((composer) => {
                  if (!composer) return;
                  composer.draft = e.detail.prompt;
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
    if (!session) return this.signIn && !this.app ? this.#signedOut() : html`<div class="cvt-starting"><civitai-loader></civitai-loader></div>`;
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
            ${spendBadge(conversationSpend(conversation ?? null, session.jobs.all(), session.store.saveCost))}
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
                  @cvt-example=${(e: CustomEvent<Example>) =>
                    void this.#composer().then((composer) => {
                      if (!composer) return;
                      composer.draft = e.detail.prompt;
                      if (e.detail.wantsFile) composer.browse();
                      composer.focus();
                    })}
                ></civitai-chat-welcome>`
              : keyed(conversation?.id, html`<civitai-chat-thread .turns=${turns} .live=${session.agent.live} .jobs=${session.jobs} .posts=${session.posts} .panels=${session.panels} .files=${() => session.attachments()} ?can-share=${this.#shareBase !== undefined} ?dock-panels=${this.dockPanels} .models=${this.#models} .resolve=${resolve} .views=${{ ...this.tools, ...this.toolViews }}></civitai-chat-thread>`)}
          <civitai-chat-composer
            ?running=${session.agent.running}
            .uploads=${this.uploads}
            .refs=${this.refs}
            voice
            ?transcribing=${this.transcribing}
            .heard=${this.heard}
            .voiceLanguage=${voiceLanguage(session.settings.voiceLanguage)}
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
        .userName=${this.userName}
        .canExport=${turns.length > 0}
        .canSignOut=${this.canSignOut}
        .canTheme=${this.fullPage}
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
