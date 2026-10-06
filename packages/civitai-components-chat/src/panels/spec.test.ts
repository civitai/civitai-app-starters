import { describe, expect, it } from 'vitest';

import { checkPanelSpec, mergeSpec, renderAsk, missingRequired, normalizeValues, renderRun, sizeFor, withSeeds, type PanelSpec } from './spec.js';

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

  it('tells the assistant what to fix: unknown placeholders, unused inputs, bad controls, a run that is not run_step, run_workflow or an ask', () => {
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
      'run must be run_step arguments ({"stepType": ..., "input": {...}}), run_workflow arguments ({"steps": [...]}), or {"ask": "a message to you with {{name}} placeholders"}.',
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

  it('takes a panel whose button asks the assistant, with the values and picked files in the message', () => {
    const post = spec({
      title: 'Post it',
      inputs: { picture: { kind: 'image', required: true }, title: { kind: 'text', label: 'Title' }, detail: { kind: 'text', label: 'Description', multiline: true } },
      run: { ask: 'Post {{picture}} to Civitai titled "{{title}}". Description: {{detail}}' },
      button: 'Post',
    });
    expect(post.button).toBe('Post');
    expect(renderAsk(post, normalizeValues(post, { picture: 'gen1-1-1', title: 'Cozy cabin', detail: 'Snowy night.' }))).toEqual({
      message: 'Post gen1-1-1 to Civitai titled "Cozy cabin". Description: Snowy night.',
      refs: ['gen1-1-1'],
    });
    expect(checkPanelSpec({ title: 'Ask', inputs: { a: { kind: 'text' } }, run: { ask: 'do {{b}}' } }).errors).toContain('run uses {{b}}, but there is no input called b.');
  });

  it('lets a choice stand for a whole block of inputs, filling the placeholders inside it', () => {
    const picker = spec({
      title: 'Picker',
      inputs: { prompt: { kind: 'text' }, model: { kind: 'choice', options: ['A', 'B'], map: { A: { model: 'a', prompt: '{{prompt}}' }, B: { model: 'b', text: 'make {{prompt}}' } } } },
      run: { stepType: 'imageGen', input: '{{model}}' },
    });
    expect(renderRun(picker, normalizeValues(picker, { prompt: 'a fox', model: 'B' })).args).toEqual({ stepType: 'imageGen', input: { model: 'b', text: 'make a fox' } });
    expect(checkPanelSpec({ title: 'x', inputs: { model: { kind: 'choice', options: ['A', 'B'], map: { A: { p: '{{missing}}' } } } }, run: { stepType: 's', input: '{{model}}' } }).errors).toContain(
      'run uses {{missing}}, but there is no input called missing.',
    );
  });

  it('says where a new control goes when a block choice is the input, instead of letting the service refuse an object in a field', () => {
    const inputs = {
      prompt: { kind: 'text' },
      model: { kind: 'choice', options: ['A', 'B'], map: { A: { engine: 'a', prompt: '{{prompt}}' }, B: { engine: 'b', prompt: '{{prompt}}' } } },
      duration: { kind: 'slider', min: 1, max: 10, default: 5 },
    };
    const inField = checkPanelSpec({ title: 'x', inputs, run: { stepType: 'videoGen', input: { engine: '{{model}}', prompt: '{{prompt}}', duration: '{{duration}}' } } });
    expect(inField.errors?.some((error) => error.startsWith('{{model}} stands for a whole input') && error.includes("inside each of model's option blocks"))).toBe(true);

    const leftOut = checkPanelSpec({ title: 'x', inputs, run: { stepType: 'videoGen', input: '{{model}}' } });
    expect(leftOut.errors).toEqual(["Inputs duration are not used in run. The input is {{model}}, so put {{duration}} inside each of model's option blocks."]);

    const inBlocks = checkPanelSpec({
      title: 'x',
      inputs: { ...inputs, model: { ...inputs.model, map: { A: { engine: 'a', prompt: '{{prompt}}', duration: '{{duration}}' }, B: { engine: 'b', prompt: '{{prompt}}', duration: '{{duration}}' } } } },
      run: { stepType: 'videoGen', input: '{{model}}' },
    });
    expect(inBlocks.errors).toBeUndefined();
  });
});
