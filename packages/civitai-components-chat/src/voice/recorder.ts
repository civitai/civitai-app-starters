import { SPEECH_LEVEL } from './pcm.js';

const MAX_SECONDS = 120;
const TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];

/** Quiet this long after speech ends a phrase, which then goes out to be transcribed on its own. */
export const PAUSE_MS = 700;
const MIN_PHRASE_MS = 1000;
const MAX_PHRASE_MS = 15_000;

export function canRecord(): boolean {
  return typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== 'undefined' && recordingType() !== undefined;
}

function recordingType(): string | undefined {
  return TYPES.find((type) => MediaRecorder.isTypeSupported(type));
}

export interface RecorderEvents {
  /** 0 to 1. */
  onLevel?(level: number): void;
  /** A phrase ended: a playable recording of it, in the order spoken. Silence alone is never sent. */
  onPhrase?(recording: Blob): void;
  onLimit?(): void;
}

interface Phrase {
  recorder: MediaRecorder;
  done: Promise<Blob>;
  startedAt: number;
  speech: boolean;
}

/**
 * A microphone recording cut into phrases at pauses, so each can be transcribed while the viewer keeps
 * talking. Each phrase has its own recorder, because only a recording's first piece carries the header
 * that makes it playable.
 */
export class VoiceRecorder {
  #stream: MediaStream;
  #events: RecorderEvents;
  #phrase: Phrase;
  #context?: AudioContext;
  #frame = 0;
  #quietSince = 0;
  #limit: ReturnType<typeof setTimeout>;
  #stopped = false;

  private constructor(stream: MediaStream, events: RecorderEvents) {
    this.#stream = stream;
    this.#events = events;
    // Without a level to listen to, there are no pauses to cut at: everything is one phrase.
    const metered = this.#meter();
    this.#phrase = this.#begin(!metered);
    this.#limit = setTimeout(() => events.onLimit?.(), MAX_SECONDS * 1000);
  }

  /** Asks for the microphone; rejects when the viewer refuses or there is none. */
  static async start(events: RecorderEvents = {}): Promise<VoiceRecorder> {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    return new VoiceRecorder(stream, events);
  }

  /** Ends the recording; the last phrase, if anything was said in it, goes out before this resolves. */
  async stop(): Promise<void> {
    if (this.#stopped) return;
    this.#stopped = true;
    this.#release();
    await this.#end(this.#phrase);
  }

  cancel(): void {
    if (this.#stopped) return;
    this.#stopped = true;
    this.#release();
    this.#phrase.speech = false;
    if (this.#phrase.recorder.state !== 'inactive') this.#phrase.recorder.stop();
  }

  #begin(speech: boolean): Phrase {
    const recorder = new MediaRecorder(this.#stream, { mimeType: recordingType() });
    const chunks: Blob[] = [];
    recorder.addEventListener('dataavailable', (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    });
    const done = new Promise<Blob>((resolve) =>
      recorder.addEventListener('stop', () => resolve(new Blob(chunks, { type: recorder.mimeType || recordingType() }))),
    );
    recorder.start();
    return { recorder, done, startedAt: Date.now(), speech };
  }

  async #end(phrase: Phrase): Promise<void> {
    if (phrase.recorder.state !== 'inactive') phrase.recorder.stop();
    const recording = await phrase.done;
    if (phrase.speech && recording.size > 0) this.#events.onPhrase?.(recording);
  }

  #cut(): void {
    const ended = this.#phrase;
    this.#phrase = this.#begin(false);
    this.#quietSince = 0;
    void this.#end(ended);
  }

  #listen(level: number): void {
    const now = Date.now();
    const phrase = this.#phrase;
    if (level >= SPEECH_LEVEL) {
      phrase.speech = true;
      this.#quietSince = 0;
    } else if (!this.#quietSince) {
      this.#quietSince = now;
    }
    const age = now - phrase.startedAt;
    const paused = phrase.speech && this.#quietSince > 0 && now - this.#quietSince >= PAUSE_MS && age >= MIN_PHRASE_MS;
    if (paused || (phrase.speech && age >= MAX_PHRASE_MS)) this.#cut();
    // A long silence is dropped rather than sent, so nobody pays to transcribe nothing.
    else if (!phrase.speech && age >= MAX_PHRASE_MS) {
      phrase.recorder.stop();
      this.#phrase = this.#begin(false);
    }
  }

  #meter(): boolean {
    if (typeof AudioContext === 'undefined') return false;
    const context = new AudioContext();
    this.#context = context;
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    context.createMediaStreamSource(this.#stream).connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);
    const tick = (): void => {
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) sum += ((sample - 128) / 128) ** 2;
      const level = Math.min(1, Math.sqrt(sum / samples.length) * 4);
      this.#events.onLevel?.(level);
      this.#listen(level);
      this.#frame = requestAnimationFrame(tick);
    };
    this.#frame = requestAnimationFrame(tick);
    return true;
  }

  #release(): void {
    clearTimeout(this.#limit);
    cancelAnimationFrame(this.#frame);
    for (const track of this.#stream.getTracks()) track.stop();
    void this.#context?.close().catch(() => undefined);
    this.#context = undefined;
  }
}
