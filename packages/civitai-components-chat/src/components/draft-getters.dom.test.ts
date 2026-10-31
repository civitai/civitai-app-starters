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
  const calls: { resolve: (words: string) => void; reject: (error: unknown) => void }[] = [];
  const transcribe = vi.spyOn(ChatSession.prototype, 'transcribe').mockImplementation(() => new Promise<string>((resolve, reject) => calls.push({ resolve, reject })));
  return {
    transcribe,
    answer: (words: string) => calls.splice(0).forEach((call) => call.resolve(words)),
    fail: (error: unknown) => calls.splice(0).forEach((call) => call.reject(error)),
  };
}

/**
 * `draft` read at the very moment `dictating` turns false. It checks after every microtask, not on a
 * timer, so a draft that reached the box even one task later than `dictating` changed reads as the old
 * one here. Call it straight after whatever ends the dictation, with no `await` in between.
 */
async function draftWhenDictatingEnds(chat: CivitaiChat): Promise<string> {
  for (let tick = 0; tick < 2000; tick++) {
    if (!chat.dictating) return chat.draft;
    await Promise.resolve();
  }
  throw new Error('dictating did not end within the microtasks after the dictation finished');
}

/**
 * A live (streaming) transcript, standing in for the one the chat opens on the orchestrator. Only its
 * VoiceTranscript side is real here: what the chat reads and when; the streaming itself is not under test.
 */
function fakeLiveTranscript() {
  const opened: { finish: (words: string) => void; serverStops: (words: string) => void }[] = [];
  vi.spyOn(ChatSession.prototype, 'liveTranscript').mockImplementation((onChange: () => void) => {
    let settle!: (words: string) => void;
    const settled = new Promise<string>((resolve) => (settle = resolve));
    const transcript = {
      text: '',
      pending: true,
      canceled: false,
      error: undefined as unknown,
      stop: () => undefined,
      settled: () => settled,
      cancel: () => {
        transcript.canceled = true;
        transcript.pending = false;
        settle(transcript.text);
      },
    };
    opened.push({
      finish: (words) => {
        transcript.text = words;
        transcript.pending = false;
        settle(words);
        onChange();
      },
      // The server stopped listening after a long pause: everything it heard is back.
      serverStops: (words) => {
        transcript.text = words;
        transcript.pending = false;
        onChange();
        settle(words);
      },
    });
    return transcript as never;
  });
  return opened;
}

/** Audio worklets, so the composer streams PCM (the live path) instead of recording phrases. */
function fakeAudioWorklets(): void {
  class FakeNode {
    port = { onmessage: null };
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
    // The moment it is false the words are already in the box.
    expect(await draftWhenDictatingEnds(chat)).toBe('draw a red bike');
    expect(chat.draft).toBe('draw a red bike');
  });

  /** Records, stops, and leaves the one phrase waiting on the transcription. */
  async function dictate(composer: CivitaiChatComposer, finishRecording: () => void, stop: 'Stop and edit the text' | 'Send what you said') {
    await press(composer, 'Talk instead of typing');
    await vi.waitFor(() => expect(composer.querySelector('[aria-label="Recording your voice"]')).not.toBeNull());
    await press(composer, stop);
    finishRecording();
    await vi.waitFor(() => expect(composer.querySelector('.cvt-transcribing')).not.toBeNull());
  }

  it('ends when no words came back: false, and the box keeps what it held', async () => {
    const finishRecording = fakeMicrophone();
    const { answer } = fakeTranscription();
    const { chat, composer } = await mount(signedIn);
    await type(composer, 'draw');
    await dictate(composer, finishRecording, 'Stop and edit the text');
    expect(chat.dictating).toBe(true);

    answer('');
    expect(await draftWhenDictatingEnds(chat)).toBe('draw');
    expect(chat.dictating).toBe(false);
    await vi.waitFor(() => expect(chat.shadowRoot!.querySelector('civitai-toast-region')?.textContent).toContain("Didn't catch any words"));
    expect(chat.dictating).toBe(false);
  });

  it('ends when the transcription fails: false, and the box keeps what it held', async () => {
    const finishRecording = fakeMicrophone();
    const { fail } = fakeTranscription();
    const { chat, composer } = await mount(signedIn);
    await type(composer, 'draw');
    await dictate(composer, finishRecording, 'Stop and edit the text');
    expect(chat.dictating).toBe(true);

    fail(new Error('transcription broke'));
    expect(await draftWhenDictatingEnds(chat)).toBe('draw');
    expect(chat.dictating).toBe(false);
    await vi.waitFor(() => expect(chat.shadowRoot!.querySelector('civitai-toast-region')?.textContent).toContain('Could not turn your recording into text'));
    expect(chat.dictating).toBe(false);
  });

  it('ends on "Send what you said": false, and the words went as a message rather than into the box', async () => {
    const finishRecording = fakeMicrophone();
    const { answer } = fakeTranscription();
    const { chat, composer } = await mount(signedIn);
    const sent: string[] = [];
    // Cancelled so no reply is asked for; what matters is that the message went.
    chat.addEventListener('before-send', (event) => {
      sent.push((event as CustomEvent<{ text: string }>).detail.text);
      event.preventDefault();
    });
    await type(composer, 'draw');
    await dictate(composer, finishRecording, 'Send what you said');
    expect(chat.dictating).toBe(true);

    answer('a red bike');
    expect(await draftWhenDictatingEnds(chat)).toBe('');
    await vi.waitFor(() => expect(sent).toEqual(['draw a red bike']));
    expect(chat.dictating).toBe(false);
    expect(chat.draft).toBe('');
  });

  it('live (streaming) transcription: true until the words are in draft, whether the viewer stops or the server does', async () => {
    fakeMicrophone();
    fakeAudioWorklets();
    const opened = fakeLiveTranscript();
    const { chat, composer } = await mount(signedIn);
    await type(composer, 'draw');

    // The viewer stops.
    await press(composer, 'Talk instead of typing');
    await vi.waitFor(() => expect(opened).toHaveLength(1));
    expect(chat.dictating).toBe(true);
    await press(composer, 'Stop and edit the text');
    await vi.waitFor(() => expect(composer.querySelector('.cvt-transcribing')).not.toBeNull());
    expect(chat.dictating).toBe(true);
    opened[0]!.finish('a red bike');
    expect(await draftWhenDictatingEnds(chat)).toBe('draw a red bike');

    // The server stops listening after a long pause, while the viewer is still on the recording bar.
    await press(composer, 'Talk instead of typing');
    await vi.waitFor(() => expect(opened).toHaveLength(2));
    expect(chat.dictating).toBe(true);
    opened[1]!.serverStops('a blue boat');
    expect(await draftWhenDictatingEnds(chat)).toBe('draw a red bike a blue boat');
    await vi.waitFor(() => expect(composer.querySelector('textarea')).not.toBeNull());
    expect(composer.recording).toBe(false);
    expect(chat.dictating).toBe(false);
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

/**
 * A message `send()` cannot send now (the chat holds, or the viewer's Buzz grant is refused) is kept
 * in an empty message box for the viewer to send later. Not while they dictate: the box is hidden
 * behind the recording bar and what they say is joined to the end of it, so a message put there would
 * end up glued to the front of their words.
 */
describe('<civitai-chat> send() kept back while the viewer dictates', () => {
  const refusing = (chat: CivitaiChat) => (chat.app = { ...(fakeApp() as object), requestGrants: async () => false } as never);
  const holding = (chat: CivitaiChat) => {
    chat.app = fakeApp();
    chat.holdReason = 'Your app is starting…';
  };

  /** Starts dictating into an empty box, then has the page send `text`. */
  async function sendWhileDictating(chat: CivitaiChat, composer: CivitaiChatComposer, text: string): Promise<void> {
    expect(chat.draft).toBe('');
    await press(composer, 'Talk instead of typing');
    await vi.waitFor(() => expect(chat.dictating).toBe(true));
    await chat.send(text);
    await composer.updateComplete;
  }

  for (const [name, set] of [['held', holding], ['grant refused', refusing]] as const) {
    it(`${name}: leaves the box alone while dictating, so what they said is all that lands there`, async () => {
      const finishRecording = fakeMicrophone();
      const { answer } = fakeTranscription();
      const { chat, composer } = await mount(set);

      await sendWhileDictating(chat, composer, 'Looks good — build it.');
      expect(chat.dictating).toBe(true);
      expect(chat.draft).toBe('');

      await press(composer, 'Stop and edit the text');
      finishRecording();
      await vi.waitFor(() => expect(composer.querySelector('.cvt-transcribing')).not.toBeNull());
      answer('and a timer');
      expect(await draftWhenDictatingEnds(chat)).toBe('and a timer');
    });

    it(`${name}: not dictating, the message is kept in the empty box as before`, async () => {
      const { chat, composer } = await mount(set);
      expect(chat.dictating).toBe(false);
      await chat.send('Looks good — build it.');
      await composer.updateComplete;
      expect(chat.draft).toBe('Looks good — build it.');
    });
  }
});
