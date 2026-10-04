import type { Workflow } from '@civitai/sdk';
import { describe, expect, it, vi } from 'vitest';

import { toolInfo } from '../orchestration/job.js';
import { JobManager } from '../orchestration/jobs.js';
import { controllable, flush, imageStep, toolResult, workflow } from '../test-support/fakes.js';
import { PanelManager, type SavedPanel } from './panel.js';
import { OPEN_PANEL, UPDATE_PANEL, panelTools } from './tools.js';

const RUN_STEP_SCHEMA = { properties: { stepType: {}, input: {}, whatif: {}, waitForCompletion: {}, tags: {}, metadataJson: {} } };

const LOGO = {
  title: 'Logo maker',
  inputs: {
    brand: { kind: 'text', label: 'Brand name', required: true },
    style: { kind: 'choice', options: ['Minimal mark', 'Mascot'] },
    seed: { kind: 'seed' },
  },
  run: { stepType: 'imageGen', input: { prompt: 'logo for {{brand}}, {{style}}', seed: '{{seed}}' } },
};

function setup({ refuse = false } = {}) {
  const asked: { message: string; refs: string[] }[] = [];
  const composed: { message: string; refs: string[] }[] = [];
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const feed = controllable<Workflow>();
  const jobs = new JobManager({
    api: { getWorkflow: vi.fn(), watchWorkflow: vi.fn(() => feed.iterate()), addTag: vi.fn(), updateWorkflow: vi.fn() } as never,
    cancelWorkflow: vi.fn(),
    mcp: {
      callTool: vi.fn(async (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        if (refuse) return toolResult(undefined, 'input.prompt: required', true);
        if (args.whatif) return toolResult({ cost: { total: 12, variable: false }, insufficientBuzz: false });
        return toolResult({ workflowId: `7-${calls.length}` });
      }),
    },
    resolveArgs: async (args) => args,
    decide: () => 'confirm',
    findWorkflows: vi.fn(async () => []),
    hideMatureContent: () => true,
  });
  const saved: SavedPanel[] = [];
  const panels = new PanelManager({
    jobs,
    toolInfo: (name) => (name === 'run_step' ? toolInfo(name, RUN_STEP_SCHEMA) : undefined),
    save: (panel) => saved.push(panel),
    ask: (message, refs) => asked.push({ message, refs }),
    compose: (message, refs) => composed.push({ message, refs }),
    random: () => 0.25,
    newId: () => 'PANEL-ULID',
  });
  const tools = panelTools({ conversationId: 'C1', seq: 2, panels });
  const call = (name: string, input: unknown, toolCallId = 'call_1') =>
    (tools[name] as unknown as { execute: (input: unknown, opts: unknown) => Promise<Record<string, unknown>> }).execute(input, { toolCallId, messages: [] });
  return { panels, jobs, calls, saved, call, feed, asked, composed };
}

describe('panels', () => {
  it('opens a panel once a free price check accepts it, and tells the assistant its handle and price', async () => {
    const { panels, calls, saved, call } = setup();
    const result = await call(OPEN_PANEL, { ...LOGO, values: { brand: 'Night Owl' } });

    expect(calls).toEqual([{ name: 'run_step', args: { stepType: 'imageGen', input: { prompt: 'logo for Night Owl, Minimal mark', seed: 536870911 }, whatif: true } }]);
    expect(result).toMatchObject({ panel: 'p1', version: 1, estimatedBuzz: 12, values: { brand: 'Night Owl', style: 'Minimal mark', seed: -1 } });
    expect(panels.get('p1')?.toolCallId).toBe('call_1');
    expect(saved.at(-1)).toMatchObject({ v: 1, id: 'PANEL-ULID', handle: 'p1', seq: 2, versions: [{ title: 'Logo maker' }], runs: [] });
  });

  it('shows nothing when the service refuses the run, and hands the reason back to the assistant', async () => {
    const { panels, call } = setup({ refuse: true });
    const result = await call(OPEN_PANEL, LOGO);
    expect(result.error).toContain('input.prompt: required');
    expect(panels.all()).toEqual([]);
  });

  it("runs the user's values straight through the orchestrator, tagged as the panel's, keeping the seed it used", async () => {
    const { panels, calls, saved, call, feed } = setup();
    await call(OPEN_PANEL, { ...LOGO, values: { brand: 'Night Owl', style: 'Mascot' } });
    const panel = panels.get('p1')!;

    const job = await panel.run();
    expect(job?.state).toBe('running');
    const submit = calls.at(-1)!;
    expect(submit.args).toMatchObject({ stepType: 'imageGen', input: { prompt: 'logo for Night Owl, Mascot', seed: 536870911 }, waitForCompletion: false, tags: ['chat-cvt', 'cvt:job', 'cvt:conv:C1'] });
    expect(JSON.parse(submit.args.metadataJson as string)).toMatchObject({ job: 'p1-1', panel: 'p1', tool: 'run_step' });
    expect(saved.at(-1)?.runs).toEqual([{ job: 'p1-1', version: 1, values: { brand: 'Night Owl', style: 'Mascot', seed: 536870911 } }]);

    feed.push(workflow({ id: '7-3', status: 'succeeded', steps: [imageStep([{ id: 'i', url: 'https://x/logo.png' }])] as never }));
    await flush();
    expect(job?.results.map((r) => r.id)).toEqual(['p1-1-1']);
    expect(panels.context()).toContain('p1-1 (version 1) succeeded → p1-1-1');
    expect(panels.context()).toContain('Price per run with these values: about 12 Buzz, quoted by the service');
  });

  it('waits for required inputs before it can run', async () => {
    const { panels, call } = setup();
    await call(OPEN_PANEL, LOGO);
    const panel = panels.get('p1')!;
    expect(panel.missing).toEqual(['Brand name']);
    expect(await panel.run()).toBeUndefined();
    panel.setValue('brand', 'Crumbs');
    expect(panel.canRun).toBe(true);
  });

  it('turns a change into a new version that keeps the values still fitting and moves the panel to that call', async () => {
    const { panels, call } = setup();
    await call(OPEN_PANEL, { ...LOGO, values: { brand: 'Night Owl', style: 'Mascot' } });
    const result = await call(
      UPDATE_PANEL,
      {
        panel: 'p1',
        inputs: { palette: { kind: 'choice', options: ['Warm', 'Cool'] } },
        run: { stepType: 'imageGen', input: { prompt: 'logo for {{brand}}, {{style}}, {{palette}} colors', seed: '{{seed}}' } },
        values: { palette: 'Cool' },
      },
      'call_2',
    );

    expect(result).toMatchObject({ panel: 'p1', version: 2, values: { brand: 'Night Owl', style: 'Mascot', palette: 'Cool' } });
    expect(panels.get('p1')).toMatchObject({ toolCallId: 'call_2', version: 2 });
    expect(await call(UPDATE_PANEL, { panel: 'p1', inputs: { mood: { kind: 'toggle' } } }, 'call_3')).toMatchObject({ error: expect.stringContaining('mood are not used') });
    expect(panels.get('p1')).toMatchObject({ toolCallId: 'call_2', version: 2 });
  });

  it('brings a panel and its runs back after a reload, watching a run still going', () => {
    const { panels, jobs } = setup();
    const saved: SavedPanel = {
      v: 1,
      id: 'PANEL-ULID',
      handle: 'p1',
      seq: 2,
      toolCallId: 'call_1',
      versions: [{ title: 'Logo maker', inputs: { brand: { kind: 'text' } }, run: { stepType: 'imageGen', input: { prompt: '{{brand}}' } } }],
      values: { brand: 'Crumbs' },
      runs: [
        { job: 'p1-1', version: 1, values: { brand: 'Night Owl' } },
        { job: 'p1-2', version: 1, values: { brand: 'Crumbs' } },
      ],
    };
    panels.restore('C1', { p1: saved }, new Map([['p1-1', workflow({ id: '7-1', status: 'succeeded', steps: [imageStep([{ id: 'i', url: 'https://x/a.png' }])] as never })]]));

    const panel = panels.get('p1')!;
    expect(panel.jobs.map((job) => [job.id, job.state, job.args])).toEqual([
      ['p1-1', 'succeeded', { stepType: 'imageGen', input: { prompt: 'Night Owl' } }],
      ['p1-2', 'expired', { stepType: 'imageGen', input: { prompt: 'Crumbs' } }],
    ]);
    expect(jobs.get('p1-1')?.results[0]?.id).toBe('p1-1-1');
    expect(panel.selected).toBe('p1-2');
  });

  it('names the panel the assistant opened or changed last as the one to show', async () => {
    const { panels, call } = setup();
    await call(OPEN_PANEL, { ...LOGO, values: { brand: 'A' } }, 'call_1');
    await call(OPEN_PANEL, { ...LOGO, title: 'Second', values: { brand: 'B' } }, 'call_2');
    expect(panels.latest?.handle).toBe('p2');
    panels.get('p1')!.setValue('brand', 'C');
    expect(panels.latest?.handle).toBe('p2');
    await call(UPDATE_PANEL, { panel: 'p1', values: { brand: 'D' } }, 'call_3');
    expect(panels.latest?.handle).toBe('p1');
  });

  it('opens a panel whose button asks the assistant: no price check, and pressing it sends the filled-in message', async () => {
    const { panels, calls, call, asked, composed } = setup();
    const result = await call(OPEN_PANEL, {
      title: 'Post it',
      inputs: { picture: { kind: 'image' }, title: { kind: 'text', label: 'Title' } },
      run: { ask: 'Post {{picture}} to Civitai titled "{{title}}"' },
      button: 'Post',
      values: { picture: 'gen1-1-1', title: 'Cozy cabin' },
    });
    expect(calls).toEqual([]);
    expect(result.note).toContain('its message comes to you as their next message');
    const panel = panels.get('p1')!;
    expect(panel.canRun).toBe(true);
    expect(await panel.run()).toBeUndefined();
    expect(asked).toEqual([{ message: 'Post gen1-1-1 to Civitai titled "Cozy cabin"', refs: ['gen1-1-1'] }]);
    expect(composed).toEqual([]);
    expect(panels.context()).toContain('Button "Post" sends you this message as the user');
  });

  it("puts a shared ask panel's message in the message box instead of sending what someone else wrote", async () => {
    const { panels, asked, composed } = setup();
    const panel = panels.open({
      conversationId: 'C1',
      seq: 1,
      toolCallId: 'shared',
      spec: { title: 'Post it', inputs: { title: { kind: 'text' } }, run: { ask: 'Post titled {{title}}' }, button: 'Post' },
      values: { title: 'Hi' },
      forkedFrom: { id: 'X', version: 1 },
    });
    await panel.run();
    expect(asked).toEqual([]);
    expect(composed).toEqual([{ message: 'Post titled Hi', refs: [] }]);
  });
});
