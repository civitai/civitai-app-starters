export const PCM_RATE = 16_000;

export const SPEECH_LEVEL = 0.08;

export class Resampler {
  #step: number;
  #at = 0;
  #last = 0;

  constructor(fromRate: number, toRate = PCM_RATE) {
    this.#step = fromRate / toRate;
  }

  push(input: Float32Array): Int16Array {
    const out: number[] = [];
    // Position -1 is the previous block's last sample, so block edges don't click.
    while (this.#at < input.length - 1) {
      const index = Math.floor(this.#at);
      const fraction = this.#at - index;
      const a = index < 0 ? this.#last : input[index]!;
      const b = input[index + 1]!;
      out.push(toInt16(a + (b - a) * fraction));
      this.#at += this.#step;
    }
    this.#at -= input.length;
    if (input.length > 0) this.#last = input[input.length - 1]!;
    return Int16Array.from(out);
  }
}

function toInt16(sample: number): number {
  const clamped = Math.max(-1, Math.min(1, sample));
  return Math.round(clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff);
}

export function levelOf(pcm: Int16Array): number {
  if (pcm.length === 0) return 0;
  let sum = 0;
  for (const sample of pcm) sum += (sample / 0x8000) ** 2;
  return Math.min(1, Math.sqrt(sum / pcm.length) * 4);
}

export interface GateOptions {
  /** The transcriber needs about 600 ms of quiet to commit a segment. */
  hangMs?: number;
  /** Keeps the first syllable from being clipped. */
  prerollMs?: number;
}

/** Long silences are held back: live transcription bills per second sent and holds a GPU slot while open. */
export class SpeechGate {
  #send: (pcm: Int16Array) => void;
  #hang: number;
  #preroll: number;
  #held: Int16Array[] = [];
  #heldSamples = 0;
  #open = false;
  #quiet = 0;

  constructor(send: (pcm: Int16Array) => void, { hangMs = 1000, prerollMs = 300 }: GateOptions = {}) {
    this.#send = send;
    this.#hang = (hangMs * PCM_RATE) / 1000;
    this.#preroll = (prerollMs * PCM_RATE) / 1000;
  }

  push(pcm: Int16Array, level = levelOf(pcm)): void {
    if (level >= SPEECH_LEVEL) {
      if (!this.#open) {
        for (const block of this.#held) this.#send(block);
        this.#held = [];
        this.#heldSamples = 0;
        this.#open = true;
      }
      this.#quiet = 0;
      this.#send(pcm);
      return;
    }
    if (this.#open && this.#quiet + pcm.length <= this.#hang) {
      this.#quiet += pcm.length;
      this.#send(pcm);
      return;
    }
    this.#open = false;
    this.#hold(pcm);
  }

  #hold(pcm: Int16Array): void {
    this.#held.push(pcm);
    this.#heldSamples += pcm.length;
    while (this.#held.length > 1 && this.#heldSamples - this.#held[0]!.length >= this.#preroll) {
      this.#heldSamples -= this.#held.shift()!.length;
    }
  }
}

export function pcmBytes(blocks: Int16Array[]): Uint8Array {
  const total = blocks.reduce((sum, block) => sum + block.length, 0);
  const bytes = new Uint8Array(total * 2);
  const view = new DataView(bytes.buffer);
  let offset = 0;
  for (const block of blocks) {
    for (const sample of block) {
      view.setInt16(offset, sample, true);
      offset += 2;
    }
  }
  return bytes;
}

/** A playable WAV of the PCM, for transcribing in one go when live transcription is not available. */
export function wavOf(blocks: Int16Array[]): Blob {
  const data = pcmBytes(blocks);
  const header = new DataView(new ArrayBuffer(44));
  const text = (offset: number, value: string) => [...value].forEach((char, i) => header.setUint8(offset + i, char.charCodeAt(0)));
  text(0, 'RIFF');
  header.setUint32(4, 36 + data.length, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  header.setUint32(16, 16, true);
  header.setUint16(20, 1, true);
  header.setUint16(22, 1, true);
  header.setUint32(24, PCM_RATE, true);
  header.setUint32(28, PCM_RATE * 2, true);
  header.setUint16(32, 2, true);
  header.setUint16(34, 16, true);
  text(36, 'data');
  header.setUint32(40, data.length, true);
  return new Blob([header.buffer, data as BlobPart], { type: 'audio/wav' });
}
