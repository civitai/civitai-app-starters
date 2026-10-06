import { describe, expect, it, vi } from 'vitest';

import { toolResult } from '../test-support/fakes.js';
import { adjustPanel } from './adjust.js';
import { checkPanelSpec, normalizeValues, renderRun } from './spec.js';

const LISTED = `# image services (5 results)

## #1: Black Forest Labs FLUX 3 Image · Create Image
  Service: image/fal/flux3/createImage (stepType imageGen)

## #2: Black Forest Labs FLUX 3 Image · Edit Image
  Service: image/fal/flux3/editImage (stepType imageGen)

## #3: Google Nano Banana 2
  Service: image/google/nano-banana-2 (stepType imageGen)

## #4: Krea 2 Turbo · Create Image
  Service: image/comfy/krea2/turbo/createImage (stepType imageGen)

## #5: Broken · Create Image
  Service: image/broken/createImage (stepType imageGen)
`;

const EXAMPLES: Record<string, Record<string, unknown>> = {
  'image/google/nano-banana-2': { engine: 'google', model: 'nano-banana-2' },
  'image/comfy/krea2/turbo/createImage': { engine: 'comfy', ecosystem: 'krea2', model: 'turbo', operation: 'createImage' },
  'image/broken/createImage': { engine: 'broken', operation: 'createImage' },
};
const PRICES: Record<string, number> = { fal: 63, google: 40, comfy: 17 };

function deps() {
  const mcp = {
    callTool: vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (name === 'find_services') return toolResult(undefined, LISTED);
      if (name === 'get_input_schema') return toolResult(undefined, JSON.stringify({ example: EXAMPLES[String(args.service)] }));
      const engine = String((args.input as { engine?: unknown }).engine);
      return engine in PRICES ? toolResult({ cost: { total: PRICES[engine] } }) : toolResult(undefined, 'input invalid', true);
    }),
  };
  return { mcp, resolveArgs: async (args: Record<string, unknown>) => args };
}

const request = { stepType: 'imageGen', input: { engine: 'fal', model: 'flux3', operation: 'createImage', prompt: 'a cozy cabin', aspectRatio: '16:9' } };

describe('adjustPanel', () => {
  it('offers the current model and others of the same kind, cheapest first, priced, without those the service refuses', async () => {
    const built = (await adjustPanel('run_step', request, deps(), 'Your picture'))!;
    expect(checkPanelSpec(built.spec).errors).toBeUndefined();
    const model = built.spec.inputs.model;
    expect(model?.kind === 'choice' && model.options).toEqual([
      'Black Forest Labs FLUX 3 Image (current) · ≈ 63 Buzz',
      'Krea 2 Turbo · ≈ 17 Buzz',
      'Google Nano Banana 2 · ≈ 40 Buzz',
    ]);
    expect(built.values).toEqual({ prompt: 'a cozy cabin', model: 'Black Forest Labs FLUX 3 Image (current) · ≈ 63 Buzz' });
  });

  it("runs the picked model with the edited prompt, keeping the current model's own settings", async () => {
    const built = (await adjustPanel('run_step', request, deps(), 'Your picture'))!;
    const krea = renderRun(built.spec, normalizeValues(built.spec, { prompt: 'a log cabin', model: 'Krea 2 Turbo · ≈ 17 Buzz' }));
    expect(krea.args).toEqual({ stepType: 'imageGen', input: { engine: 'comfy', ecosystem: 'krea2', model: 'turbo', operation: 'createImage', prompt: 'a log cabin' } });
    const same = renderRun(built.spec, normalizeValues(built.spec, { prompt: 'a log cabin' }));
    expect(same.args).toEqual({ stepType: 'imageGen', input: { ...request.input, prompt: 'a log cabin' } });
  });

  it("puts the picture a video starts from wherever each service takes it, and skips services that cannot take one", async () => {
    const listed = [
      ['Wan v2.2-5b · Image to Video', 'video/wan/v2.2-5b/fal/image-to-video'],
      ['Wan v2.2-5b · Text to Video', 'video/wan/v2.2-5b/fal/text-to-video'],
      ['MiniMax H3', 'video/minimax-h3'],
      ['Lightricks LTX-2.5 · Create Video', 'video/ltx2.5/createVideo'],
      ['Mochi', 'video/mochi'],
    ]
      .map(([name, id], i) => `## #${i + 1}: ${name}\n  Service: ${id} (stepType videoGen)`)
      .join('\n\n');
    const schemas: Record<string, { example: Record<string, unknown>; schema: { properties: Record<string, unknown> } }> = {
      'video/minimax-h3': { example: { engine: 'minimax-h3' }, schema: { properties: { lastFrameImage: { format: 'source-image' }, firstFrameImage: { format: 'source-image' } } } },
      'video/ltx2.5/createVideo': { example: { engine: 'ltx2.5', operation: 'createVideo' }, schema: { properties: { images: { type: 'array', items: { format: 'source-image' } } } } },
      'video/mochi': { example: { engine: 'mochi' }, schema: { properties: { prompt: { type: 'string' } } } },
    };
    const prices: Record<string, number> = { wan: 143, 'minimax-h3': 850, 'ltx2.5': 52, mochi: 30 };
    const mcp = {
      callTool: vi.fn(async (name: string, args: Record<string, unknown>) => {
        if (name === 'find_services') return toolResult(undefined, listed);
        if (name === 'get_input_schema') return toolResult(undefined, JSON.stringify(schemas[String(args.service)] ?? { example: { engine: 'wan', operation: 'text-to-video' } }));
        return toolResult({ cost: { total: prices[String((args.input as { engine?: unknown }).engine)] } });
      }),
    };
    const wan = { stepType: 'videoGen', input: { engine: 'wan', version: 'v2.2-5b', provider: 'fal', operation: 'image-to-video', prompt: 'it waddles', images: ['up1-1'] } };

    const built = (await adjustPanel('run_step', wan, { mcp, resolveArgs: async (args) => args }, 'Your video'))!;
    const model = built.spec.inputs.model;
    expect(model?.kind === 'choice' && model.options).toEqual(['Wan v2.2-5b (current) · ≈ 143 Buzz', 'Lightricks LTX-2.5 · ≈ 52 Buzz', 'MiniMax H3 · ≈ 850 Buzz']);
    const h3 = renderRun(built.spec, normalizeValues(built.spec, { prompt: 'it waddles', model: 'MiniMax H3 · ≈ 850 Buzz' }));
    expect(h3.args).toEqual({ stepType: 'videoGen', input: { engine: 'minimax-h3', firstFrameImage: 'up1-1', prompt: 'it waddles' } });
    const ltx = renderRun(built.spec, normalizeValues(built.spec, { prompt: 'it waddles', model: 'Lightricks LTX-2.5 · ≈ 52 Buzz' }));
    expect(ltx.args).toEqual({ stepType: 'videoGen', input: { engine: 'ltx2.5', operation: 'createVideo', images: ['up1-1'], prompt: 'it waddles' } });
  });

  it('leaves anything but one prompted step to the assistant', async () => {
    expect(await adjustPanel('run_workflow', { steps: [] }, deps(), 'x')).toBeNull();
    expect(await adjustPanel('run_step', { stepType: 'imageUpscaler', input: { image: 'gen1-1-1' } }, deps(), 'x')).toBeNull();
  });
});
