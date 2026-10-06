export const ORCH_URL = 'https://orchestration.civitai.com';
export const SITE_URL = 'https://civitai.com';
export const BUY_BUZZ_URL = `${SITE_URL}/purchase/buzz`;

export interface ChatModelOption {
  /** A model id the orchestrator's chat endpoint serves, e.g. `anthropic/claude-sonnet-5.5`. */
  id: string;
  label: string;
  /** What choosing it means for the viewer, e.g. the rough cost of a reply. */
  note?: string;
}

export interface ChatConfig {
  /** The chat model, as an AIR the orchestrator serves through its OpenAI-compatible endpoint. */
  model: string;
  /** Other models the viewer may pick in Settings, besides the default and a custom id. */
  models: ChatModelOption[];
  orchestrationMcpUrl: string;
  siteMcpUrl: string;
  /** New viewers' "ask before spending more than" limit, in Buzz; 0 asks every time. */
  autoRunLimit: number;
}

export const chatConfig: ChatConfig = {
  model: 'urn:air:qwen3:repository:huggingface:gittensor-model-hub/Qwen3.8-27B-NVFP4-RTX5090@main.tar',
  orchestrationMcpUrl: `${ORCH_URL}/mcp/v2`,
  siteMcpUrl: 'https://mcp.civitai.com/mcp',
  autoRunLimit: 100,
  models: [],
};

/** Changes what every chat on the page uses from its next reply; call it before the first chat starts. */
export function configureChat(patch: Partial<ChatConfig>): void {
  Object.assign(chatConfig, Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)));
}

export const MAX_STEPS = 10;
export const MAX_OUTPUT_TOKENS = 1_200;
export const CONTEXT_BUDGET_TOKENS = 24_000;
export const RETENTION_DAYS = 30;
export const CUSTOM_INSTRUCTIONS_MAX = 1_500;
export const HOST_INSTRUCTIONS_MAX = 4_000;

export const APP_TAG = 'chat-cvt';
export const TURN_TAG = 'cvt:turn';
export const HEAD_TAG = 'cvt:head';
export const JOB_TAG = 'cvt:job';
export const conversationTag = (id: string): string => `cvt:conv:${id}`;
export const scopeTag = (scope: string): string => `cvt:scope:${scope}`;
/** Tag-safe, and short enough to leave room for the rest of the tag. */
export const SCOPE_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
