import type { Attachment } from '../types.js';
import type { LiveTurn } from './core.js';

/**
 * What the element and the session ask of a reply's runner: `Agent` runs the reply in the page,
 * `RemoteAgent` follows one a server runs. Both fire `change` (whenever `live` or `running` changes),
 * `error` (`AgentErrorDetail`, as a reply fails) and `network-retry` (`AgentRetryDetail`).
 */
export interface ChatAgent extends EventTarget {
  /** The reply now running, as shown so far; `null` between replies. */
  readonly live: LiveTurn | null;
  readonly running: boolean;
  send(content: string, attachments?: Attachment[], refs?: string[]): Promise<void>;
  /** The viewer's Stop: the reply ends `aborted`, keeping what it did. */
  abort(): void;
  /** Asks again for the latest reply, after it failed. */
  retry(): Promise<void>;
  /**
   * Whether `edit` can work here: always in the page; with a server runner, once it said it takes
   * edits (`features`). Whether a reply runs now is not part of it.
   */
  readonly canEdit: boolean;
  /**
   * The viewer edited their latest message, while no reply runs: its text becomes `content`, the reply
   * that followed it (if any) is dropped, and the turn is replied to afresh, as a new reply (charged
   * as one). Nothing when a reply runs, when there is no message, or when `canEdit` is false.
   */
  edit(content: string): Promise<void>;
  /**
   * The page leaves the reply (another chat opened, a new one started, the session replaced). In the
   * page that ends it, as Stop does; a reply a server runs carries on, and is followed again once its
   * chat is opened.
   */
  leave(): void;
  /** The session is replaced: as `leave`, and nothing is started or followed by this agent any more. */
  dispose(): void;
}
