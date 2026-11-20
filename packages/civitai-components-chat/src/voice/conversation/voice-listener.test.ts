import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PcmRecorderEvents } from '../pcm-recorder.js';
import type { LiveSocketHandlers } from './live-socket.js';
import { VoiceListener } from './voice-listener.js';

const BLOCK = new Int16Array(640);

async function listening() {
  let microphone!: PcmRecorderEvents;
  let transcript!: LiveSocketHandlers;
  const turns: string[] = [];
  const listener = new VoiceListener(
    {
      open: async () => ({ workflowId: 'wf', socketUrl: 'wss://live' }),
      cancel: () => undefined,
      connect: async (_url, handlers) => {
        transcript = handlers;
        return { send: () => undefined, close: () => undefined };
      },
      microphone: async (events) => {
        microphone = events;
        return { cancel: () => undefined };
      },
      replyAudible: () => false,
    },
    { heard: () => undefined, level: () => undefined, turn: (text) => turns.push(text), interrupt: () => undefined, failed: () => undefined },
  );
  await listener.start();

  const speak = (seconds: number) => {
    for (let t = 0; t < seconds; t += 0.04) {
      microphone.onSamples?.(BLOCK);
      microphone.onLevel?.(0.5);
      microphone.onAudio(BLOCK);
      vi.advanceTimersByTime(40);
    }
  };
  const hear = (text: string, end: number, probability: number) => {
    transcript.onEvent?.({ type: 'partial', text, end });
    transcript.onEvent?.({ type: 'turn', end, probability });
  };
  const quiet = (seconds: number) => {
    for (let t = 0; t < seconds; t += 0.04) {
      microphone.onSamples?.(BLOCK);
      microphone.onLevel?.(0);
      vi.advanceTimersByTime(40);
    }
  };
  return { listener, turns, speak, hear, quiet };
}

describe('VoiceListener', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'performance'] }));
  afterEach(() => vi.useRealTimers());

  it('ends the turn right after a pause the model is sure finishes it', async () => {
    const { listener, turns, speak, hear, quiet } = await listening();
    speak(1.2);
    hear("What's the capital of Australia?", 1.2, 0.95);

    quiet(0.4);
    listener.stop();

    expect(turns).toEqual(["What's the capital of Australia?"]);
  });

  it('waits through a pause the model expects the viewer to talk on from', async () => {
    const { listener, turns, speak, hear, quiet } = await listening();
    speak(1.2);
    hear('I want to book a flight to', 1.2, 0.02);

    quiet(3);
    expect(turns).toEqual([]);
    quiet(3.5);
    listener.stop();

    expect(turns).toEqual(['I want to book a flight to']);
  });
});
