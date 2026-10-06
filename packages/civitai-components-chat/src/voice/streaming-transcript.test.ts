import { describe, expect, it, vi } from 'vitest';

import { StreamingTranscript, type LiveSession, type StreamingDeps } from './streaming-transcript.js';

const SESSION: LiveSession = { workflowId: 'wf1', inputUrl: 'https://orch/input?sig=a', transcriptUrl: 'https://orch/transcript?sig=b' };

/** An orchestrator that takes numbered audio chunks and streams whatever transcript events the test writes. */
function fakeOrchestrator({ hold = false } = {}) {
  const posts: { seq: number; final: boolean; bytes: number }[] = [];
  let write!: (line: string) => void;
  let end!: () => void;
  const transcript = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      write = (line) => controller.enqueue(encoder.encode(`${line}\n`));
      end = () => controller.close();
    },
  });
  let release: () => void = () => undefined;
  let gate = hold ? new Promise<void>((resolve) => (release = resolve)) : Promise.resolve();
  const replies: Response[] = [];
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === SESSION.transcriptUrl) return new Response(transcript, { status: 200 });
    const query = new URL(url).searchParams;
    posts.push({ seq: Number(query.get('seq')), final: query.get('final') === 'true', bytes: (init?.body as Uint8Array | undefined)?.length ?? 0 });
    await gate;
    return replies.shift() ?? Response.json({ nextSequence: Number(query.get('seq')) + 1 });
  });
  return {
    posts,
    fetch: fetch as unknown as typeof globalThis.fetch,
    say: (event: Record<string, unknown>) => write(JSON.stringify(event)),
    end: () => end(),
    replyNext: (response: Response) => replies.push(response),
    release: () => {
      release();
      gate = Promise.resolve();
    },
  };
}

function deps(orchestrator: ReturnType<typeof fakeOrchestrator>, overrides: Partial<StreamingDeps> = {}): StreamingDeps {
  return {
    open: vi.fn(async () => SESSION),
    cancel: vi.fn(async () => undefined),
    transcribe: vi.fn(async () => 'said at once'),
    fetch: orchestrator.fetch,
    language: 'en',
    ...overrides,
  };
}

const audio = (samples: number) => new Int16Array(samples).fill(1000);

describe('StreamingTranscript', () => {
  it('streams the audio in numbered chunks, shows the words as they come, and ends on done', async () => {
    const orchestrator = fakeOrchestrator();
    const changed = vi.fn();
    const open = vi.fn(async () => SESSION);
    const live = new StreamingTranscript(deps(orchestrator, { open }), changed);
    live.add(audio(1600));
    await vi.waitFor(() => expect(orchestrator.posts).toHaveLength(1));
    expect(open).toHaveBeenCalledWith({ language: 'en', maxDurationSeconds: 120, idleTimeoutSeconds: 12 });
    expect(orchestrator.posts[0]).toEqual({ seq: 0, final: false, bytes: 3200 });

    orchestrator.say({ type: 'partial', text: 'paint me', start: 0 });
    await vi.waitFor(() => expect(live.text).toBe('paint me'));
    orchestrator.say({ type: 'final', text: 'Paint me a cabin.', start: 0, end: 1.2 });
    orchestrator.say({ type: 'partial', text: 'in the', start: 1.2 });
    await vi.waitFor(() => expect(live.text).toBe('Paint me a cabin. in the'));

    live.add(audio(800));
    await vi.waitFor(() => expect(orchestrator.posts).toHaveLength(2));
    live.stop();
    await vi.waitFor(() => expect(orchestrator.posts.at(-1)).toEqual({ seq: 2, final: true, bytes: 0 }));
    orchestrator.say({ type: 'done', text: 'Paint me a cabin in the snow.', language: 'en', audioSeconds: 2.4 });
    orchestrator.end();

    expect(await live.settled()).toBe('Paint me a cabin in the snow.');
    expect(live.pending).toBe(false);
    expect(changed).toHaveBeenCalled();
  });

  it('keeps one request out at a time, putting what was recorded meanwhile into the next one', async () => {
    const orchestrator = fakeOrchestrator({ hold: true });
    const live = new StreamingTranscript(deps(orchestrator), () => undefined);
    live.add(audio(100));
    await vi.waitFor(() => expect(orchestrator.posts).toHaveLength(1));

    live.add(audio(200));
    live.add(audio(300));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(orchestrator.posts).toHaveLength(1);

    orchestrator.release();
    await vi.waitFor(() => expect(orchestrator.posts).toHaveLength(2));
    expect(orchestrator.posts[1]).toEqual({ seq: 1, final: false, bytes: 1000 });
    live.cancel();
  });

  it('moves on when the server already has a chunk whose reply was lost', async () => {
    const orchestrator = fakeOrchestrator();
    orchestrator.replyNext(Response.json({ nextSequence: 1 }, { status: 409 }));
    const live = new StreamingTranscript(deps(orchestrator), () => undefined);
    live.add(audio(100));
    await vi.waitFor(() => expect(orchestrator.posts).toHaveLength(1));
    live.add(audio(100));
    await vi.waitFor(() => expect(orchestrator.posts).toHaveLength(2));

    expect(orchestrator.posts[1]!.seq).toBe(1);
    live.cancel();
  });

  it('transcribes the whole recording at once when live transcription cannot start', async () => {
    const orchestrator = fakeOrchestrator();
    const transcribe = vi.fn(async () => 'said at once');
    const live = new StreamingTranscript(deps(orchestrator, { open: async () => Promise.reject(new Error('unknown step type')), transcribe }), () => undefined);
    live.add(audio(1600));
    live.add(audio(1600));
    live.stop();

    expect(await live.settled()).toBe('said at once');
    const [recording] = transcribe.mock.calls[0] as unknown as [Blob];
    expect(recording.type).toBe('audio/wav');
    expect(recording.size).toBe(44 + 6400);
    expect(orchestrator.posts).toEqual([]);
  });

  it('cancels the workflow when the viewer cancels', async () => {
    const orchestrator = fakeOrchestrator();
    const cancel = vi.fn(async () => undefined);
    const live = new StreamingTranscript(deps(orchestrator, { cancel }), () => undefined);
    live.add(audio(100));
    await vi.waitFor(() => expect(orchestrator.posts).toHaveLength(1));

    live.cancel();
    expect(cancel).toHaveBeenCalledWith('wf1');
    expect(live.pending).toBe(false);
  });

  it('settles when the server stops listening on its own', async () => {
    const orchestrator = fakeOrchestrator();
    const live = new StreamingTranscript(deps(orchestrator), () => undefined);
    live.add(audio(100));
    await vi.waitFor(() => expect(orchestrator.posts).toHaveLength(1));

    orchestrator.say({ type: 'final', text: 'Hello.', start: 0, end: 1 });
    orchestrator.say({ type: 'done', text: 'Hello.' });
    expect(await live.settled()).toBe('Hello.');
    live.add(audio(100));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(orchestrator.posts).toHaveLength(1);
  });
});
