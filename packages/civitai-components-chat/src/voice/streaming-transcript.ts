import type { VoiceTranscript } from './live-transcript.js';
import { pcmBytes, wavOf } from './pcm.js';

const MAX_REQUEST_BYTES = 1024 * 1024;
const SEND_ATTEMPTS = 4;
const READ_ATTEMPTS = 3;
/** How long to wait for `done` after the input is closed before keeping what arrived. */
const SETTLE_MS = 20_000;
/** The server ends a session after this long with no audio; the gate holds back silence, so it is the viewer's pause. */
const IDLE_SECONDS = 12;

export interface LiveSession {
  workflowId: string;
  inputUrl: string;
  transcriptUrl: string;
}

export interface StreamingDeps {
  /** Submits a `liveTranscription` step as the viewer and returns its upload and transcript URLs. */
  open(input: { language?: string; maxDurationSeconds: number; idleTimeoutSeconds: number }): Promise<LiveSession>;
  cancel(workflowId: string): Promise<void>;
  /** Transcribes a whole recording at once, for when live transcription cannot start. */
  transcribe(recording: Blob, signal: AbortSignal): Promise<string>;
  fetch?: typeof fetch;
  language?: string;
  maxSeconds?: number;
}

type TranscriptEvent =
  | { type: 'partial'; text: string }
  | { type: 'final'; text: string }
  | { type: 'done'; text: string };

/**
 * One utterance transcribed while it is spoken: audio goes up in numbered chunks, one request at a time,
 * and text comes back as a stream of partial and final segments. When the step cannot start, the audio is
 * kept and transcribed in one go at the end instead.
 */
export class StreamingTranscript implements VoiceTranscript {
  #deps: StreamingDeps;
  #onChange: () => void;
  #fetch: typeof fetch;
  #abort = new AbortController();
  #session?: LiveSession;
  #unavailable = false;
  /** Audio recorded before the session answered, or all of it when it never does. */
  #recorded: Int16Array[] = [];
  #outbox: Int16Array[] = [];
  #wake?: () => void;
  #closing = false;
  #finals: string[] = [];
  #partial = '';
  #done?: string;
  #settled = false;
  #resolve!: (text: string) => void;
  #result: Promise<string>;
  error?: unknown;

  constructor(deps: StreamingDeps, onChange: () => void) {
    this.#deps = deps;
    this.#onChange = onChange;
    this.#fetch = deps.fetch ?? fetch.bind(globalThis);
    this.#result = new Promise((resolve) => (this.#resolve = resolve));
    void deps
      .open({ ...(deps.language ? { language: deps.language } : {}), maxDurationSeconds: deps.maxSeconds ?? 120, idleTimeoutSeconds: IDLE_SECONDS })
      .then(
        (session) => this.#begin(session),
        () => {
          this.#unavailable = true;
          if (this.#closing) void this.#transcribeAtOnce();
        },
      );
  }

  add(pcm: Int16Array): void {
    if (this.canceled || this.#closing || this.#settled) return;
    if (this.#session) {
      this.#outbox.push(pcm);
      this.#wake?.();
    } else {
      this.#recorded.push(pcm);
    }
  }

  /** The viewer is done talking: the input closes and the last words come back. */
  stop(): void {
    if (this.#closing || this.canceled) return;
    this.#closing = true;
    if (this.#session) {
      this.#wake?.();
      setTimeout(() => this.#finish(), SETTLE_MS);
    } else if (this.#unavailable) {
      void this.#transcribeAtOnce();
    }
  }

  cancel(): void {
    if (this.canceled) return;
    this.#abort.abort();
    if (this.#session) void this.#deps.cancel(this.#session.workflowId).catch(() => undefined);
    this.#finish();
  }

  get canceled(): boolean {
    return this.#abort.signal.aborted;
  }

  get text(): string {
    if (this.#done !== undefined) return this.#done.trim();
    return [...this.#finals, this.#partial].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  }

  get pending(): boolean {
    return !this.#settled;
  }

  settled(): Promise<string> {
    return this.#result;
  }

  #begin(session: LiveSession): void {
    if (this.canceled) {
      void this.#deps.cancel(session.workflowId).catch(() => undefined);
      return;
    }
    this.#session = session;
    this.#outbox.push(...this.#recorded);
    this.#recorded = [];
    void this.#read();
    void this.#upload();
    if (this.#closing) setTimeout(() => this.#finish(), SETTLE_MS);
  }

  async #upload(): Promise<void> {
    const session = this.#session!;
    let seq = 0;
    while (!this.canceled && !this.#settled) {
      if (this.#outbox.length === 0 && !this.#closing) {
        await new Promise<void>((resolve) => (this.#wake = resolve));
        continue;
      }
      // Whatever was recorded while the last request was out goes in this one, so a slow line adds lag, never a queue.
      const blocks: Int16Array[] = [];
      let size = 0;
      while (this.#outbox.length > 0 && size + this.#outbox[0]!.length * 2 <= MAX_REQUEST_BYTES) {
        size += this.#outbox[0]!.length * 2;
        blocks.push(this.#outbox.shift()!);
      }
      const final = this.#closing && this.#outbox.length === 0;
      const reply = await this.#send(session, seq, pcmBytes(blocks), final);
      if (reply === 'stop') return this.#closeEmpty(session, seq + 1);
      seq = reply;
      if (final) return;
    }
  }

  /** The next sequence number, or `stop` when the input will take no more audio. */
  async #send(session: LiveSession, seq: number, body: Uint8Array, final: boolean): Promise<number | 'stop'> {
    for (let attempt = 1; attempt <= SEND_ATTEMPTS && !this.canceled; attempt++) {
      try {
        const response = await this.#fetch(`${session.inputUrl}&seq=${seq}${final ? '&final=true' : ''}`, {
          method: 'POST',
          headers: { 'Content-Type': 'audio/pcm' },
          body: body as BodyInit,
          signal: this.#abort.signal,
        });
        if (response.ok) return seq + 1;
        if (response.status === 409) {
          const next = Number(((await response.json().catch(() => ({}))) as { nextSequence?: unknown }).nextSequence);
          // Already taken (a retry after a lost reply), or the server closed the input.
          if (Number.isInteger(next) && next > seq) return next;
          return 'stop';
        }
        if (response.status === 413) return 'stop';
        this.error ??= new Error(`The recording could not be sent (${response.status}).`);
        return 'stop';
      } catch (error) {
        if (this.canceled) return 'stop';
        if (attempt === SEND_ATTEMPTS) {
          this.error ??= error;
          return 'stop';
        }
        await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
      }
    }
    return 'stop';
  }

  async #closeEmpty(session: LiveSession, seq: number): Promise<void> {
    if (this.canceled) return;
    await this.#fetch(`${session.inputUrl}&seq=${seq}&final=true`, { method: 'POST', headers: { 'Content-Type': 'audio/pcm' }, signal: this.#abort.signal }).catch(() => undefined);
  }

  async #read(): Promise<void> {
    const session = this.#session!;
    for (let attempt = 1; attempt <= READ_ATTEMPTS && !this.#settled; attempt++) {
      try {
        const response = await this.#fetch(session.transcriptUrl, { signal: this.#abort.signal });
        if (!response.ok || !response.body) throw new Error(`The transcript could not be read (${response.status}).`);
        // The stream replays from the start on every connection.
        this.#finals = [];
        this.#partial = '';
        const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
        let buffered = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffered += value;
          const lines = buffered.split('\n');
          buffered = lines.pop() ?? '';
          for (const line of lines) if (line.trim()) this.#apply(JSON.parse(line) as TranscriptEvent);
        }
        if (buffered.trim()) this.#apply(JSON.parse(buffered) as TranscriptEvent);
        if (this.#done !== undefined) return;
      } catch (error) {
        if (this.canceled) return;
        if (attempt === READ_ATTEMPTS) this.error ??= error;
      }
    }
    this.#finish();
  }

  #apply(event: TranscriptEvent): void {
    if (event.type === 'partial') this.#partial = event.text;
    else if (event.type === 'final') {
      this.#finals.push(event.text);
      this.#partial = '';
    } else if (event.type === 'done') {
      this.#done = event.text;
      this.#finish();
      return;
    }
    this.#onChange();
  }

  async #transcribeAtOnce(): Promise<void> {
    if (this.#recorded.length === 0) return this.#finish();
    try {
      this.#done = await this.#deps.transcribe(wavOf(this.#recorded), this.#abort.signal);
    } catch (error) {
      if (!this.canceled) this.error ??= error;
    }
    this.#recorded = [];
    this.#finish();
  }

  #finish(): void {
    if (this.#settled) return;
    this.#settled = true;
    this.#wake?.();
    this.#resolve(this.text);
    if (!this.canceled) this.#onChange();
  }
}
