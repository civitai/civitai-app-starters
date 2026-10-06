import { levelOf, Resampler, SpeechGate } from './pcm.js';

const MAX_SECONDS = 120;
const PROCESSOR = 'cvt-pcm-tap';

const WORKLET = `class PcmTap extends AudioWorkletProcessor {
  constructor() { super(); this.buffer = new Float32Array(2048); this.filled = 0; }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) {
      for (let i = 0; i < channel.length; i++) {
        this.buffer[this.filled++] = channel[i];
        if (this.filled === this.buffer.length) { this.port.postMessage(this.buffer.slice(0)); this.filled = 0; }
      }
    }
    return true;
  }
}
registerProcessor('${PROCESSOR}', PcmTap);`;

export function canStreamPcm(): boolean {
  return typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia) && typeof AudioWorkletNode !== 'undefined' && typeof AudioContext !== 'undefined';
}

export interface PcmRecorderEvents {
  onLevel?(level: number): void;
  onAudio(pcm: Int16Array): void;
  onLimit?(): void;
}

export class PcmRecorder {
  #stream: MediaStream;
  #context: AudioContext;
  #node: AudioWorkletNode;
  #limit: ReturnType<typeof setTimeout>;
  #stopped = false;

  private constructor(stream: MediaStream, context: AudioContext, node: AudioWorkletNode, events: PcmRecorderEvents) {
    this.#stream = stream;
    this.#context = context;
    this.#node = node;
    const resampler = new Resampler(context.sampleRate);
    const gate = new SpeechGate((pcm) => events.onAudio(pcm));
    node.port.onmessage = (event: MessageEvent<Float32Array>) => {
      if (this.#stopped) return;
      const pcm = resampler.push(event.data);
      const level = levelOf(pcm);
      events.onLevel?.(level);
      gate.push(pcm, level);
    };
    this.#limit = setTimeout(() => events.onLimit?.(), MAX_SECONDS * 1000);
  }

  static async start(events: PcmRecorderEvents): Promise<PcmRecorder> {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    const context = new AudioContext();
    try {
      const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }));
      try {
        await context.audioWorklet.addModule(url);
      } finally {
        URL.revokeObjectURL(url);
      }
      const node = new AudioWorkletNode(context, PROCESSOR);
      const silent = context.createGain();
      silent.gain.value = 0;
      // A worklet only runs while something downstream pulls on it.
      context.createMediaStreamSource(stream).connect(node).connect(silent).connect(context.destination);
      return new PcmRecorder(stream, context, node, events);
    } catch (error) {
      for (const track of stream.getTracks()) track.stop();
      void context.close().catch(() => undefined);
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.#release();
  }

  cancel(): void {
    this.#release();
  }

  #release(): void {
    if (this.#stopped) return;
    this.#stopped = true;
    clearTimeout(this.#limit);
    this.#node.port.onmessage = null;
    for (const track of this.#stream.getTracks()) track.stop();
    void this.#context.close().catch(() => undefined);
  }
}
