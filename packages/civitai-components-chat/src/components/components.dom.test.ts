import type { Workflow } from '@civitai/sdk';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { controllable, imageStep, workflow } from '../test-support/fakes.js';
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

describe('civitai-chat-composer voice input', () => {
  function fakeMicrophone({ refuse = false } = {}) {
    const track = { stop: vi.fn() };
    class FakeRecorder extends EventTarget {
      static isTypeSupported = (type: string) => type.startsWith('audio/webm');
      state = 'inactive';
      mimeType = 'audio/webm;codecs=opus';
      start() {
        this.state = 'recording';
      }
      stop() {
        this.state = 'inactive';
        this.dispatchEvent(Object.assign(new Event('dataavailable'), { data: new Blob(['said'], { type: this.mimeType }) }));
        this.dispatchEvent(new Event('stop'));
      }
    }
    vi.stubGlobal('MediaRecorder', FakeRecorder);
    vi.stubGlobal('AudioContext', undefined);
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => (refuse ? Promise.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' })) : { getTracks: () => [track] })) },
    });
    return track;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(navigator, 'mediaDevices');
  });

  const press = async (composer: HTMLElement, label: string) => {
    composer.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!.click();
    await vi.waitFor(async () => {
      await (composer as unknown as { updateComplete: Promise<unknown> }).updateComplete;
    });
  };

  const listen = (composer: HTMLElement) => {
    const events: string[] = [];
    const phrases: Blob[] = [];
    for (const type of ['cvt-voice-start', 'cvt-voice-phrase', 'cvt-voice-done', 'cvt-voice-cancel']) {
      composer.addEventListener(type, (e) => {
        const detail = (e as CustomEvent<{ recording?: Blob; send?: boolean }>).detail;
        if (detail?.recording) phrases.push(detail.recording);
        events.push(type === 'cvt-voice-done' ? `done:${detail!.send ? 'send' : 'edit'}` : type.replace('cvt-voice-', ''));
      });
    }
    return { events, phrases };
  };

  it('hands over what the viewer said, then asks for it to be sent, releasing the microphone', async () => {
    const track = fakeMicrophone();
    const composer = await mount('civitai-chat-composer', { voice: true });
    const { events, phrases } = listen(composer);

    await press(composer, 'Talk instead of typing');
    await vi.waitFor(() => expect(composer.querySelector('[aria-label="Recording your voice"]')).not.toBeNull());
    expect(composer.querySelector('textarea')).toBeNull();

    await press(composer, 'Send what you said');
    await vi.waitFor(() => expect(events).toEqual(['start', 'phrase', 'done:send']));
    expect(phrases[0]!.size).toBeGreaterThan(0);
    expect(track.stop).toHaveBeenCalled();
    await vi.waitFor(() => expect(composer.querySelector('textarea')).not.toBeNull());
  });

  it('stops for editing, or throws the recording away on cancel', async () => {
    fakeMicrophone();
    const composer = await mount('civitai-chat-composer', { voice: true });
    const { events } = listen(composer);

    await press(composer, 'Talk instead of typing');
    await vi.waitFor(() => expect(composer.querySelector('[aria-label="Recording your voice"]')).not.toBeNull());
    await press(composer, 'Cancel recording');
    await vi.waitFor(() => expect(composer.querySelector('textarea')).not.toBeNull());
    expect(events).toEqual(['start', 'cancel']);

    await press(composer, 'Talk instead of typing');
    await vi.waitFor(() => expect(composer.querySelector('[aria-label="Recording your voice"]')).not.toBeNull());
    await press(composer, 'Stop and edit the text');
    await vi.waitFor(() => expect(events.slice(2)).toEqual(['start', 'phrase', 'done:edit']));
  });

  it('streams speech as 16 kHz PCM where the browser has audio worklets', async () => {
    fakeMicrophone();
    const nodes: { port: { onmessage: ((event: { data: Float32Array }) => void) | null } }[] = [];
    class FakeNode {
      port = { onmessage: null };
      constructor() {
        nodes.push(this);
      }
      connect<T>(next: T) {
        return next;
      }
    }
    class FakeContext {
      sampleRate = 48_000;
      destination = {};
      audioWorklet = { addModule: async () => undefined };
      createGain() {
        return { gain: { value: 1 }, connect: <T>(next: T) => next };
      }
      createMediaStreamSource() {
        return { connect: <T>(next: T) => next };
      }
      close() {
        return Promise.resolve();
      }
    }
    vi.stubGlobal('AudioWorkletNode', FakeNode);
    vi.stubGlobal('AudioContext', FakeContext);
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:worklet', revokeObjectURL: () => undefined }));
    const composer = await mount('civitai-chat-composer', { voice: true });
    const started: { live: boolean }[] = [];
    const audio: Int16Array[] = [];
    composer.addEventListener('cvt-voice-start', (e) => started.push((e as CustomEvent<{ live: boolean }>).detail));
    composer.addEventListener('cvt-voice-audio', (e) => audio.push((e as CustomEvent<{ pcm: Int16Array }>).detail.pcm));

    await press(composer, 'Talk instead of typing');
    await vi.waitFor(() => expect(started).toEqual([{ live: true }]));
    nodes[0]!.port.onmessage!({ data: new Float32Array(2048).fill(0.4) });

    expect(audio).toHaveLength(1);
    expect(Math.abs(audio[0]!.length - 2048 / 3)).toBeLessThanOrEqual(1);
  });

  it('lets the viewer say which language they speak', async () => {
    fakeMicrophone();
    const composer = await mount('civitai-chat-composer', { voice: true, voiceLanguage: 'en' });
    const chosen: string[] = [];
    composer.addEventListener('cvt-voice-language', (e) => chosen.push((e as CustomEvent<{ language: string }>).detail.language));
    const picker = composer.querySelector<HTMLSelectElement>('select[aria-label="The language you speak"]')!;
    expect(picker.closest('label')!.textContent).toContain('EN');

    picker.value = 'nl';
    picker.dispatchEvent(new Event('change'));
    expect(chosen).toEqual(['nl']);
  });

  it('shows the words heard so far while the viewer is still talking', async () => {
    fakeMicrophone();
    const composer = await mount('civitai-chat-composer', { voice: true });
    await press(composer, 'Talk instead of typing');
    await vi.waitFor(() => expect(composer.querySelector('[aria-label="Recording your voice"]')).not.toBeNull());

    composer.heard = 'Paint me a snowy cabin';
    await composer.updateComplete;
    expect(composer.querySelector('.cvt-heard')?.textContent).toBe('Paint me a snowy cabin');
  });

  it('shows plainly that it is turning the recording into text, and lets the viewer stop it', async () => {
    const composer = await mount('civitai-chat-composer', { voice: true, transcribing: true });
    const canceled: unknown[] = [];
    composer.addEventListener('cvt-voice-cancel', (e) => canceled.push(e));

    const status = composer.querySelector('[role="status"]')!;
    expect(status.textContent).toContain('Turning what you said into text');
    expect(status.querySelector('.cvt-spinner')).not.toBeNull();
    expect(composer.querySelector('textarea')).toBeNull();

    await press(composer, 'Stop transcribing');
    expect(canceled).toHaveLength(1);
  });

  it('says why when the microphone is refused', async () => {
    fakeMicrophone({ refuse: true });
    const composer = await mount('civitai-chat-composer', { voice: true });
    const problems: unknown[] = [];
    composer.addEventListener('cvt-voice-error', (e) => problems.push((e as CustomEvent<{ error: unknown }>).detail.error));

    await press(composer, 'Talk instead of typing');
    await vi.waitFor(() => expect(problems).toHaveLength(1));
    expect((problems[0] as Error).name).toBe('NotAllowedError');
    expect(composer.querySelector('textarea')).not.toBeNull();
  });
});

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

  it('suggests slash commands while one is typed, and completes the only match on Tab', async () => {
    const { composer, type, key } = await setup();
    await type('/mo');
    expect([...composer.querySelectorAll('.cvt-commands code')].map((c) => c.textContent)).toEqual(['/model [default | smart | model id]']);
    key({ key: 'Tab' });
    await composer.updateComplete;
    expect(composer.querySelector('textarea')!.value).toBe('/model ');
    expect(composer.querySelector('.cvt-commands')).toBeNull();
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
    expect(card.shadowRoot!.querySelector('h3')?.textContent).toBe('Your picture');
    const items = [...card.shadowRoot!.querySelectorAll('[part=actions] civitai-menu-item')] as HTMLElement[];
    expect(items.map((b) => b.textContent?.trim())).toEqual(['Use in chat', 'Animate', 'Sharpen', 'Info', 'Download']);
    expect(card.shadowRoot!.querySelector('[part=actions] [slot=trigger]')?.getAttribute('aria-label')).toBe('More for this result');
    items[1]!.click();
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

describe('civitai-chat-generation-card Adjust', () => {
  it('offers Adjust only where the page can turn the request into controls', async () => {
    const job = new FakeJob('awaiting_confirmation');
    const plain = await mount('civitai-chat-generation-card', { job });
    expect(plain.shadowRoot!.querySelector('[part=adjust]')).toBeNull();
    const card = await mount('civitai-chat-generation-card', { job, adjustable: true });
    const asked: unknown[] = [];
    card.addEventListener('job-adjust', (e) => asked.push(e.target));
    card.shadowRoot!.querySelector<HTMLElement>('[part=adjust]')!.click();
    expect(asked).toEqual([card]);
  });
});

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

describe('civitai-chat-post-card for a draft', () => {
  it('says nothing is public yet and publishes only from its Publish button', async () => {
    const post = Object.assign(new FakePost(), { drafts: true, publish: vi.fn(async () => undefined) });
    const card = await mount('civitai-chat-post-card', { post });
    expect(card.shadowRoot!.textContent).toContain('It starts as a draft');
    post.state = 'drafted';
    post.url = 'https://civitai.com/posts/9';
    post.dispatchEvent(new Event('change'));
    await card.updateComplete;
    expect(card.shadowRoot!.textContent).toContain('Nothing is public yet.');
    expect(card.shadowRoot!.querySelector<HTMLAnchorElement>('[part=link]')?.href).toBe('https://civitai.com/posts/9');
    expect(post.publish).not.toHaveBeenCalled();
    card.shadowRoot!.querySelector<HTMLElement>('[part=publish]')!.click();
    expect(post.publish).toHaveBeenCalled();
  });
});

describe('civitai-chat-settings-dialog', () => {
  it('lets the viewer pick a listed model or type any model id', async () => {
    const dialog = await mount('civitai-chat-settings-dialog', {
      open: true,
      settings: { theme: 'system', allowMature: false, autoRunLimit: 100 },
      models: [{ id: 'z-ai/glm-5.3-flash', label: 'Smart', note: 'Follows instructions more closely.' }],
    });
    const changes: unknown[] = [];
    dialog.addEventListener('cvt-settings-change', (e) => changes.push((e as CustomEvent).detail));
    const select = dialog.querySelector<HTMLInputElement>('civitai-select[label=Assistant]')!;

    select.value = 'z-ai/glm-5.3-flash';
    select.dispatchEvent(new Event('change'));
    expect(changes).toEqual([{ assistantModel: 'z-ai/glm-5.3-flash' }]);

    select.value = 'custom';
    select.dispatchEvent(new Event('change'));
    await dialog.updateComplete;
    const id = dialog.querySelector<HTMLInputElement>('civitai-text-input[label="Model id"]')!;
    id.value = ' z-ai/glm-5.3-prime ';
    id.dispatchEvent(new Event('change'));
    expect(changes.at(-1)).toEqual({ assistantModel: 'z-ai/glm-5.3-prime' });
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

  it('says when a step did not work, with what came back behind it, so a retrying assistant is visibly busy', async () => {
    const turn = {
      seq: 1,
      createdAt: '',
      user: { content: 'add a picture option', attachments: [] },
      assistant: {
        messages: [
          { role: 'assistant' as const, content: [{ type: 'tool-call' as const, toolCallId: 'c1', toolName: 'update_panel', input: {} }] },
          { role: 'tool' as const, content: [{ type: 'tool-result' as const, toolCallId: 'c1', toolName: 'update_panel', output: { type: 'json' as const, value: { error: 'input.images: required' } } }] },
        ],
        status: 'done' as const,
      },
    };
    const thread = await mount('civitai-chat-thread', { turns: [turn], jobs: { byToolCall: () => undefined, get: () => undefined } as never, posts: { available: false } as never });
    await thread.querySelector('civitai-chat-turn')!.updateComplete;
    const failed = thread.querySelector('.cvt-step-failed')!;
    expect(failed.querySelector('summary')?.textContent).toBe("Changing the controls didn't work");
    expect(failed.querySelector('code')?.textContent).toBe('input.images: required');
  });

  it("shows a page tool's call the way the page renders it, and its own activity while it runs", async () => {
    const turn = { seq: 1, createdAt: '', user: { content: 'pin it', attachments: [] }, assistant: { messages: [], status: 'streaming' as const } };
    const live = { seq: 1, parts: [{ kind: 'tool', toolCallId: 't1', toolName: 'pin_to_board', input: { file: 'gen1-1-1' }, state: 'calling' }] };
    const views = {
      pin_to_board: {
        activity: 'Pinning it…',
        render: (call: { state: string; output?: unknown }) => (call.state === 'done' ? `Pinned as #${(call.output as { pin: number }).pin}` : undefined),
      },
    };
    const thread = await mount('civitai-chat-thread', { turns: [turn], live: live as never, views, jobs: { byToolCall: () => undefined, get: () => undefined } as never });
    await thread.querySelector('civitai-chat-turn')!.updateComplete;
    expect(thread.querySelector('.cvt-activity')?.textContent).toBe('Pinning it…');

    Object.assign(live.parts[0]!, { state: 'done', output: { pin: 7 } });
    thread.live = { ...live } as never;
    await thread.updateComplete;
    await thread.querySelector('civitai-chat-turn')!.updateComplete;
    expect(thread.textContent).toContain('Pinned as #7');
  });

  it('renames what a built-in tool is doing when the page gives only an activity', async () => {
    const turn = { seq: 1, createdAt: '', user: { content: 'find one', attachments: [] }, assistant: { messages: [], status: 'streaming' as const } };
    const live = { seq: 1, parts: [{ kind: 'tool', toolCallId: 't1', toolName: 'search_models', input: {}, state: 'calling' }] };
    const thread = await mount('civitai-chat-thread', { turns: [turn], live: live as never, views: { search_models: { activity: 'Browsing the catalog…' } }, jobs: { byToolCall: () => undefined, get: () => undefined } as never });
    await thread.querySelector('civitai-chat-turn')!.updateComplete;
    expect(thread.querySelector('.cvt-activity')?.textContent).toBe('Browsing the catalog…');
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

async function panelFixture() {
  const feed = controllable<Workflow>();
  const { PanelManager } = await import('../panels/panel.js');
  const { JobManager } = await import('../orchestration/jobs.js');
  const { toolInfo } = await import('../orchestration/job.js');
  const submitted: Record<string, unknown>[] = [];
  const jobs = new JobManager({
    api: { getWorkflow: vi.fn(), watchWorkflow: vi.fn(() => feed.iterate()), addTag: vi.fn(), updateWorkflow: vi.fn() } as never,
    cancelWorkflow: vi.fn(),
    mcp: {
      callTool: vi.fn(async (_name: string, args: Record<string, unknown>) => {
        if (!args.whatif) submitted.push(args);
        return { content: [{ type: 'text', text: 'ok' }], structuredContent: args.whatif ? { cost: { total: 12, variable: false } } : { workflowId: '7-1' } };
      }),
    } as never,
    resolveArgs: async (args) => args,
    decide: () => 'confirm',
    findWorkflows: vi.fn(async () => []),
    hideMatureContent: () => true,
  });
  const panels = new PanelManager({ jobs, toolInfo: (name) => toolInfo(name, { properties: { whatif: {}, waitForCompletion: {} } }), save: vi.fn() });
  const panel = panels.open({
    conversationId: 'C1',
    seq: 1,
    toolCallId: 'c1',
    spec: {
      title: 'Lo-fi beat',
      inputs: {
        mood: { kind: 'choice', label: 'Mood', options: ['Rainy night', 'Sunday morning'], default: 'Rainy night' },
        lead: { kind: 'text', label: 'Lead', required: true },
        tracks: { kind: 'count', label: 'How many', min: 1, max: 4, default: 1 },
      },
      run: { stepType: 'aceStepAudio', input: { prompt: 'lo-fi, {{mood}}, {{lead}}', quantity: '{{tracks}}' } },
    },
    price: { total: 44, variable: false },
  });
  return { panel, panels, submitted, feed };
}

describe('civitai-chat-panel', () => {
  const setup = async () => {
    const { panel, submitted } = await panelFixture();
    const el = await mount('civitai-chat-panel', { panel });
    const runButton = () => [...el.querySelectorAll<HTMLElement>('civitai-button')].find((b) => b.textContent?.startsWith('Run'))!;
    return { el, panel, submitted, runButton };
  };

  it('shows its controls and the price on Run, and waits for required inputs', async () => {
    const { el, runButton } = await setup();
    expect(el.querySelector('h3')?.textContent).toBe('Lo-fi beat');
    expect(el.querySelector('civitai-segmented-control')?.getAttribute('label')).toBe('Mood');
    expect(runButton().textContent).toContain('Run · ≈ 44 Buzz');
    expect(runButton().hasAttribute('disabled')).toBe(true);
    expect(el.textContent).toContain('Fill in Lead to run.');
  });

  it('says the link was copied, once the chat answers that it reached the clipboard', async () => {
    const { panel } = await panelFixture();
    const el = await mount('civitai-chat-panel', { panel, canShare: true });
    el.addEventListener('panel-share', (e) => ((e as CustomEvent<{ copied?: Promise<boolean> }>).detail.copied = Promise.resolve(true)));
    const share = () => el.querySelector<HTMLElement>('.cvt-panel-share')!;
    expect(share().textContent).toBe('Share');
    share().click();
    await vi.waitFor(() => expect(share().textContent).toBe('Link copied ✓'));
  });

  it('labels an ask panel by what it does, without a price', async () => {
    const { panel } = await panelFixture();
    panel.apply({ spec: { ...panel.spec, run: { ask: 'Make a {{mood}} beat with {{lead}}' }, button: 'Make it' }, toolCallId: 'c2' });
    const el = await mount('civitai-chat-panel', { panel });
    const button = [...el.querySelectorAll<HTMLElement>('civitai-button')].find((b) => b.textContent?.startsWith('Make it'))!;
    expect(button.textContent?.trim()).toBe('Make it');
    expect(el.textContent).toContain('Fill in Lead to run.');
  });

  it('pulls a number past its limit back to the limit, in the field too, and prices that', async () => {
    const { el, panel, runButton } = await setup();
    const tracks = el.querySelector('civitai-number-input')! as unknown as HTMLInputElement;
    tracks.value = '15';
    tracks.dispatchEvent(new Event('change'));
    await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
    expect(panel.values.tracks).toBe(4);
    expect(tracks.value).toBe('4');
    expect(runButton().textContent).toContain('checking price…');
  });

  it("runs the user's choices as they set them, then shows the run", async () => {
    const { el, panel, submitted, runButton } = await setup();
    const lead = el.querySelector('civitai-text-input')!;
    (lead as unknown as { value: string }).value = 'piano';
    lead.dispatchEvent(new Event('input'));
    const mood = el.querySelector('civitai-segmented-control')!;
    (mood as unknown as { value: string }).value = 'Sunday morning';
    mood.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(panel.ready).toBe(true));
    await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;

    runButton().click();
    await vi.waitFor(() => expect(submitted).toHaveLength(1));
    expect(submitted[0]).toMatchObject({ stepType: 'aceStepAudio', input: { prompt: 'lo-fi, Sunday morning, piano' }, waitForCompletion: false });
    await vi.waitFor(() => expect(el.querySelector('civitai-chat-generation-card')).not.toBeNull());

    runButton().click();
    await vi.waitFor(() => expect(submitted).toHaveLength(2));
    await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
    expect([...el.querySelectorAll('.cvt-panel-run')].map((b) => [b.getAttribute('aria-label'), b.getAttribute('aria-pressed')])).toEqual([
      ['Run 2, in progress', 'true'],
      ['Run 1, in progress', 'false'],
    ]);
  });
});

describe('civitai-chat-studio', () => {
  it('lays a panel out as a studio: controls with Run on the left, the run on show in the middle, every run in the tray', async () => {
    const { panel, feed } = await panelFixture();
    const studio = await mount('civitai-chat-studio', { panel });
    const root = studio.shadowRoot!;
    expect(root.querySelector('.controls h2')?.textContent).toBe('Lo-fi beat');
    // Too long for buttons in the narrow column, so a dropdown.
    expect(root.querySelector('.controls [label=Mood]')?.localName).toBe('civitai-select');
    expect(root.querySelector('.canvas')?.textContent).toContain('Press Run to make the first one.');

    panel.setValue('lead', 'piano');
    await panel.quote();
    await panel.run();
    await studio.updateComplete;
    expect(root.querySelector('.canvas [role=status]')?.textContent).toContain('Writing your song');
    expect(root.querySelector('.tray-label')?.textContent).toBe('Runs · 1');

    feed.push(workflow({ id: '7-1', status: 'succeeded', steps: [imageStep([{ id: 'a', url: 'https://x/a.png', width: 1024, height: 1024 }])] as never }));
    await vi.waitFor(() => expect(root.querySelector('.results civitai-image')).not.toBeNull());
    const picks: unknown[] = [];
    studio.addEventListener('media-action', (e) => picks.push((e as CustomEvent).detail));
    root.querySelectorAll<HTMLElement>('.results civitai-menu-item')[0]!.click();
    expect(picks).toEqual([{ id: 'p1-1-1', action: 'reference' }]);
  });

  it('asks for something to make while there is no panel', async () => {
    const studio = await mount('civitai-chat-studio');
    expect(studio.shadowRoot!.textContent).toContain('its controls show up here');
  });
});

describe('a docked panel in the thread', () => {
  it('shows a chip that brings the panel up beside the chat, instead of the panel itself', async () => {
    const { panel, panels } = await panelFixture();
    const turn = {
      seq: 1,
      createdAt: '',
      user: { content: 'a beat maker', attachments: [] },
      assistant: {
        messages: [
          { role: 'assistant' as const, content: [{ type: 'tool-call' as const, toolCallId: 'c1', toolName: 'open_panel', input: {} }] },
          { role: 'tool' as const, content: [{ type: 'tool-result' as const, toolCallId: 'c1', toolName: 'open_panel', output: { type: 'json' as const, value: { panel: 'p1' } } }] },
        ],
        status: 'done' as const,
      },
    };
    const thread = await mount('civitai-chat-thread', { turns: [turn], panels, dockPanels: true, jobs: { byToolCall: () => undefined, get: () => undefined } as never, posts: { available: false } as never });
    await thread.querySelector('civitai-chat-turn')!.updateComplete;
    expect(thread.querySelector('civitai-chat-panel')).toBeNull();
    const focused: unknown[] = [];
    thread.addEventListener('panel-focus', (e) => focused.push((e as CustomEvent).detail.panel));
    thread.querySelector<HTMLElement>('.cvt-panel-chip')!.click();
    expect(focused).toEqual([panel]);
  });
});
