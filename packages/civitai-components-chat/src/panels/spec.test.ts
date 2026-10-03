import { describe, expect, it } from 'vitest';

import { checkPanelSpec, mergeSpec, missingRequired, normalizeValues, renderRun, sizeFor, withSeeds, type PanelSpec } from './spec.js';

const LOGO = {
  title: 'Logo maker',
  inputs: {
    brand: { kind: 'text', label: 'Brand name', required: true },
    style: { kind: 'choice', options: ['Minimal mark', 'Mascot'], map: { 'Minimal mark': 'minimal geometric mark', Mascot: 'friendly mascot character' } },
    shape: { kind: 'aspect', options: ['1:1', '16:9'] },
    count: { kind: 'count', max: 4, default: 2 },
    reference: { kind: 'image' },
    seed: { kind: 'seed' },
  },
  layout: [['brand'], ['style', 'shape']],
  run: {
    stepType: 'imageGen',
    input: {
      engine: 'flux2',
      prompt: 'logo for "{{brand}}", {{style}}, flat vector',
      width: '{{shape.width}}',
      height: '{{shape.height}}',
      quantity: '{{count}}',
      images: ['{{reference}}'],
      seed: '{{seed}}',
    },
  },
};

const spec = (raw: unknown = LOGO): PanelSpec => {
  const checked = checkPanelSpec(raw);
  if (!checked.spec) throw new Error(checked.errors.join(' '));
  return checked.spec;
};

describe('panel definitions', () => {
  it('fills the run from the values: mapped choices, typed numbers, sizes from the ratio, empty optional inputs left out', () => {
    const logo = spec();
    const values = normalizeValues(logo, { brand: 'Night Owl Coffee', style: 'Mascot', shape: '16:9', seed: 42 });

    expect(renderRun(logo, values)).toEqual({
      tool: 'run_step',
      args: {
        stepType: 'imageGen',
        input: { engine: 'flux2', prompt: 'logo for "Night Owl Coffee", friendly mascot character, flat vector', width: 1344, height: 768, quantity: 2, seed: 42 },
      },
    });
    expect(renderRun(logo, { ...values, reference: 'up1-1' }).args.input).toMatchObject({ images: ['up1-1'] });
  });

  it('tells the assistant what to fix: unknown placeholders, unused inputs, bad controls, a run that is not run_step or run_workflow', () => {
    const checked = checkPanelSpec({
      title: 'Broken',
      inputs: { mood: { kind: 'choice', options: ['Calm'] }, extra: { kind: 'toggle' }, tone: { kind: 'text' } },
      run: { stepType: 'aceStepAudio', input: { prompt: '{{tone}} {{tempo}}', width: '{{tone.width}}' } },
    });
    expect(checked.errors).toEqual([
      'inputs.mood: a choice needs 2 to 12 distinct options.',
      'run uses {{tempo}}, but there is no input called tempo.',
      '{{tone.width}} only works on an aspect input.',
      'Inputs extra are not used in run; put {{name}} where each value belongs, or remove them.',
    ]);
    expect(checkPanelSpec({ ...LOGO, run: { prompt: 'x' } }).errors).toContain(
      'run must be run_step arguments ({"stepType": ..., "input": {...}}) or run_workflow arguments ({"steps": [...]}).',
    );
  });

  it('keeps given values that fit, pulls numbers into range, and falls back to defaults otherwise', () => {
    const logo = spec();
    expect(normalizeValues(logo, { style: 'Watercolor', count: 9, shape: '16:9' })).toMatchObject({ style: 'Minimal mark', count: 4, shape: '16:9', seed: -1, reference: '' });
    expect(normalizeValues(logo, { count: 'many' }).count).toBe(2);
    expect(missingRequired(logo, normalizeValues(logo))).toEqual(['Brand name']);
  });

  it('gives a seed left at -1 a fresh value per run and keeps a fixed one', () => {
    const logo = spec();
    expect(withSeeds(logo, normalizeValues(logo), () => 0.5).seed).toBe(1_073_741_823);
    expect(withSeeds(logo, normalizeValues(logo, { seed: 7 }), () => 0.5).seed).toBe(7);
  });

  it('sizes ratios at about the base area in multiples of 64', () => {
    expect(sizeFor('1:1')).toEqual({ width: 1024, height: 1024 });
    expect(sizeFor('2:3', 768)).toEqual({ width: 640, height: 960 });
  });

  it('merges a change by input name, removing inputs set to null and their layout slots', () => {
    const logo = spec();
    const merged = checkPanelSpec(
      mergeSpec(logo, {
        inputs: { reference: null, palette: { kind: 'choice', options: ['Warm', 'Cool'] } },
        run: { ...logo.run, input: { ...(logo.run.input as object), images: undefined, prompt: 'logo for "{{brand}}", {{style}}, {{palette}} colors' } },
        layout: [['brand'], ['style', 'palette']],
      }),
    );
    expect(merged.errors).toBeUndefined();
    expect(Object.keys(merged.spec!.inputs)).toEqual(['brand', 'style', 'shape', 'count', 'seed', 'palette']);
  });
});
