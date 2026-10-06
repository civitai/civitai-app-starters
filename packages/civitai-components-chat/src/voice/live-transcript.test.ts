import { describe, expect, it, vi } from 'vitest';

import { LiveTranscript } from './live-transcript.js';

function controllable() {
  const calls: { recording: Blob; resolve(words: string): void; reject(error: unknown): void }[] = [];
  const transcribe = (recording: Blob) => new Promise<string>((resolve, reject) => calls.push({ recording, resolve, reject }));
  return { calls, transcribe };
}

const phrase = (name: string) => new Blob([name], { type: 'audio/webm' });

describe('LiveTranscript', () => {
  it('reads in the order the phrases were spoken, whichever comes back first', async () => {
    const { calls, transcribe } = controllable();
    const changed = vi.fn();
    const live = new LiveTranscript(transcribe, changed);
    live.add(phrase('one'));
    live.add(phrase('two'));

    calls[1]!.resolve('a snowy cabin');
    await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
    expect(live.text).toBe('a snowy cabin');
    expect(live.pending).toBe(true);

    calls[0]!.resolve('Paint me');
    expect(await live.settled()).toBe('Paint me a snowy cabin');
    expect(live.pending).toBe(false);
  });

  it('keeps the phrases that worked when one fails, and says one failed', async () => {
    const { calls, transcribe } = controllable();
    const live = new LiveTranscript(transcribe, () => undefined);
    live.add(phrase('one'));
    live.add(phrase('two'));
    calls[0]!.resolve('Paint me');
    calls[1]!.reject(new Error('service down'));

    expect(await live.settled()).toBe('Paint me');
    expect((live.error as Error).message).toBe('service down');
  });

  it('stops listening once canceled', async () => {
    const { calls, transcribe } = controllable();
    const changed = vi.fn();
    const live = new LiveTranscript(transcribe, changed);
    live.add(phrase('one'));
    live.cancel();
    live.add(phrase('two'));
    calls[0]!.reject(new DOMException('aborted', 'AbortError'));

    await live.settled();
    expect(calls).toHaveLength(1);
    expect(live.error).toBeUndefined();
    expect(changed).not.toHaveBeenCalled();
  });
});
