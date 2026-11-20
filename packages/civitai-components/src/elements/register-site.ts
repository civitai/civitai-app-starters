import { defineCivitaiAvatar } from './civitai-avatar.js';
import { defineCivitaiMediaCard } from './civitai-media-card.js';
import { defineCivitaiRatingBadge } from './civitai-rating-badge.js';
import { defineCivitaiReaction } from './civitai-reaction.js';
import { defineCivitaiTag } from './civitai-tag.js';
import { registerAll } from './register.js';

/**
 * The civitai vocabulary ON TOP OF the generic kit: two disjoint bundles would
 * each carry their own 8.5 kB of Lit, and a page with a tag in it wants buttons
 * too. Load this OR `register.js`. Safe to call more than once.
 */
export function registerSite(): void {
  registerAll();
  defineCivitaiAvatar();
  defineCivitaiMediaCard();
  defineCivitaiReaction();
  defineCivitaiRatingBadge();
  defineCivitaiTag();
}

registerSite();
