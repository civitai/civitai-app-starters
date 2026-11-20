/**
 * Rendered tests for the Generate form: the real component, mounted into
 * happy-dom and driven through its DOM, with the BFF replaced by a stubbed
 * `fetch`. They check what a user sees and what the form sends: the prompt it
 * prices, the prompt it submits, and the workflow it then polls.
 *
 * Deliberately behavioural. They read the form the way a person does (by
 * label, button text and status text), so restyling or restructuring the
 * markup does not break them; changing what the form DOES does.
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { DEFAULT_MODEL_AIR } from '@civitai/app-sdk/orchestrator';
import GenerateForm from '$lib/components/GenerateForm.svelte';

const PROMPT = 'a lighthouse on a basalt cliff at dusk, test prompt 7f3';
const COST = 37;
const BALANCE = 1234;
const WORKFLOW_ID = 'wf-test-91';
const IMAGE_URL = 'https://images.example.test/out-1.png';

interface Call {
  url: string;
  method: string;
  body: unknown;
}

let calls: Call[];
let estimateReply: Record<string, unknown>;
let container: HTMLElement;
let component: ReturnType<typeof mount>;

/** A stand-in for the BFF: answers the three routes the form calls, records every call. */
function fakeBff(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const method = init?.method ?? 'GET';
  calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
  const reply = (body: unknown) =>
    Promise.resolve(
      new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
  if (method === 'POST' && url === '/api/generate/estimate') return reply(estimateReply);
  if (method === 'POST' && url === '/api/generate') return reply({ workflowId: WORKFLOW_ID, snapshot: {} });
  if (method === 'GET' && url.startsWith(`/api/workflow/${WORKFLOW_ID}?`)) {
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
  expect(text()).toContain('Preview the Buzz cost of this prompt to enable Generate.');
  expect(calls).toEqual([]);
});

test('prices the typed prompt, then submits it and shows the finished image', async () => {
  typePrompt(PROMPT);
  click(button(/^Preview Buzz cost$/));

  await until(() => expect(button(/^Generate/).textContent?.trim()).toBe(`Generate (≈ ${COST} Buzz)`));
  expect(calls).toEqual([{ url: '/api/generate/estimate', method: 'POST', body: { prompt: PROMPT } }]);
  expect(button(/^Generate/).disabled).toBe(false);
  expect(text()).toContain(`This will cost ${COST} Buzz.`);
  expect(text()).toContain(`Your balance: ${BALANCE} Buzz.`);

  click(button(/^Generate/));

  await until(() => expect(container.querySelector('img')?.getAttribute('src')).toBe(IMAGE_URL));
  expect(calls.slice(1)).toEqual([
    { url: '/api/generate', method: 'POST', body: { prompt: PROMPT } },
    { url: `/api/workflow/${WORKFLOW_ID}?wait=25000`, method: 'GET', body: undefined },
  ]);
  expect(text()).toContain('Status: succeeded');
  expect(text()).toContain(`spent ${COST} Buzz.`);
});

test('an estimate with no cost says so and keeps Generate locked', async () => {
  estimateReply = { cost: null };
  typePrompt(PROMPT);
  click(button(/^Preview Buzz cost$/));

  await until(() => expect(container.querySelector('[role="status"]')?.textContent).toContain('Estimate unavailable'));
  expect(button(/^Generate/).textContent?.trim()).toBe('Generate');
  expect(button(/^Generate/).disabled).toBe(true);
  expect(text()).not.toContain('This will cost');
  expect(calls.map((c) => c.url)).toEqual(['/api/generate/estimate']);
});

test('editing the prompt after an estimate drops the price and locks Generate again', async () => {
  typePrompt(PROMPT);
  click(button(/^Preview Buzz cost$/));
  await until(() => expect(button(/^Generate/).disabled).toBe(false));

  typePrompt(`${PROMPT}, edited`);

  expect(button(/^Generate/).disabled).toBe(true);
  expect(button(/^Generate/).textContent?.trim()).toBe('Generate');
  expect(text()).not.toContain('This will cost');
});
