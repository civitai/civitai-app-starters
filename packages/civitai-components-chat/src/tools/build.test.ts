import type { SiteClient } from '@civitai/sdk';
import { describe, expect, it, vi } from 'vitest';

import orchestrationFixture from '../test-fixtures/orchestration-tools.json' with { type: 'json' };
import siteFixture from '../test-fixtures/site-tools.json' with { type: 'json' };
import type { McpConnection, McpTool } from '../mcp/clients.js';
import { JobManager } from '../orchestration/jobs.js';
import { PanelManager } from '../panels/panel.js';
import { PostManager } from '../posting/post.js';
import { toolResult } from '../test-support/fakes.js';
import { buildToolSet, type TurnToolContext } from './build.js';
import { ALLOWED_SITE_TOOLS, DENIED_ORCHESTRATION_TOOLS, withoutControls, type ToolCatalog } from './catalog.js';

const orchestrationTools = orchestrationFixture.tools as McpTool[];
const siteTools = siteFixture.tools as McpTool[];

function catalog(site: McpTool[] | null = siteTools.filter((t) => ALLOWED_SITE_TOOLS.has(t.name))): ToolCatalog {
  return { orchestration: orchestrationTools.filter((t) => !DENIED_ORCHESTRATION_TOOLS.has(t.name)), site };
}

function context(overrides: Partial<TurnToolContext> = {}) {
  const connection = (): McpConnection => ({
    url: 'x',
    listTools: vi.fn(),
    callTool: vi.fn(async () => toolResult({ models: [{ id: 5, name: 'Anime Lora', type: 'LORA', air: [{ versionId: 6, air: 'urn:air:sdxl:lora:civitai:5@6' }] }] }, 'Found 1 model(s)')),
    close: vi.fn(),
  });
  const jobs = new JobManager({
    api: { getWorkflow: vi.fn(), watchWorkflow: vi.fn(), addTag: vi.fn(), updateWorkflow: vi.fn() } as never,
    cancelWorkflow: vi.fn(),
    mcp: { callTool: vi.fn(async () => toolResult({ workflowId: '7-20260923120000000', cost: { total: 1, variable: false } })) },
    resolveArgs: async (args) => args,
    decide: () => 'confirm',
    findWorkflows: vi.fn(async () => []),
    hideMatureContent: () => true,
  });
  const ctx: TurnToolContext = {
    conversationId: 'C1',
    seq: 4,
    jobs,
    orchestration: connection(),
    site: connection(),
    siteApi: { get: vi.fn(async () => ({ items: [{ id: 9, name: 'Real Vision', type: 'Checkpoint', modelVersions: [{ id: 10, baseModel: 'SDXL 1.0' }] }] })) } as unknown as SiteClient,
    posts: new PostManager({ host: { createPost: vi.fn() }, authorize: async () => true, saved: vi.fn() }),
    findAttachment: (id) =>
      id === 'gen1-1-1'
        ? { id, kind: 'image', source: { type: 'result', workflowId: 'w', job: 'gen1-1', path: 'output.images[0]' } }
        : id === 'up1-1'
          ? { id, kind: 'image', source: { type: 'upload', blobId: 'b' } }
          : undefined,
    resolveArgs: vi.fn(async (args) => ({ ...args, mediaUrl: args.mediaUrl === 'up1-1' ? 'https://x/photo' : args.mediaUrl })),
    onCaption: vi.fn(),
    ...overrides,
  };
  return ctx;
}

const run = (tool: unknown, input: unknown, toolCallId = 'call') =>
  (tool as { execute: (input: unknown, opts: unknown) => Promise<unknown> }).execute(input, { toolCallId, messages: [] });

describe('buildToolSet', () => {
  it('offers the MCP tools as the servers define them, minus the ones the app owns, plus ask_choice', () => {
    const tools = buildToolSet(catalog(), context());
    const names = Object.keys(tools);
    expect(names).toEqual(
      expect.arrayContaining(['run_step', 'run_workflow', 'find_services', 'get_input_schema', 'get_guide', 'caption_media', 'search_models', 'get_model', 'ask_choice']),
    );
    for (const denied of ['get_workflow', 'cancel_workflow', 'list_workflows']) {
      expect(names).not.toContain(denied);
    }
    expect(names).not.toContain('create_post');
  });

  it('offers panels only when it can run steps and the chat has somewhere to keep them', () => {
    const panels = new PanelManager({ jobs: context().jobs, toolInfo: () => undefined, save: vi.fn() });
    expect(Object.keys(buildToolSet(catalog(), context({ panels })))).toEqual(expect.arrayContaining(['open_panel', 'update_panel']));
    expect(Object.keys(buildToolSet(catalog(), context()))).not.toContain('open_panel');
    const withoutRuns = { ...catalog(), orchestration: catalog().orchestration.filter((t) => !t.name.startsWith('run_')) };
    expect(Object.keys(buildToolSet(withoutRuns, context({ panels })))).not.toContain('open_panel');
  });

  it('offers a post for the user to confirm instead of posting it, for pictures this chat made', async () => {
    const ctx = context();
    const tools = buildToolSet(catalog(), ctx);
    const result = await run(tools.post_to_civitai, { files: ['gen1-1-1'], title: 'Red bike' }, 'call-post');
    expect(result).toMatchObject({ status: 'awaiting_user' });
    expect(ctx.posts.get('call-post')).toMatchObject({ title: 'Red bike', state: 'ready', items: [{ id: 'gen1-1-1' }] });
    expect(await run(tools.post_to_civitai, { files: ['gen9-9-9'] })).toMatchObject({ error: expect.stringContaining('gen9-9-9') });
    expect(await run(tools.post_to_civitai, { files: ['up1-1'] })).toMatchObject({ error: expect.stringContaining('up1-1') });
  });

  it('does not offer posting outside civitai.com', () => {
    const ctx = context({ posts: new PostManager({ host: null, authorize: async () => true, saved: vi.fn() }) });
    expect(Object.keys(buildToolSet(catalog(), ctx))).not.toContain('post_to_civitai');
  });

  it('hides the parameters the app sets on generation tools', () => {
    const schema = withoutControls({
      $schema: 'x',
      type: 'object',
      properties: { prompt: { type: 'string' }, whatif: {}, waitForCompletion: {}, tags: {}, metadataJson: {} },
      required: ['prompt', 'whatif'],
    });
    expect(schema).toEqual({ type: 'object', properties: { prompt: { type: 'string' } }, required: ['prompt'] });
  });

  it('starts runs as jobs numbered in call order, named for what they make, and answers without waiting for them', async () => {
    const ctx = context();
    const tools = buildToolSet(catalog(), ctx);
    const video = { $type: 'videoGen', input: { engine: 'wan', prompt: 'it rides away', images: ['gen4-1-1'] } };
    const [first, second] = await Promise.all([
      run(tools.run_step, { stepType: 'imageGen', input: { engine: 'sdcpp', prompt: 'a red bike' } }, 'call_a'),
      run(tools.run_workflow, { steps: [{ $type: 'imageGen', input: { prompt: 'a red bike' }, name: 'still' }, video] }, 'call_b'),
    ]);
    expect(first).toMatchObject({ job: 'gen4-1', status: 'awaiting_confirmation', estimatedBuzz: 1 });
    expect(second).toMatchObject({ job: 'gen4-2' });
    expect(ctx.jobs.get('gen4-1')?.label).toBe('Making your picture');
    expect(ctx.jobs.get('gen4-2')).toMatchObject({ toolCallId: 'call_b', seq: 4, label: 'Making your video' });
  });

  it('hands a refused request back to the assistant to fix, leaving no card', async () => {
    const refusal = "JSON deserialization for type 'ComfySdxlCreateImageGenInput' was missing required properties including: 'model'.";
    const jobs = new JobManager({
      api: {} as never,
      cancelWorkflow: vi.fn(),
      mcp: { callTool: vi.fn(async () => toolResult(undefined, refusal, true)) },
      resolveArgs: async (args) => args,
      decide: () => 'confirm',
      findWorkflows: vi.fn(async () => []),
      hideMatureContent: () => true,
    });
    const tools = buildToolSet(catalog(), context({ jobs }));
    const result = await run(tools.run_step, { stepType: 'imageGen', input: { engine: 'comfy', ecosystem: 'sdxl', operation: 'createImage', prompt: 'a cat' } });
    expect(result).toMatchObject({ error: expect.stringContaining("'model'"), note: expect.stringContaining('Fix the input') });
    expect(jobs.all()).toEqual([]);
  });

  it('passes other tools through with attachment ids resolved, remembering captions of uploads', async () => {
    const ctx = context();
    const tools = buildToolSet(catalog(), ctx);
    await run(tools.caption_media, { mediaUrl: 'up1-1' });
    expect(ctx.orchestration.callTool).toHaveBeenCalledWith('caption_media', { mediaUrl: 'https://x/photo' }, expect.anything());
    expect(ctx.onCaption).toHaveBeenCalledWith('up1-1', 'Found 1 model(s)');
  });

  it('returns model recommendations alongside the text for model search', async () => {
    const tools = buildToolSet(catalog(), context());
    expect(await run(tools.search_models, { query: 'anime' })).toEqual({
      text: 'Found 1 model(s)',
      models: [{ id: 5, name: 'Anime Lora', type: 'LORA', air: 'urn:air:sdxl:lora:civitai:5@6' }],
    });
  });

  it('searches through the public API when the site MCP cannot be reached', async () => {
    const ctx = context();
    const tools = buildToolSet(catalog(null), ctx);
    expect(Object.keys(tools)).not.toContain('get_model');
    const result = (await run(tools.search_models, { query: 'realistic', type: 'Checkpoint' })) as { models: unknown[] };
    expect(ctx.siteApi.get).toHaveBeenCalledWith('models', expect.objectContaining({ query: expect.objectContaining({ query: 'realistic', types: 'Checkpoint', supportsGeneration: 'true' }) }));
    expect(result.models).toEqual([{ id: 9, name: 'Real Vision', type: 'Checkpoint', air: 'urn:air:sdxl:checkpoint:civitai:9@10' }]);
  });
});

describe('fetch_page', () => {
  const FETCH_PAGE: McpTool = { name: 'fetch_page', description: 'Read a web page.', inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } };
  const withFetch = (): ToolCatalog => ({ ...catalog(), orchestration: [...catalog().orchestration, FETCH_PAGE] });
  // 7,178 characters, as the onboarding page the eval read; its end is what a 4,000 cut lost.
  const PAGE = `# Build an app\n${'Step text that matters. '.repeat(298)}\nLAST LINE: run civitai app submit`.slice(0, 7_178);

  it('reads a whole page of up to 16,000 characters', async () => {
    expect(PAGE.length).toBe(7_178);
    const ctx = context({ orchestration: { url: 'x', listTools: vi.fn(), close: vi.fn(), callTool: vi.fn(async () => toolResult(undefined, PAGE)) } });
    const tools = buildToolSet(withFetch(), ctx);
    expect(await run(tools.fetch_page, { url: 'https://developer.example/apps' })).toBe(PAGE);
  });

  it('says how much of a longer page, or another tool’s long reply, was left out', async () => {
    const long = 'x'.repeat(16_500);
    const ctx = context({ orchestration: { url: 'x', listTools: vi.fn(), close: vi.fn(), callTool: vi.fn(async () => toolResult(undefined, long)) } });
    const tools = buildToolSet(withFetch(), ctx);
    expect(await run(tools.fetch_page, { url: 'https://developer.example/long' })).toBe(`${'x'.repeat(16_000)}\n…(500 more characters not shown)`);
    expect(await run(tools.get_guide, {})).toBe(`${'x'.repeat(4_000)}\n…(12500 more characters not shown)`);
  });

  it('fetches a page once per chat, however often it is asked for, and again in another chat', async () => {
    const callTool = vi.fn(async () => toolResult(undefined, PAGE));
    const orchestration: McpConnection = { url: 'x', listTools: vi.fn(), close: vi.fn(), callTool };
    const first = buildToolSet(withFetch(), context({ conversationId: 'cache-1', orchestration }));
    expect(await run(first.fetch_page, { url: 'https://developer.example/apps' })).toBe(PAGE);
    // The next reply builds its tools again; the same page, spelled with a fragment and a capital host.
    const second = buildToolSet(withFetch(), context({ conversationId: 'cache-1', orchestration, seq: 5 }));
    expect(await run(second.fetch_page, { url: 'https://DEVELOPER.example/apps#start' })).toBe(`(Already fetched in this chat; same content.)\n\n${PAGE}`);
    expect(callTool).toHaveBeenCalledTimes(1);

    const other = buildToolSet(withFetch(), context({ conversationId: 'cache-2', orchestration }));
    await run(other.fetch_page, { url: 'https://developer.example/apps' });
    await run(other.fetch_page, { url: 'https://developer.example/other' });
    expect(callTool).toHaveBeenCalledTimes(3);
  });

  it('shares one fetch between two calls of the same step, and asks again after a failure', async () => {
    let fail = true;
    const callTool = vi.fn(async () => (fail ? toolResult(undefined, 'upstream 502', true) : toolResult(undefined, PAGE)));
    const tools = buildToolSet(withFetch(), context({ conversationId: 'cache-3', orchestration: { url: 'x', listTools: vi.fn(), close: vi.fn(), callTool } }));
    expect(await run(tools.fetch_page, { url: 'https://developer.example/apps' })).toMatchObject({ error: 'upstream 502' });
    fail = false;
    const both = await Promise.all([run(tools.fetch_page, { url: 'https://developer.example/apps' }), run(tools.fetch_page, { url: 'https://developer.example/apps' })]);
    expect(both).toEqual([PAGE, `(Already fetched in this chat; same content.)\n\n${PAGE}`]);
    expect(callTool).toHaveBeenCalledTimes(2);
  });

  it('never caches another tool', async () => {
    const callTool = vi.fn(async () => toolResult(undefined, 'guide'));
    const tools = buildToolSet(withFetch(), context({ conversationId: 'cache-4', orchestration: { url: 'x', listTools: vi.fn(), close: vi.fn(), callTool } }));
    await run(tools.get_guide, { topic: 'a' });
    await run(tools.get_guide, { topic: 'a' });
    expect(callTool).toHaveBeenCalledTimes(2);
  });
});
