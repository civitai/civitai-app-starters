// Stylesheets: tokens first, then the component CSS — the workspace equivalents
// of the two <link>s in packages/civitai-components/demo/index.html.
import '@civitai/theme/styles.css';
import '@civitai/components/styles.css';
import './demo.css';

// Defines every <civitai-*> element: the generic kit (registerAll) plus the
// site bundle (avatar, media-card, reaction, rating-badge, tag).
import { registerSite } from '@civitai/components/register-site';

import type { TabItem } from '@civitai/components/civitai-tabs';
import type { SelectOption } from '@civitai/components/civitai-select';
import type { RadioOption } from '@civitai/components/civitai-radio-group';
import type { Intent } from '@civitai/components/civitai-badge';
import type { ReactionDetail } from '@civitai/components/civitai-reaction';
import type { TagVoteDetail } from '@civitai/components/civitai-tag';
// These element modules also carry the HTMLElementTagNameMap augmentations that
// type document.querySelector('civitai-…') — register-site's dist d.ts re-exports
// no imports of its own, so the chain must be pulled in explicitly.
import type { CivitaiToastRegion } from '@civitai/components/civitai-toast-region';
import type { CivitaiModal } from '@civitai/components/civitai-modal';
import type { CivitaiConfirmDialog } from '@civitai/components/civitai-confirm-dialog';
import type { CivitaiButton } from '@civitai/components/civitai-button';

registerSite();

const toasts = document.querySelector('civitai-toast-region')!;

function toast(message: string, options: { heading?: string; color?: Intent; urgent?: boolean; sticky?: boolean } = {}): void {
  const { sticky = false, ...rest } = options;
  toasts.show({ message, duration: sticky ? 0 : 3000, ...rest });
}

// --- Theme: flip data-theme on <html>; every --civitai-* token re-resolves.
const themeToggle = document.getElementById('theme-toggle')!;
themeToggle.addEventListener('click', () => {
  const root = document.documentElement;
  const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  root.setAttribute('data-theme', next);
  toast(`Switched to ${next} theme.`, { heading: 'Theme', color: 'info' });
});

// --- Property-driven option sets (attributes cannot carry arrays).
const select = document.querySelector('civitai-select')!;
select.data = [
  { value: 'sdxl', label: 'SDXL' },
  { value: 'flux', label: 'Flux' },
  { value: 'pony', label: 'Pony' },
] satisfies SelectOption[];

const radioGroup = document.querySelector('civitai-radio-group')!;
radioGroup.data = [
  { value: 'euler', label: 'Euler' },
  { value: 'ddim', label: 'DDIM' },
  { value: 'dpm', label: 'DPM++ 2M', disabled: true },
] satisfies RadioOption[];

// --- Tabs: items via the `data` property; panels pair by `value`.
const tabs = document.querySelector('civitai-tabs')!;
tabs.data = [
  { value: 'grid', label: 'Grid' },
  { value: 'list', label: 'List' },
  { value: 'compact', label: 'Compact', disabled: true },
] satisfies TabItem[];
tabs.addEventListener('change', () => {
  toast(`Tab: ${tabs.value}`, { color: 'info' });
});

// --- Modal + confirm dialog.
const modal = document.querySelector('civitai-modal')!;
document.getElementById('open-modal')!.addEventListener('click', () => modal.show());

const confirmDialog = document.querySelector('civitai-confirm-dialog')!;
document.getElementById('ask-confirm')!.addEventListener('click', () => {
  confirmDialog.ask().then((confirmed) => {
    if (confirmed) toast('Collection deleted.', { heading: 'Confirmed', color: 'success' });
    else toast('Kept the collection.', { heading: 'Cancelled', color: 'info' });
  });
});

// --- Loading-state button.
// `#id` selectors do not participate in the tag-name overload, so type it here.
const loadDemo = document.querySelector<CivitaiButton>('#load-demo')!;
loadDemo.addEventListener('click', () => {
  loadDemo.loading = true;
  window.setTimeout(() => {
    loadDemo.loading = false;
  }, 1500);
});

// --- Toast triggers.
document.getElementById('toast-info')!.addEventListener('click', () => toast('Generation queued.', { heading: 'Info', color: 'info' }));
document.getElementById('toast-success')!.addEventListener('click', () => toast('Changes are live.', { heading: 'Saved', color: 'success' }));
document.getElementById('toast-warning')!.addEventListener('click', () => toast('Low on Buzz.', { heading: 'Warning', color: 'warning' }));
document.getElementById('toast-error')!.addEventListener('click', () => toast('The worker rejected the job.', { heading: 'Failed', color: 'error' }));
document.getElementById('toast-urgent')!.addEventListener('click', () => toast('Out of disk — free space now.', { heading: 'Urgent', color: 'error', urgent: true }));
document.getElementById('toast-sticky')!.addEventListener('click', () => toast('Dismiss me manually.', { heading: 'Sticky', color: 'warning', sticky: true }));

// --- Site kit: optimistic events bubble as composed CustomEvents.
document.querySelectorAll('civitai-tag').forEach((tag) => {
  tag.addEventListener('vote', (event) => {
    const { name, vote } = (event as CustomEvent<TagVoteDetail>).detail;
    const verdict = vote > 0 ? 'Upvoted' : vote < 0 ? 'Downvoted' : 'Cleared vote for';
    toast(`${verdict}: ${name}`, { color: 'info' });
  });
});

document.querySelectorAll('civitai-reaction').forEach((reaction) => {
  reaction.addEventListener('react', (event) => {
    const { emoji, reacted, count } = (event as CustomEvent<ReactionDetail>).detail;
    toast(`${emoji} ${reacted ? 'added' : 'removed'} — ${count}`, { color: 'success' });
  });
});
