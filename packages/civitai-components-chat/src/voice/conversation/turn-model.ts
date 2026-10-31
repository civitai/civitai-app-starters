import { FEATURE_DIMS, features } from './smart-turn-features.js';

const ORT_DIST = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/';
const MODEL_URL = 'https://huggingface.co/pipecat-ai/smart-turn-v3/resolve/f766f81d3cfdf7737ac64aad813d91bbfd56bf93/smart-turn-v3.2-cpu.onnx';

interface OnnxRuntime {
  env: { wasm: { wasmPaths: string; numThreads: number } };
  Tensor: new (type: 'float32', data: Float32Array, dims: number[]) => unknown;
  InferenceSession: {
    create(url: string): Promise<{ run(feeds: Record<string, unknown>): Promise<Record<string, { data: ArrayLike<number> }>> }>;
  };
}

/** Smart Turn v3: from the last 8 s of 16 kHz audio, the probability that the speaker has finished. */
export interface TurnModel {
  judge(audio: Float32Array): Promise<number>;
}

let loading: Promise<TurnModel> | undefined;

/** Fetched once per page, on first use: about 8 MB of model and 11 MB of runtime. */
export function loadTurnModel(): Promise<TurnModel> {
  loading ??= load().catch((error: unknown) => {
    loading = undefined;
    throw error;
  });
  return loading;
}

async function load(): Promise<TurnModel> {
  // Loaded from the CDN at runtime, so a page that never talks never bundles or downloads it.
  const ort = (await import(/* @vite-ignore */ /* webpackIgnore: true */ `${ORT_DIST}ort.wasm.min.mjs`)) as OnnxRuntime;
  ort.env.wasm.wasmPaths = ORT_DIST;
  ort.env.wasm.numThreads = 1;
  const session = await ort.InferenceSession.create(MODEL_URL);
  return {
    async judge(audio) {
      const output = await session.run({ input_features: new ort.Tensor('float32', features(audio), FEATURE_DIMS) });
      return Object.values(output)[0]!.data[0]!;
    },
  };
}
