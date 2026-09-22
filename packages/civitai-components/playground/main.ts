import { injectStyles } from '../src/index.js';
import type { CivitaiSegmentedControl } from '../src/elements/civitai-segmented-control.js';
import type { CivitaiModal } from '../src/elements/civitai-modal.js';
import type { CivitaiRadioGroup } from '../src/elements/civitai-radio-group.js';
import type { CivitaiSelect } from '../src/elements/civitai-select.js';
import type { CivitaiTabs } from '../src/elements/civitai-tabs.js';
import type { CivitaiToastRegion } from '../src/elements/civitai-toast-region.js';
import '../src/elements/register-site.js';

// The legacy attribute CSS, so the playground can sit elements next to the
// markup they replace.
injectStyles();

const root = document.documentElement;
const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');

// No `data-theme` until the toggle is used, so the page loads the way any app
// that never sets one does: following the OS, via @civitai/theme alone.
const showingDark = (): boolean =>
  root.dataset.theme ? root.dataset.theme === 'dark' : prefersDark.matches;

document.querySelector('#theme')?.addEventListener('click', () => {
  root.dataset.theme = showingDark() ? 'light' : 'dark';
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

// An inline SVG, so the playground needs no asset server.
const SAMPLE =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
       <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
         <stop offset="0" stop-color="#228be6"/><stop offset="1" stop-color="#326D5C"/>
       </linearGradient></defs>
       <rect width="100" height="100" fill="url(#g)"/>
     </svg>`
  );
document.querySelector('#ok')?.setAttribute('src', SAMPLE);

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

const tabsEl = document.querySelector<CivitaiTabs>('#tabs');
if (tabsEl) {
  tabsEl.data = [
    { value: 'grid', label: 'Grid' },
    { value: 'list', label: 'List' },
    { value: 'map', label: 'Map (unavailable)', disabled: true },
    { value: 'feed', label: 'Feed' },
  ];
}

const modal = document.querySelector<CivitaiModal>('#modal');
const sticky = document.querySelector<CivitaiModal>('#sticky');
if (sticky) {
  sticky.closeOnEscape = false;
  sticky.closeOnOverlayClick = false;
}
document.querySelector('#open-modal')?.addEventListener('click', () => {
  if (modal) modal.open = true;
});
document.querySelector('#open-sticky')?.addEventListener('click', () => {
  if (sticky) sticky.open = true;
});
for (const id of ['#modal-ok', '#modal-cancel']) {
  document.querySelector(id)?.addEventListener('click', () => {
    if (modal) modal.open = false;
  });
}

const toasts = document.querySelector<CivitaiToastRegion>('#toasts');
document.querySelector('#toast-info')?.addEventListener('click', () => {
  toasts?.show({ message: 'Queued for generation.', color: 'info' });
});
document.querySelector('#toast-success')?.addEventListener('click', () => {
  toasts?.show({ heading: 'Saved', message: 'Your changes are live.', color: 'success' });
});
document.querySelector('#toast-error')?.addEventListener('click', () => {
  toasts?.show({
    heading: 'Generation failed',
    message: 'Not enough Buzz.',
    color: 'error',
    duration: 0,
    urgent: true,
  });
});
document.querySelector('#toast-clear')?.addEventListener('click', () => toasts?.clear());

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

const tagLog = document.querySelector('#tag-log');
document.querySelector('#tags')?.addEventListener('vote', (event) => {
  const { name, vote } = (event as CustomEvent<{ name: string; vote: number }>).detail;
  const said = vote === 1 ? 'upvoted' : vote === -1 ? 'downvoted' : 'cleared';
  if (tagLog) tagLog.textContent = `${said} ${name}`;
});

const menuLog = document.querySelector('#menu-log');
document.querySelector('#actions')?.addEventListener('select', (event) => {
  const { value } = (event as CustomEvent<{ value: string }>).detail;
  if (menuLog) menuLog.textContent = `chose "${value}"`;
});

const cardLog = document.querySelector('#card-log');
document.querySelector('#cards')?.addEventListener('react', (event) => {
  const { emoji, reacted, count } = (
    event as CustomEvent<{ emoji: string; reacted: boolean; count: number }>
  ).detail;
  if (cardLog) cardLog.textContent = `${reacted ? 'reacted' : 'un-reacted'} ${emoji} \u2192 ${count}`;
});

// ─ Workflow button ─ a fake orchestrator, so the playground spends nothing.
import '../src/sdk/civitai-workflow-button.define.js';
import '../src/sdk/civitai-sign-in-button.define.js';
import type { CivitaiWorkflowButton } from '../src/sdk/civitai-workflow-button.js';
import type { CivitaiSignInButton } from '../src/sdk/civitai-sign-in-button.js';

const wfLog = document.getElementById('wf-log') as HTMLElement;

function fakeApp(opts: { cost: number; reportsProgress: boolean; steps?: number }) {
  let canceled = false;
  return {
    requestGrants: async () => true,
    getToken: async () => 'playground',
    orchestration: {
      estimateWorkflow: async () => {
        await new Promise((r) => setTimeout(r, 500));
        return { cost: { total: opts.cost } };
      },
      submitWorkflow: async () => {
        canceled = false;
        return { id: `wf_${Date.now()}` };
      },
      cancelWorkflow: async () => {
        canceled = true;
      },
      async *watchWorkflow() {
        const statuses = ['unassigned', 'preparing', 'scheduled'];
        for (const status of statuses) {
          await new Promise((r) => setTimeout(r, 900));
          if (canceled) return yield { status: 'canceled', steps: [] };
          yield { status, steps: [] };
        }
        // Each step runs in turn, the way a mesh then a rig does.
        const total = opts.steps ?? 1;
        for (let step = 0; step < total; step++) {
          for (let rate = 0.05; rate <= 1; rate += 0.05) {
            await new Promise((r) => setTimeout(r, 400));
            if (canceled) return yield { status: 'canceled', steps: [] };
            yield {
              status: 'processing',
              steps: Array.from({ length: total }, (_, i) => ({
                status: i < step ? 'succeeded' : i === step ? 'processing' : 'unassigned',
                estimatedProgressRate: i === step && opts.reportsProgress ? rate : null,
              })),
            };
          }
        }
        yield { status: 'succeeded', steps: [] };
      },
    },
  } as never;
}

for (const [id, app] of [
  ['wf-fast', fakeApp({ cost: 185, reportsProgress: true, steps: 2 })],
  ['wf-blind', fakeApp({ cost: 44, reportsProgress: false })],
] as const) {
  const button = document.getElementById(id) as CivitaiWorkflowButton;
  button.app = app;
  button.template = { steps: [{ $type: 'echo', input: {} }] } as never;
  for (const event of ['priced', 'submitted', 'progress', 'finished', 'canceled', 'error']) {
    button.addEventListener(event, (e) => {
      const detail = (e as CustomEvent).detail as Record<string, unknown> | undefined;
      const status = detail?.status ? ` ${String(detail.status)}` : '';
      wfLog.textContent = `${id}: ${event}${status}`;
    });
  }
}

(document.getElementById('sign-in') as CivitaiSignInButton).signIn = {
  signedIn: false,
  signIn: async () => {
    wfLog.textContent = 'sign-in: would leave for auth.civitai.com';
    return new Promise<never>(() => {});
  },
} as never;
