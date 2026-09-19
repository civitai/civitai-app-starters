/**
 * Every ported element against the attribute markup it replaces, in both
 * themes. `display` is compared on the HOST, which is what stands where the
 * legacy element stood; an inner node blockifies as a flex item of it.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { componentsCss } from '../src/styles.generated.js';
import '../src/elements/register.js';

// `display` is absent on purpose: it is asserted on the host below, and an
// element whose chrome sits on an inner node moves it there deliberately.
const BOX = [
  'backgroundColor', 'color', 'borderTopColor', 'borderTopWidth', 'borderTopStyle',
  'borderRadius', 'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight',
  'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'textTransform',
  'gap', 'alignItems', 'flexDirection', 'flexWrap', 'whiteSpace', 'height', 'resize',
] as const;

interface Case {
  id: string;
  element: string;
  legacy: string;
  /** Compared on the host unless the legacy chrome lives on an inner node. */
  compare?: (host: HTMLElement) => HTMLElement;
  legacyTarget?: (legacy: HTMLElement) => HTMLElement;
}

const CASES: Case[] = [
  { id: 'card', element: '<civitai-card padding="md">x</civitai-card>',
    legacy: `<div data-civitai-ui="card" data-padding="md">x</div>` },
  { id: 'card/with-border', element: '<civitai-card with-border padding="lg">x</civitai-card>',
    legacy: `<div data-civitai-ui="card" data-with-border="true" data-padding="lg">x</div>` },
  { id: 'stack', element: '<civitai-stack><i>a</i></civitai-stack>',
    legacy: `<div data-civitai-ui="stack"><i>a</i></div>` },
  { id: 'stack/gap-lg', element: '<civitai-stack gap="lg"><i>a</i></civitai-stack>',
    legacy: `<div data-civitai-ui="stack" data-gap="lg"><i>a</i></div>` },
  { id: 'group', element: '<civitai-group><i>a</i></civitai-group>',
    legacy: `<div data-civitai-ui="group"><i>a</i></div>` },
  { id: 'group/nowrap', element: '<civitai-group nowrap gap="sm"><i>a</i></civitai-group>',
    legacy: `<div data-civitai-ui="group" data-nowrap="true" data-gap="sm"><i>a</i></div>` },
  { id: 'loader', element: '<civitai-loader></civitai-loader>',
    legacy: `<span data-civitai-ui="loader"></span>`,
    compare: (host) => host.shadowRoot!.querySelector('.spinner')! },
  { id: 'loader/sm', element: '<civitai-loader size="sm"></civitai-loader>',
    legacy: `<span data-civitai-ui="loader" data-size="sm"></span>`,
    compare: (host) => host.shadowRoot!.querySelector('.spinner')! },
  { id: 'alert', element: '<civitai-alert>msg</civitai-alert>',
    legacy: `<div data-civitai-ui="alert">msg</div>` },
  { id: 'alert/error', element: '<civitai-alert color="error">msg</civitai-alert>',
    legacy: `<div data-civitai-ui="alert" data-color="error">msg</div>` },
  { id: 'alert/warning', element: '<civitai-alert color="warning">msg</civitai-alert>',
    legacy: `<div data-civitai-ui="alert" data-color="warning">msg</div>` },
];

const PIXEL =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

CASES.push(
  { id: 'image', element: `<civitai-image src="${PIXEL}" alt="p"></civitai-image>`,
    legacy: `<div data-civitai-ui="image"><img data-civitai-ui-image-img src="${PIXEL}" alt="p" /></div>` },
  { id: 'slider', element: '<civitai-slider value="50"></civitai-slider>',
    legacy: `<div data-civitai-ui="slider"><input type="range" value="50" /></div>`,
    compare: (host) => host.shadowRoot!.querySelector('input')!,
    legacyTarget: (legacy) => legacy.querySelector('input')! }
);

const FIELD_CHROME = `<label data-civitai-ui-label for="lg">L</label>` +
  `<span data-civitai-ui-description>D</span>`;

CASES.push(
  { id: 'textarea', element: '<civitai-textarea label="L" description="D"></civitai-textarea>',
    legacy: `<div data-civitai-ui="textarea">${FIELD_CHROME}<textarea id="lg" data-civitai-ui-control></textarea></div>`,
    compare: (host) => host.shadowRoot!.querySelector('textarea')!,
    legacyTarget: (legacy) => legacy.querySelector('textarea')! },
  { id: 'number-input', element: '<civitai-number-input label="L" description="D"></civitai-number-input>',
    legacy: `<div data-civitai-ui="number-input">${FIELD_CHROME}<input id="lg" type="number" data-civitai-ui-control /></div>`,
    compare: (host) => host.shadowRoot!.querySelector('input')!,
    legacyTarget: (legacy) => legacy.querySelector('input')! },
  { id: 'select', element: '<civitai-select label="L" description="D"></civitai-select>',
    legacy: `<div data-civitai-ui="select">${FIELD_CHROME}<select id="lg" data-civitai-ui-control></select></div>`,
    compare: (host) => host.shadowRoot!.querySelector('select')!,
    legacyTarget: (legacy) => legacy.querySelector('select')! }
);

for (const variant of ['filled', 'light', 'outline'] as const) {
  for (const color of ['', 'info', 'success', 'warning', 'error'] as const) {
    CASES.push({
      id: `badge/${variant}${color ? `/${color}` : ''}`,
      element: `<civitai-badge variant="${variant}"${color ? ` color="${color}"` : ''}>b</civitai-badge>`,
      legacy: `<span data-civitai-ui="badge" data-variant="${variant}"${color ? ` data-color="${color}"` : ''}>b</span>`,
    });
  }
}
for (const size of ['sm', 'md', 'lg'] as const) {
  CASES.push({
    id: `badge/size-${size}`,
    element: `<civitai-badge size="${size}">b</civitai-badge>`,
    legacy: `<span data-civitai-ui="badge" data-size="${size}">b</span>`,
  });
}

let style: HTMLStyleElement | undefined;
let scope: HTMLElement | undefined;

afterEach(() => {
  scope?.remove();
  style?.remove();
  scope = undefined;
  style = undefined;
});

const cases = (['light', 'dark'] as const).flatMap((theme) =>
  CASES.map((testCase) => [theme, testCase.id, testCase] as const)
);

describe('element vs legacy markup', () => {
  it.each(cases)('%s / %s', async (theme, _id, testCase) => {
    style = document.createElement('style');
    style.textContent = componentsCss;
    document.head.append(style);

    scope = document.createElement('div');
    scope.setAttribute('data-theme', theme);
    scope.innerHTML = testCase.element + testCase.legacy;
    document.body.append(scope);

    const [host, legacy] = [...scope.children] as [HTMLElement, HTMLElement];
    await (host as HTMLElement & { updateComplete: Promise<boolean> }).updateComplete;

    // The host always carries the outer box, whatever the chrome sits on.
    expect(getComputedStyle(host).display, 'host display').toBe(getComputedStyle(legacy).display);

    const a = getComputedStyle(testCase.compare?.(host) ?? host);
    const b = getComputedStyle(testCase.legacyTarget?.(legacy) ?? legacy);
    for (const property of BOX) {
      expect(a[property], property).toBe(b[property]);
    }

    const hostBox = host.getBoundingClientRect();
    const legacyBox = legacy.getBoundingClientRect();
    expect(hostBox.width, 'width').toBeCloseTo(legacyBox.width, 1);
    expect(hostBox.height, 'height').toBeCloseTo(legacyBox.height, 1);
  });
});
