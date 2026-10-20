/**
 * The run protocol between `<civitai-chat runner="remote">` and a server-side runner that keeps a
 * reply going while the page sleeps or closes. The runner implements it server side against these
 * exact types; the chat's `RemoteAgent` is its client.
 *
 * Imported as `@civitai/components-chat/runner-protocol`. Types and a few pure helpers only: no DOM,
 * no Lit, nothing that runs on import.
 *
 * ## Endpoints (relative to the runner's base URL; see {@link runPaths})
 *
 * | Call | Body | Answer |
 * |---|---|---|
 * | `POST /runs` | {@link StartRunRequest} | `200`/`201` {@link StartRunResponse}; `4xx`/`5xx` {@link RunErrorResponse} |
 * | `GET /runs?conversationId=<id>` | | `200` {@link RunLookupResponse}: the conversation's live run, or `null` |
 * | `GET /runs/<runId>/events` | `Last-Event-ID` header to resume | `200` `text/event-stream` of {@link RunEvent}; `404` once the run is unknown |
 * | `POST /runs/<runId>/stop` | {@link StopRunRequest} | `202`: the run stops gracefully and ends with `run-ended` `stopped` |
 * | `POST /conversations/<id>/patch` | {@link ConversationPatchRequest} | `204`: the runner writes it into the head |
 *
 * Every request carries the page's own auth headers; the runner decides who the viewer is.
 *
 * ## The event stream
 *
 * One SSE message per event, `id:` the event's position in the run's journal (a decimal integer,
 * strictly increasing from `0`), `data:` the event as JSON ({@link encodeRunEvent}). The first event of
 * every run is `run-started`; the last is `run-ended`, after which the runner closes the stream. A
 * client that reconnects sends the last id it read as `Last-Event-ID`, and the runner sends every
 * event after it, then follows the run; without one it sends the whole journal. The runner sends an
 * SSE comment at least every {@link RUN_KEEPALIVE_MS}, so a client can tell a dead connection from a
 * quiet run.
 *
 * ## What the stream shows
 *
 * The parts a reply shows (`TurnPart`, the same ones the browser runner's reply shows) travel as
 * edits: `text-delta`, `tool-call`, `tool-result`, `tool-error` and `parts-truncate` (a step asked for
 * again after a drop takes back what its cut attempt showed). A runner gets them from the reply's
 * `AgentCore.live.parts` with {@link createPartsDiffer}, at most every {@link RUN_TEXT_FLUSH_MS}, so text
 * deltas are coalesced; a client applies them with {@link applyRunEvent}. Both are pure, so the parts a
 * client rebuilds are the parts the runner's reply showed, by construction.
 *
 * ## The single writer
 *
 * In remote mode the runner is the only writer of the conversation's head (the saved conversation):
 * it saves the user's turn when the run starts, the reply's progress as it goes, and how it ended
 * before `run-ended`. The page writes no head; it reads the head again once a run ended, and sends a
 * title or model the viewer changed as a patch.
 */

import type { ModelMessage } from 'ai';

import type { ErrorTrace } from './agent/error-trace.js';
import type { TurnPart } from './agent/parts.js';
import type { ChatToolResult } from './tools/gate.js';
import type { TitleSource, TurnUser } from './types.js';

export type { ErrorTrace } from './agent/error-trace.js';
export type { TurnPart } from './agent/parts.js';
export type { ChatToolResult } from './tools/gate.js';
export type { Attachment, TurnUser } from './types.js';

/** The protocol's version: every request and response, and `run-started`, carry it as `v`. */
export const RUN_PROTOCOL_VERSION = 1;

/** How often, at most, a runner sends the parts' edits: text written meanwhile goes as one delta. */
export const RUN_TEXT_FLUSH_MS = 100;

/** The longest a runner leaves the event stream silent: it sends an SSE comment by then. */
export const RUN_KEEPALIVE_MS = 15_000;

/** The runner's paths, relative to its base URL (no leading slash: joined onto the base's path). */
export const runPaths = {
  start: (): string => 'runs',
  lookup: (conversationId: string): string => `runs?conversationId=${encodeURIComponent(conversationId)}`,
  events: (runId: string): string => `runs/${encodeURIComponent(runId)}/events`,
  stop: (runId: string): string => `runs/${encodeURIComponent(runId)}/stop`,
  patch: (conversationId: string): string => `conversations/${encodeURIComponent(conversationId)}/patch`,
} as const;

/** A JSON value, as a request carries it. */
export type RunJson = string | number | boolean | null | RunJson[] | { [key: string]: RunJson };

/**
 * What the page tells the runner about itself for one reply: what the server-side tools and gate need
 * that only the page knows, e.g. the app open in the page (`{ appId, sandbox }`). Opaque to the chat:
 * the page's `remoteRunner.pageState()` returns it, read as each reply starts, and the runner
 * validates it. The page's own tool executors and its `beforeToolCall` do not run in remote mode: the
 * runner holds the tools and the gate, and this is how it learns the state they decide on.
 */
export type RunPageState = { [key: string]: RunJson };

/** The viewer's settings that shape a reply, as the page holds them; the runner validates them. */
export interface RunSettings {
  customInstructions?: string;
  /** The embedding page's instructions to the assistant (`instructions`). */
  hostInstructions?: string;
  /** The most one step of the reply may write. */
  maxOutputTokens: number;
  /** How the reply is paid for: free replies while they last then Buzz (`auto`), `free` only, or `paid`. */
  tier: 'auto' | 'free' | 'paid';
  allowMature: boolean;
  /** The Buzz a generation may cost without asking the viewer. */
  autoRunLimit: number;
  /** Replies are read aloud: written to be spoken. */
  spokenReplies: boolean;
}

/** `POST /runs`: start a reply. */
export interface StartRunRequest {
  v: 1;
  /**
   * Made once per reply by the client and sent again unchanged when it retries a start whose answer it
   * never got: a runner that already started that run answers with it instead of starting another.
   */
  idempotencyKey: string;
  conversationId: string;
  /** The chat's `scope`, which keeps an embedding app's conversations apart. */
  scope?: string;
  /**
   * The turn to reply to: `seq` is the next turn of the saved conversation (the user's new message),
   * or, with `retry`, its latest turn again (asked again after it failed: the runner carries on from
   * its saved steps, or starts it over). A runner answers `stale-turn` to any other `seq`.
   */
  turn: { seq: number; user: TurnUser; retry?: boolean };
  /** The model the reply uses. */
  model: string;
  settings: RunSettings;
  page?: RunPageState;
}

/** The answer to a start that worked. */
export interface StartRunResponse {
  v: 1;
  runId: string;
  conversationId: string;
  seq: number;
}

/**
 * Why a call was refused: `run-active` (the conversation has a live run; `runId` names it),
 * `stale-turn` (the turn is not the conversation's next or latest one), `refused` (the viewer may not:
 * banned, no consent, out of Buzz), `unauthorized`, `bad-request`, `not-found`, `unavailable`.
 */
export type RunErrorCode = 'run-active' | 'stale-turn' | 'refused' | 'unauthorized' | 'bad-request' | 'not-found' | 'unavailable';

export interface RunErrorResponse {
  v: 1;
  error: RunErrorCode;
  /** Words the viewer may be shown. */
  message: string;
  runId?: string;
}

/** A live run, as `GET /runs?conversationId=` reports it. */
export interface RunSummary {
  runId: string;
  conversationId: string;
  /** The turn it replies to. */
  seq: number;
  user: TurnUser;
  /** ISO 8601. */
  startedAt: string;
}

/** `GET /runs?conversationId=`: the conversation's live run, `null` when none runs. */
export interface RunLookupResponse {
  v: 1;
  run: RunSummary | null;
}

/** `POST /runs/<runId>/stop`: stop the reply, keeping what it did, as the viewer's Stop does. */
export interface StopRunRequest {
  v: 1;
}

/**
 * `POST /conversations/<id>/patch`: a change the viewer made to the conversation itself, which the
 * runner writes into the head (now, or with its next save while a run is live). `model: null` makes the
 * chat follow the viewer's default again.
 */
export interface ConversationPatchRequest {
  v: 1;
  title?: string;
  titleSource?: Exclude<TitleSource, 'first-message'>;
  model?: string | null;
}

/** How a run ended: `done`, `stopped` (the viewer's Stop), `error`, or `ran_out` (it used every step it may take). */
export type RunEndStatus = 'done' | 'stopped' | 'error' | 'ran_out';

/** A subagent's live progress, for its card while its `dispatch_agent` call runs. */
export interface RunSubagentProgress {
  task: string;
  steps: number;
  toolCalls: number;
  lastTool?: string;
}

/** Everything a run's event stream carries. */
export type RunEvent =
  /** The first event. `parts`: what the reply shows at once (the saved steps of a reply carried on), else `[]`. */
  | { type: 'run-started'; v: 1; runId: string; conversationId: string; seq: number; user: TurnUser; parts: TurnPart[] }
  /** Words added to the text part at `index`; at `index` equal to the parts' count, a new text part. */
  | { type: 'text-delta'; index: number; text: string }
  /** A tool call started, as a new part at `index` (always the parts' count). */
  | { type: 'tool-call'; index: number; toolCallId: string; toolName: string; input: unknown }
  /** A call's result came in. */
  | { type: 'tool-result'; toolCallId: string; output: unknown }
  /** A call failed, in the words the viewer sees. */
  | { type: 'tool-error'; toolCallId: string; error: string }
  /** The parts from `length` on are taken back (a step asked for again after a drop). */
  | { type: 'parts-truncate'; length: number }
  /** A step finished: how many the reply finished so far, and whether this one called a tool. */
  | { type: 'step-finished'; steps: number; calledTools: boolean }
  /** The reply's progress so far was saved to the head (ISO 8601). */
  | { type: 'checkpoint'; savedAt: string }
  /** A subagent's progress, by its `dispatch_agent` call's id; `null` once it ended. */
  | { type: 'subagent-progress'; toolCallId: string; progress: RunSubagentProgress | null }
  /** A tool call finished as the gate reports it (the browser runner's `tool-result` event). */
  | { type: 'tool-reported'; result: ChatToolResult }
  /** The runner's connection to the model was cut and the step is asked for again by itself (from 1). */
  | { type: 'network-retry'; attempt: number; trace: ErrorTrace }
  /** The reply failed: the words the viewer sees and where it failed. `run-ended` `error` follows. */
  | { type: 'error'; message: string; detail?: string; kind?: string; trace: ErrorTrace }
  /**
   * The last event. `messages`: what the reply kept, as the head saves it. `endedBy`: the words the
   * gate ended a `done` reply on. `resumable`: an `error` reply can be asked again (`retry`) without
   * running a tool twice; `steps` is how many steps it finished.
   */
  | { type: 'run-ended'; status: RunEndStatus; messages: ModelMessage[]; steps: number; endedBy?: string; resumable?: boolean };

export type RunEventType = RunEvent['type'];

/** One event as an SSE message: `id:` its journal position, `data:` the event as JSON. */
export function encodeRunEvent(id: number | string, event: RunEvent): string {
  return `id: ${id}\ndata: ${JSON.stringify(event)}\n\n`;
}

/** Turns snapshots of a reply's parts into the events that edit one into the next. */
export interface PartsDiffer {
  diff(parts: readonly TurnPart[]): RunEvent[];
}

/** Not implemented yet. */
export function createPartsDiffer(_initial: readonly TurnPart[] = []): PartsDiffer {
  return { diff: () => [] };
}

/** Not implemented yet. */
export function applyRunEvent(_parts: TurnPart[], _event: RunEvent): boolean {
  return true;
}
