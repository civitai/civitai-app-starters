import { describe, expect, it } from 'vitest';

import { workflow } from '../test-support/fakes.js';
import { generationDetails } from './details.js';

describe('generationDetails', () => {
  it('names the Civitai model and LoRAs the orchestrator actually used, with the prompt and settings', () => {
    const made = workflow({
      id: '6-1',
      status: 'succeeded',
      createdAt: '2026-09-24T17:40:50Z',
      completedAt: '2026-09-24T17:41:04Z',
      cost: { total: 13 },
      steps: [
        {
          $type: 'imageGen',
          name: '$0',
          input: {
            engine: 'comfy',
            ecosystem: 'anima',
            operation: 'createImage',
            prompt: 'a cozy cabin',
            negativePrompt: '',
            diffuserModel: 'urn:air:anima:checkpoint:civitai:2458426@2945208',
            vaeModel: 'urn:air:anima:vae:huggingface:circlestone-labs/Anima@main/vae.safetensors',
            loras: { 'urn:air:anima:lora:civitai:5@6': 0.8 },
            steps: 30,
            cfgScale: 4,
            sampler: 'er_sde',
            scheduler: 'simple',
          },
        },
      ],
    } as never);
    expect(generationDetails(made, '$0', undefined, { width: 1024, height: 1024 })).toEqual({
      texts: [{ label: 'Prompt', text: 'a cozy cabin' }],
      service: 'imageGen · comfy · anima · createImage',
      resources: [
        { air: 'urn:air:anima:checkpoint:civitai:2458426@2945208', modelId: 2458426, versionId: 2945208, kind: 'model' },
        { air: 'urn:air:anima:lora:civitai:5@6', modelId: 5, versionId: 6, kind: 'lora', strength: 0.8 },
      ],
      settings: [
        { label: 'Size', value: '1024 × 1024' },
        { label: 'Steps', value: '30' },
        { label: 'Guidance', value: '4' },
        { label: 'Sampler', value: 'er_sde · simple' },
      ],
      cost: 13,
      seconds: 14,
      workflowId: '6-1',
    });
  });

  it('falls back to what the assistant asked for before the workflow is read', () => {
    expect(generationDetails(undefined, undefined, { stepType: 'videoGen', engine: 'ltx2.3', operation: 'createVideo', prompt: 'waves', duration: 5 })).toMatchObject({
      texts: [{ label: 'Prompt', text: 'waves' }],
      service: 'videoGen · ltx2.3 · createVideo',
      settings: [{ label: 'Length', value: '5 s' }],
    });
  });

  it('reads a song step, which has a description and lyrics instead of a prompt and no engine', () => {
    const song = workflow({
      id: '6-2',
      status: 'succeeded',
      steps: [{ $type: 'aceStepAudio', name: '$0', input: { musicDescription: 'gentle acoustic guitar', lyrics: '[Instrumental]', seed: 0, duration: 30, bpm: 72, key: 'G major', steps: 8, cfg: 1 } }],
    } as never);
    expect(generationDetails(song, '$0', undefined)).toMatchObject({
      texts: [
        { label: 'Description', text: 'gentle acoustic guitar' },
        { label: 'Lyrics', text: '[Instrumental]' },
      ],
      service: 'aceStepAudio',
      settings: [
        { label: 'Steps', value: '8' },
        { label: 'Guidance', value: '1' },
        { label: 'Seed', value: '0' },
        { label: 'Length', value: '30 s' },
        { label: 'Tempo', value: '72 BPM' },
        { label: 'Key', value: 'G major' },
      ],
    });
  });
});
