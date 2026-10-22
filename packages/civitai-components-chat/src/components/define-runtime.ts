import '@civitai/components/civitai-avatar/define';
import '@civitai/components/civitai-badge/define';
import '@civitai/components/civitai-confirm-dialog/define';
import '@civitai/components/civitai-media-card/define';
import '@civitai/components/civitai-modal/define';
import '@civitai/components/civitai-number-input/define';
import '@civitai/components/civitai-segmented-control/define';
import '@civitai/components/civitai-select/define';
import '@civitai/components/civitai-slider/define';
import '@civitai/components/civitai-switch/define';
import '@civitai/components/civitai-text-input/define';
import '@civitai/components/civitai-textarea/define';

import { CivitaiChatBalance } from './civitai-chat-balance.js';
import { CivitaiChatChoiceCard } from './civitai-chat-choice-card.js';
import { CivitaiChatPanel } from './civitai-chat-panel.js';
import { CivitaiChatReplyStatus } from './civitai-chat-reply-status.js';
import { CivitaiChatGenerationDetails } from './civitai-chat-generation-details.js';
import { CivitaiChatModelPicker } from './civitai-chat-model-picker.js';
import { CivitaiChatSettingsDialog } from './civitai-chat-settings-dialog.js';
import { CivitaiChatSidebar } from './civitai-chat-sidebar.js';
import { CivitaiChatSpend } from './civitai-chat-spend.js';
import { CivitaiChatThread } from './civitai-chat-thread.js';
import { CivitaiChatTurn } from './civitai-chat-turn.js';
import { defineCivitaiChatGenerationCard } from './lib/civitai-chat-generation-card.js';
import { defineCivitaiChatLightbox } from './lib/civitai-chat-lightbox.js';
import { defineCivitaiChatModelCard } from './lib/civitai-chat-model-card.js';
import { defineCivitaiChatPostCard } from './lib/civitai-chat-post-card.js';

const RUNTIME: Array<[string, CustomElementConstructor]> = [
  ['civitai-chat-balance', CivitaiChatBalance],
  ['civitai-chat-choice-card', CivitaiChatChoiceCard],
  ['civitai-chat-generation-details', CivitaiChatGenerationDetails],
  ['civitai-chat-model-picker', CivitaiChatModelPicker],
  ['civitai-chat-panel', CivitaiChatPanel],
  ['civitai-chat-reply-status', CivitaiChatReplyStatus],
  ['civitai-chat-turn', CivitaiChatTurn],
  ['civitai-chat-thread', CivitaiChatThread],
  ['civitai-chat-sidebar', CivitaiChatSidebar],
  ['civitai-chat-spend', CivitaiChatSpend],
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
