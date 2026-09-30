import '@civitai/components/civitai-avatar/define';
import '@civitai/components/civitai-badge/define';
import '@civitai/components/civitai-confirm-dialog/define';
import '@civitai/components/civitai-media-card/define';
import '@civitai/components/civitai-modal/define';
import '@civitai/components/civitai-segmented-control/define';
import '@civitai/components/civitai-select/define';
import '@civitai/components/civitai-switch/define';
import '@civitai/components/civitai-textarea/define';

import { CivitaiChatChoiceCard } from './civitai-chat-choice-card.js';
import { CivitaiChatGenerationDetails } from './civitai-chat-generation-details.js';
import { CivitaiChatSettingsDialog } from './civitai-chat-settings-dialog.js';
import { CivitaiChatSidebar } from './civitai-chat-sidebar.js';
import { CivitaiChatThread } from './civitai-chat-thread.js';
import { CivitaiChatTurn } from './civitai-chat-turn.js';
import { defineCivitaiChatGenerationCard } from './lib/civitai-chat-generation-card.js';
import { defineCivitaiChatLightbox } from './lib/civitai-chat-lightbox.js';
import { defineCivitaiChatModelCard } from './lib/civitai-chat-model-card.js';
import { defineCivitaiChatPostCard } from './lib/civitai-chat-post-card.js';

const RUNTIME: Array<[string, CustomElementConstructor]> = [
  ['civitai-chat-choice-card', CivitaiChatChoiceCard],
  ['civitai-chat-generation-details', CivitaiChatGenerationDetails],
  ['civitai-chat-turn', CivitaiChatTurn],
  ['civitai-chat-thread', CivitaiChatThread],
  ['civitai-chat-sidebar', CivitaiChatSidebar],
  ['civitai-chat-settings-dialog', CivitaiChatSettingsDialog],
];

export function defineChatRuntime(): void {
  defineCivitaiChatLightbox();
  defineCivitaiChatGenerationCard();
  defineCivitaiChatModelCard();
  defineCivitaiChatPostCard();
  for (const [name, ctor] of RUNTIME) {
    if (!customElements.get(name)) customElements.define(name, ctor);
  }
}
