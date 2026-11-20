/** The words of one recording as they come back, however they are transcribed. */
export interface VoiceTranscript {
  readonly text: string;
  /** False once every word is back, or the transcription has given up. */
  readonly pending: boolean;
  readonly canceled: boolean;
  error?: unknown;
  /** The viewer finished talking. */
  stop(): void;
  settled(): Promise<string>;
  cancel(): void;
}

/**
 * The words of one recording as its phrases come back from transcription: each phrase is sent the moment
 * it ends, they finish in any order, and the text reads in the order they were spoken.
 */
export class LiveTranscript implements VoiceTranscript {
  #parts: (string | undefined)[] = [];
  #pending = new Set<Promise<void>>();
  #abort = new AbortController();
  #transcribe: (recording: Blob, signal: AbortSignal) => Promise<string>;
  #onChange: () => void;
  /** Why a phrase could not be turned into text, when one could not. */
  error?: unknown;

  constructor(transcribe: (recording: Blob, signal: AbortSignal) => Promise<string>, onChange: () => void) {
    this.#transcribe = transcribe;
    this.#onChange = onChange;
  }

  add(recording: Blob): void {
    if (this.#abort.signal.aborted) return;
    const index = this.#parts.push(undefined) - 1;
    const pending: Promise<void> = this.#transcribe(recording, this.#abort.signal)
      .then(
        (words) => {
          this.#parts[index] = words;
        },
        (error: unknown) => {
          if (!this.#abort.signal.aborted) this.error ??= error;
        },
      )
      .finally(() => {
        this.#pending.delete(pending);
        if (!this.#abort.signal.aborted) this.#onChange();
      });
    this.#pending.add(pending);
  }

  get text(): string {
    return this.#parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  }

  get pending(): boolean {
    return this.#pending.size > 0;
  }

  get canceled(): boolean {
    return this.#abort.signal.aborted;
  }

  /** The whole text once every phrase sent so far is back. */
  async settled(): Promise<string> {
    while (this.#pending.size > 0) await Promise.all([...this.#pending]);
    return this.text;
  }

  stop(): void {}

  cancel(): void {
    this.#abort.abort();
  }
}
