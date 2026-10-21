/**
 * The chat's reply loop without the page: `@civitai/components-chat/core`.
 *
 * Everything a server-side runner needs to run a reply exactly as `<civitai-chat>` runs it in the
 * browser: `AgentCore` (the step loop, its stop conditions and the automatic retries of a dropped
 * connection), the parts a reply shows, the model provider, the tool gate, the prompt and history
 * builders, read-only subagents, the conversation store, and an MCP server's tools as the chat offers
 * them (`McpServerPool` + `extraToolSet`: each named `${serverId}__${tool}`, its reply kept to its
 * first `RESULT_HEAD_CHARS` and last `RESULT_TAIL_CHARS` characters), and the pieces behind those:
 * `createMcpConnection`, `mcpResultToText` and `keepEnds`, plus `hostToolSet` and its notes for a
 * runner that offers a page's tools as the chat does. No module this imports, however
 * indirectly, loads Lit or anything that needs a DOM (`core.test.ts` walks the import graph and fails
 * otherwise), so it loads in plain Node.
 *
 * The browser-only surfaces (the element, the session that wires it, uploads, voice) are not here.
 */

export { AgentCore, withoutToolMarkup, type AgentCoreDeps, type AgentCoreOutcome, type AgentCoreRequest, type AgentCoreRun, type AgentCoreStep, type LiveTurn } from './agent/core.js';
export { partsFromMessages, type TurnPart } from './agent/parts.js';
export { describeTrace, errorTrace, type ErrorTrace, type TraceContext } from './agent/error-trace.js';
export { isNetworkDrop, MAX_NETWORK_RETRIES_PER_REPLY, NETWORK_RETRY_DELAYS_MS, pauseBeforeRetry } from './agent/network-retry.js';
export { stripToolMarkup } from './agent/tool-markup.js';
export { authedFetch, createAssistantModel, PROVIDER, PROVIDER_OPTIONS } from './agent/provider.js';
export { FreeTier, freeTierFetch, type FreeTierChoice, type FreeTierModel, type FreeTierStatus, type FreeTierWindow } from './agent/free-tier.js';
export {
  chatConfig,
  configureChat,
  contextBudget,
  outputTokenCap,
  stepLimit,
  APP_TAG,
  HEAD_TAG,
  JOB_TAG,
  TURN_TAG,
  conversationTag,
  scopeTag,
  type ChatConfig,
  type ChatModelOption,
} from './config.js';
export {
  endedReply,
  gateToolSet,
  nextReply,
  ENDED_BY_PAGE_MESSAGE,
  REFUSED_BY_PAGE_NOTE,
  type ChatToolDecision,
  type ChatToolGate,
  type ChatToolGateContext,
  type ChatToolResult,
  type GateDeps,
} from './tools/gate.js';
export { buildModelMessages, estimateTokens, type LiveLookup } from './agent/history.js';
export { buildSystemPrompt, buildTurnContext, defaultRules, type PromptContext, type TurnContext } from './agent/system-prompt.js';
export {
  dispatchAgentTool,
  resolveSubagents,
  subagentToolNames,
  SubagentTracker,
  DISPATCH_AGENT,
  type ChatSubagents,
  type DispatchDeps,
  type ResolvedSubagents,
  type SubagentProgress,
} from './agent/subagents.js';
export { humanize, humanizeHost, RETRYABLE_ERRORS, type ErrorKind, type HumanError } from './ux/humanize.js';
export { McpServerPool, namespacedToolName, type ChatMcpServer, type McpServerPoolDeps, type ServerTools } from './mcp/servers.js';
export { extraToolSet, keepEnds, RESULT_HEAD_CHARS, RESULT_TAIL_CHARS, type ExtraToolDeps } from './tools/extra.js';
export {
  createMcpConnection,
  McpConnectionClosedError,
  McpStreamLostError,
  type McpCallOptions,
  type McpConnection,
  type McpConnectionOptions,
  type McpProgress,
  type McpTool,
} from './mcp/clients.js';
export { mcpResultToText } from './mcp/result.js';
export {
  hostToolSet,
  HOST_TOOL_FAILED_NOTE,
  MEDIA_NOTE,
  type ChatFile,
  type ChatTool,
  type ChatToolCall,
  type ChatToolContext,
  type ChatToolView,
  type HostToolDeps,
} from './tools/host.js';
export { isSuperseded, type ChatConversation, type ChatConversationStore, type ConversationStore, type ListedConversation } from './store/conversation-store.js';
export { ThreadStore, turnFrom, conversationMetadataOf, type OpenedConversation, type ThreadStoreDeps } from './store/thread-store.js';
export type { Attachment, Conversation, ConversationMetadata, ConversationMetadataV3, ResumePoint, SavedTurn, SavedTurnV3, StoredConversationMetadata, Turn, TurnStatus, TurnUser } from './types.js';
