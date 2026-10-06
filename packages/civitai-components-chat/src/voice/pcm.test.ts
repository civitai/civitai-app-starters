import { describe, expect, it } from 'vitest';

import { levelOf, PCM_RATE, Resampler, SpeechGate } from './pcm.js';

const block = (samples: number, value: number) => new Int16Array(samples).fill(value);
const LOUD = 8000;

describe('Resampler', () => {
  it('turns 48 kHz into 16 kHz without a seam between blocks', () => {
    const resampler = new Resampler(48_000);
    const ramp = (from: number) => Float32Array.from({ length: 480 }, (_, i) => (from + i) / 2000);
    const out = [...resampler.push(ramp(0)), ...resampler.push(ramp(480))];

    expect(Math.abs(out.length - 320)).toBeLessThanOrEqual(1);
    const steps = out.slice(1).map((sample, i) => sample - out[i]!);
    expect(Math.max(...steps) - Math.min(...steps)).toBeLessThanOrEqual(2);
  });
});

describe('SpeechGate', () => {
  const run = (blocks: Int16Array[]) => {
    const sent: Int16Array[] = [];
    const gate = new SpeechGate((pcm) => sent.push(pcm));
    for (const pcm of blocks) gate.push(pcm);
    return sent.reduce((sum, pcm) => sum + pcm.length, 0) / PCM_RATE;
  };
  const tenth = (value: number) => block(PCM_RATE / 10, value);

  it('sends no silence before anyone speaks', () => {
    expect(run(Array.from({ length: 50 }, () => tenth(0)))).toBe(0);
  });

  it('sends speech with the moment before it, and a second of the pause after it, then holds back the rest', () => {
    const quiet = Array.from({ length: 10 }, () => tenth(0));
    const speech = Array.from({ length: 20 }, () => tenth(LOUD));
    const sent = run([...quiet, ...speech, ...quiet, ...quiet, ...quiet]);

    expect(sent).toBeCloseTo(0.3 + 2 + 1, 5);
  });

  it('picks up again when speech resumes after a long pause', () => {
    const quiet = Array.from({ length: 30 }, () => tenth(0));
    const speech = Array.from({ length: 10 }, () => tenth(LOUD));
    expect(run([...speech, ...quiet, ...speech])).toBeCloseTo(1 + 1 + 0.3 + 1, 5);
  });
});

describe('PCM', () => {
  it('measures loudness on the meter scale', () => {
    expect(levelOf(block(160, 0))).toBe(0);
    expect(levelOf(block(160, LOUD))).toBeGreaterThan(0.5);
  });
});
