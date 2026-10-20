import type { ChatAgent } from '../agent/chat-agent.js';
import type { LiveTurn } from '../agent/core.js';
import type { RunPageState, RunSettings, RunSubagentProgress } from '../runner-protocol.js';
import type { ConversationStore } from '../store/conversation-store.js';
import type { ChatToolResult } from '../tools/gate.js';
import type { RunnerClient } from './runner-client.js';

export interface RemoteAgentDeps {
  client: RunnerClient;
  store: ConversationStore;
  scope?: string;
  model(): string;
  settings(): RunSettings;
  pageState?(): RunPageState | undefined;
  reread(conversationId: string): Promise<void>;
  progress?: { set(id: string, progress: RunSubagentProgress | undefined): void };
  onToolResult?(result: ChatToolResult): void;
  wake?(listener: () => void): () => void;
  newKey?(): string;
  idleMs?: number;
}

/** Not implemented yet: the API the remote runner's tests drive. */
export class RemoteAgent extends EventTarget implements ChatAgent {
  constructor(_deps: RemoteAgentDeps) {
    super();
  }

  get live(): LiveTurn | null {
    return null;
  }

  get running(): boolean {
    return false;
  }

  async send(_content: string, _attachments?: unknown[], _refs?: string[]): Promise<void> {}

  async retry(): Promise<void> {}

  abort(): void {}

  leave(): void {}

  async reattach(_conversationId: string): Promise<boolean> {
    return false;
  }
}
