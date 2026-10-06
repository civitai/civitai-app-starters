import type { AppClient } from '@civitai/sdk';
import type { LanguageModel, ToolSet } from 'ai';

import { Agent } from './agent/agent.js';
import { partsFromMessages } from './agent/parts.js';
import { FreeTier, freeTierFetch } from './agent/free-tier.js';
import { createAssistantModel } from './agent/provider.js';
import { chatConfig } from './config.js';
import { createMcpConnection, type McpConnection } from './mcp/clients.js';
import { createOrchestrationApi, type OrchestrationApi } from './orchestration/api.js';
import { generationDetails, type GenerationDetails } from './orchestration/details.js';
import { toolInfo, type GenerationJob, type JobState, type JobToolInfo } from './orchestration/job.js';
import { JobManager } from './orchestration/jobs.js';
import { PanelManager } from './panels/panel.js';
import { adjustPanel } from './panels/adjust.js';
import type { SharedPanel } from './panels/share.js';
import type { PanelSpec, PanelValues } from './panels/spec.js';
import { OPEN_PANEL } from './panels/tools.js';
import { sitePoster } from './posting/site.js';
import { POST_TOOL, PostManager, type PostHost } from './posting/post.js';
import { resolveAttachmentArgs, uploadId } from './store/attachments.js';
import { ThreadStore, type OpenedConversation } from './store/thread-store.js';
import { buildToolSet } from './tools/build.js';
import type { McpTool } from './mcp/clients.js';
import { isJobTool, loadOrchestrationTools, loadSiteTools, type ToolCatalog } from './tools/catalog.js';
import type { Attachment, Settings, Turn } from './types.js';
import { uploadAttachment, uploadFile, probeMedia } from './uploads/upload.js';
import { decide } from './ux/spending.js';
import { loadSettings, saveSettings, settingsKey } from './settings.js';
import { hostToolSet, type ChatTool } from './tools/host.js';
import { StreamingTranscript } from './voice/streaming-transcript.js';
import { voiceLanguage } from './voice/languages.js';
import { transcribe } from './voice/transcribe.js';

/** Jobs still waiting for a click are offered again only in the most recent turns. */
const REOFFER_TURNS = 3;

export interface PendingUpload {
  key: string;
  file: File;
  progress: number;
  attachment?: Attachment;
  error?: string;
}

export interface SessionOptions {
  /** Keeps an embedding app's conversations and preferences apart from the rest. */
  scope?: string;
  /** Tools the embedding page offers; read at the start of every reply. */
  hostTools?(): Record<string, ChatTool>;
  hostInstructions?(): string | undefined;
  /** Which MCP servers the assistant may use; both are on unless switched off. */
  mcp?(): { orchestration?: boolean; site?: boolean };
  /** Replaces the built-in persona and rules, or edits them. */
  systemPrompt?(): string | ((defaults: string) => string) | undefined;
  /** How an ask panel's button reaches the assistant: sent as the viewer, or put in the message box. */
  ask?(message: string, refs: string[]): void;
  compose?(message: string, refs: string[]): void;
}

/** Everything one signed-in viewer's chat needs, wired once. */
export class ChatSession extends EventTarget {
  readonly app: AppClient;
  readonly api: OrchestrationApi;
  /** The viewer's free allowance for chat replies. */
  readonly freeTier: FreeTier;
  readonly orchestrationMcp: McpConnection;
  readonly siteMcp: McpConnection;
  readonly jobs: JobManager;
  readonly posts: PostManager;
  readonly panels: PanelManager;
  readonly store: ThreadStore;
  readonly agent: Agent;
  settings: Settings;

  #orchestrationTools: Promise<McpTool[]> | null = null;
  #siteTools: Promise<McpTool[] | null> | null = null;
  #options: SessionOptions;
  #hostToolNames = new Set<string>();
  #models = new Map<string, LanguageModel>();
  /** What the run tools can do, from the latest catalog; panels run through them. */
  #runTools = new Map<string, JobToolInfo>();

  constructor(app: AppClient, options: SessionOptions = {}) {
    super();
    this.app = app;
    this.#options = options;
    this.settings = loadSettings(settingsKey(options.scope));
    this.api = createOrchestrationApi(app);
    this.freeTier = new FreeTier(() => this.api.getFreeTier());
    this.orchestrationMcp = createMcpConnection({ url: chatConfig.orchestrationMcpUrl, token: () => app.getToken() });
    this.siteMcp = createMcpConnection({ url: chatConfig.siteMcpUrl });
    // The site MCP's browse tools are anonymous; posting goes as the viewer, so it carries their token.
    const poster = sitePoster(createMcpConnection({ url: chatConfig.siteMcpUrl, token: () => app.getToken() }));
    this.posts = new PostManager({
      host: postHostOf(app),
      site: () => (this.#options.mcp?.().site === false ? null : poster),
      authorize: () => app.requestGrants(['posts:write:self']),
      saved: (post) => {
        const saved = post.toSaved();
        if (saved) void this.store.savePost(post.id, saved).catch((error: unknown) => console.warn('[chat-cvt] could not record the post', error));
      },
    });
    this.jobs = new JobManager({
      api: this.api,
      cancelWorkflow: (id) => app.orchestration.cancelWorkflow(id),
      mcp: this.orchestrationMcp,
      resolveArgs: (args) => this.resolveArgs(args),
      decide: (price) => decide(price, this.settings.autoRunLimit),
      hideMatureContent: () => !this.settings.allowMature,
      findWorkflows: async (tags) =>
        (await app.orchestration.queryWorkflows({ tags, take: 10 })).items,
    });
    this.panels = new PanelManager({
      jobs: this.jobs,
      toolInfo: (name) => this.#runTools.get(name),
      save: (panel) => void this.store.savePanel(panel).catch((error: unknown) => console.warn('[chat-cvt] could not save the panel', error)),
      ...(options.ask ? { ask: options.ask } : {}),
      ...(options.compose ? { compose: options.compose } : {}),
    });
    this.store = new ThreadStore({
      orchestration: app.orchestration,
      api: this.api,
      hideMatureContent: () => !this.settings.allowMature,
      scope: options.scope,
    });
    this.agent = new Agent({
      model: () => this.#model(this.settings.assistantModel?.trim() || chatConfig.model),
      titleModel: () => this.#model(chatConfig.model),
      store: this.store,
      jobs: this.jobs,
      posts: this.posts,
      toolSet: (turn) => this.#toolSet(turn),
      attachments: () => this.attachments(),
      customInstructions: () => this.settings.customInstructions,
      hostInstructions: () => this.#options.hostInstructions?.(),
      isHostTool: (name) => this.#hostToolNames.has(name),
      panels: () => this.panels.context(),
      systemPrompt: () => this.#options.systemPrompt?.(),
    });
  }

  /** Read at every turn, so switching a server on or off applies from the next reply. */
  async catalog(): Promise<ToolCatalog> {
    const { orchestration = true, site = true } = this.#options.mcp?.() ?? {};
    const [orchestrationTools, siteTools] = await Promise.all([
      orchestration ? this.#loadOrchestration() : [],
      site ? (this.#siteTools ??= loadSiteTools(this.siteMcp)) : [],
    ]);
    this.#runTools = new Map(orchestrationTools.filter((tool) => isJobTool(tool.name)).map((tool) => [tool.name, toolInfo(tool.name, tool.inputSchema)]));
    return { orchestration: orchestrationTools, site: siteTools };
  }

  #loadOrchestration(): Promise<McpTool[]> {
    this.#orchestrationTools ??= loadOrchestrationTools(this.orchestrationMcp).catch((error: unknown) => {
      this.#orchestrationTools = null;
      throw error;
    });
    return this.#orchestrationTools;
  }

  #model(id: string): LanguageModel {
    let model = this.#models.get(id);
    if (!model) {
      const wrap = (inner: typeof fetch) =>
        freeTierFetch(inner, id, this.freeTier, () => {
          const tier = this.settings.assistantTier ?? 'auto';
          return { useFree: tier !== 'paid', payWhenOut: tier !== 'free' };
        });
      this.#models.set(id, (model = createAssistantModel(this.app, { model: id, wrap })));
    }
    return model;
  }

  updateSettings(patch: Partial<Settings>): void {
    this.settings = { ...this.settings, ...patch };
    saveSettings(this.settings, settingsKey(this.#options.scope));
    this.dispatchEvent(new Event('settings-change'));
  }

  /** Uploads of every turn, then everything each job made, in conversation order. */
  attachments(): Attachment[] {
    const conversation = this.store.current;
    if (!conversation) return [];
    const byJob = new Map<number, GenerationJob[]>();
    for (const job of this.jobs.all()) byJob.set(job.seq, [...(byJob.get(job.seq) ?? []), job]);
    return conversation.turns.flatMap((turn) => [
      ...turn.user.attachments,
      ...(byJob.get(turn.seq) ?? []).sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true })).flatMap((job) => job.results),
    ]);
  }

  findAttachment(id: string): Attachment | undefined {
    return this.attachments().find((attachment) => attachment.id === id);
  }

  /** How a result was made; `null` for uploads. */
  detailsFor(attachment: Attachment): GenerationDetails | null {
    if (attachment.source.type !== 'result') return null;
    const job = this.jobs.get(attachment.source.job);
    if (!job) return null;
    const { path } = attachment.source;
    const media = job.media.find((item) => item.path === path);
    return this.jobDetails(job, media?.stepName, { width: attachment.width, height: attachment.height });
  }

  /** What a job is making, from the step that makes it: the last one of a chain. */
  jobDetails(job: GenerationJob, stepName = job.workflow?.steps.at(-1)?.name ?? undefined, size?: { width?: number; height?: number }): GenerationDetails {
    const steps = job.args.steps as { $type?: string; input?: Record<string, unknown> }[] | undefined;
    const last = Array.isArray(steps) ? steps.at(-1) : undefined;
    const input = (job.args.input as Record<string, unknown> | undefined) ?? last?.input;
    const requested = input ? { ...input, stepType: job.args.stepType ?? last?.$type } : undefined;
    return generationDetails(job.workflow, stepName, requested, size);
  }

  resolveArgs(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    return resolveAttachmentArgs(args, (id) => this.findAttachment(id), (attachment) => this.refreshUrl(attachment));
  }

  async refreshUrl(attachment: Attachment): Promise<string | undefined> {
    if (attachment.source.type === 'upload') {
      attachment.url = await this.api.refreshBlobUrl(attachment.source.blobId);
      return attachment.url;
    }
    const job = this.jobs.get(attachment.source.job);
    if (!job?.workflowId) return undefined;
    job.apply(await this.api.getWorkflow(job.workflowId, { hideMatureContent: !this.settings.allowMature }));
    return job.results.find((result) => result.id === attachment.id)?.url;
  }

  async openConversation(id: string): Promise<void> {
    this.agent.abort();
    this.jobs.clear();
    this.posts.clear();
    this.panels.clear();
    const [opened, catalog] = await Promise.all([this.store.open(id), this.catalog().catch(() => null)]);
    this.#rebuildJobs(opened, catalog);
    this.#rebuildPosts(opened);
    this.panels.restore(opened.conversation.id, opened.conversation.panels, new Map(opened.jobs.filter(({ metadata }) => metadata.panel).map(({ metadata, workflow }) => [metadata.job, workflow])));
    this.updateSettings({ lastConversationId: id });
  }

  newConversation(): void {
    this.agent.abort();
    this.jobs.clear();
    this.posts.clear();
    this.panels.clear();
    this.store.startNew();
  }

  async upload(pending: PendingUpload, onChange: () => void): Promise<void> {
    try {
      const [blob, info] = await Promise.all([
        uploadFile({ api: this.api }, pending.file, {
          onProgress: (fraction) => {
            pending.progress = fraction;
            onChange();
          },
        }),
        probeMedia(pending.file),
      ]);
      pending.attachment = uploadAttachment('', pending.file, blob, info);
    } catch (error) {
      pending.error = (error as Error).message;
    }
    onChange();
  }

  /** Billed per second of audio sent, unlike `transcribe`, which bills per call. */
  liveTranscript(onChange: () => void): StreamingTranscript {
    const language = voiceLanguage(this.settings.voiceLanguage);
    return new StreamingTranscript(
      {
        open: async (input) => {
          const workflow = await this.app.orchestration.submitWorkflow({ steps: [{ $type: 'liveTranscription', input }] } as never);
          const output = (workflow.steps?.[0] as { output?: { inputUrl?: string; transcriptUrl?: string } } | undefined)?.output;
          if (!workflow.id || !output?.inputUrl || !output.transcriptUrl) throw new Error('Live transcription did not start.');
          return { workflowId: workflow.id, inputUrl: output.inputUrl, transcriptUrl: output.transcriptUrl };
        },
        cancel: (id) => this.app.orchestration.cancelWorkflow(id),
        language,
      },
      onChange,
    );
  }

  /** About 1 Buzz per call, whatever the length. */
  transcribe(recording: Blob, signal?: AbortSignal): Promise<string> {
    return transcribe({ api: this.api, mcp: this.orchestrationMcp }, recording, signal, voiceLanguage(this.settings.voiceLanguage));
  }

  async send(text: string, uploads: PendingUpload[] = [], refs: string[] = []): Promise<void> {
    const conversation = this.store.current ?? this.store.startNew();
    const seq = (conversation.turns.at(-1)?.seq ?? 0) + 1;
    const attachments = uploads
      .filter((pending) => pending.attachment)
      .map((pending, index) => ({ ...pending.attachment!, id: uploadId(seq, index + 1) }));
    if (conversation.turns.length === 0) this.updateSettings({ lastConversationId: conversation.id });
    await this.agent.send(text, attachments, refs);
  }

  /**
   * Starts a conversation with a panel someone shared, as if the assistant had just built it, so the
   * viewer can run it and ask for changes. Free: no assistant reply runs until they write.
   */
  async openShared(shared: SharedPanel): Promise<void> {
    this.newConversation();
    const turn = this.store.appendUserTurn(`Opened a shared panel: ${shared.spec.title}`, []);
    const conversation = this.store.current!;
    conversation.title = shared.spec.title;
    conversation.titleSource = 'llm';
    this.#placePanel(turn, `shared-${conversation.id}`, shared.spec, shared.values, { id: shared.id, version: shared.version });
    this.updateSettings({ lastConversationId: conversation.id });
    await this.store.completeTurn(turn);
  }

  /**
   * Turns a generation into a panel to tweak and rerun: its prompt, and its model beside similar ones,
   * each priced as it is picked. Made by the app, not the assistant, so it costs nothing and always works.
   */
  async adjust(job: GenerationJob): Promise<boolean> {
    if (this.agent.running || !this.store.current) return false;
    const built = await adjustPanel(job.tool.name, job.args, { mcp: this.orchestrationMcp, resolveArgs: (args) => this.resolveArgs(args) }, job.subject);
    if (!built) return false;
    const turn = this.store.appendUserTurn(`Adjust ${job.subject.toLowerCase()}`, []);
    this.#placePanel(turn, `adjust-${job.id}-${turn.seq}`, built.spec, built.values);
    // The panel replaces a request still waiting for the viewer's OK.
    job.decline();
    await this.store.completeTurn(turn);
    return true;
  }

  // Recorded as an assistant open_panel call so the thread, saving and the assistant need no special case.
  #placePanel(turn: Turn, toolCallId: string, spec: PanelSpec, values: PanelValues, forkedFrom?: { id: string; version: number }): void {
    const panel = this.panels.open({ conversationId: this.store.current!.id, seq: turn.seq, toolCallId, spec, values, ...(forkedFrom ? { forkedFrom } : {}) });
    turn.assistant.messages = [
      { role: 'assistant', content: [{ type: 'tool-call', toolCallId, toolName: OPEN_PANEL, input: { ...spec, values: panel.values } }] },
      { role: 'tool', content: [{ type: 'tool-result', toolCallId, toolName: OPEN_PANEL, output: { type: 'json', value: panel.summary() as never } }] },
    ];
    turn.assistant.status = 'done';
  }

  async #toolSet(turn: { conversationId: string; seq: number }): Promise<ToolSet> {
    const builtIn = await this.#builtInTools(turn);
    const host = hostToolSet(this.#options.hostTools?.() ?? {}, builtIn, {
      conversationId: turn.conversationId,
      findAttachment: (id) => this.findAttachment(id),
      resolveArgs: (args) => this.resolveArgs(args),
    });
    this.#hostToolNames = new Set(Object.keys(host));
    return { ...builtIn, ...host };
  }

  async #builtInTools(turn: { conversationId: string; seq: number }): Promise<ToolSet> {
    return buildToolSet(await this.catalog(), {
      ...turn,
      jobs: this.jobs,
      orchestration: this.orchestrationMcp,
      site: this.siteMcp,
      siteApi: this.app.site,
      posts: this.posts,
      panels: this.panels,
      findAttachment: (id) => this.findAttachment(id),
      resolveArgs: (args) => this.resolveArgs(args),
      onCaption: (id, caption) => {
        const attachment = this.store.current?.turns.flatMap((t) => t.user.attachments).find((a) => a.id === id);
        if (attachment) attachment.caption = caption.slice(0, 600);
      },
    });
  }

  #rebuildPosts({ conversation }: OpenedConversation): void {
    for (const turn of conversation.turns) {
      for (const part of partsFromMessages(turn.assistant.messages)) {
        if (part.kind !== 'tool' || part.toolName !== POST_TOOL || part.state !== 'done') continue;
        const input = (part.input ?? {}) as { files?: string[]; title?: string; description?: string; tags?: string[] };
        const items = (input.files ?? []).flatMap((id) => this.findAttachment(id) ?? []);
        if (items.length === 0) continue;
        this.posts.create({
          id: part.toolCallId,
          items,
          title: input.title,
          detail: input.description,
          tags: input.tags,
          saved: conversation.posts?.[part.toolCallId],
        });
      }
    }
  }

  #rebuildJobs(opened: OpenedConversation, catalog: ToolCatalog | null): void {
    const { conversation, jobs } = opened;
    const workflows = new Map(jobs.map(({ metadata, workflow }) => [metadata.job, workflow]));
    const lastSeq = conversation.turns.at(-1)?.seq ?? 0;
    for (const turn of conversation.turns) {
      for (const part of partsFromMessages(turn.assistant.messages)) {
        if (part.kind !== 'tool' || !isJobTool(part.toolName)) continue;
        const output = part.output as { job?: unknown; status?: unknown; estimatedBuzz?: unknown } | undefined;
        if (typeof output?.job !== 'string') continue;
        const schema = catalog?.orchestration.find((tool) => tool.name === part.toolName)?.inputSchema ?? {};
        const job = this.jobs.create({
          id: output.job,
          conversationId: conversation.id,
          seq: turn.seq,
          toolCallId: part.toolCallId,
          tool: toolInfo(part.toolName, schema),
          args: (part.input ?? {}) as Record<string, unknown>,
        });
        const workflow = workflows.get(output.job);
        if (workflow) {
          job.resume(workflow);
          continue;
        }
        const price = typeof output.estimatedBuzz === 'number' ? { total: output.estimatedBuzz, variable: false } : null;
        job.restore(restoredState(output.status, lastSeq - turn.seq < REOFFER_TURNS), price);
      }
    }
  }
}

function restoredState(status: unknown, recent: boolean): JobState {
  switch (status) {
    case 'awaiting_confirmation':
    case 'pricing':
      return recent ? 'awaiting_confirmation' : 'declined';
    case 'rejected':
    case 'declined':
      return status;
    default:
      // It ran, but its workflow was never found: an interrupted submit or an expired one.
      return 'expired';
  }
}

/** Only a block framed in civitai.com has a host, and only an SDK with `createPost` can post through it. */
function postHostOf(app: AppClient): PostHost | null {
  const host = (app as { host?: Partial<PostHost> }).host;
  return typeof host?.createPost === 'function' ? (host as PostHost) : null;
}
