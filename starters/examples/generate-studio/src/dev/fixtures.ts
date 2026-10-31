/**
 * DEV-ONLY fixtures for the mock host (src/Harness.tsx) and the dev server's
 * generation-resources stand-in (vite.config.ts). Never imported by the app.
 *
 * Images are inline SVG data URIs, so the harness renders with no network and
 * no failed loads. The ids are PLACEHOLDERS, not real Civitai resources.
 */
import type { AppWorkflow, BlockGatedImage, BlockResourceInfo } from '@civitai/app-sdk/blocks';

export function mockImage(label: string, hue: number): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="hsl(${hue},70%,55%)"/><stop offset="1" stop-color="hsl(${(hue + 60) % 360},70%,30%)"/>` +
    `</linearGradient></defs><rect width="512" height="512" fill="url(#g)"/>` +
    `<text x="256" y="268" font-family="sans-serif" font-size="44" fill="#fff" text-anchor="middle">${label}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** What the mock checkpoint picker returns. */
export const CHECKPOINT_PICK: BlockResourceInfo = {
  versionId: 900001,
  modelId: 800001,
  modelName: 'Mock Illustrious',
  versionName: 'v2',
  baseModel: 'Illustrious',
  modelType: 'Checkpoint',
};

/** What the mock LoRA picker returns — in the checkpoint's family, with recommended settings. */
export const LORA_PICK: BlockResourceInfo = {
  versionId: 900101,
  modelId: 800101,
  modelName: 'Mock Watercolor Style',
  versionName: 'v1',
  baseModel: 'Illustrious',
  modelType: 'LORA',
  strength: 0.8,
  minStrength: 0,
  maxStrength: 1.5,
  trainedWords: ['wtrcolor'],
  clipSkip: null,
};

/** A second LoRA only reachable through a setup code (the mock picker has one canned pick per type). */
export const LORA_CODE_ONLY: BlockResourceInfo = {
  versionId: 900102,
  modelId: 800102,
  modelName: 'Mock Ink Lines',
  versionName: 'v3',
  baseModel: 'Illustrious',
  modelType: 'LORA',
  strength: 1,
  minStrength: -1,
  maxStrength: 2,
  trainedWords: [],
  clipSkip: null,
};

/** Everything the dev generation-resources endpoint can rehydrate, by version id. */
export const REHYDRATABLE: BlockResourceInfo[] = [CHECKPOINT_PICK, LORA_PICK, LORA_CODE_ONLY];

export const SOURCE_UPLOAD = { url: mockImage('source', 30), width: 1024, height: 1024 };

/**
 * The app's queue as the mock reports it. One rated PG output, one rated R
 * output (hidden or blurred depending on the viewer), one not rated yet, and a
 * run still going. 🔴 STATIC: the mock does not add your own submits to it.
 */
export const APP_WORKFLOWS: AppWorkflow[] = [
  {
    workflowId: 'wf_mock_live',
    status: 'processing',
    images: [],
    cost: null,
    createdAt: '2026-10-06T12:05:00.000Z',
  },
  {
    workflowId: 'wf_mock_done',
    status: 'succeeded',
    images: [
      { url: mockImage('PG', 200), width: 1024, height: 1024, nsfwLevel: 1 },
      { url: mockImage('R', 340), width: 1024, height: 1024, nsfwLevel: 4 },
      { url: mockImage('unrated', 120), width: 1024, height: 1024, nsfwLevel: null },
    ],
    cost: 24,
    createdAt: '2026-10-06T12:00:00.000Z',
  },
];

/** The gated read of what "Publish" returns: one rated, one withheld, one not rated yet. */
export const PUBLISHED_IDS = [910001, 910002, 910003];
export const GATED_IMAGES: BlockGatedImage[] = [
  { imageId: 910001, status: 'visible', nsfwLevel: 1, contentRating: 'pg', url: mockImage('published', 200), width: 1024, height: 1024 },
  { imageId: 910002, status: 'hidden' },
  { imageId: 910003, status: 'visible', ratingPending: true, url: mockImage('pending', 120), width: 1024, height: 1024 },
];
