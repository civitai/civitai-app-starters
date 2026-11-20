import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { ChatBackend, ChatStoreBackend, ChatTranscribe, ChatTranscribeOptions } from '../backend.js';
import { memoryStore } from '../test-support/fake-backend.js';
import { fakeRunner, RUNNER_URL } from '../test-support/fake-runner.js';
import type { CivitaiChat } from './civitai-chat.js';
import type { CivitaiChatComposer } from './civitai-chat-composer.js';
import { defineElements } from './define.js';

/** `<civitai-chat>` on a host backend that brings its own speech-to-text (`backend.transcribe`). */

beforeAll(() => defineElements());
afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, 'mediaDevices');
});

const MIC = 'Talk instead of typing';
const TALK = 'Talk with the assistant';

/**
 * A microphone that records one phrase per recording (no audio context, so no cutting at pauses).
 * With `worklets`, the browser could also stream live PCM, and has an audio context that meters a
 * steady loud voice (so the phrase counts as speech).
 */
function fakeMicrophone({ worklets = false } = {}) {
  class FakeRecorder extends EventTarget {
    static isTypeSupported = (type: string) => type.startsWith('audio/webm');
    state = 'inactive';
    mimeType = 'audio/webm;codecs=opus';
    start() {
      this.state = 'recording';
    }
    stop() {
      if (this.state === 'inactive') return;
      this.state = 'inactive';
      const data = new Blob(['said'], { type: this.mimeType });
      this.dispatchEvent(Object.assign(new Event('dataavailable'), { data }));
      this.dispatchEvent(new Event('stop'));
    }
  }
  vi.stubGlobal('MediaRecorder', FakeRecorder);
  if (worklets) {
    class FakeContext {
      sampleRate = 48_000;
      destination = {};
      audioWorklet = { addModule: async () => undefined };
      createGain() {
        return { gain: { value: 1 }, connect: <T>(next: T) => next };
      }
      createAnalyser() {
        return { fftSize: 512, getByteTimeDomainData: (samples: Uint8Array) => samples.fill(160) };
      }
      createMediaStreamSource() {
        return { connect: <T>(next: T) => next };
      }
      close() {
        return Promise.resolve();
      }
    }
    class FakeNode {
      port = { onmessage: null };
      connect<T>(next: T) {
        return next;
      }
    }
    vi.stubGlobal('AudioContext', FakeContext);
    vi.stubGlobal('AudioWorkletNode', FakeNode);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 16));
    vi.stubGlobal('cancelAnimationFrame', (id: ReturnType<typeof setTimeout>) => clearTimeout(id));
  } else {
    vi.stubGlobal('AudioContext', undefined);
    vi.stubGlobal('AudioWorkletNode', undefined);
  }
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: () => undefined }] })) } });
}

/** Every recording the composer handed the chat to transcribe. */
function phrasesOf(chat: CivitaiChat): Blob[] {
  const phrases: Blob[] = [];
  composerOf(chat).addEventListener('cvt-voice-phrase', (e) => phrases.push((e as CustomEvent<{ recording: Blob }>).detail.recording));
  return phrases;
}

/** Nothing here should reach a network: every request answers 404, and the test can see them. */
function noNetwork() {
  const spy = vi.fn(async () => new Response('not here', { status: 404 }));
  vi.stubGlobal('fetch', spy);
  return spy;
}

function backendOf(transcribe?: ChatTranscribe): ChatBackend {
  return { url: '/api/llm', model: 'host/default-model', store: memoryStore(), ...(transcribe ? { transcribe } : {}) };
}

async function mount(set: (chat: CivitaiChat) => void): Promise<CivitaiChat> {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const chat = document.createElement('civitai-chat');
  set(chat);
  document.body.append(chat);
  await vi.waitFor(() => expect(chat.shadowRoot!.querySelector('civitai-chat-composer')).not.toBeNull(), { timeout: 10_000 });
  await chat.updateComplete;
  return chat;
}

const composerOf = (chat: CivitaiChat) => chat.shadowRoot!.querySelector<CivitaiChatComposer>('civitai-chat-composer')!;
const button = (chat: CivitaiChat, label: string) => composerOf(chat).querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
const toastText = (chat: CivitaiChat) => chat.shadowRoot!.querySelector('civitai-toast-region')?.textContent ?? '';

async function press(chat: CivitaiChat, label: string): Promise<void> {
  await vi.waitFor(() => expect(button(chat, label)).not.toBeNull());
  button(chat, label)!.click();
  await composerOf(chat).updateComplete;
}

/** Records one phrase and stops for editing: the phrase goes to transcription. */
async function dictate(chat: CivitaiChat, { speakMs = 0 } = {}): Promise<void> {
  await press(chat, MIC);
  await vi.waitFor(() => expect(composerOf(chat).querySelector('[aria-label="Recording your voice"]')).not.toBeNull());
  if (speakMs) await new Promise((resolve) => setTimeout(resolve, speakMs));
  await press(chat, 'Stop and edit the text');
}

function fakeApp() {
  return {
    getToken: async () => 'viewer-token',
    requestGrants: async () => true,
    site: { get: async () => ({ username: 'viewer' }) },
    orchestration: { queryWorkflows: vi.fn(async () => ({ items: [], next: '' })), submitWorkflow: vi.fn(async () => ({ id: '7-1', cost: { total: 0 } })) },
  };
}

describe('<civitai-chat> dictation through a host backend', () => {
  it('offers the microphone only when the backend has transcribe (or the chat is on Civitai)', async () => {
    fakeMicrophone();
    noNetwork();
    const without = await mount((c) => (c.backend = backendOf()));
    expect(composerOf(without).voice).toBe(false);
    expect(button(without, MIC)).toBeNull();
    without.remove();

    const withHook = await mount((c) => (c.backend = backendOf(vi.fn(async () => ({ text: 'hi' })))));
    expect(composerOf(withHook).voice).toBe(true);
    expect(composerOf(withHook).hostVoice).toBe(true);
    expect(button(withHook, MIC)).not.toBeNull();
    // No Buzz price on a host's microphone.
    expect(button(withHook, MIC)!.title).not.toContain('Buzz');
    withHook.remove();

    const civitai = await mount((c) => {
      c.mcp = { orchestration: false, site: false };
      c.app = fakeApp() as never;
    });
    expect(composerOf(civitai).voice).toBe(true);
    expect(composerOf(civitai).hostVoice).toBe(false);
    expect(button(civitai, MIC)).not.toBeNull();
  });

  it('hands the recorded audio and the chosen language to transcribe, and puts the words after the draft', async () => {
    fakeMicrophone();
    const network = noNetwork();
    const calls: { audio: Blob; options: ChatTranscribeOptions }[] = [];
    const transcribe = vi.fn(async (audio: Blob, options: ChatTranscribeOptions) => {
      calls.push({ audio, options });
      return { text: '  a snowy cabin  ' };
    });
    const chat = await mount((c) => (c.backend = backendOf(transcribe)));
    const recordings = phrasesOf(chat);

    // The viewer picks German beside the microphone; it is what the hook is told.
    const picker = composerOf(chat).querySelector<HTMLSelectElement>('select[aria-label="The language you speak"]')!;
    picker.value = 'de';
    picker.dispatchEvent(new Event('change'));
    await chat.updateComplete;
    composerOf(chat).draft = 'Paint';

    await dictate(chat);
    await vi.waitFor(() => expect(chat.draft).toBe('Paint a snowy cabin'));
    expect(chat.dictating).toBe(false);

    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(recordings).toHaveLength(1);
    expect(calls[0]!.audio).toBe(recordings[0]);
    expect(calls[0]!.audio.size).toBeGreaterThan(0);
    expect(calls[0]!.audio.type).toBe('audio/webm;codecs=opus');
    expect(calls[0]!.options.language).toBe('de');
    expect(calls[0]!.options.signal).toBeInstanceOf(AbortSignal);
    expect(calls[0]!.options.signal!.aborted).toBe(false);
    // The words came from the hook alone.
    expect(network).not.toHaveBeenCalled();
  });

  it('says the recording could not be turned into text when transcribe fails, and leaves the draft alone', async () => {
    fakeMicrophone();
    noNetwork();
    const transcribe = vi.fn(async () => {
      throw new Error('speech service down');
    });
    const chat = await mount((c) => (c.backend = backendOf(transcribe)));
    composerOf(chat).draft = 'keep me';

    await dictate(chat);
    await vi.waitFor(() => expect(toastText(chat)).toContain('Could not turn your recording into text. Try again, or type it.'));
    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(chat.dictating).toBe(false);
    expect(chat.draft).toBe('keep me');
  });

  // A failure the chat can classify by its status is worded for a host, never as Civitai's: the
  // Civitai wording of each of these names Civitai, so a toast without it is the host's.
  for (const [status, words] of [
    [429, 'The assistant is busy right now. Wait a moment and try again.'],
    [401, "Your sign-in wasn't accepted. Please sign in again."],
    [503, "The assistant isn't available right now. Try again in a minute."],
  ] as const) {
    it(`words a ${status} from transcribe for the host, not for Civitai`, async () => {
      fakeMicrophone();
      noNetwork();
      const transcribe = vi.fn(async () => {
        throw Object.assign(new Error(`speech-to-text answered ${status}`), { status });
      });
      const chat = await mount((c) => (c.backend = backendOf(transcribe)));

      await dictate(chat);
      await vi.waitFor(() => expect(toastText(chat)).toContain(words));
      expect(toastText(chat)).not.toContain('Civitai');
      expect(chat.draft).toBe('');
    });
  }

  it('refuses an answer that is not { text }', async () => {
    fakeMicrophone();
    noNetwork();
    const chat = await mount((c) => (c.backend = backendOf((async () => ({ transcript: 'wrong field' })) as never)));

    await dictate(chat);
    await vi.waitFor(() => expect(toastText(chat)).toContain('Could not turn your recording into text.'));
    expect(chat.draft).toBe('');
  });

  it('aborts the call when the viewer stops transcribing, and drops what comes back after', async () => {
    fakeMicrophone();
    noNetwork();
    let finish!: (value: { text: string }) => void;
    let signal: AbortSignal | undefined;
    const transcribe = vi.fn(
      (_audio: Blob, options: ChatTranscribeOptions) =>
        new Promise<{ text: string }>((resolve) => {
          signal = options.signal;
          finish = resolve;
        }),
    );
    const chat = await mount((c) => (c.backend = backendOf(transcribe)));

    await dictate(chat);
    await vi.waitFor(() => expect(transcribe).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(composerOf(chat).querySelector('.cvt-transcribing')).not.toBeNull());
    expect(signal!.aborted).toBe(false);

    await press(chat, 'Stop transcribing');
    expect(signal!.aborted).toBe(true);
    expect(chat.dictating).toBe(false);

    finish({ text: 'too late' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(chat.draft).toBe('');
    expect(composerOf(chat).querySelector('textarea')).not.toBeNull();
  });

  it('sends nothing to transcribe when the viewer cancels the recording', async () => {
    fakeMicrophone();
    noNetwork();
    const transcribe = vi.fn(async () => ({ text: 'never' }));
    const chat = await mount((c) => (c.backend = backendOf(transcribe)));

    await press(chat, MIC);
    await vi.waitFor(() => expect(composerOf(chat).querySelector('[aria-label="Recording your voice"]')).not.toBeNull());
    await press(chat, 'Cancel recording');
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(transcribe).not.toHaveBeenCalled();
    expect(chat.dictating).toBe(false);
    expect(chat.draft).toBe('');
  });

  it('records phrases for the hook and never offers a spoken conversation, even where live streaming could run', async () => {
    fakeMicrophone({ worklets: true });
    noNetwork();
    const transcribe = vi.fn(async () => ({ text: 'hello there' }));
    const chat = await mount((c) => {
      c.voiceConversation = true;
      c.backend = backendOf(transcribe);
    });
    const started: { live: boolean }[] = [];
    composerOf(chat).addEventListener('cvt-voice-start', (e) => started.push((e as CustomEvent<{ live: boolean }>).detail));

    expect(composerOf(chat).talk).toBe(false);
    expect(button(chat, TALK)).toBeNull();
    // Even a stray request to start one is refused: nothing starts.
    composerOf(chat).dispatchEvent(new CustomEvent('cvt-conversation-start'));
    await chat.updateComplete;
    expect(chat.shadowRoot!.querySelector('[aria-label="Talking with the assistant"]')).toBeNull();

    // A moment of (loud) speech, so the metered phrase counts as said.
    await dictate(chat, { speakMs: 100 });
    await vi.waitFor(() => expect(chat.draft).toBe('hello there'));
    expect(started).toEqual([{ live: false }]);
    expect(transcribe).toHaveBeenCalledTimes(1);
  });

  it('control: the same browser on Civitai offers the spoken conversation and streams live', async () => {
    fakeMicrophone({ worklets: true });
    noNetwork();
    const chat = await mount((c) => {
      c.voiceConversation = true;
      c.mcp = { orchestration: false, site: false };
      c.app = fakeApp() as never;
    });
    const started: { live: boolean }[] = [];
    composerOf(chat).addEventListener('cvt-voice-start', (e) => started.push((e as CustomEvent<{ live: boolean }>).detail));

    expect(composerOf(chat).talk).toBe(true);
    expect(button(chat, TALK)).not.toBeNull();
    await press(chat, MIC);
    await vi.waitFor(() => expect(started).toEqual([{ live: true }]));
  });
});

describe('<civitai-chat runner="remote"> on a store-only backend with transcribe', () => {
  it('offers the microphone and puts the words in the draft, without the runner', async () => {
    fakeMicrophone();
    noNetwork();
    const runner = fakeRunner();
    const transcribe = vi.fn(async (_audio: Blob, _options: ChatTranscribeOptions) => ({ text: 'from the host' }));
    const backend: ChatStoreBackend = { model: 'host/default', store: memoryStore(), transcribe };
    const chat = await mount((c) => {
      c.runner = 'remote';
      c.remoteRunner = { url: RUNNER_URL, fetch: runner.fetch, reconnectDelaysMs: [0] };
      c.backend = backend;
    });
    expect(composerOf(chat).voice).toBe(true);
    expect(composerOf(chat).hostVoice).toBe(true);
    const before = runner.requests.length;

    await dictate(chat);
    await vi.waitFor(() => expect(chat.draft).toBe('from the host'));
    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(transcribe.mock.calls[0]![1].language).toBe('en');
    expect(runner.requests.slice(before).filter((request) => request.method !== 'GET')).toEqual([]);
  });

  it('control: without transcribe, no microphone', async () => {
    fakeMicrophone();
    noNetwork();
    const runner = fakeRunner();
    const chat = await mount((c) => {
      c.runner = 'remote';
      c.remoteRunner = { url: RUNNER_URL, fetch: runner.fetch, reconnectDelaysMs: [0] };
      c.backend = { model: 'host/default', store: memoryStore() };
    });
    expect(composerOf(chat).voice).toBe(false);
    expect(button(chat, MIC)).toBeNull();
  });
});
