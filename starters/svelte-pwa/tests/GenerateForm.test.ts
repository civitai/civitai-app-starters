/**
 * Rendered tests for the Generate form: the real component, mounted into
 * happy-dom and driven through its DOM, with the BFF replaced by a stubbed
 * `fetch`. They check what a user sees and what the form sends: the prompt it
 * prices, the prompt it submits, and the workflow it then polls.
 *
 * They assert on what the form sends and on a few things it shows: the button
 * labels ("Preview Buzz cost", "Generate (≈ N Buzz)"), "Estimate
 * unavailable", the quoted cost in its <strong>, the image, and the error a
 * failed request shows in its <pre>. Restyling does
 * not break them; renaming those buttons or dropping those elements does, so
 * update the matching lookup here when you change one on purpose.
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { DEFAULT_MODEL_AIR } from '@civitai/app-sdk/orchestrator';
import GenerateForm from '../src/components/GenerateForm.svelte';

const PROMPT = 'a lighthouse on a basalt cliff at dusk, test prompt 7f3';
const COST = 37;
const BALANCE = 1234;
const WORKFLOW_ID = 'wf-test-91';
const IMAGE_URL = 'https://images.example.test/out-1.png';
const ESTIMATE_ERROR = 'estimate upstream answered 503, test e41';
const SUBMIT_ERROR = 'not enough Buzz for this workflow, test s52';
const POLL_ERROR = 'workflow wait answered 502, test p63';

interface Call {
  url: string;
  method: string;
  body: unknown;
}

let calls: Call[];
let estimateReply: Record<string, unknown>;
let estimateStatus: number;
let submitReply: Record<string, unknown>;
let submitStatus: number;
let pollStatus: number;
let container: HTMLElement;
let component: ReturnType<typeof mount>;

/** A stand-in for the BFF: answers the three routes the form calls, records every call. */
function fakeBff(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const method = init?.method ?? 'GET';
  calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
  const reply = (body: unknown, status = 200) =>
    Promise.resolve(
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
    );
  if (method === 'POST' && url === '/api/generate/estimate') return reply(estimateReply, estimateStatus);
  if (method === 'POST' && url === '/api/generate') return reply(submitReply, submitStatus);
  if (method === 'GET' && url.startsWith(`/api/workflow/${WORKFLOW_ID}?`)) {
    if (pollStatus !== 200) return reply({ error: POLL_ERROR }, pollStatus);
    return reply({
      done: true,
      snapshot: {
        id: WORKFLOW_ID,
        status: 'succeeded',
        cost: { total: COST },
        steps: [{ output: { images: [{ available: true, url: IMAGE_URL }] } }],
      },
    });
  }
  return Promise.reject(new Error(`unexpected request: ${method} ${url}`));
}

beforeEach(() => {
  calls = [];
  estimateReply = { cost: COST };
  estimateStatus = 200;
  submitReply = { workflowId: WORKFLOW_ID, snapshot: {} };
  submitStatus = 200;
  pollStatus = 200;
  vi.stubGlobal('fetch', vi.fn(fakeBff));
  container = document.createElement('div');
  document.body.append(container);
  component = mount(GenerateForm, { target: container, props: { initialBalance: BALANCE } });
  flushSync();
});

afterEach(() => {
  unmount(component);
  container.remove();
  vi.unstubAllGlobals();
});

const textarea = () => {
  const el = container.querySelector('textarea');
  if (!el) throw new Error('no prompt textarea');
  return el;
};

function button(name: RegExp): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find((b) => name.test(b.textContent?.trim() ?? ''));
  if (!found) throw new Error(`no button matching ${name}`);
  return found;
}

const text = () => (container.textContent ?? '').replace(/\s+/g, ' ');

/** Types into the textarea the way a browser does, so `bind:value` updates. */
function typePrompt(value: string) {
  const el = textarea();
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

function click(el: HTMLElement) {
  el.click();
  flushSync();
}

/** Re-checks `assertion` until it passes, flushing Svelte between tries. */
async function until(assertion: () => void, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      assertion();
      return;
    } catch (err) {
      if (Date.now() > deadline) throw err;
      await new Promise((r) => setTimeout(r, 10));
      flushSync();
    }
  }
}

test('renders the prompt, the model and both actions, with Generate locked until an estimate', () => {
  expect(container.querySelector('label')?.textContent).toContain('Prompt');
  expect(textarea().value).not.toBe('');
  expect(text()).toContain(DEFAULT_MODEL_AIR);
  expect(button(/^Preview Buzz cost$/).disabled).toBe(false);
  expect(button(/^Generate/).disabled).toBe(true);
  expect(calls).toEqual([]);
});

test('prices the typed prompt, then submits it and shows the finished image', async () => {
  typePrompt(PROMPT);
  click(button(/^Preview Buzz cost$/));

  await until(() => expect(button(/^Generate/).textContent?.trim()).toBe(`Generate (≈ ${COST} Buzz)`));
  expect(calls).toEqual([{ url: '/api/generate/estimate', method: 'POST', body: { prompt: PROMPT } }]);
  expect(button(/^Generate/).disabled).toBe(false);
  expect(container.querySelector('strong')?.textContent).toBe(String(COST));
  expect(text()).toContain(String(BALANCE));

  click(button(/^Generate/));

  await until(() => expect(container.querySelector('img')?.getAttribute('src')).toBe(IMAGE_URL));
  expect(calls.slice(1)).toEqual([
    { url: '/api/generate', method: 'POST', body: { prompt: PROMPT } },
    { url: `/api/workflow/${WORKFLOW_ID}?wait=25000`, method: 'GET', body: undefined },
  ]);
  expect(text()).toContain('succeeded');
});

test('an estimate with no cost says so and keeps Generate locked', async () => {
  estimateReply = { cost: null };
  typePrompt(PROMPT);
  click(button(/^Preview Buzz cost$/));

  await until(() => expect(container.querySelector('[role="status"]')?.textContent).toContain('Estimate unavailable'));
  expect(button(/^Generate/).textContent?.trim()).toBe('Generate');
  expect(button(/^Generate/).disabled).toBe(true);
  expect(container.querySelector('strong')).toBeNull();
  expect(calls.map((c) => c.url)).toEqual(['/api/generate/estimate']);
});

test('editing the prompt after an estimate drops the price and locks Generate again', async () => {
  typePrompt(PROMPT);
  click(button(/^Preview Buzz cost$/));
  await until(() => expect(button(/^Generate/).disabled).toBe(false));

  typePrompt(`${PROMPT}, edited`);

  expect(button(/^Generate/).disabled).toBe(true);
  expect(button(/^Generate/).textContent?.trim()).toBe('Generate');
  expect(container.querySelector('strong')).toBeNull();
});

test('a failed estimate shows the error and keeps Generate locked', async () => {
  estimateStatus = 503;
  estimateReply = { error: ESTIMATE_ERROR };
  typePrompt(PROMPT);
  click(button(/^Preview Buzz cost$/));

  await until(() => expect(container.querySelector('pre')?.textContent).toContain(ESTIMATE_ERROR));
  expect(button(/^Generate/).textContent?.trim()).toBe('Generate');
  expect(button(/^Generate/).disabled).toBe(true);
  expect(container.querySelector('strong')).toBeNull();
  // An error, not a priced-at-nothing estimate: no "Estimate unavailable".
  expect(container.querySelector('[role="status"]')).toBeNull();
  // The estimate can be retried.
  expect(button(/^Preview Buzz cost$/).disabled).toBe(false);
  expect(calls.map((c) => c.url)).toEqual(['/api/generate/estimate']);
});

test('a failed submit shows the error, drops the price and locks Generate until a new estimate', async () => {
  submitStatus = 402;
  submitReply = { error: SUBMIT_ERROR };
  typePrompt(PROMPT);
  click(button(/^Preview Buzz cost$/));
  await until(() => expect(button(/^Generate/).disabled).toBe(false));

  click(button(/^Generate/));

  await until(() => expect(container.querySelector('pre')?.textContent).toContain(SUBMIT_ERROR));
  expect(calls.slice(1)).toEqual([{ url: '/api/generate', method: 'POST', body: { prompt: PROMPT } }]);
  expect(container.querySelector('img')).toBeNull();
  expect(container.querySelector('strong')).toBeNull();
  // A failed submit may still have started a workflow (a timeout or a 5xx
  // after the orchestrator accepted it), so the form drops the quote and
  // Generate locks: one more click must not pay for a second workflow.
  expect(button(/^Generate/).textContent?.trim()).toBe('Generate');
  expect(button(/^Generate/).disabled).toBe(true);
  // Preview stays usable, and a new estimate unlocks Generate at ITS price.
  expect(button(/^Preview Buzz cost$/).disabled).toBe(false);
  estimateReply = { cost: COST + 5 };
  click(button(/^Preview Buzz cost$/));
  await until(() => expect(button(/^Generate/).textContent?.trim()).toBe(`Generate (≈ ${COST + 5} Buzz)`));
  expect(button(/^Generate/).disabled).toBe(false);
  expect(calls.map((c) => c.url)).toEqual(['/api/generate/estimate', '/api/generate', '/api/generate/estimate']);
});

test('a failed wait for the workflow drops the price and locks Generate', async () => {
  pollStatus = 502;
  typePrompt(PROMPT);
  click(button(/^Preview Buzz cost$/));
  await until(() => expect(button(/^Generate/).disabled).toBe(false));

  click(button(/^Generate/));

  await until(() => expect(container.querySelector('pre')?.textContent).toContain(POLL_ERROR));
  expect(container.querySelector('img')).toBeNull();
  expect(container.querySelector('strong')).toBeNull();
  // The orchestrator accepted this workflow, so it may still be running.
  expect(button(/^Generate/).textContent?.trim()).toBe('Generate');
  expect(button(/^Generate/).disabled).toBe(true);
  expect(button(/^Preview Buzz cost$/).disabled).toBe(false);
  expect(calls.map((c) => c.url)).toEqual([
    '/api/generate/estimate',
    '/api/generate',
    `/api/workflow/${WORKFLOW_ID}?wait=25000`,
  ]);
});

test('a failed re-estimate drops the earlier price and locks Generate again', async () => {
  typePrompt(PROMPT);
  click(button(/^Preview Buzz cost$/));
  await until(() => expect(button(/^Generate/).disabled).toBe(false));

  estimateStatus = 503;
  estimateReply = { error: ESTIMATE_ERROR };
  click(button(/^Preview Buzz cost$/));

  await until(() => expect(container.querySelector('pre')?.textContent).toContain(ESTIMATE_ERROR));
  expect(button(/^Generate/).textContent?.trim()).toBe('Generate');
  expect(button(/^Generate/).disabled).toBe(true);
  expect(container.querySelector('strong')).toBeNull();
  expect(calls.map((c) => c.url)).toEqual(['/api/generate/estimate', '/api/generate/estimate']);
});
