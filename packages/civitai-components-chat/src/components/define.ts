import type { CivitaiChatChoiceCard } from './civitai-chat-choice-card.js';
import type { CivitaiChatComposer } from './civitai-chat-composer.js';
import type { CivitaiChatGenerationDetails } from './civitai-chat-generation-details.js';
import type { CivitaiChatSettingsDialog } from './civitai-chat-settings-dialog.js';
import type { CivitaiChatSidebar } from './civitai-chat-sidebar.js';
import type { CivitaiChatThread } from './civitai-chat-thread.js';
import type { CivitaiChatTurn } from './civitai-chat-turn.js';
import type { CivitaiChatWelcome } from './civitai-chat-welcome.js';
import { defineChatRuntime } from './define-runtime.js';
import { defineChatShell } from './define-shell.js';

/** Every chat element at once, for tests; a page registers the shell and the rest follows lazily. */
export function defineElements(): void {
  defineChatShell();
  defineChatRuntime();
}

declare global {
  interface HTMLElementTagNameMap {
    'civitai-chat-composer': CivitaiChatComposer;
    'civitai-chat-thread': CivitaiChatThread;
    'civitai-chat-turn': CivitaiChatTurn;
    'civitai-chat-sidebar': CivitaiChatSidebar;
    'civitai-chat-welcome': CivitaiChatWelcome;
    'civitai-chat-choice-card': CivitaiChatChoiceCard;
    'civitai-chat-generation-details': CivitaiChatGenerationDetails;
    'civitai-chat-settings-dialog': CivitaiChatSettingsDialog;
  }
}
