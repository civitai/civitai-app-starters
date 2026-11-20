// Must match WhisperFeatureExtractor(chunk_length=8, do_normalize=True); Smart Turn v3 was trained on it.
import { PCM_RATE } from '../pcm.js';

export const WINDOW_SAMPLES = 8 * PCM_RATE;
const FFT = 400;
const HOP = 160;
const BINS = FFT / 2 + 1;
const MELS = 80;
const FRAMES = WINDOW_SAMPLES / HOP;
export const FEATURE_DIMS = [1, MELS, FRAMES];

const hann = Float32Array.from({ length: FFT }, (_, n) => 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / FFT));
const twiddleRe = Float64Array.from({ length: FFT }, (_, j) => Math.cos((-2 * Math.PI * j) / FFT));
const twiddleIm = Float64Array.from({ length: FFT }, (_, j) => Math.sin((-2 * Math.PI * j) / FFT));
// 400 = 4·4·5·5, so a mixed-radix FFT replaces the 80k-multiply-per-frame DFT.
const RADICES = [4, 4, 5, 5];
const scratchRe = RADICES.map((_, level) => new Float64Array(FFT / RADICES.slice(0, level).reduce((a, r) => a * r, 1)));
const scratchIm = scratchRe.map((a) => new Float64Array(a.length));
const spectrumRe = new Float64Array(FFT);
const spectrumIm = new Float64Array(FFT);

function fft(input: Float64Array, inOffset: number, stride: number, n: number, level: number, outOffset: number): void {
  if (n === 1) {
    spectrumRe[outOffset] = input[inOffset]!;
    spectrumIm[outOffset] = 0;
    return;
  }
  const p = RADICES[level]!;
  const m = n / p;
  const step = FFT / n;
  for (let q = 0; q < p; q++) fft(input, inOffset + q * stride, stride * p, m, level + 1, outOffset + q * m);
  const tRe = scratchRe[level]!;
  const tIm = scratchIm[level]!;
  tRe.set(spectrumRe.subarray(outOffset, outOffset + n));
  tIm.set(spectrumIm.subarray(outOffset, outOffset + n));
  for (let k = 0; k < m; k++) {
    for (let s = 0; s < p; s++) {
      const index = k + s * m;
      let re = 0;
      let im = 0;
      for (let q = 0; q < p; q++) {
        const t = (q * index * step) % FFT;
        const aRe = tRe[q * m + k]!;
        const aIm = tIm[q * m + k]!;
        re += aRe * twiddleRe[t]! - aIm * twiddleIm[t]!;
        im += aRe * twiddleIm[t]! + aIm * twiddleRe[t]!;
      }
      spectrumRe[outOffset + index] = re;
      spectrumIm[outOffset + index] = im;
    }
  }
}

const melFilters = (() => {
  const hzToMel = (hz: number) => (hz < 1000 ? (3 * hz) / 200 : 15 + (Math.log(hz / 1000) * 27) / Math.log(6.4));
  const melToHz = (mel: number) => (mel < 15 ? (200 * mel) / 3 : 1000 * Math.exp(((mel - 15) * Math.log(6.4)) / 27));
  const maxMel = hzToMel(PCM_RATE / 2);
  const edges = Array.from({ length: MELS + 2 }, (_, i) => melToHz((maxMel * i) / (MELS + 1)));
  const filters = new Float32Array(MELS * BINS);
  for (let m = 0; m < MELS; m++) {
    const norm = 2 / (edges[m + 2]! - edges[m]!);
    for (let b = 0; b < BINS; b++) {
      const hz = (b * PCM_RATE) / FFT;
      const rising = (hz - edges[m]!) / (edges[m + 1]! - edges[m]!);
      const falling = (edges[m + 2]! - hz) / (edges[m + 2]! - edges[m + 1]!);
      filters[m * BINS + b] = Math.max(0, Math.min(rising, falling)) * norm;
    }
  }
  return filters;
})();

/** Log-mel features of the last 8 s of 16 kHz audio (in -1..1), laid out as [mel, frame]. */
export function features(audio: Float32Array): Float32Array {
  const take = Math.min(audio.length, WINDOW_SAMPLES);
  const x = new Float64Array(WINDOW_SAMPLES);
  x.set(audio.subarray(audio.length - take), WINDOW_SAMPLES - take);

  let mean = 0;
  for (const v of x) mean += v;
  mean /= x.length;
  let variance = 0;
  for (const v of x) variance += (v - mean) ** 2;
  const scale = 1 / Math.sqrt(variance / x.length + 1e-7);

  const pad = FFT / 2;
  const padded = new Float32Array(WINDOW_SAMPLES + FFT);
  for (let i = 0; i < padded.length; i++) {
    let j = i - pad;
    j = j < 0 ? -j : j >= WINDOW_SAMPLES ? 2 * WINDOW_SAMPLES - 2 - j : j;
    padded[i] = (x[j]! - mean) * scale;
  }

  const logMel = new Float32Array(MELS * FRAMES);
  const power = new Float32Array(BINS);
  const windowed = new Float64Array(FFT);
  let max = -Infinity;
  for (let f = 0; f < FRAMES; f++) {
    const o = f * HOP;
    for (let n = 0; n < FFT; n++) windowed[n] = padded[o + n]! * hann[n]!;
    fft(windowed, 0, 1, FFT, 0, 0);
    for (let b = 0; b < BINS; b++) power[b] = spectrumRe[b]! ** 2 + spectrumIm[b]! ** 2;
    for (let m = 0; m < MELS; m++) {
      let sum = 0;
      for (let b = 0; b < BINS; b++) sum += power[b]! * melFilters[m * BINS + b]!;
      const value = Math.log10(Math.max(1e-10, sum));
      logMel[m * FRAMES + f] = value;
      if (value > max) max = value;
    }
  }
  for (let i = 0; i < logMel.length; i++) logMel[i] = (Math.max(logMel[i]!, max - 8) + 4) / 4;
  return logMel;
}
