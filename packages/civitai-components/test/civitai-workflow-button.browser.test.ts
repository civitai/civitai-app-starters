import type { AppClient, Workflow } from '@civitai/sdk';
import { afterEach, describe, expect, it } from 'vitest';

import type { CivitaiWorkflowButton } from '../src/sdk/civitai-workflow-button.js';
import '../src/sdk/civitai-workflow-button.define.js';

let scope: HTMLElement | undefined;

afterEach(() => {
  scope?.remove();
  scope = undefined;
});

const TEMPLATE = { steps: [{ $type: 'echo', input: {} }] } as never;

function workflow(status: string, rate?: number): Workflow {
  return {
    id: 'wf_1',
    status,
    steps: rate === undefined ? [] : [{ status: 'processing', estimatedProgressRate: rate }],
  } as unknown as Workflow;
}

/** A workflow of several steps, as `[status, rate]` pairs. */
function steps(...given: [string, number | null][]): Workflow {
  return {
    id: 'wf_1',
    status: 'processing',
    steps: given.map(([status, estimatedProgressRate]) => ({ status, estimatedProgressRate })),
  } as unknown as Workflow;
}

/** A workflow whose steps are waiting in a queue, as jobs ahead of each (null: not queued). */
function queued(...ahead: (number | null)[]): Workflow {
  return {
    id: 'wf_1',
    status: 'unassigned',
    steps: ahead.map((precedingJobs) => ({
      status: 'unassigned',
      queuePosition: precedingJobs === null ? undefined : { support: 'available', precedingJobs },
    })),
  } as unknown as Workflow;
}

/** A hand-driven orchestrator: each `push` is one reading of the workflow. */
function fakeApp(cost: number | { variable: true } = 120) {
  const calls: string[] = [];
  let deliver: ((value: IteratorResult<Workflow>) => void) | undefined;
  const pending: Workflow[] = [];

  const push = (next: Workflow) => {
    if (deliver) {
      const settle = deliver;
      deliver = undefined;
      settle({ value: next, done: false });
    } else pending.push(next);
  };

  const app = {
    requestGrants: async (scopes: readonly string[]) => {
      calls.push(`grants:${scopes.join(',')}`);
      return true;
    },
    orchestration: {
      estimateWorkflow: async () => {
        calls.push('estimate');
        return { cost: typeof cost === 'number' ? { total: cost } : { total: 0, variable: true } };
      },
      submitWorkflow: async () => {
        calls.push('submit');
        return { id: 'wf_1' };
      },
      cancelWorkflow: async (id: string) => {
        calls.push(`cancel:${id}`);
      },
      watchWorkflow: () => ({
        [Symbol.asyncIterator]: () => ({
          next: () =>
            pending.length > 0
              ? Promise.resolve({ value: pending.shift()!, done: false })
              : new Promise<IteratorResult<Workflow>>((resolve) => (deliver = resolve)),
        }),
      }),
    },
  } as unknown as AppClient;

  return { app, calls, push };
}

async function mount(app: AppClient, attrs: Record<string, string> = {}) {
  scope?.remove();
  scope = document.createElement('div');
  const el = document.createElement('civitai-workflow-button');
  el.app = app;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  scope.append(el);
  document.body.append(scope);
  el.template = TEMPLATE;
  await el.updateComplete;
  return el;
}

const run = (el: CivitaiWorkflowButton): HTMLElement & { disabled: boolean } =>
  el.shadowRoot!.querySelector('[part~="run"]')!;
const dialog = (el: CivitaiWorkflowButton): HTMLElement & { open: boolean } =>
  el.shadowRoot!.querySelector('civitai-confirm-dialog')!;
/** The spinner keeps its place when idle, so a press cannot resize the button. */
const spinning = (el: CivitaiWorkflowButton): boolean => {
  const loader = el.shadowRoot!.querySelector('[part~="spinner"]');
  return loader !== null && !loader.hasAttribute('data-idle');
};
const fill = (el: CivitaiWorkflowButton): string =>
  run(el).style.getPropertyValue('--civitai-workflow-progress');

/** Answers the cancel dialog the way a viewer would. */
async function answer(el: CivitaiWorkflowButton, choice: 'confirm' | 'cancel') {
  await settle(el);
  const button = dialog(el).shadowRoot!.querySelector<HTMLElement>(`[part~="${choice}"]`)!;
  button.click();
  await settle(el);
}

/** Lit renders on a microtask, and a press drives several awaits before it. */
const settle = async (el: CivitaiWorkflowButton) => {
  for (let i = 0; i < 6; i++) await el.updateComplete;
};

describe('<civitai-workflow-button> pricing', () => {
  it('shows what the workflow will cost before it runs', async () => {
    const { app } = fakeApp(185);
    const el = await mount(app, { label: 'Bake' });

    await settle(el);

    expect(run(el).textContent).toContain('Bake for 185 Buzz');
  });

  it('offers a metered workflow without a price rather than as free', async () => {
    const { app } = fakeApp({ variable: true });
    const priced: unknown[] = [];
    const record = (e: Event) => priced.push((e as CustomEvent).detail);
    document.addEventListener('priced', record);
    const el = await mount(app, { label: 'Paint' });

    await settle(el);
    document.removeEventListener('priced', record);

    expect(run(el).textContent).toContain('Paint');
    expect(run(el).textContent).not.toContain('Buzz');
    expect(priced).toEqual([{ cost: null, variable: true }]);
  });

  it('prices again when the workflow changes', async () => {
    const { app, calls } = fakeApp();
    const el = await mount(app);
    await settle(el);

    el.template = { steps: [{ $type: 'echo', input: { changed: true } }] } as never;
    await settle(el);

    expect(calls.filter((c) => c === 'estimate')).toHaveLength(2);
  });
});

describe('<civitai-workflow-button> as a button', () => {
  it('stretches the button it wraps, not just itself', async () => {
    const { app } = fakeApp();
    const el = await mount(app, { 'full-width': '' });
    await settle(el);

    expect(run(el).getBoundingClientRect().width).toBeCloseTo(
      el.getBoundingClientRect().width,
      0
    );
  });

  it('stays out of the way when the app disables it', async () => {
    const { app, calls } = fakeApp();
    const el = await mount(app, { disabled: '' });
    await settle(el);

    expect(run(el).disabled).toBe(true);
    run(el).click();
    await settle(el);

    expect(calls).toEqual(['estimate']);
  });
});

describe('<civitai-workflow-button> placement', () => {
  const box = (el: CivitaiWorkflowButton) => {
    const inner = run(el).shadowRoot!.querySelector('button')!;
    const live = el.shadowRoot!.querySelector('.live')!;
    const b = inner.getBoundingClientRect();
    const c = live.getBoundingClientRect();
    return {
      left: Math.round(c.left - b.left),
      right: Math.round(b.right - c.right),
      width: Math.round(b.width),
    };
  };

  it('keeps its content centred and its width steady from price to progress', async () => {
    const { app, push } = fakeApp();
    const el = await mount(app);
    el.template = { steps: [{ $type: 'a', input: {} }, { $type: 'b', input: {} }] } as never;
    await settle(el);
    const idle = box(el);

    run(el).click();
    push(steps(['processing', 0.3], ['unassigned', null]));
    await settle(el);
    const running = box(el);

    expect(idle.left, 'centred before').toBe(idle.right);
    expect(running.left, 'centred while the spinner is there').toBe(running.right);
    expect(running.width, 'and the same size throughout').toBe(idle.width);
  });
});

describe('<civitai-workflow-button> running', () => {
  it('asks for the spend it needs, submits, and reports where the workflow is', async () => {
    const { app, calls, push } = fakeApp();
    const el = await mount(app);
    await settle(el);

    run(el).click();
    push(workflow('processing'));
    await settle(el);

    expect(calls).toEqual(['estimate', 'grants:ai:write:budgeted', 'submit']);
    expect(run(el).textContent).toContain('working…');

    run(el).click();
    await settle(el);

    expect(calls.filter((c) => c === 'submit'), 'a second press starts no second run').toHaveLength(1);
    expect(dialog(el).open, 'it asks about cancelling instead').toBe(true);
  });

  it('fills the button itself with the progress the workflow estimates', async () => {
    const { app, push } = fakeApp();
    const el = await mount(app);
    await settle(el);

    run(el).click();
    push(workflow('processing', 0.42));
    await settle(el);

    expect(fill(el)).toBe('42%');
  });

  it('hands each reading of the workflow to the app, which may want its outputs early', async () => {
    const { app, push } = fakeApp();
    const el = await mount(app);
    await settle(el);
    const seen: Workflow[] = [];
    el.addEventListener('progress', (e) => seen.push((e as CustomEvent).detail.workflow));

    run(el).click();
    const reading = workflow('processing', 0.5);
    push(reading);
    await settle(el);

    expect(seen).toEqual([reading]);
  });

  it('spins while it works, so a workflow that estimates nothing still looks alive', async () => {
    const { app, push } = fakeApp();
    const el = await mount(app);
    await settle(el);

    run(el).click();
    push(workflow('processing'));
    await settle(el);

    expect(spinning(el)).toBe(true);
    expect(fill(el), 'nothing to fill without an estimate').toBe('');
  });

  it('follows the step that is furthest behind, and says how many are done', async () => {
    const { app, push } = fakeApp();
    const el = await mount(app);
    await settle(el);

    run(el).click();
    // A mesh step most of the way through, and a rig step that has not begun.
    push(steps(['processing', 0.62], ['unassigned', null]));
    await settle(el);

    expect(fill(el), 'the only step reporting anything is the mesh').toBe('62%');
    expect(run(el).textContent, 'and neither step has finished').toContain('0/2');

    push(steps(['succeeded', null], ['processing', 0.4]));
    await settle(el);

    expect(fill(el)).toBe('40%');
    expect(run(el).textContent).toContain('1/2');
  });

  it('says how far back in the queue it is, and stays the same width as that counts down', async () => {
    const { app, push } = fakeApp();
    const el = await mount(app);
    await settle(el);

    run(el).click();
    push(queued(12));
    await settle(el);

    expect(run(el).textContent).toContain('queued… 12 ahead');
    const width = run(el).getBoundingClientRect().width;

    push(queued(9));
    await settle(el);

    expect(run(el).textContent).toContain('queued… 9 ahead');
    expect(run(el).getBoundingClientRect().width).toBe(width);

    push(queued(0));
    await settle(el);

    expect(run(el).textContent, 'nothing ahead is still waiting, not running').toContain('next up');

    push(workflow('processing', 0.1));
    await settle(el);

    const label = el.shadowRoot!.querySelector('[part~="label"]')!.textContent;
    expect(label, 'a running step carries no position').toBe('working…');
  });

  it('waits on the step with the most ahead of it', async () => {
    const { app, push } = fakeApp();
    const el = await mount(app);
    await settle(el);
    const seen: number[] = [];
    el.addEventListener('progress', (e) => seen.push((e as CustomEvent).detail.queued));

    run(el).click();
    push(queued(2, 5, null));
    await settle(el);

    expect(run(el).textContent).toContain('5 ahead');
    expect(seen).toEqual([5]);
  });

  it('ignores a step that reports no progress yet', async () => {
    const { app, push } = fakeApp();
    const el = await mount(app);
    await settle(el);

    run(el).click();
    push(steps(['processing', 0.5], ['processing', 0]));
    await settle(el);

    expect(fill(el), 'a zero is a step that has not started, not 0% of the work').toBe('50%');
  });

  it('asks before cancelling, and cancels when the viewer says so', async () => {
    const { app, calls, push } = fakeApp();
    const el = await mount(app);
    await settle(el);

    run(el).click();
    push(workflow('processing'));
    await settle(el);
    run(el).click();
    await answer(el, 'confirm');

    expect(calls).toContain('cancel:wf_1');
    expect(spinning(el), 'the run is over, so nothing spins').toBe(false);
  });

  it('opens the cancel dialog at its own size, not the button\'s', async () => {
    const { app, push } = fakeApp();
    const el = await mount(app);
    await settle(el);

    run(el).click();
    push(workflow('processing'));
    await settle(el);
    run(el).click();
    await settle(el);

    const panel = dialog(el).shadowRoot!.querySelector('.panel')!;
    const actions = dialog(el).shadowRoot!.querySelector('[part~="actions"]')!;
    const body = dialog(el).shadowRoot!.querySelector('[part~="body"]')!;
    expect(panel.getBoundingClientRect().width).toBeGreaterThan(300);
    expect(
      actions.getBoundingClientRect().top,
      'the footer sits below the body rather than over it'
    ).toBeGreaterThanOrEqual(body.getBoundingClientRect().bottom - 1);
  });

  it('shows the workflow id, which is what support asks for', async () => {
    const { app, push } = fakeApp();
    const el = await mount(app);
    await settle(el);

    run(el).click();
    push(workflow('processing'));
    await settle(el);
    run(el).click();
    await settle(el);

    expect(el.shadowRoot!.querySelector('[part~="workflow-id"]')!.textContent).toBe('wf_1');
  });

  it('closes the cancel dialog when the run ends under it', async () => {
    const { app, push } = fakeApp();
    const el = await mount(app);
    await settle(el);

    run(el).click();
    push(workflow('processing'));
    await settle(el);
    run(el).click();
    await settle(el);
    expect(dialog(el).open, 'the viewer is being asked').toBe(true);

    push(workflow('succeeded'));
    await settle(el);

    expect(dialog(el).open, 'but there is nothing left to cancel').toBe(false);
    expect(run(el).textContent).toContain('Done!');
  });

  it('keeps the workflow running when the viewer changes their mind', async () => {
    const { app, calls, push } = fakeApp();
    const el = await mount(app);
    await settle(el);

    run(el).click();
    push(workflow('processing'));
    await settle(el);
    run(el).click();
    await answer(el, 'cancel');

    expect(calls.some((c) => c.startsWith('cancel:'))).toBe(false);
    expect(spinning(el)).toBe(true);
  });

  it('hands the finished workflow to the app and returns to its price', async () => {
    const { app, push } = fakeApp();
    const el = await mount(app);
    await settle(el);
    const finished: Workflow[] = [];
    el.addEventListener('finished', (event) =>
      finished.push((event as CustomEvent<{ workflow: Workflow }>).detail.workflow)
    );

    run(el).click();
    push(workflow('succeeded'));
    await settle(el);

    expect(finished.map((w) => w.status)).toEqual(['succeeded']);
    expect(run(el).textContent, 'the outcome, before the price comes back').toContain('Done!');
    expect(fill(el), 'and the button stays full rather than snapping empty').toBe('100%');

    await new Promise((r) => setTimeout(r, 1700));
    await settle(el);

    expect(run(el).textContent).toContain('120 Buzz');
    expect(run(el).disabled).toBe(false);
  });

  it('names a cancelled run before offering its price again', async () => {
    const { app, push } = fakeApp();
    const el = await mount(app);
    await settle(el);

    run(el).click();
    push(workflow('processing'));
    await settle(el);
    run(el).click();
    await answer(el, 'confirm');

    expect(run(el).textContent).toContain('Canceled');
  });

  it('says what went wrong instead of looking busy forever', async () => {
    const { app } = fakeApp();
    const failing = {
      ...app,
      orchestration: {
        ...app.orchestration,
        submitWorkflow: async () => {
          throw new Error('blocked prompt');
        },
      },
    } as unknown as AppClient;
    const el = await mount(failing);
    await settle(el);
    const errors: string[] = [];
    el.addEventListener('error', (event) =>
      errors.push((event as CustomEvent<{ message: string }>).detail.message)
    );

    run(el).click();
    await settle(el);

    expect(errors).toEqual(['blocked prompt']);
    expect(run(el).disabled).toBe(false);
  });
});
