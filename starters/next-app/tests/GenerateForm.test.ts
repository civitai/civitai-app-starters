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
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { DEFAULT_MODEL_AIR } from '@civitai/app-sdk/orchestrator';
import { GenerateForm } from '../src/components/GenerateForm';

// Tells React this is a test environment, so `act` flushes updates and does
// not warn.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PROMPT = 'a lighthouse on a basalt cliff at dusk, test prompt 7f3';
const COST = 37;
const BALANCE = 1234;
const WORKFLOW_ID = 'wf-test-91';
const IMAGE_URL = 'https://images.example.test/out-1.png';
const ESTIMATE_ERROR = 'estimate upstream answered 503, test e41';
const SUBMIT_ERROR = 'not enough Buzz for this workflow, test s52';
const POLL_ERROR = 'workflow wait answered 502, test p63';
/** The form's idempotency key: 32 lowercase hex characters (`mintAttemptKey`). */
const KEY = /^[0-9a-f]{32}$/;

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
/** When set, the submit reply waits for it, so a test can act while the submit is in flight. */
let submitGate: Promise<void> | null;
let container: HTMLElement;
let root: Root;

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
  if (method === 'POST' && url === '/api/generate') {
    if (submitGate) return submitGate.then(() => reply(submitReply, submitStatus));
    return reply(submitReply, submitStatus);
  }
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

beforeEach(async () => {
  calls = [];
  estimateReply = { cost: COST };
  estimateStatus = 200;
  submitReply = { workflowId: WORKFLOW_ID, snapshot: {} };
  submitStatus = 200;
  pollStatus = 200;
  submitGate = null;
  vi.stubGlobal('fetch', vi.fn(fakeBff));
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(GenerateForm, { initialBalance: BALANCE }));
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const textarea = () => {
  const el = container.querySelector('textarea');
  if (!el) throw new Error('no prompt textarea');
  return el;
};

function button(name: RegExp): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find((b) => name.test(b.textContent ?? ''));
  if (!found) throw new Error(`no button matching ${name}`);
  return found;
}

const text = () => container.textContent ?? '';

/** The idempotency key of every submit, in order. */
const submitKeys = () =>
  calls.filter((c) => c.url === '/api/generate').map((c) => (c.body as { idempotencyKey?: unknown }).idempotencyKey);

/** Prices the current prompt, waits for Generate to unlock, then presses it. */
async function previewThenGenerate() {
  await click(button(/^Preview Buzz cost$/));
  await until(() => expect(button(/^Generate/).disabled).toBe(false));
  await click(button(/^Generate/));
}

/** Types into the textarea the way a browser does, so React's onChange fires. */
async function typePrompt(value: string) {
  await act(async () => {
    const el = textarea();
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    setValue.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function click(el: HTMLElement) {
  await act(async () => {
    el.click();
  });
}

/** Re-checks `assertion` until it passes, flushing React between tries. */
async function until(assertion: () => void, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      assertion();
      return;
    } catch (err) {
      if (Date.now() > deadline) throw err;
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
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
  await typePrompt(PROMPT);
  await click(button(/^Preview Buzz cost$/));

  await until(() => expect(button(/^Generate/).textContent).toBe(`Generate (≈ ${COST} Buzz)`));
  expect(calls).toEqual([{ url: '/api/generate/estimate', method: 'POST', body: { prompt: PROMPT } }]);
  expect(button(/^Generate/).disabled).toBe(false);
  expect(container.querySelector('strong')?.textContent).toBe(String(COST));
  expect(text()).toContain(String(BALANCE));

  await click(button(/^Generate/));

  await until(() => expect(container.querySelector('img')?.getAttribute('src')).toBe(IMAGE_URL));
  expect(calls.slice(1)).toEqual([
    { url: '/api/generate', method: 'POST', body: { prompt: PROMPT, idempotencyKey: expect.stringMatching(KEY) } },
    { url: `/api/workflow/${WORKFLOW_ID}?wait=25000`, method: 'GET', body: undefined },
  ]);
  expect(text()).toContain('succeeded');
});

test('an estimate with no cost says so and keeps Generate locked', async () => {
  estimateReply = { cost: null };
  await typePrompt(PROMPT);
  await click(button(/^Preview Buzz cost$/));

  await until(() => expect(container.querySelector('[role="status"]')?.textContent).toContain('Estimate unavailable'));
  expect(button(/^Generate/).textContent).toBe('Generate');
  expect(button(/^Generate/).disabled).toBe(true);
  expect(container.querySelector('strong')).toBeNull();
  expect(calls.map((c) => c.url)).toEqual(['/api/generate/estimate']);
});

test('editing the prompt after an estimate drops the price and locks Generate again', async () => {
  await typePrompt(PROMPT);
  await click(button(/^Preview Buzz cost$/));
  await until(() => expect(button(/^Generate/).disabled).toBe(false));

  await typePrompt(`${PROMPT}, edited`);

  expect(button(/^Generate/).disabled).toBe(true);
  expect(button(/^Generate/).textContent).toBe('Generate');
  expect(container.querySelector('strong')).toBeNull();
});

test('a failed estimate shows the error and keeps Generate locked', async () => {
  estimateStatus = 503;
  estimateReply = { error: ESTIMATE_ERROR };
  await typePrompt(PROMPT);
  await click(button(/^Preview Buzz cost$/));

  await until(() => expect(container.querySelector('pre')?.textContent).toContain(ESTIMATE_ERROR));
  expect(button(/^Generate/).textContent).toBe('Generate');
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
  await typePrompt(PROMPT);
  await click(button(/^Preview Buzz cost$/));
  await until(() => expect(button(/^Generate/).disabled).toBe(false));

  await click(button(/^Generate/));

  await until(() => expect(container.querySelector('pre')?.textContent).toContain(SUBMIT_ERROR));
  expect(calls.slice(1)).toEqual([
    { url: '/api/generate', method: 'POST', body: { prompt: PROMPT, idempotencyKey: expect.stringMatching(KEY) } },
  ]);
  expect(container.querySelector('img')).toBeNull();
  expect(container.querySelector('strong')).toBeNull();
  // A failed submit may still have started a workflow (a timeout or a 5xx
  // after the orchestrator accepted it), so the form drops the quote and
  // Generate locks: one more click must not pay for a second workflow.
  expect(button(/^Generate/).textContent).toBe('Generate');
  expect(button(/^Generate/).disabled).toBe(true);
  // Preview stays usable, and a new estimate unlocks Generate at ITS price.
  expect(button(/^Preview Buzz cost$/).disabled).toBe(false);
  estimateReply = { cost: COST + 5 };
  await click(button(/^Preview Buzz cost$/));
  await until(() => expect(button(/^Generate/).textContent).toBe(`Generate (≈ ${COST + 5} Buzz)`));
  expect(button(/^Generate/).disabled).toBe(false);
  expect(calls.map((c) => c.url)).toEqual(['/api/generate/estimate', '/api/generate', '/api/generate/estimate']);
});

test('a failed wait for the workflow drops the price and locks Generate', async () => {
  pollStatus = 502;
  await typePrompt(PROMPT);
  await click(button(/^Preview Buzz cost$/));
  await until(() => expect(button(/^Generate/).disabled).toBe(false));

  await click(button(/^Generate/));

  await until(() => expect(container.querySelector('pre')?.textContent).toContain(POLL_ERROR));
  expect(container.querySelector('img')).toBeNull();
  expect(container.querySelector('strong')).toBeNull();
  // The orchestrator accepted this workflow, so it may still be running.
  expect(button(/^Generate/).textContent).toBe('Generate');
  expect(button(/^Generate/).disabled).toBe(true);
  expect(button(/^Preview Buzz cost$/).disabled).toBe(false);
  expect(calls.map((c) => c.url)).toEqual([
    '/api/generate/estimate',
    '/api/generate',
    `/api/workflow/${WORKFLOW_ID}?wait=25000`,
  ]);
});

test('a failed re-estimate drops the earlier price and locks Generate again', async () => {
  await typePrompt(PROMPT);
  await click(button(/^Preview Buzz cost$/));
  await until(() => expect(button(/^Generate/).disabled).toBe(false));

  estimateStatus = 503;
  estimateReply = { error: ESTIMATE_ERROR };
  await click(button(/^Preview Buzz cost$/));

  await until(() => expect(container.querySelector('pre')?.textContent).toContain(ESTIMATE_ERROR));
  expect(button(/^Generate/).textContent).toBe('Generate');
  expect(button(/^Generate/).disabled).toBe(true);
  expect(container.querySelector('strong')).toBeNull();
  expect(calls.map((c) => c.url)).toEqual(['/api/generate/estimate', '/api/generate/estimate']);
});

// --- the idempotency key: one per attempt, bound to the prompt --------------

test('a retry after a failed submit sends the same idempotency key, and no estimate carries one', async () => {
  submitStatus = 502;
  submitReply = { error: SUBMIT_ERROR };
  await typePrompt(PROMPT);
  await previewThenGenerate();
  await until(() => expect(container.querySelector('pre')?.textContent).toContain(SUBMIT_ERROR));

  submitStatus = 200;
  submitReply = { workflowId: WORKFLOW_ID, snapshot: {} };
  await previewThenGenerate();
  await until(() => expect(container.querySelector('img')?.getAttribute('src')).toBe(IMAGE_URL));

  const keys = submitKeys();
  expect(keys).toHaveLength(2);
  expect(keys[0]).toMatch(KEY);
  expect(keys[1]).toBe(keys[0]);
  // The estimate is a what-if that may count as a match for the key: never send it.
  const estimates = calls.filter((c) => c.url === '/api/generate/estimate');
  expect(estimates).toHaveLength(2);
  for (const e of estimates) expect(e.body).toEqual({ prompt: PROMPT });
});

test('a retry after a failed wait for the workflow sends the same idempotency key', async () => {
  pollStatus = 502;
  await typePrompt(PROMPT);
  await previewThenGenerate();
  await until(() => expect(container.querySelector('pre')?.textContent).toContain(POLL_ERROR));

  pollStatus = 200;
  await previewThenGenerate();
  await until(() => expect(container.querySelector('img')?.getAttribute('src')).toBe(IMAGE_URL));

  const keys = submitKeys();
  expect(keys).toHaveLength(2);
  expect(keys[0]).toMatch(KEY);
  expect(keys[1]).toBe(keys[0]);
});

test('editing the prompt after a failed submit gives the next submit a new key, even when edited back', async () => {
  submitStatus = 502;
  submitReply = { error: SUBMIT_ERROR };
  await typePrompt(PROMPT);
  await previewThenGenerate();
  await until(() => expect(container.querySelector('pre')?.textContent).toContain(SUBMIT_ERROR));

  // Edited and back again, without submitting the edit: the edit dropped the
  // first attempt, so the same prompt is a new attempt.
  await typePrompt(`${PROMPT}, edited`);
  await typePrompt(PROMPT);
  await previewThenGenerate();
  await until(() => expect(submitKeys()).toHaveLength(2));
  await until(() => expect(container.querySelector('pre')?.textContent).toContain(SUBMIT_ERROR));

  // A different prompt is a new attempt too.
  await typePrompt(`${PROMPT}, edited`);
  await previewThenGenerate();
  await until(() => expect(submitKeys()).toHaveLength(3));

  const keys = submitKeys();
  for (const k of keys) expect(k).toMatch(KEY);
  expect(new Set(keys).size).toBe(3);
  expect(calls.filter((c) => c.url === '/api/generate').map((c) => (c.body as { prompt: string }).prompt)).toEqual([
    PROMPT,
    PROMPT,
    `${PROMPT}, edited`,
  ]);
});

test('a new Generate after a finished workflow gets a new key', async () => {
  await typePrompt(PROMPT);
  await previewThenGenerate();
  await until(() => expect(container.querySelector('img')?.getAttribute('src')).toBe(IMAGE_URL));

  // A finished generation leaves Generate enabled for the same prompt.
  expect(button(/^Generate/).disabled).toBe(false);
  await click(button(/^Generate/));
  await until(() => expect(submitKeys()).toHaveLength(2));

  const keys = submitKeys();
  expect(keys[0]).toMatch(KEY);
  expect(keys[1]).toMatch(KEY);
  expect(keys[1]).not.toBe(keys[0]);
});

test('Reset after a failed submit gives the next submit a new key', async () => {
  submitStatus = 502;
  submitReply = { error: SUBMIT_ERROR };
  await typePrompt(PROMPT);
  await previewThenGenerate();
  await until(() => expect(container.querySelector('pre')?.textContent).toContain(SUBMIT_ERROR));

  await click(button(/^Reset$/));
  await previewThenGenerate();
  await until(() => expect(submitKeys()).toHaveLength(2));

  const keys = submitKeys();
  expect(keys[0]).toMatch(KEY);
  expect(keys[1]).toMatch(KEY);
  expect(keys[1]).not.toBe(keys[0]);
});

test('a submit that fails after Reset was pressed mid-flight keeps its key for the retry', async () => {
  let release!: () => void;
  submitGate = new Promise<void>((r) => {
    release = r;
  });
  submitStatus = 502;
  submitReply = { error: SUBMIT_ERROR };
  await typePrompt(PROMPT);
  await previewThenGenerate();
  await until(() => expect(submitKeys()).toHaveLength(1));

  // Reset while the submit is still in flight, then the submit fails: the
  // workflow may exist, so the retry must still carry the same key.
  await click(button(/^Reset$/));
  release();
  await until(() => expect(container.querySelector('pre')?.textContent).toContain(SUBMIT_ERROR));

  submitGate = null;
  await previewThenGenerate();
  await until(() => expect(submitKeys()).toHaveLength(2));

  const keys = submitKeys();
  expect(keys[0]).toMatch(KEY);
  expect(keys[1]).toBe(keys[0]);
});
