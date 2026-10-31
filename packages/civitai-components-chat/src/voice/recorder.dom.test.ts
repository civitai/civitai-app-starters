import { afterEach, describe, expect, it, vi } from 'vitest';

import { PAUSE_MS, VoiceRecorder } from './recorder.js';

/** A microphone whose loudness the test sets, with time and animation frames under the test's control. */
function fakeMicrophone() {
  let loudness = 0;
  let now = 1_000_000;
  let frame: FrameRequestCallback | undefined;
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
      this.dispatchEvent(Object.assign(new Event('dataavailable'), { data: new Blob(['audio'], { type: this.mimeType }) }));
      this.dispatchEvent(new Event('stop'));
    }
  }
  class FakeAudioContext {
    createAnalyser() {
      return { fftSize: 512, getByteTimeDomainData: (samples: Uint8Array) => samples.fill(128 + Math.round(loudness * 32)) };
    }
    createMediaStreamSource() {
      return { connect: () => undefined };
    }
    close() {
      return Promise.resolve();
    }
  }
  vi.stubGlobal('MediaRecorder', FakeRecorder);
  vi.stubGlobal('AudioContext', FakeAudioContext);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frame = callback;
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => (frame = undefined));
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => ({ getTracks: () => [{ stop: () => undefined }] }) } });

  /** Plays `ms` of sound at a loudness (0 = silence), a frame every 50 ms. */
  const play = async (level: number, ms: number) => {
    loudness = level;
    for (let t = 0; t < ms; t += 50) {
      now += 50;
      frame?.(now);
    }
    await Promise.resolve();
  };
  return { play };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, 'mediaDevices');
});

describe('VoiceRecorder', () => {
  it('sends each phrase as soon as the speaker pauses, and the last one on stop', async () => {
    const { play } = fakeMicrophone();
    const phrases: Blob[] = [];
    const recorder = await VoiceRecorder.start({ onPhrase: (recording) => phrases.push(recording) });

    await play(0.5, 1500);
    await play(0, PAUSE_MS + 100);
    await vi.waitFor(() => expect(phrases).toHaveLength(1));

    await play(0.5, 1200);
    await recorder.stop();
    expect(phrases).toHaveLength(2);
    expect(phrases.every((phrase) => phrase.size > 0)).toBe(true);
  });

  it('never sends silence', async () => {
    const { play } = fakeMicrophone();
    const phrases: Blob[] = [];
    const recorder = await VoiceRecorder.start({ onPhrase: (recording) => phrases.push(recording) });

    await play(0, 20_000);
    await recorder.stop();
    expect(phrases).toEqual([]);
  });

  it('sends nothing when canceled', async () => {
    const { play } = fakeMicrophone();
    const phrases: Blob[] = [];
    const recorder = await VoiceRecorder.start({ onPhrase: (recording) => phrases.push(recording) });

    await play(0.5, 800);
    recorder.cancel();
    await play(0, 100);
    expect(phrases).toEqual([]);
  });
});
