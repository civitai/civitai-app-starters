import { defineChatShell } from './components/define-shell.js';

export { CivitaiChat, QUEUE_TIMEOUT_MS, type BeforeSendDetail, type CanSendChangeDetail, type ChatChangeDetail, type ChatLayout, type QueuedMessage, type ReplyResumeDetail } from './components/civitai-chat.js';
export type { Example as ChatExample } from './components/civitai-chat-welcome.js';
export { configureChat, type ChatConfig, type ChatModelOption } from './config.js';
export type { ChatBackend } from './backend.js';
export type { ChatConversation, ChatConversationStore, ChatConversationSummary, ChatSavedTurn } from './store/conversation-store.js';
export type { AgentErrorDetail as ChatReplyError } from './agent/agent.js';
export type { AgentRetryDetail as ChatReplyRetry } from './agent/agent.js';
export type { ErrorTrace as ChatErrorTrace } from './agent/error-trace.js';
export { holdSharedPanel, takeSharedPanel, type SharedPanel } from './panels/share.js';
export { popupSignIn } from './auth/popup.js';
export type { ChatFile, ChatTool, ChatToolCall, ChatToolContext, ChatToolView } from './tools/host.js';
export type { ToolCallsMode as ChatToolCallsMode } from './components/tool-calls.js';
export type { ChatMcpOptions, ChatMcpServer } from './mcp/servers.js';
export type { ChatToolDecision, ChatToolGate, ChatToolResult } from './tools/gate.js';
export type { ChatCommand, ChatCommandContext, ChatCommands, ChatCommandsOption } from './ux/commands.js';

/** Registers `<civitai-chat>`; the rest of the chat loads once it has a signed-in `app`. Safe to call more than once. */
export function defineCivitaiChat(): void {
  defineChatShell();
}
