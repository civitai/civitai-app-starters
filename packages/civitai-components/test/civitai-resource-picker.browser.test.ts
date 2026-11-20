import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';

import {
  blockTokenSource,
  MAX_AUTO_RETRIES,
  ResourceSourceError,
  type CivitaiResourcePicker,
  type PickedResource,
  type ResourcePage,
  type ResourceSearchParams,
  type ResourceSource,
} from '../src/sdk/civitai-resource-picker.js';
import '../src/sdk/civitai-resource-picker.define.js';

let scope: HTMLElement | undefined;

afterEach(() => {
  scope?.remove();
  scope = undefined;
});

const DAY = 86_400_000;
const FUTURE = new Date(Date.now() + 5 * DAY).toISOString();
const PAST = new Date(Date.now() - 5 * DAY).toISOString();

/** Distinct values everywhere, so a pick cannot be right by sharing a field. */
const WORKFLOW = {
  modelId: 501,
  name: 'Upscale Chain',
  type: 'Workflows',
  creatorUsername: 'maker',
  versions: [
    { id: 9003, name: 'v3', baseModel: 'Flux.1 D', access: 'early-access' as const, earlyAccessDeadline: FUTURE },
    { id: 9002, name: 'v2', baseModel: 'SDXL 1.0', access: 'open' as const },
    { id: 9001, name: 'v1', baseModel: 'SD 1.5', access: 'paid' as const },
  ],
};
const OTHER = {
  modelId: 777,
  name: 'Portrait Relight',
  type: 'ComfyWorkflows',
  creatorUsername: null,
  versions: [{ id: 4401, name: 'first', baseModel: null }],
};

const page = (items: ResourcePage['items'], owner: 'mine' | 'any' = 'any', nextCursor: string | null = null): ResourcePage => ({
  items,
  owner,
  nextCursor,
});

interface Call {
  params: ResourceSearchParams;
  signal: AbortSignal;
  resolve: (page: ResourcePage) => void;
  reject: (error: unknown) => void;
}

/** A source answered by hand; it ignores `signal` unless told otherwise. */
function handSource() {
  const calls: Call[] = [];
  const waiters: (() => void)[] = [];
  const source: ResourceSource = {
    search: (params, signal) =>
      new Promise<ResourcePage>((resolve, reject) => {
        calls.push({ params, signal, resolve, reject });
        waiters.splice(0).forEach((wake) => wake());
      }),
  };
  /** Resolves once the source has been called `n` times in total. */
  const called = async (n: number) => {
    while (calls.length < n) await new Promise<void>((wake) => waiters.push(wake));
    return calls[n - 1]!;
  };
  return { source, calls, called };
}

/** A source that answers every search the same way, immediately. */
const fixedSource = (answer: (params: ResourceSearchParams) => ResourcePage): ResourceSource => ({
  search: async (params) => answer(params),
});

async function mount(source: ResourceSource | undefined, attrs: Record<string, string> = {}) {
  scope?.remove();
  scope = document.createElement('div');
  const el = document.createElement('civitai-resource-picker');
  el.setAttribute('types', 'Workflows ComfyWorkflows');
  el.setAttribute('noun', 'workflow');
  el.debounce = 0;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.source = source;
  scope.append(el);
  document.body.append(scope);
  await el.updateComplete;
  return el;
}

/** Lit renders on a microtask and a search adds several awaits before it. */
const settle = async (el: CivitaiResourcePicker) => {
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;
  }
};

const until = async (el: CivitaiResourcePicker, done: () => boolean, ms = 2000) => {
  const end = Date.now() + ms;
  while (!done()) {
    if (Date.now() > end) throw new Error('timed out waiting for the picker');
    await settle(el);
  }
};

const $ = <T extends Element = HTMLElement>(el: CivitaiResourcePicker, selector: string) =>
  el.shadowRoot!.querySelector<T>(selector);
const $$ = (el: CivitaiResourcePicker, selector: string) => [
  ...el.shadowRoot!.querySelectorAll<HTMLElement>(selector),
];
const names = (el: CivitaiResourcePicker) => $$(el, '[part~="name"]').map((n) => n.textContent!.trim());

function chooseOwner(el: CivitaiResourcePicker, owner: 'mine' | 'any') {
  const radio = $<HTMLInputElement>(el, `input[type="radio"][value="${owner}"]`)!;
  radio.click();
}

function type(el: CivitaiResourcePicker, text: string) {
  const input = $<HTMLInputElement>(el, '[part~="search"]')!;
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
}

describe('<civitai-resource-picker> picking', () => {
  it('resolves show() and fires `pick` with the projected shape, newest version by default', async () => {
    const el = await mount(fixedSource(() => page([WORKFLOW, OTHER])));
    const events: PickedResource[] = [];
    el.addEventListener('pick', (e) => events.push((e as CustomEvent<PickedResource>).detail));

    const result = el.show();
    await until(el, () => names(el).length === 2);
    $(el, `[data-model-id="501"] [part~="select"]`)!.click();

    const expected: PickedResource = {
      modelId: 501,
      modelVersionId: 9003,
      name: 'Upscale Chain',
      versionName: 'v3',
      creatorUsername: 'maker',
      baseModel: 'Flux.1 D',
      earlyAccessDeadline: FUTURE,
      access: 'early-access',
      owner: 'any',
    };
    await expect(result).resolves.toEqual(expected);
    expect(events).toEqual([expected]);
    expect(el.open).toBe(false);
  });

  it('picks the version the viewer selected, and leaves out a deadline it does not have', async () => {
    const el = await mount(fixedSource(() => page([WORKFLOW])));
    const result = el.show();
    await until(el, () => names(el).length === 1);

    const select = $<HTMLSelectElement>(el, '[part~="version"]')!;
    expect(select.value).toBe('9003');
    select.value = '9002';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await settle(el);
    $(el, '[part~="select"]')!.click();

    const picked = await result;
    expect(picked).toEqual({
      modelId: 501,
      modelVersionId: 9002,
      name: 'Upscale Chain',
      versionName: 'v2',
      creatorUsername: 'maker',
      baseModel: 'SDXL 1.0',
      access: 'open',
      owner: 'any',
    });
    expect(picked).not.toHaveProperty('earlyAccessDeadline');
  });

  it('a version select does not leak a `change` out of the element', async () => {
    const el = await mount(fixedSource(() => page([WORKFLOW])));
    let leaked = 0;
    el.addEventListener('change', () => (leaked += 1));
    void el.show();
    await until(el, () => names(el).length === 1);
    const select = $<HTMLSelectElement>(el, '[part~="version"]')!;
    select.value = '9001';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    chooseOwner(el, 'mine');
    await settle(el);
    expect(leaked).toBe(0);
  });

  it('dismissing resolves null and fires `dismiss`, not `pick`', async () => {
    const el = await mount(fixedSource(() => page([WORKFLOW])));
    let dismissed = 0;
    let picked = 0;
    el.addEventListener('dismiss', () => (dismissed += 1));
    el.addEventListener('pick', () => (picked += 1));

    const result = el.show();
    await until(el, () => names(el).length === 1);
    const modal = $(el, 'civitai-modal')!;
    modal.shadowRoot!.querySelector<HTMLElement>('[part~="close"]')!.click();

    await expect(result).resolves.toBeNull();
    expect(dismissed).toBe(1);
    expect(picked).toBe(0);
    expect(el.open).toBe(false);
  });

  it('closing it from code resolves show() with null without a `dismiss`', async () => {
    const el = await mount(fixedSource(() => page([WORKFLOW])));
    let dismissed = 0;
    el.addEventListener('dismiss', () => (dismissed += 1));
    const result = el.show();
    await settle(el);
    el.open = false;
    await expect(result).resolves.toBeNull();
    expect(dismissed).toBe(0);
  });
});

describe('<civitai-resource-picker> owner', () => {
  it('asks the source for `mine` once the viewer switches lists', async () => {
    const { source, calls, called } = handSource();
    const el = await mount(source);
    void el.show();
    (await called(1)).resolve(page([WORKFLOW]));
    expect(calls[0]!.params.owner).toBe('any');

    chooseOwner(el, 'mine');
    const second = await called(2);
    expect(second.params).toEqual({
      types: ['Workflows', 'ComfyWorkflows'],
      owner: 'mine',
      query: '',
      limit: 20,
    });
    second.resolve(page([OTHER], 'mine'));
    await until(el, () => names(el).join() === 'Portrait Relight');
  });

  it('a pick from the `mine` list says so', async () => {
    const el = await mount(fixedSource((p) => page([WORKFLOW], p.owner)), { owner: 'mine' });
    const result = el.show();
    await until(el, () => names(el).length === 1);
    $(el, '[part~="select"]')!.click();
    expect((await result)?.owner).toBe('mine');
  });

  it.each([
    ['answered `any`', 'any' as const],
    ['answered with no echo (a server older than the param)', undefined],
  ])('a `mine` search %s is an error, and no list is shown', async (_label, echo) => {
    const source: ResourceSource = {
      // A source that does not check the echo itself: the element must.
      search: async () => ({ items: [WORKFLOW], nextCursor: null, owner: echo as 'any' }),
    };
    const el = await mount(source, { owner: 'mine' });
    void el.show();
    await until(el, () => el.phase === 'error' || el.phase === 'ready');

    expect(el.phase).toBe('error');
    expect($(el, '[part~="error"]')!.dataset.kind).toBe('owner-unsupported');
    expect($(el, '[role="alert"]')!.textContent).toContain('could not list only your own workflows');
    expect($(el, '[part~="list"]')).toBeNull();
    expect(names(el)).toEqual([]);
  });

  it.each([
    ['attribute', (el: CivitaiResourcePicker) => el.setAttribute('owner', 'mine')],
    ['property', (el: CivitaiResourcePicker) => (el.owner = 'mine')],
  ])('an owner %s change while open drops the old list and searches `mine`', async (_how, change) => {
    const { source, calls, called } = handSource();
    const el = await mount(source);
    const result = el.show();
    (await called(1)).resolve(page([WORKFLOW], 'any'));
    await until(el, () => names(el).length === 1);

    change(el);
    await el.updateComplete;
    // Not one frame of the `any` rows under a checked "My" switch.
    expect(names(el)).toEqual([]);
    expect($<HTMLInputElement>(el, 'input[value="mine"]')!.checked).toBe(true);
    const second = await called(2);
    expect(second.params.owner).toBe('mine');
    expect(calls).toHaveLength(2);

    second.resolve(page([OTHER], 'mine'));
    await until(el, () => names(el).join() === 'Portrait Relight');
    $(el, '[part~="select"]')!.click();
    expect((await result)?.owner).toBe('mine');
  });

  it("a pick's `owner` is the list it was shown in, not the switch", async () => {
    const { source, called } = handSource();
    const el = await mount(source);
    const result = el.show();
    (await called(1)).resolve(page([WORKFLOW], 'any'));
    await until(el, () => names(el).length === 1);
    const select = $(el, '[part~="select"]')!;
    // The switch moves and the click lands in the same task, before any render.
    el.owner = 'mine';
    select.click();
    expect((await result)?.owner).toBe('any');
  });

  it('an `any` search is not held to the echo', async () => {
    const el = await mount(fixedSource(() => page([WORKFLOW], 'any')));
    void el.show();
    await until(el, () => names(el).length === 1);
    expect(el.phase).toBe('ready');
  });

  it('a 401 on `mine` asks the viewer to sign in', async () => {
    const el = await mount(
      { search: async () => Promise.reject(new ResourceSourceError('unauthorized', 'nope', { status: 401 })) },
      { owner: 'mine' }
    );
    void el.show();
    await until(el, () => el.phase === 'error');
    expect($(el, '[role="alert"]')!.textContent).toContain('Sign in to Civitai to see your own workflows');
  });
});

describe('<civitai-resource-picker> searching', () => {
  it('debounces typing into one search for the final text', async () => {
    const { source, calls, called } = handSource();
    const el = await mount(source);
    el.debounce = 40;
    void el.show();
    (await called(1)).resolve(page([WORKFLOW]));

    type(el, 'u');
    type(el, 'up');
    type(el, 'ups');
    await new Promise((r) => setTimeout(r, 120));
    await settle(el);

    expect(calls.map((c) => c.params.query)).toEqual(['', 'ups']);
  });

  it('aborts the search a newer one replaces', async () => {
    const { source, called } = handSource();
    const el = await mount(source);
    void el.show();
    const first = await called(1);
    expect(first.signal.aborted).toBe(false);

    type(el, 'relight');
    await called(2);
    expect(first.signal.aborted).toBe(true);
  });

  it('a stale answer never overwrites a fresh one', async () => {
    const { source, called } = handSource();
    const el = await mount(source);
    void el.show();
    const stale = await called(1);
    type(el, 'relight');
    const fresh = await called(2);

    // The fresh answer lands first, then the one it replaced — a source that
    // ignores `signal` can do exactly this.
    fresh.resolve(page([OTHER]));
    await until(el, () => names(el).join() === 'Portrait Relight');
    stale.resolve(page([WORKFLOW]));
    await settle(el);

    expect(names(el)).toEqual(['Portrait Relight']);
  });

  it('a stale FAILURE never replaces a fresh list either', async () => {
    const { source, called } = handSource();
    const el = await mount(source);
    void el.show();
    const stale = await called(1);
    type(el, 'relight');
    const fresh = await called(2);
    fresh.resolve(page([OTHER]));
    await until(el, () => names(el).length === 1);
    stale.reject(new ResourceSourceError('failed', 'old'));
    await settle(el);
    expect(el.phase).toBe('ready');
    expect(names(el)).toEqual(['Portrait Relight']);
  });

  it('loads the next page with the cursor and appends it', async () => {
    const { source, called } = handSource();
    const el = await mount(source);
    void el.show();
    (await called(1)).resolve(page([WORKFLOW], 'any', 'cur-2'));
    await until(el, () => $(el, '[part~="more"]') !== null);
    $(el, '[part~="more"]')!.click();
    const next = await called(2);
    expect(next.params.cursor).toBe('cur-2');
    next.resolve(page([OTHER]));
    await until(el, () => names(el).length === 2);
    expect(names(el)).toEqual(['Upscale Chain', 'Portrait Relight']);
    expect($(el, '[part~="more"]')).toBeNull();
  });

  it('a failed "Load more" keeps the list and retries the same page', async () => {
    const { source, called } = handSource();
    const el = await mount(source);
    void el.show();
    (await called(1)).resolve(page([WORKFLOW], 'any', 'cur-2'));
    await until(el, () => $(el, '[part~="more"]') !== null);
    $(el, '[part~="more"]')!.click();
    (await called(2)).reject(new ResourceSourceError('failed', 'The catalog request failed (500).'));
    await until(el, () => $(el, '[part~="more-error"]') !== null);

    expect(names(el)).toEqual(['Upscale Chain']);
    expect($(el, '[part~="more-error"]')!.getAttribute('role')).toBe('alert');
    $(el, '[part~="retry-more"]')!.click();
    const retry = await called(3);
    expect(retry.params.cursor).toBe('cur-2');
    retry.resolve(page([OTHER]));
    await until(el, () => names(el).length === 2);
    expect(names(el)).toEqual(['Upscale Chain', 'Portrait Relight']);
    expect($(el, '[part~="more-error"]')).toBeNull();
  });

  it.each([
    ['mine', 'You have not published any workflows yet.'],
    ['any', 'No workflows found.'],
  ] as const)('an empty %s list says so', async (owner, text) => {
    const el = await mount(fixedSource((p) => page([], p.owner)), { owner });
    void el.show();
    await until(el, () => el.phase === 'ready');
    expect($(el, '[part~="empty"]')!.textContent!.trim()).toBe(text);
  });
});

describe('<civitai-resource-picker> busy server', () => {
  const busy = (status: number) =>
    new ResourceSourceError('busy', 'Civitai is busy right now.', { status, retryAfterMs: 5 });

  it.each([429, 503])('shows a retry state on %i and recovers on its own', async (status) => {
    const { source, called } = handSource();
    const el = await mount(source);
    void el.show();
    (await called(1)).reject(busy(status));
    await until(el, () => el.phase === 'retrying');
    expect($(el, '[part~="retrying"]')!.getAttribute('role')).toBe('status');
    expect($(el, '[part~="list"]')).toBeNull();

    (await called(2)).resolve(page([WORKFLOW]));
    await until(el, () => names(el).length === 1);
    expect(el.phase).toBe('ready');
  });

  it(`gives up after ${MAX_AUTO_RETRIES} automatic retries and offers one`, async () => {
    const { source, calls, called } = handSource();
    const el = await mount(source);
    void el.show();
    for (let n = 1; n <= MAX_AUTO_RETRIES + 1; n++) (await called(n)).reject(busy(429));
    await until(el, () => el.phase === 'error');
    await new Promise((r) => setTimeout(r, 30));
    expect(calls).toHaveLength(MAX_AUTO_RETRIES + 1);

    $(el, '[part~="retry"]')!.click();
    (await called(MAX_AUTO_RETRIES + 2)).resolve(page([OTHER]));
    await until(el, () => names(el).length === 1);
  });

  // Regression guard for existing behaviour (#672 follow-up): the busy branch's
  // `if (append) return;` is what keeps page 1 on screen while page 2 waits.
  it('a busy "Load more" keeps the list while it retries the same cursor, then errors inline', async () => {
    const { source, calls, called } = handSource();
    const el = await mount(source);
    void el.show();
    (await called(1)).resolve(page([WORKFLOW], 'any', 'cur-2'));
    await until(el, () => $(el, '[part~="more"]') !== null);
    $(el, '[part~="more"]')!.click();

    for (let n = 2; n <= MAX_AUTO_RETRIES + 1; n++) {
      (await called(n)).reject(busy(503));
      // Each wait in between: page 1 is still the list, not a full-page retry.
      await settle(el);
      expect(el.phase).toBe('ready');
      expect(names(el)).toEqual(['Upscale Chain']);
      expect($(el, '[part~="retrying"]')).toBeNull();
    }
    (await called(MAX_AUTO_RETRIES + 2)).reject(busy(503));
    await until(el, () => $(el, '[part~="more-error"]') !== null);
    await new Promise((r) => setTimeout(r, 30));

    expect(calls).toHaveLength(MAX_AUTO_RETRIES + 2);
    expect(calls.slice(1).map((c) => c.params.cursor)).toEqual(Array(MAX_AUTO_RETRIES + 1).fill('cur-2'));
    expect(names(el)).toEqual(['Upscale Chain']);
    expect(el.phase).toBe('ready');
    expect($(el, '[part~="more-error"]')!.textContent).toContain('Civitai is busy right now.');
  });
});

describe('<civitai-resource-picker> badges', () => {
  it('marks an early-access version with its deadline, and a paid one', async () => {
    const el = await mount(fixedSource(() => page([WORKFLOW])));
    void el.show();
    await until(el, () => names(el).length === 1);

    const early = $(el, '[part~="early-access"]')!;
    expect(early.textContent).toContain('Early access until');
    expect(early.textContent).toContain(String(new Date(FUTURE).getFullYear()));
    expect($(el, '[part~="paid"]')).toBeNull();
    const options = $$(el, 'option').map((o) => o.textContent!.trim());
    expect(options).toEqual(['v3 · Flux.1 D · Early access', 'v2 · SDXL 1.0', 'v1 · SD 1.5 · Paid']);

    const select = $<HTMLSelectElement>(el, '[part~="version"]')!;
    select.value = '9001';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await settle(el);
    expect($(el, '[part~="early-access"]')).toBeNull();
    expect($(el, '[part~="paid"]')!.textContent!.trim()).toBe('Paid');
  });

  it('says early access without a date when the gate has no end yet', async () => {
    const pending = { ...OTHER, versions: [{ id: 4401, name: 'first', baseModel: null, access: 'early-access' as const }] };
    const el = await mount(fixedSource(() => page([pending])));
    void el.show();
    await until(el, () => names(el).length === 1);
    expect($(el, '[part~="early-access"]')!.textContent!.trim()).toBe('Early access');
  });

  it('shows no badge for an ungated version', async () => {
    const el = await mount(fixedSource(() => page([OTHER])));
    void el.show();
    await until(el, () => names(el).length === 1);
    expect($(el, '[part~="badge"]')).toBeNull();
  });
});

describe('<civitai-resource-picker> with blockTokenSource', () => {
  const ORIGIN = 'https://host.example';

  function stubFetch(respond: (url: string) => Response) {
    const urls: string[] = [];
    const auth: (string | null)[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      urls.push(url);
      auth.push(new Headers(init?.headers).get('Authorization'));
      return respond(url);
    }) as typeof fetch;
    return { urls, auth, fetchImpl };
  }

  const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

  const raw = {
    id: 501,
    name: 'Upscale Chain',
    type: 'Workflows',
    creator: { username: 'maker' },
    // The live shape: a timed gate (early access), an ungated version, a
    // permanent gate (no `earlyAccessDeadline` — the server sets it only for a
    // timed one), and a timed gate whose end is not set yet. The last row is a
    // stray `earlyAccessDeadline` with no gate: the server never sends that
    // (both come from one active PaidAccess row), so it reads as open.
    modelVersions: [
      { id: 9003, name: 'v3', baseModel: 'Flux.1 D', earlyAccessDeadline: FUTURE, paidAccess: { permanent: false, endsAt: FUTURE } },
      { id: 9002, name: 'v2', baseModel: 'SDXL 1.0', paidAccess: null },
      { id: 9001, name: 'v1', baseModel: 'SD 1.5', paidAccess: { permanent: true, endsAt: null } },
      { id: 9000, name: 'v0', baseModel: 'SD 1.5', paidAccess: { permanent: false, endsAt: null } },
      { id: 8999, name: 'beta', baseModel: 'SD 1.5', earlyAccessDeadline: PAST, paidAccess: null },
    ],
  };

  it('builds the request URL the toggle implies, with the token', async () => {
    const { urls, auth, fetchImpl } = stubFetch((url) =>
      json({ items: [raw], metadata: { owner: new URL(url).searchParams.get('owner') } })
    );
    const el = await mount(blockTokenSource({ origin: `${ORIGIN}/`, getToken: () => 'tok-1', fetch: fetchImpl }));
    void el.show();
    await until(el, () => names(el).length === 1);
    chooseOwner(el, 'mine');
    await until(el, () => urls.length === 2 && el.phase === 'ready');

    expect(urls).toEqual([
      `${ORIGIN}/api/v1/blocks/models?types=Workflows&types=ComfyWorkflows&owner=any&limit=20`,
      `${ORIGIN}/api/v1/blocks/models?types=Workflows&types=ComfyWorkflows&owner=mine&limit=20`,
    ]);
    expect(auth).toEqual(['Bearer tok-1', 'Bearer tok-1']);
    expect(names(el)).toEqual(['Upscale Chain']);
  });

  it('reads the access gate off `paidAccess` alone', async () => {
    const { fetchImpl } = stubFetch(() => json({ items: [raw], metadata: { owner: 'any' } }));
    const result = await blockTokenSource({ origin: ORIGIN, getToken: () => 't', fetch: fetchImpl }).search(
      { types: ['Workflows'], owner: 'any' },
      new AbortController().signal
    );
    expect(result).toEqual({
      items: [
        {
          modelId: 501,
          name: 'Upscale Chain',
          type: 'Workflows',
          creatorUsername: 'maker',
          versions: [
            { id: 9003, name: 'v3', baseModel: 'Flux.1 D', access: 'early-access', earlyAccessDeadline: FUTURE },
            { id: 9002, name: 'v2', baseModel: 'SDXL 1.0', access: 'open' },
            { id: 9001, name: 'v1', baseModel: 'SD 1.5', access: 'paid' },
            { id: 9000, name: 'v0', baseModel: 'SD 1.5', access: 'early-access' },
            { id: 8999, name: 'beta', baseModel: 'SD 1.5', access: 'open' },
          ],
        },
      ],
      nextCursor: null,
      owner: 'any',
    });
  });

  it.each([
    ['absent', { nextCursor: null }, 'any'],
    ['`any`', { owner: 'any' }, 'any'],
    ['`mine`', { owner: 'mine' }, 'mine'],
  ])('reports a page whose echo is %s as that owner', async (_label, metadata, owner) => {
    const { fetchImpl } = stubFetch(() => json({ items: [raw], metadata }));
    const result = await blockTokenSource({ origin: ORIGIN, getToken: () => 't', fetch: fetchImpl }).search(
      { types: ['Workflows'], owner: 'mine' },
      new AbortController().signal
    );
    expect(result.owner).toBe(owner);
  });

  it.each([
    ['absent', { nextCursor: null }],
    ['`any`', { owner: 'any' }],
  ])('through blockTokenSource, a `mine` page whose echo is %s shows an error, not a list', async (_label, metadata) => {
    const { fetchImpl } = stubFetch(() => json({ items: [raw], metadata }));
    const el = await mount(blockTokenSource({ origin: ORIGIN, getToken: () => 't', fetch: fetchImpl }), {
      owner: 'mine',
    });
    void el.show();
    await until(el, () => el.phase === 'error' || el.phase === 'ready');
    expect(el.phase).toBe('error');
    expect($(el, '[part~="error"]')!.dataset.kind).toBe('owner-unsupported');
    expect(names(el)).toEqual([]);
  });

  it.each([401, 403, 404])(
    'never falls back to the public /api/v1/models on a %i for `mine`',
    async (status) => {
      const { urls, fetchImpl } = stubFetch(() => json({ error: 'no' }, status));
      const el = await mount(
        blockTokenSource({ origin: ORIGIN, getToken: () => 't', fetch: fetchImpl }),
        { owner: 'mine' }
      );
      void el.show();
      await until(el, () => el.phase === 'error');
      await new Promise((r) => setTimeout(r, 20));

      // Positive control: the instrument does see requests.
      expect(urls.length).toBeGreaterThan(0);
      expect(urls.every((u) => new URL(u).pathname === '/api/v1/blocks/models')).toBe(true);
      expect(urls.filter((u) => new URL(u).pathname === '/api/v1/models')).toEqual([]);
      expect(names(el)).toEqual([]);
    }
  );

  it('on a 401, asks for a fresh token once and retries with it', async () => {
    const asked: boolean[] = [];
    const { auth, fetchImpl } = stubFetch(() => json({ items: [], metadata: { owner: 'any' } }));
    const gated = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await fetchImpl(input, init);
      return new Headers(init?.headers).get('Authorization') === 'Bearer stale' ? json({ error: 'expired' }, 401) : response;
    }) as typeof fetch;
    const page1 = await blockTokenSource({
      origin: ORIGIN,
      getToken: (opts) => {
        const fresh = opts?.fresh === true;
        asked.push(fresh);
        return fresh ? 'renewed' : 'stale';
      },
      fetch: gated,
    }).search({ types: ['Workflows'], owner: 'any' }, new AbortController().signal);
    expect(page1.owner).toBe('any');
    expect(asked).toEqual([false, true]);
    expect(auth).toEqual(['Bearer stale', 'Bearer renewed']);
  });

  it('a 401 the fresh token cannot fix is `unauthorized`, after one request', async () => {
    const { auth, fetchImpl } = stubFetch(() => json({ error: 'Sign-in required' }, 401));
    await expect(
      blockTokenSource({ origin: ORIGIN, getToken: () => 'same', fetch: fetchImpl }).search(
        { types: ['Workflows'], owner: 'mine' },
        new AbortController().signal
      )
    ).rejects.toMatchObject({ kind: 'unauthorized', status: 401 });
    expect(auth).toEqual(['Bearer same']);
  });

  it('a `mine` 401 for a viewer known to be anonymous is final: one request, no fresh token', async () => {
    const asked: boolean[] = [];
    const { auth, fetchImpl } = stubFetch(() => json({ error: 'Sign-in required' }, 401));
    const el = await mount(
      blockTokenSource({
        origin: ORIGIN,
        getToken: (opts) => {
          asked.push(opts?.fresh === true);
          return opts?.fresh ? 'renewed' : 'anon-token';
        },
        signedIn: () => false,
        fetch: fetchImpl,
      }),
      { owner: 'mine' }
    );
    void el.show();
    await until(el, () => el.phase === 'error');
    await new Promise((r) => setTimeout(r, 20));

    expect(auth).toEqual(['Bearer anon-token']);
    expect(asked).toEqual([false]);
    expect($(el, '[part~="error"]')!.dataset.kind).toBe('unauthorized');
  });

  it.each([
    ['`mine`, signed in', 'mine', true],
    ['`mine`, viewer not known yet', 'mine', undefined],
    ['`any`, anonymous', 'any', false],
  ] as const)('any other 401 (%s) still gets the one fresh-token retry', async (_label, owner, signedIn) => {
    const asked: boolean[] = [];
    const { auth, fetchImpl } = stubFetch(() => json({ items: [], metadata: { owner } }));
    const gated = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await fetchImpl(input, init);
      return new Headers(init?.headers).get('Authorization') === 'Bearer stale' ? json({ error: 'invalid block token' }, 401) : response;
    }) as typeof fetch;
    const result = await blockTokenSource({
      origin: ORIGIN,
      getToken: (opts) => {
        asked.push(opts?.fresh === true);
        return opts?.fresh ? 'renewed' : 'stale';
      },
      signedIn: () => signedIn,
      fetch: gated,
    }).search({ types: ['Workflows'], owner }, new AbortController().signal);
    expect(result.owner).toBe(owner);
    expect(asked).toEqual([false, true]);
    expect(auth).toEqual(['Bearer stale', 'Bearer renewed']);
  });

  it('carries Retry-After from a 429 into the wait', async () => {
    const { fetchImpl } = stubFetch(() => json({ error: 'slow down' }, 429, { 'Retry-After': '7' }));
    await expect(
      blockTokenSource({ origin: ORIGIN, getToken: () => 't', fetch: fetchImpl }).search(
        { types: ['Workflows'], owner: 'any' },
        new AbortController().signal
      )
    ).rejects.toMatchObject({ kind: 'busy', status: 429, retryAfterMs: 7000 });
  });
});

describe('<civitai-resource-picker> accessibility', () => {
  it('has no axe violations with a list showing', async () => {
    const el = await mount(fixedSource(() => page([WORKFLOW, OTHER])));
    void el.show();
    await until(el, () => names(el).length === 2);
    const results = await axe.run(el, {
      rules: { 'color-contrast': { enabled: false } },
      resultTypes: ['violations'],
    });
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });

  it('labels the search box, the list switch and every version select', async () => {
    const el = await mount(fixedSource(() => page([WORKFLOW])));
    void el.show();
    await until(el, () => names(el).length === 1);
    const search = $<HTMLInputElement>(el, '[part~="search"]')!;
    expect(search.labels?.[0]?.textContent).toBe('Search workflows');
    expect($(el, 'legend')!.textContent).toBe('Whose workflows');
    expect($<HTMLSelectElement>(el, '[part~="version"]')!.labels?.[0]?.textContent).toBe(
      'Version of Upscale Chain'
    );
  });

  it('searches on Enter without waiting for the debounce', async () => {
    const { source, calls, called } = handSource();
    const el = await mount(source);
    el.debounce = 10_000;
    void el.show();
    (await called(1)).resolve(page([WORKFLOW]));
    type(el, 'chain');
    $(el, '[part~="search"]')!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, composed: true })
    );
    await called(2);
    expect(calls[1]!.params.query).toBe('chain');
  });
});

describe('<civitai-resource-picker> theme', () => {
  /** What a token resolves to under `scope`, as a computed colour. */
  function resolved(scopeEl: HTMLElement, token: string): string {
    const probe = document.createElement('span');
    probe.style.color = `var(${token})`;
    scopeEl.append(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();
    return value;
  }

  it.each(['light', 'dark'])('paints rows and text from the %s tokens', async (theme) => {
    const el = await mount(fixedSource(() => page([WORKFLOW])));
    scope!.setAttribute('data-theme', theme);
    void el.show();
    await until(el, () => names(el).length === 1);
    const item = $(el, '[part~="item"]')!;
    const name = $(el, '[part~="name"]')!;
    expect(getComputedStyle(item).backgroundColor).toBe(resolved(scope!, '--civitai-color-surface'));
    expect(getComputedStyle(name).color).toBe(resolved(scope!, '--civitai-color-text'));
  });

  it('the two themes differ, so the case above can tell them apart', async () => {
    const el = await mount(fixedSource(() => page([WORKFLOW])));
    void el.show();
    await until(el, () => names(el).length === 1);
    const item = $(el, '[part~="item"]')!;
    scope!.setAttribute('data-theme', 'light');
    const light = getComputedStyle(item).backgroundColor;
    scope!.setAttribute('data-theme', 'dark');
    const dark = getComputedStyle(item).backgroundColor;
    expect(light).not.toBe(dark);
  });
});
