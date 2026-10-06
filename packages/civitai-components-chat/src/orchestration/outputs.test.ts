import { describe, expect, it } from 'vitest';

import { imageStep, workflow } from '../test-support/fakes.js';
import { failureOf, progressOf, readOutputs } from './outputs.js';

describe('readOutputs', () => {
  it('finds every media blob by shape, in step order, with the path to re-read it', () => {
    const media = readOutputs(
      workflow({
        id: '1-1',
        steps: [
          imageStep([{ id: 'a', url: 'https://x/a', width: 1024, height: 768 }, { id: 'b', available: false }]),
          { $type: 'videoGen', name: 'v', status: 'succeeded', output: { video: { id: 'c', available: true, url: 'https://x/c', width: 1280, height: 720, duration: 5 } } },
          { $type: 'aceStepAudio', name: 'm', status: 'succeeded', output: { blob: { type: 'audio', id: 'd', available: true, url: 'https://x/d', duration: 30 } } },
          { $type: 'polyGen', name: 'p', status: 'succeeded', output: { blob: { type: 'model3d', id: 'e', available: true, url: 'https://x/e' } } },
          { $type: 'chatCompletion', name: 'c', status: 'succeeded', output: { choices: [{ message: { content: 'hi' } }] } },
        ] as never,
      }),
    );
    expect(media.map((m) => [m.blobId, m.kind, m.path, m.available])).toEqual([
      ['a', 'image', 'output.images[0]', true],
      ['b', 'image', 'output.images[1]', false],
      ['c', 'video', 'output.video', true],
      ['d', 'audio', 'output.blob', true],
    ]);
    expect(media[0]).toMatchObject({ width: 1024, height: 768, url: 'https://x/a', blocked: false });
    expect(media[2]?.durationSec).toBe(5);
  });

  it('marks an available blob whose url was withheld as blocked', () => {
    const [media] = readOutputs(workflow({ id: '1-1', steps: [imageStep([{ id: 'a' }])] as never }));
    expect(media?.blocked).toBe(true);
  });
});

describe('progressOf', () => {
  it('reports the slowest step and the longest queue', () => {
    const wf = workflow({
      id: '1-1',
      steps: [
        { $type: 'imageGen', name: 'a', status: 'processing', estimatedProgressRate: 0.8 },
        { $type: 'imageGen', name: 'b', status: 'processing', estimatedProgressRate: 0.3, queuePosition: { precedingJobs: 4 } },
      ] as never,
    });
    expect(progressOf(wf)).toEqual({ progress: 0.3, queued: 4, preparing: null });
  });

  it('reports a model still downloading, by size across every download, with the longest time left', () => {
    const wf = workflow({
      id: '1-1',
      steps: [
        {
          $type: 'imageGen',
          name: 'a',
          status: 'preparing',
          estimatedProgressRate: 0.99,
          preparation: [
            { resource: 'urn:air:sdxl:checkpoint:civitai:139565@294470', sizeBytes: 6_000_000_000, progress: 0.5, etaSeconds: 300 },
            { resource: 'urn:air:sdxl:lora:civitai:1@2', sizeBytes: 2_000_000_000, progress: 1, etaSeconds: 0 },
            { resource: 'urn:air:sdxl:lora:civitai:3@4', sizeBytes: 2_000_000_000, progress: 0.25, etaSeconds: 400 },
          ],
        },
      ] as never,
    });
    expect(progressOf(wf).preparing).toEqual({ progress: 0.4375, etaSeconds: 400, bytes: 8_000_000_000 });
  });
});

describe('failureOf', () => {
  it('reads the error the orchestrator attached to a failed step', () => {
    const wf = workflow({ id: '1-1', status: 'failed', steps: [{ $type: 'imageGen', name: 'a', status: 'failed', metadata: { error: 'Prompt blocked' } }] as never });
    expect(failureOf(wf)).toBe('Prompt blocked');
  });
});
