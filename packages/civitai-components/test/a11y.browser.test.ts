/**
 * Run axe against the host, never a `ShadowRoot` — it needs a document-attached
 * node, and pierces open shadow roots itself. `color-contrast` is off for the
 * same reason as the React harness: it would flag the upstream Mantine palette.
 */
import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';

import { injectStyles } from '../src/index.js';
import type { CivitaiSegmentedControl } from '../src/elements/civitai-segmented-control.js';
import '../src/elements/register.js';

const AXE_OPTIONS: axe.RunOptions = {
  rules: { 'color-contrast': { enabled: false } },
  resultTypes: ['violations'],
};

const CASES: { id: string; markup: string; prepare?: (scope: HTMLElement) => void }[] = [
  { id: 'button', markup: '<civitai-button>Generate</civitai-button>' },
  { id: 'button/loading', markup: '<civitai-button loading>Generating</civitai-button>' },
  { id: 'button/disabled', markup: '<civitai-button disabled>Generate</civitai-button>' },
  {
    id: 'button/icon-only',
    markup: '<civitai-button aria-label="Close"><span aria-hidden="true">&times;</span></civitai-button>',
  },
  { id: 'text-input', markup: '<civitai-text-input label="Prompt"></civitai-text-input>' },
  {
    id: 'text-input/described',
    markup:
      '<civitai-text-input label="Prompt" description="What to draw" required></civitai-text-input>',
  },
  {
    id: 'text-input/invalid',
    markup: '<civitai-text-input label="Steps" value="999" error="Max is 150"></civitai-text-input>',
  },
  {
    id: 'segmented-control',
    markup: '<civitai-segmented-control aria-label="View"></civitai-segmented-control>',
    prepare: (scope) => {
      scope.querySelector<CivitaiSegmentedControl>('civitai-segmented-control')!.data = [
        { value: 'grid', label: 'Grid' },
        { value: 'list', label: 'List', disabled: true },
      ];
    },
  },
  { id: 'checkbox', markup: '<civitai-checkbox label="Enable upscaling"></civitai-checkbox>' },
  {
    id: 'checkbox/invalid',
    markup: '<civitai-checkbox label="Accept terms" required error="Required"></civitai-checkbox>',
  },
  { id: 'textarea', markup: '<civitai-textarea label="Prompt"></civitai-textarea>' },
  {
    id: 'number-input',
    markup: '<civitai-number-input label="Steps" min="1" max="150"></civitai-number-input>',
  },
  {
    id: 'select',
    markup: '<civitai-select label="Model" placeholder="Pick one"></civitai-select>',
    prepare: (scope) => {
      (scope.querySelector('civitai-select') as HTMLElement & { data: unknown }).data = [
        { value: 'sdxl', label: 'SDXL' },
      ];
    },
  },
  {
    id: 'radio-group',
    markup: '<civitai-radio-group label="Speed" description="Quality costs time"></civitai-radio-group>',
    prepare: (scope) => {
      (scope.querySelector('civitai-radio-group') as HTMLElement & { data: unknown }).data = [
        { value: 'fast', label: 'Fast' },
        { value: 'slow', label: 'Slow', disabled: true },
      ];
    },
  },
  { id: 'collapse', markup: '<civitai-collapse heading="Advanced">body</civitai-collapse>' },
  { id: 'collapse/open', markup: '<civitai-collapse heading="Advanced" open>body</civitai-collapse>' },
  { id: 'slider', markup: '<civitai-slider label="CFG" min="1" max="20" value="7"></civitai-slider>' },
  {
    id: 'image',
    markup:
      '<civitai-image alt="A generated landscape" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"></civitai-image>',
  },
  {
    id: 'tooltip',
    markup: '<civitai-tooltip label="Spends Buzz"><button>Generate</button></civitai-tooltip>',
  },
  {
    id: 'tabs',
    markup:
      '<civitai-tabs aria-label="View">' +
      '<civitai-tab-panel value="grid">Grid</civitai-tab-panel>' +
      '<civitai-tab-panel value="list">List</civitai-tab-panel>' +
      '</civitai-tabs>',
    prepare: (scope) => {
      (scope.querySelector('civitai-tabs') as HTMLElement & { data: unknown }).data = [
        { value: 'grid', label: 'Grid' },
        { value: 'list', label: 'List', disabled: true },
      ];
    },
  },
  {
    id: 'modal',
    markup: '<civitai-modal heading="Confirm" open>Costs Buzz.</civitai-modal>',
  },
  {
    id: 'form',
    markup:
      '<form><civitai-text-input label="Query" name="q"></civitai-text-input>' +
      '<civitai-button type="submit">Search</civitai-button></form>',
  },
];

let scope: HTMLElement | undefined;

afterEach(() => {
  scope?.remove();
  scope = undefined;
});

for (const theme of ['light', 'dark'] as const) {
  describe(`axe a11y — elements, [data-theme='${theme}']`, () => {
    for (const testCase of CASES) {
      it(`${testCase.id} has zero violations`, async () => {
        injectStyles();
        scope = document.createElement('div');
        scope.setAttribute('data-theme', theme);
        scope.innerHTML = testCase.markup;
        document.body.append(scope);
        testCase.prepare?.(scope);

        await Promise.all(
          [...scope.querySelectorAll('*')]
            .filter((el): el is HTMLElement & { updateComplete: Promise<boolean> } =>
              'updateComplete' in el
            )
            .map((el) => el.updateComplete)
        );

        const results = await axe.run(scope, AXE_OPTIONS);
        const summary = results.violations
          .map((v) => `  [${v.id}] ${v.help}\n${v.nodes.map((n) => `    ${n.html}\n    ${n.failureSummary}`).join('\n')}`)
          .join('\n');
        expect(results.violations, `${testCase.id}:\n${summary}`).toHaveLength(0);
      });
    }
  });
}
