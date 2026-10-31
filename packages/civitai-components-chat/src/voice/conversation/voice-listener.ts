import { PCM_RATE, SPEECH_LEVEL } from '../pcm.js';
import type { PcmRecorderEvents } from '../pcm-recorder.js';
import { LiveSocket, type LiveSocketHandlers } from './live-socket.js';
import { WINDOW_SAMPLES } from './smart-turn-features.js';
import type { TurnModel } from './turn-model.js';
import { holdFor, verdictFor, type TurnVerdict } from './turn-policy.js';

const TICK_MS = 50;
/** Smart Turn was trained on speech followed by about 200 ms of silence. */
const VERDICT_SILENCE = 0.2;
/** Voiced audio a turn needs before its text counts: the recognizer invents words ("Thank you.") for noise. */
const MIN_VOICED = 0.3;
/** Talking over the reply for this long stops it; a cough or a click does not. */
const INTERRUPT_AFTER = 0.2;

export interface ListenerDeps {
  /** Starts a `liveTranscription` step. */
  open(): Promise<{ workflowId: string; socketUrl: string }>;
  cancel(workflowId: string): void;
  connect?(url: string, handlers: LiveSocketHandlers): Promise<Pick<LiveSocket, 'send' | 'close'>>;
  microphone(events: PcmRecorderEvents): Promise<{ cancel(): void }>;
  /** The in-browser end-of-turn model; until it loads, the server's verdicts decide. */
  turnModel?(): Promise<TurnModel>;
  /** While the reply plays its voice leaks into the microphone, so only sustained speech counts. */
  replyAudible(): boolean;
}

export interface ListenerEvents {
  heard(text: string): void;
  level(level: number): void;
  /** The viewer finished their turn. */
  turn(text: string): void;
  /** The viewer talked over the reply. */
  interrupt(): void;
  failed(error: unknown): void;
}

class Utterance {
  finals: string[] = [];
  partial = '';
  /** Seconds of sent audio the transcript covers. */
  covered = 0;

  get text(): string {
    return [...this.finals, this.partial].join(' ').replace(/\s+/g, ' ').trim();
  }

  apply(event: { type: string; text?: unknown; end?: unknown }): void {
    const text = typeof event.text === 'string' ? event.text : '';
    if (event.type === 'partial') this.partial = text;
    if (event.type === 'final') {
      this.finals.push(text);
      this.partial = '';
    }
    if (typeof event.end === 'number') this.covered = Math.max(this.covered, event.end);
  }
}

/** Listens over one `liveTranscription` session and decides when the viewer has finished talking. */
export class VoiceListener {
  #deps: ListenerDeps;
  #events: ListenerEvents;
  #microphone?: { cancel(): void };
  #socket?: Pick<LiveSocket, 'send' | 'close'>;
  #workflowId?: string;
  #ticker?: ReturnType<typeof setInterval>;
  #stopped = false;

  /** Last 8 s of what the microphone heard, for the end-of-turn model. */
  #recent = new Float32Array(WINDOW_SAMPLES);
  #recentWritten = 0;
  #model?: TurnModel;

  // Positions on the session's own clock: seconds of audio sent, which skips the silence the gate held back.
  #sentSeconds = 0;
  #speechEnd = 0;
  #lastSpeechAt = -Infinity;
  #blockSeconds = 0;
  #loudBlock = false;
  #loudFor = 0;
  #interrupted = false;
  #voiced = 0;
  #utterance = new Utterance();
  #verdict?: TurnVerdict;
  #judgedSpeechEnd = -1;
  /** The transcriber's segment that was still open when the turn ended re-sends text that is already answered. */
  #staleSegment = false;
  #turnEndedAt = -Infinity;

  constructor(deps: ListenerDeps, events: ListenerEvents) {
    this.#deps = deps;
    this.#events = events;
  }

  async start(): Promise<void> {
    void this.#deps.turnModel?.().then(
      (model) => (this.#model = model),
      (error: unknown) => console.warn('[chat-cvt] the end-of-turn model did not load; the server decides', error),
    );
    await this.#connect();
    this.#microphone = await this.#deps.microphone({
      onSamples: (pcm) => this.#remember(pcm),
      onLevel: (level) => this.#onLevel(level),
      onAudio: (pcm) => this.#onAudio(pcm),
    });
    this.#ticker = setInterval(() => this.#tick(), TICK_MS);
  }

  stop(): void {
    this.#stopped = true;
    clearInterval(this.#ticker);
    this.#microphone?.cancel();
    this.#socket?.close();
    if (this.#workflowId) this.#deps.cancel(this.#workflowId);
  }

  // A session ends at its time limit or after a long silence; the conversation carries on in a new one.
  async #connect(): Promise<void> {
    const { workflowId, socketUrl } = await this.#deps.open();
    this.#workflowId = workflowId;
    this.#sentSeconds = 0;
    this.#speechEnd = 0;
    this.#turnEndedAt = -Infinity;
    this.#utterance = new Utterance();
    const connect = this.#deps.connect ?? ((url, handlers) => LiveSocket.open(url, handlers));
    this.#socket = await connect(socketUrl, {
      onEvent: (event) => this.#onTranscript(event),
      onClose: () => {
        if (!this.#stopped) void this.#connect().catch((error: unknown) => this.#events.failed(error));
      },
    });
  }

  #remember(pcm: Int16Array): void {
    this.#blockSeconds = pcm.length / PCM_RATE;
    for (const sample of pcm) this.#recent[this.#recentWritten++ % this.#recent.length] = sample / 0x8000;
  }

  #onLevel(level: number): void {
    this.#events.level(level);
    this.#loudBlock = level >= SPEECH_LEVEL;
    if (!this.#loudBlock) {
      this.#loudFor = 0;
      this.#interrupted = false;
      return;
    }
    this.#loudFor += this.#blockSeconds;
    this.#lastSpeechAt = performance.now();
    const audible = this.#deps.replyAudible();
    if (!audible || this.#loudFor >= INTERRUPT_AFTER) this.#voiced += this.#blockSeconds;
    if (audible && this.#loudFor >= INTERRUPT_AFTER && !this.#interrupted) {
      this.#interrupted = true;
      this.#events.interrupt();
    }
  }

  #onAudio(pcm: Int16Array): void {
    this.#socket?.send(pcm);
    this.#sentSeconds += pcm.length / PCM_RATE;
    // The gate sends a loud block last, after any quiet lead-in it held, so this is where the speech ends.
    if (this.#loudBlock) this.#speechEnd = this.#sentSeconds;
  }

  #onTranscript(event: { type: string } & Record<string, unknown>): void {
    if (event.type === 'turn') {
      if (!this.#model && typeof event.end === 'number' && typeof event.probability === 'number') {
        this.#verdict = { speechEnd: event.end, probability: event.probability };
      }
      return;
    }
    if (event.type !== 'partial' && event.type !== 'final') return;
    if (this.#staleSegment && this.#lastSpeechAt <= this.#turnEndedAt) {
      if (event.type === 'final') this.#staleSegment = false;
      return;
    }
    if (this.#voiced < MIN_VOICED) return;
    this.#utterance.apply(event);
    this.#events.heard(this.#utterance.text);
  }

  #tick(): void {
    const silence = (performance.now() - this.#lastSpeechAt) / 1000;
    const speechEnd = this.#speechEnd;
    if (this.#model && silence >= VERDICT_SILENCE && this.#judgedSpeechEnd !== speechEnd && this.#voiced >= MIN_VOICED) {
      this.#judgedSpeechEnd = speechEnd;
      void this.#model.judge(this.#lastSeconds()).then((probability) => {
        if (this.#speechEnd === speechEnd) this.#verdict = { speechEnd, probability };
      });
    }

    const text = this.#utterance.text;
    const transcribed = this.#utterance.covered >= speechEnd - 0.1;
    if (!text || this.#voiced < MIN_VOICED || !transcribed || silence < holdFor(verdictFor(this.#verdict, speechEnd))) return;

    this.#staleSegment = this.#utterance.partial !== '';
    this.#turnEndedAt = performance.now();
    this.#utterance = new Utterance();
    this.#voiced = 0;
    this.#verdict = undefined;
    this.#events.heard('');
    this.#events.turn(text);
  }

  #lastSeconds(): Float32Array {
    const n = Math.min(this.#recentWritten, this.#recent.length);
    const audio = new Float32Array(n);
    for (let i = 0; i < n; i++) audio[i] = this.#recent[(this.#recentWritten - n + i) % this.#recent.length]!;
    return audio;
  }
}
