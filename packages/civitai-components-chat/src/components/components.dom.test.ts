import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { CardJob, CardState } from './lib/civitai-chat-generation-card.js';
import type { CardPost, PostCardState } from './lib/civitai-chat-post-card.js';
import { defineElements } from './define.js';

beforeAll(() => defineElements());
afterEach(() => document.body.replaceChildren());

async function mount<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}) {
  const el = document.createElement(tag);
  Object.assign(el, props);
  document.body.append(el);
  await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
  return el;
}

describe('civitai-chat-composer', () => {
  const setup = async (props = {}) => {
    const composer = await mount('civitai-chat-composer', props);
    const area = composer.querySelector('textarea')!;
    const sent: string[] = [];
    const stopped: unknown[] = [];
    composer.addEventListener('cvt-send', (e) => sent.push((e as CustomEvent<{ text: string }>).detail.text));
    composer.addEventListener('cvt-stop', (e) => stopped.push(e));
    const type = async (text: string) => {
      area.value = text;
      area.dispatchEvent(new Event('input'));
      await composer.updateComplete;
    };
    const key = (init: KeyboardEventInit) => area.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
    return { composer, sent, stopped, type, key };
  };

  it('sends on Enter and keeps Shift+Enter and IME composition for writing', async () => {
    const { sent, type, key } = await setup();
    await type('a red bike');
    key({ key: 'Enter', shiftKey: true });
    key({ key: 'Enter', isComposing: true });
    expect(sent).toEqual([]);
    key({ key: 'Enter' });
    expect(sent).toEqual(['a red bike']);
  });

  it('does not send while a file is still uploading', async () => {
    const file = new File(['x'], 'p.png', { type: 'image/png' });
    const { sent, type, key } = await setup({ uploads: [{ key: 'u', file, progress: 0.4 }] });
    await type('use this');
    key({ key: 'Enter' });
    expect(sent).toEqual([]);
  });

  it('stops a reply with Escape', async () => {
    const { stopped, key } = await setup({ running: true });
    key({ key: 'Escape' });
    expect(stopped).toHaveLength(1);
  });
});

class FakeJob extends EventTarget implements CardJob {
  label = 'Making your picture';
  subject = 'Your picture';
  state: CardState;
  price: { total: number; variable: boolean } | null = { total: 44, variable: false };
  progress: number | null = null;
  queued: number | null = null;
  error?: { message: string; detail?: string };
  results: CardJob['results'] = [];
  cancelable = false;
  workflowId?: string;
  confirm = vi.fn(async () => undefined);
  decline = vi.fn();
  cancel = vi.fn(async () => undefined);
  retry = vi.fn(async () => undefined);
  constructor(state: CardState, extra: Partial<FakeJob> = {}) {
    super();
    this.state = state;
    Object.assign(this, extra);
  }
}

describe('civitai-chat-generation-card', () => {
  const text = (el: Element) => (el.shadowRoot?.textContent ?? '').replace(/\s+/g, ' ');

  it('asks before spending above the limit and runs on Go ahead', async () => {
    const job = new FakeJob('awaiting_confirmation');
    const card = await mount('civitai-chat-generation-card', { job });
    expect(text(card)).toContain('Costs about 44 Buzz. Make it?');
    expect(card.shadowRoot!.querySelector('[part=label]')?.textContent).toBe('Your picture');
    card.shadowRoot!.querySelector<HTMLElement>('[part=confirm]')!.click();
    expect(job.confirm).toHaveBeenCalled();
  });

  it('shows the wait in plain words and follows the job as it changes', async () => {
    const job = new FakeJob('running', { queued: 3 });
    const card = await mount('civitai-chat-generation-card', { job });
    expect(text(card)).toContain('Waiting in line… 3 ahead');
    job.queued = null;
    job.progress = 0.4;
    job.dispatchEvent(new Event('change'));
    await card.updateComplete;
    expect(text(card)).toContain('Making your picture… 40%');
  });

  it('points to getting Buzz when there is not enough', async () => {
    const card = await mount('civitai-chat-generation-card', { job: new FakeJob('rejected') });
    expect(card.shadowRoot!.querySelector<HTMLAnchorElement>('[part=buy]')?.href).toBe('https://civitai.com/purchase/buzz');
  });

  it('shows results with next steps and keeps technical details behind a disclosure', async () => {
    const job = new FakeJob('succeeded', {
      workflowId: '7-20260923120000000',
      results: [{ id: 'gen1-1-1', kind: 'image', url: 'https://x/a.png' }],
    });
    const card = await mount('civitai-chat-generation-card', { job });
    const actions: unknown[] = [];
    card.addEventListener('media-action', (e) => actions.push((e as CustomEvent).detail));
    const buttons = [...card.shadowRoot!.querySelectorAll('[part=actions] civitai-button')] as HTMLElement[];
    expect(buttons.map((b) => b.textContent?.trim())).toEqual(['Use in chat', 'Animate', 'Sharpen', 'Info', 'Download']);
    buttons[1]!.click();
    expect(actions).toEqual([{ id: 'gen1-1-1', action: 'animate' }]);
    const visible = text(card).replace(/Details.*$/, '');
    expect(visible).not.toMatch(/urn:air|engine|workflow|seed|cfg/i);
    expect(card.shadowRoot!.querySelector('details')?.textContent).toContain('7-20260923120000000');
  });

  it('offers what it is making while it waits, before there is a result to open', async () => {
    const card = await mount('civitai-chat-generation-card', { job: new FakeJob('running', { queued: 3 }) });
    const asked: unknown[] = [];
    card.addEventListener('job-info', (e) => asked.push(e));
    card.shadowRoot!.querySelector<HTMLElement>('[part=info]')!.click();
    expect(asked).toHaveLength(1);
  });

  it('offers to try again after a failure, in the words the job gave', async () => {
    const job = new FakeJob('failed', { error: { message: 'That request was blocked by the safety filter.' } });
    const card = await mount('civitai-chat-generation-card', { job });
    expect(text(card)).toContain('blocked by the safety filter');
    ([...card.shadowRoot!.querySelectorAll('civitai-button')] as HTMLElement[]).find((b) => b.textContent?.includes('Try again'))!.click();
    expect(job.retry).toHaveBeenCalled();
  });
});

class FakePost extends EventTarget implements CardPost {
  items = [{ id: 'gen1-1-1', kind: 'image' as const, url: 'https://x/a.png' }];
  title = 'Red bike';
  state: PostCardState = 'ready';
  url?: string;
  error?: { message: string; detail?: string };
  submit = vi.fn(async () => undefined);
  dismiss = vi.fn();
}

describe('civitai-chat-post-card', () => {
  it('hands the post to Civitai only when the button is pressed, then links to it', async () => {
    const post = new FakePost();
    const card = await mount('civitai-chat-post-card', { post });
    expect(post.submit).not.toHaveBeenCalled();
    card.shadowRoot!.querySelector<HTMLElement>('[part=publish]')!.click();
    expect(post.submit).toHaveBeenCalled();
    post.state = 'posted';
    post.url = 'https://civitai.com/posts/123';
    post.dispatchEvent(new Event('change'));
    await card.updateComplete;
    expect(card.shadowRoot!.querySelector<HTMLAnchorElement>('[part=link]')?.href).toBe('https://civitai.com/posts/123');
  });
});

describe('civitai-chat-generation-details', () => {
  it('shows the prompt and links the Civitai model it was made with, by name', async () => {
    const models = { get: vi.fn(async () => ({ href: '', name: 'Anima', versions: [{ id: 2945208, name: 'v1.0' }] })) };
    const el = await mount('civitai-chat-generation-details', {
      models: models as never,
      details: {
        texts: [{ label: 'Prompt', text: 'a cozy cabin' }],
        resources: [{ air: 'urn:air:anima:checkpoint:civitai:2458426@2945208', modelId: 2458426, versionId: 2945208, kind: 'model' }],
        settings: [{ label: 'Steps', value: '30' }],
        cost: 13,
      },
    });
    await vi.waitFor(() => expect(el.querySelector('a')?.textContent).toBe('Anima · v1.0'));
    expect(el.querySelector('a')?.getAttribute('href')).toBe('https://civitai.com/models/2458426?modelVersionId=2945208');
    expect(el.textContent).toContain('a cozy cabin');
    expect(el.textContent).toContain('13 Buzz');
  });
});

describe('civitai-chat-thread', () => {
  it('shows what the agent streams into the same live turn, without new objects', async () => {
    const turn = { seq: 1, createdAt: '', user: { content: 'hi', attachments: [] }, assistant: { messages: [], status: 'streaming' as const } };
    const live = { seq: 1, parts: [] as { kind: 'text'; text: string }[] };
    const thread = await mount('civitai-chat-thread', { turns: [turn], live, jobs: { byToolCall: () => undefined, get: () => undefined } as never });
    await thread.querySelector('civitai-chat-turn')!.updateComplete;
    live.parts.push({ kind: 'text', text: 'Hello there' });
    thread.live = live;
    await thread.updateComplete;
    await thread.querySelector('civitai-chat-turn')!.updateComplete;
    expect(thread.textContent).toContain('Hello there');
  });

  it('shows a failed reply in plain words, with what the service said under Details', async () => {
    const turn = {
      seq: 1,
      createdAt: '',
      user: { content: 'hi', attachments: [] },
      assistant: { messages: [], status: 'error' as const, error: "The assistant isn't available right now.", errorDetail: 'Chat completion failed (workflow 6-1)' },
    };
    const thread = await mount('civitai-chat-thread', { turns: [turn], jobs: { byToolCall: () => undefined, get: () => undefined } as never });
    await thread.querySelector('civitai-chat-turn')!.updateComplete;
    const alert = thread.querySelector('civitai-alert')!;
    expect(alert.textContent).toContain("The assistant isn't available right now.");
    expect(alert.querySelector('details')!.textContent).toContain('workflow 6-1');
  });

  it('keeps showing that the assistant is busy after a tool finishes and before the next words arrive', async () => {
    const turn = { seq: 1, createdAt: '', user: { content: 'hi', attachments: [] }, assistant: { messages: [], status: 'streaming' as const } };
    const live = { seq: 1, parts: [{ kind: 'tool', toolCallId: 't1', toolName: 'find_services', input: {}, state: 'done', output: 'x' }] };
    const thread = await mount('civitai-chat-thread', { turns: [turn], live: live as never, jobs: { byToolCall: () => undefined, get: () => undefined } as never });
    await thread.querySelector('civitai-chat-turn')!.updateComplete;
    expect(thread.querySelector('.cvt-typing')).not.toBeNull();
  });

  it('keeps the latest message in view while pictures above it load, until the reader scrolls away', async () => {
    let grew = (): void => undefined;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          grew = callback;
        }
        observe(): void {}
        disconnect(): void {}
      },
    );
    let height = 2000;
    let top = 0;
    const layout = (el: HTMLElement) => {
      Object.defineProperty(el, 'scrollHeight', { get: () => height });
      Object.defineProperty(el, 'clientHeight', { get: () => 500 });
      Object.defineProperty(el, 'scrollTop', { get: () => top, set: (value: number) => (top = Math.min(value, height - 500)) });
      el.scrollTo = () => undefined;
    };
    const originalQuery = HTMLElement.prototype.querySelector;
    vi.spyOn(HTMLElement.prototype, 'querySelector').mockImplementation(function (this: HTMLElement, selector: string) {
      const found = originalQuery.call(this, selector) as HTMLElement | null;
      if (found?.classList.contains('cvt-thread-scroll') && !Object.hasOwn(found, 'scrollTop')) layout(found);
      return found;
    });
    const turn = { seq: 1, createdAt: '', user: { content: 'hi', attachments: [] }, assistant: { messages: [], status: 'done' as const } };
    const thread = await mount('civitai-chat-thread', { turns: [turn], jobs: { byToolCall: () => undefined, get: () => undefined } as never });
    const scroller = thread.querySelector<HTMLElement>('.cvt-thread-scroll')!;
    const scrollTo = async (value: number) => {
      top = value;
      scroller.dispatchEvent(new Event('scroll'));
      await thread.updateComplete;
    };
    expect(top).toBe(1500);

    height = 3000;
    grew();
    expect(top).toBe(2500);

    await scrollTo(1000);
    height = 3400;
    grew();
    expect(top).toBe(1000);

    thread.querySelector<HTMLElement>('.cvt-jump')!.click();
    await scrollTo(1800);
    expect(thread.querySelector('.cvt-jump')).toBeNull();
    height = 3800;
    grew();
    expect(top).toBe(3300);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
});

describe('civitai-chat-dropzone', () => {
  it('passes on accepted files and names the ones it refused', async () => {
    const zone = await mount('civitai-chat-dropzone', { accept: 'image/*,video/mp4', maxSize: 10 });
    const got: unknown[] = [];
    zone.addEventListener('files', (e) => got.push((e as CustomEvent<{ files: File[] }>).detail.files.map((f) => f.name)));
    zone.addEventListener('rejected', (e) => got.push((e as CustomEvent<{ reason: string }>).detail.reason));
    zone.take([new File(['x'], 'a.png', { type: 'image/png' }), new File(['x'], 'b.pdf', { type: 'application/pdf' }), new File(['x'.repeat(20)], 'c.mp4', { type: 'video/mp4' })]);
    expect(got).toEqual(['type', 'size', ['a.png']]);
  });

  it('lets a drop on a paste-only zone fall through to the zone around it, taking the file once', async () => {
    const outer = await mount('civitai-chat-dropzone', { accept: 'image/*' });
    const inner = document.createElement('civitai-chat-dropzone');
    inner.noDrop = true;
    outer.append(inner);
    await inner.updateComplete;
    const taken: string[] = [];
    outer.addEventListener('files', (e) => taken.push(...(e as CustomEvent<{ files: File[] }>).detail.files.map((f) => f.name)));

    const drop = new Event('drop', { bubbles: true, composed: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', { value: { types: ['Files'], files: [new File(['x'], 'cat.png', { type: 'image/png' })] } });
    inner.dispatchEvent(drop);

    expect(taken).toEqual(['cat.png']);
    expect(drop.defaultPrevented).toBe(true);
  });
});
