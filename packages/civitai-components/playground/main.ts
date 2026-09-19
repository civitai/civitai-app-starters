import { injectStyles } from '../src/index.js';
import type { CivitaiSegmentedControl } from '../src/elements/civitai-segmented-control.js';
import type { CivitaiRadioGroup } from '../src/elements/civitai-radio-group.js';
import type { CivitaiSelect } from '../src/elements/civitai-select.js';
import '../src/elements/register.js';

// The legacy attribute CSS, so the playground can sit elements next to the
// markup they replace.
injectStyles();

const root = document.documentElement;
const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');
let followsSystem = true;

const apply = (dark: boolean): void => {
  root.dataset.theme = dark ? 'dark' : 'light';
};

// Keep following the OS until the toggle is used, so changing the desktop
// theme with the page open still moves it.
prefersDark.addEventListener('change', (event) => {
  if (followsSystem) apply(event.matches);
});

document.querySelector('#theme')?.addEventListener('click', () => {
  followsSystem = false;
  apply(root.dataset.theme !== 'dark');
});

const loadingToggle = document.querySelector('#toggle-loading');
loadingToggle?.addEventListener('click', () => {
  loadingToggle.toggleAttribute('loading');
  setTimeout(() => loadingToggle.toggleAttribute('loading'), 1500);
});

const SEGMENTS = [
  { value: 'grid', label: 'Grid' },
  { value: 'list', label: 'List' },
  { value: 'map', label: 'Map', disabled: true },
  { value: 'feed', label: 'Feed' },
];

for (const id of ['sc-sm', 'sc-md', 'sc-lg', 'sc-form']) {
  const el = document.querySelector<CivitaiSegmentedControl>(`#${id}`);
  if (el) el.data = SEGMENTS;
}

const model = document.querySelector<CivitaiSelect>('#model');
if (model) {
  model.data = [
    { value: 'sdxl', label: 'SDXL' },
    { value: 'flux', label: 'Flux.1 [dev]' },
    { value: 'sd15', label: 'SD 1.5 (retired)', disabled: true },
  ];
}

const SPEEDS = [
  { value: 'fast', label: 'Fast' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'quality', label: 'Quality (unavailable)', disabled: true },
];
for (const id of ['speed', 'speed-h']) {
  const el = document.querySelector<CivitaiRadioGroup>(`#${id}`);
  if (el) el.data = SPEEDS;
}

const scValue = document.querySelector('#sc-value');
document.querySelector('#sc-md')?.addEventListener('change', (event) => {
  if (scValue) scValue.textContent = (event.target as CivitaiSegmentedControl).value;
});

document.querySelector('civitai-alert[closable]')?.addEventListener('close', (event) => {
  (event.target as HTMLElement).remove();
});

const form = document.querySelector<HTMLFormElement>('#demo');
const result = document.querySelector('#result');
form?.addEventListener('submit', (event) => {
  event.preventDefault();
  const data = new FormData(form);
  if (result) result.textContent = `submitted q=${data.get('q')} view=${data.get('view')}`;
});
form?.addEventListener('reset', () => {
  if (result) result.textContent = 'form reset';
});
