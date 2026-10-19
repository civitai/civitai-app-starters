import { LiveSocket } from './live-socket.js';

const SPEECH_RATE = 24_000;
/** How long sent text counts as about to be heard before its audio arrives. */
const FIRST_AUDIO_WAIT_MS = 5_000;

export interface SpeakerDeps {
  /** Starts a `liveTextToSpeech` step that streams 24 kHz PCM back. */
  open(): Promise<{ workflowId: string; socketUrl: string }>;
  cancel(workflowId: string): void;
}

interface SpeechSession {
  workflowId?: string;
  socket?: LiveSocket;
  /** Text said before the socket opened. */
  pending: string;
  closed: boolean;
}

/** Speaks streamed text through one `liveTextToSpeech` session at a time. */
export class VoiceSpeaker {
  #deps: SpeakerDeps;
  #context = new AudioContext();
  #playhead = 0;
  #sources = new Set<AudioBufferSourceNode>();
  #oddByte?: number;
  #session?: SpeechSession;
  #awaitingAudioUntil = 0;

  constructor(deps: SpeakerDeps) {
    this.#deps = deps;
  }

  /** Whether the viewer hears, or is about to hear, the reply. */
  get audible(): boolean {
    return performance.now() < this.#awaitingAudioUntil || this.#playhead > this.#context.currentTime + 0.05;
  }

  /** Opens a session ahead of the first reply; one sits idle at no cost, as speech is billed per character. */
  prepare(): void {
    if (!this.#session || this.#session.closed) this.#session = this.#connect();
  }

  say(text: string): void {
    if (!text.trim()) return;
    if (!this.audible) this.#awaitingAudioUntil = performance.now() + FIRST_AUDIO_WAIT_MS;
    this.#send(text);
  }

  /** Releases the last sentence, which the worker holds until whitespace follows it. */
  finish(): void {
    if (this.#session) this.#send('\n');
  }

  /** Cuts the reply off. Text already sent cannot be taken back, so the next reply gets a fresh session. */
  stop(): void {
    this.#cutOff();
    this.prepare();
  }

  close(): void {
    this.#cutOff();
    void this.#context.close().catch(() => undefined);
  }

  #send(text: string): void {
    this.prepare();
    const session = this.#session!;
    if (session.socket) session.socket.send(new TextEncoder().encode(text));
    else session.pending += text;
  }

  #cutOff(): void {
    for (const source of this.#sources) source.stop();
    this.#sources.clear();
    this.#playhead = 0;
    this.#oddByte = undefined;
    this.#awaitingAudioUntil = 0;
    this.#end(this.#session);
    this.#session = undefined;
  }

  #connect(): SpeechSession {
    const session: SpeechSession = { pending: '', closed: false };
    void (async () => {
      const { workflowId, socketUrl } = await this.#deps.open();
      session.workflowId = workflowId;
      if (session.closed) return this.#deps.cancel(workflowId);
      session.socket = await LiveSocket.open(socketUrl, {
        onAudio: (bytes) => {
          if (this.#session === session) this.#play(bytes);
        },
        onClose: () => (session.closed = true),
      });
      if (session.pending) session.socket.send(new TextEncoder().encode(session.pending));
      session.pending = '';
    })().catch((error: unknown) => {
      session.closed = true;
      console.warn('[chat-cvt] the voice did not start', error);
    });
    return session;
  }

  #end(session: SpeechSession | undefined): void {
    if (!session || session.closed) return;
    session.closed = true;
    session.socket?.close();
    if (session.workflowId) this.#deps.cancel(session.workflowId);
  }

  #play(bytes: Uint8Array): void {
    // A sample can straddle two frames: its first byte waits for the next one.
    if (this.#oddByte !== undefined) {
      const joined = new Uint8Array(bytes.length + 1);
      joined[0] = this.#oddByte;
      joined.set(bytes, 1);
      bytes = joined;
      this.#oddByte = undefined;
    }
    if (bytes.length % 2) {
      this.#oddByte = bytes[bytes.length - 1];
      bytes = bytes.subarray(0, bytes.length - 1);
    }
    if (!bytes.length) return;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
    const buffer = this.#context.createBuffer(1, bytes.length / 2, SPEECH_RATE);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < channel.length; i++) channel[i] = view.getInt16(i * 2, true) / 0x8000;
    const source = this.#context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.#context.destination);
    const startAt = Math.max(this.#context.currentTime + 0.03, this.#playhead);
    source.start(startAt);
    this.#playhead = startAt + buffer.duration;
    this.#awaitingAudioUntil = 0;
    this.#sources.add(source);
    source.onended = () => this.#sources.delete(source);
  }
}
