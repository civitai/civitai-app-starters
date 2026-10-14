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
  /** What the chat calls itself to the viewer and to its assistant. */
  name: string;
  /** The chat model, as an AIR the orchestrator serves through its OpenAI-compatible endpoint. */
  model: string;
  /** Other models the viewer may pick in Settings, besides the default and a custom id. */
  models: ChatModelOption[];
  orchestrationMcpUrl: string;
  siteMcpUrl: string;
  /** New viewers' "ask before spending more than" limit, in Buzz; 0 asks every time. */
  autoRunLimit: number;
  /**
   * The most tokens one step of a reply may write, reasoning and tool arguments included, unless the
   * viewer set their own in Settings. Kept within 1,024 to 32,768.
   */
  maxOutputTokens: number;
}

/** The output-token cap a viewer or page may choose: fewer starves reasoning models and long file writes. */
export const OUTPUT_TOKENS_MIN = 1_024;
export const OUTPUT_TOKENS_MAX = 32_768;
export const DEFAULT_OUTPUT_TOKENS = 16_384;

export const chatConfig: ChatConfig = {
  name: 'Civitai Chat',
  model: 'urn:air:qwen3:repository:huggingface:gittensor-model-hub/Qwen3.8-27B-NVFP4-RTX5090@main.tar',
  orchestrationMcpUrl: `${ORCH_URL}/mcp/v2`,
  siteMcpUrl: 'https://mcp.civitai.com/mcp',
  autoRunLimit: 100,
  maxOutputTokens: DEFAULT_OUTPUT_TOKENS,
  models: [],
};

/**
 * The cap a reply uses: `value` (the viewer's own) when it is a number, else the page's default,
 * rounded and kept within {@link OUTPUT_TOKENS_MIN}–{@link OUTPUT_TOKENS_MAX}. A stored value from an
 * older version or a typo never reaches the request as is.
 */
export function outputTokenCap(value?: unknown): number {
  const pick = (candidate: unknown): number | undefined =>
    typeof candidate === 'number' && Number.isFinite(candidate) ? Math.min(OUTPUT_TOKENS_MAX, Math.max(OUTPUT_TOKENS_MIN, Math.round(candidate))) : undefined;
  return pick(value) ?? pick(chatConfig.maxOutputTokens) ?? DEFAULT_OUTPUT_TOKENS;
}

/** Changes what every chat on the page uses from its next reply; call it before the first chat starts. */
export function configureChat(patch: Partial<ChatConfig>): void {
  Object.assign(chatConfig, Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)));
}

export const MAX_STEPS = 10;
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
