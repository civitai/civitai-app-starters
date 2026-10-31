/** What to restore after a trip to auth.civitai.com, which returns without query or hash. */
export interface ResumeState {
  conversationId?: string;
  draft?: string;
  action?: string;
}

const KEY = 'cvt:resume';

type SessionLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function session(): SessionLike | undefined {
  try {
    return globalThis.sessionStorage;
  } catch {
    return undefined;
  }
}

export function saveResume(state: ResumeState, storage: SessionLike | undefined = session()): void {
  try {
    storage?.setItem(KEY, JSON.stringify(state));
  } catch {
    // Private windows can refuse storage; the user just lands on their last chat.
  }
}

export function takeResume(storage: SessionLike | undefined = session()): ResumeState | null {
  try {
    const raw = storage?.getItem(KEY);
    storage?.removeItem(KEY);
    return raw ? (JSON.parse(raw) as ResumeState) : null;
  } catch {
    return null;
  }
}
