import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { ChatSession } from '../session.js';
import type { CivitaiChat } from './civitai-chat.js';
import type { CivitaiChatComposer } from './civitai-chat-composer.js';
import { defineElements } from './define.js';

/**
 * `draft` and `dictating`: what a page may read about the message box without reaching into the
 * chat's shadow root. `draft` is the text in the box; `dictating` is true from the moment the viewer
 * starts talking until what they said has been joined into `draft` (or thrown away).
 */

beforeAll(() => defineElements());
afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, 'mediaDevices');
});

function fakeApp() {
  return {
    getToken: async () => 'token',
    requestGrants: async () => true,
    site: { get: async () => ({ username: 'viewer' }) },
    orchestration: { queryWorkflows: async () => ({ items: [], next: '' }), submitWorkflow: vi.fn() },
  } as never;
}

/**
 * A microphone whose recorder finishes only when the test says so, as a real one finishes a moment
 * after it is told to stop: that moment is the one between the recording bar and the transcribing bar.
 */
function fakeMicrophone() {
  const finishes: (() => void)[] = [];
  class FakeRecorder extends EventTarget {
    static isTypeSupported = (type: string) => type.startsWith('audio/webm');
    state = 'inactive';
    mimeType = 'audio/webm;codecs=opus';
    start() {
      this.state = 'recording';
    }
    stop() {
      this.state = 'inactive';
      finishes.push(() => {
        this.dispatchEvent(Object.assign(new Event('dataavailable'), { data: new Blob(['said'], { type: this.mimeType }) }));
        this.dispatchEvent(new Event('stop'));
      });
    }
  }
  vi.stubGlobal('MediaRecorder', FakeRecorder);
  vi.stubGlobal('AudioContext', undefined);
  vi.stubGlobal('AudioWorkletNode', undefined);
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: () => undefined }] })) },
  });
  /** Lets every recorder told to stop so far finish. */
  return () => finishes.splice(0).forEach((finish) => finish());
}

/** Transcription that answers only when the test says so. */
function fakeTranscription() {
  const answers: ((words: string) => void)[] = [];
  const transcribe = vi.spyOn(ChatSession.prototype, 'transcribe').mockImplementation(() => new Promise<string>((resolve) => answers.push(resolve)));
  return { transcribe, answer: (words: string) => answers.splice(0).forEach((resolve) => resolve(words)) };
}

async function mount(set: (chat: CivitaiChat) => void): Promise<{ chat: CivitaiChat; composer: CivitaiChatComposer }> {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })));
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const chat = document.createElement('civitai-chat');
  set(chat);
  document.body.append(chat);
  await vi.waitFor(() => expect(chat.shadowRoot?.querySelector('civitai-chat-composer')).not.toBeNull(), { timeout: 10_000 });
  return { chat, composer: chat.shadowRoot!.querySelector<CivitaiChatComposer>('civitai-chat-composer')! };
}

/** Types into the message box as the viewer does (no Enter). */
async function type(composer: CivitaiChatComposer, text: string): Promise<void> {
  const area = composer.querySelector('textarea')!;
  area.value = text;
  area.dispatchEvent(new Event('input'));
  await composer.updateComplete;
}

async function press(composer: CivitaiChatComposer, label: string): Promise<void> {
  await vi.waitFor(() => expect(composer.querySelector(`button[aria-label="${label}"]`)).not.toBeNull());
  composer.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!.click();
  await composer.updateComplete;
}

const signedIn = (chat: CivitaiChat) => (chat.app = fakeApp());
const signedOut = (chat: CivitaiChat) => (chat.signIn = () => new Promise<never>(() => undefined));

describe('<civitai-chat> draft', () => {
  it("is '' before the chat is on the page, and while it has no message box yet", async () => {
    const chat = document.createElement('civitai-chat');
    expect(chat.draft).toBe('');
    expect(chat.dictating).toBe(false);

    // With neither `app` nor `signIn` the chat waits on a loader, with no message box.
    document.body.append(chat);
    await chat.updateComplete;
    expect(chat.shadowRoot!.querySelector('civitai-chat-composer')).toBeNull();
    expect(chat.draft).toBe('');
    expect(chat.dictating).toBe(false);
  });

  for (const [name, set] of [['signed in', signedIn], ['signed out', signedOut]] as const) {
    it(`${name}: is what the viewer typed, and what compose() put there`, async () => {
      const { chat, composer } = await mount(set);
      expect(chat.draft).toBe('');

      await type(composer, 'a red bike at dusk');
      expect(chat.draft).toBe('a red bike at dusk');

      await chat.compose('a blue boat at dawn');
      expect(chat.draft).toBe('a blue boat at dawn');
      expect(composer.querySelector('textarea')!.value).toBe('a blue boat at dawn');

      await type(composer, '');
      expect(chat.draft).toBe('');
    });
  }
});

describe('<civitai-chat> dictating', () => {
  it('signed out: is false, and there is no microphone to start it', async () => {
    fakeMicrophone();
    const { chat, composer } = await mount(signedOut);
    expect(composer.querySelector('button[aria-label="Talk instead of typing"]')).toBeNull();
    expect(chat.dictating).toBe(false);
  });

  it('is true while recording, between recording and transcribing, and while transcribing; false once the words are in draft', async () => {
    const finishRecording = fakeMicrophone();
    const { transcribe, answer } = fakeTranscription();
    const { chat, composer } = await mount(signedIn);
    await type(composer, 'draw');
    expect(chat.dictating).toBe(false);

    await press(composer, 'Talk instead of typing');
    await vi.waitFor(() => expect(composer.querySelector('[aria-label="Recording your voice"]')).not.toBeNull());
    expect(composer.recording).toBe(true);
    expect(chat.dictating).toBe(true);
    // The box is hidden; draft is still what it held.
    expect(chat.draft).toBe('draw');

    // Stopped, the recorder is still handing over the last words: neither bar's flag is set yet.
    await press(composer, 'Stop and edit the text');
    expect(composer.recording).toBe(false);
    expect(chat.transcribing).toBe(false);
    expect(transcribe).not.toHaveBeenCalled();
    expect(chat.dictating).toBe(true);

    finishRecording();
    await vi.waitFor(() => expect(composer.querySelector('.cvt-transcribing')).not.toBeNull());
    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(chat.transcribing).toBe(true);
    expect(chat.dictating).toBe(true);
    expect(chat.draft).toBe('draw');

    answer('a red bike');
    await vi.waitFor(() => expect(chat.dictating).toBe(false));
    // The moment it is false the words are already in the box.
    expect(chat.draft).toBe('draw a red bike');
  });

  it('is false once the viewer cancels the recording, or the transcription', async () => {
    const finishRecording = fakeMicrophone();
    fakeTranscription();
    const { chat, composer } = await mount(signedIn);

    await press(composer, 'Talk instead of typing');
    await vi.waitFor(() => expect(chat.dictating).toBe(true));
    await press(composer, 'Cancel recording');
    expect(chat.dictating).toBe(false);

    await press(composer, 'Talk instead of typing');
    await vi.waitFor(() => expect(chat.dictating).toBe(true));
    await press(composer, 'Stop and edit the text');
    finishRecording();
    await vi.waitFor(() => expect(composer.querySelector('.cvt-transcribing')).not.toBeNull());
    expect(chat.dictating).toBe(true);
    await press(composer, 'Stop transcribing');
    expect(chat.dictating).toBe(false);
    expect(chat.draft).toBe('');
  });
});
