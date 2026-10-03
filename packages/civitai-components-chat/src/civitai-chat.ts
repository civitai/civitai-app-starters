import { defineChatShell } from './components/define-shell.js';

export { CivitaiChat, type ChatLayout } from './components/civitai-chat.js';
export { configureChat, type ChatConfig } from './config.js';
export { holdSharedPanel, takeSharedPanel, type SharedPanel } from './panels/share.js';
export { popupSignIn } from './auth/popup.js';
export type { ChatFile, ChatTool, ChatToolContext } from './tools/host.js';

/** Registers `<civitai-chat>`; the rest of the chat loads once it has a signed-in `app`. Safe to call more than once. */
export function defineCivitaiChat(): void {
  defineChatShell();
}
