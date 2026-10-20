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
  /** The chat model: an id or alias the orchestrator serves through its OpenAI-compatible endpoint. */
  model: string;
  /** Other models the viewer may pick in Settings, besides the default and a custom id. */
  models: ChatModelOption[];
  orchestrationMcpUrl: string;
  siteMcpUrl: string;
  /** New viewers' "ask before spending more than" limit, in Buzz; 0 asks every time. */
  autoRunLimit: number;
  /**
   * The most steps (model requests) one reply may take; the last one must answer in words, and a reply
   * that used them all offers Continue. 10 when unset, kept within 2 to {@link MAX_STEPS_LIMIT}. Each step is a paid request,
   * and each re-sends every earlier step of the same reply: nothing trims those, so with a large
   * value a long reply can outgrow the model's context window and end in an error before its last step.
   */
  maxSteps?: number;
  /**
   * The most tokens one step of a reply may write, reasoning and tool arguments included, unless the
   * viewer set their own in Settings. Kept within 1,024 to 32,768.
   */
  maxOutputTokens: number;
  /**
   * About how many tokens of earlier conversation a reply sends, by the 3.5-characters-a-token
   * estimate; {@link CONTEXT_BUDGET_TOKENS} when unset. Raise it for a model with a large window.
   */
  contextBudgetTokens?: number;
  /** The voice a spoken conversation replies in: a Qwen3 TTS speaker, and how it should speak. */
  conversationVoice: { speaker: string; instruct?: string };
}

/** The output-token cap a viewer or page may choose: fewer starves reasoning models and long file writes. */
export const OUTPUT_TOKENS_MIN = 1_024;
export const OUTPUT_TOKENS_MAX = 32_768;
export const DEFAULT_OUTPUT_TOKENS = 16_384;

export const chatConfig: ChatConfig = {
  name: 'Civitai Chat',
  model: 'civitai/qwen3.8',
  orchestrationMcpUrl: `${ORCH_URL}/mcp/v2`,
  siteMcpUrl: 'https://mcp.civitai.com/mcp',
  autoRunLimit: 100,
  maxOutputTokens: DEFAULT_OUTPUT_TOKENS,
  models: [],
  conversationVoice: { speaker: 'vivian', instruct: 'Speak quickly, at a brisk and energetic pace.' },
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

/** The step budget a reply uses: `chatConfig.maxSteps` rounded and kept within 2 to {@link MAX_STEPS_LIMIT}, else {@link MAX_STEPS}. */
export function stepLimit(): number {
  const value = chatConfig.maxSteps;
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(MAX_STEPS_LIMIT, Math.max(2, Math.round(value))) : MAX_STEPS;
}

export const MAX_STEPS = 10;
/** The most steps a page may configure: high enough for a long agentic task, a ceiling against a typo. */
export const MAX_STEPS_LIMIT = 1_000;
export const CONTEXT_BUDGET_TOKENS = 24_000;
/**
 * What a reply sends besides the conversation history: the system prompt and the built-in tools'
 * definitions. Measured 2026-10-14 at 7,206 tokens (the package's own 3.5-characters-a-token
 * estimate, longest custom instructions, posting on, the recorded tool catalogs in test-fixtures),
 * rounded up to leave room for a page's own tools and instructions. `request-overhead.test.ts`
 * re-measures it and fails if the prompt or catalogs outgrow it.
 */
export const REQUEST_OVERHEAD_TOKENS = 10_000;
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

/** The history budget a reply uses: `chatConfig.contextBudgetTokens` when it is a positive number, else {@link CONTEXT_BUDGET_TOKENS}. */
export function contextBudget(): number {
  const value = chatConfig.contextBudgetTokens;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : CONTEXT_BUDGET_TOKENS;
}
