import { useCallback, useEffect, useRef, useState } from 'react';

import { useAppStorage, useBlockContext, useBlockResize } from '@civitai/blocks-react';
import type { AppStorageKeyEntry, AppStorageQuota } from '@civitai/blocks-react';
import { isSignedIn } from '@civitai/app-sdk/blocks';

/**
 * kv-storage — per-(block instance, viewer) key-value store.
 *
 * `useAppStorage()` is the W4-v0 KV datastore. Calls flow through the host's
 * postMessage bridge; the block never sees the apps DB credentials. Keys are
 * NAMESPACED per (this block instance, this viewer) — two users of the same
 * block get isolated stores, and the same user on a different model gets a
 * different store.
 *
 * 🔴 THE BUDGET IS SCOPED WIDER THAN THE NAMESPACE. `APP_STORAGE_MAX_BYTES`
 * and `APP_STORAGE_MAX_ROWS` are per (APP, viewer): every instance of this app
 * draws on ONE budget for a given viewer. `APP_STORAGE_MAX_VALUE_BYTES` caps a
 * single value. All three live in `@civitai/app-sdk/blocks` — import them,
 * never retype a figure, and render `getQuota()`'s reply to a viewer.
 *
 * 🔴 ROWS RUN OUT BEFORE BYTES DO. One small record per item a viewer touches
 * hits the row ceiling while barely denting the byte one, so a bytes-only
 * usage readout shows headroom right up to the rejection. This demo prints
 * both.
 *
 * The `apps:storage` capability is ambient at v0 — every block can call it
 * (it's gated by the host, not a declared manifest scope; a future version may
 * make it a real scope, see W11 H4). Anon viewers: `get`/`list` no-op (null /
 * empty), writes reject.
 *
 * This example is a tiny notes pad backed by KV.
 */
export function App() {
  const { ready, viewer, theme } = useBlockContext();
  const storage = useAppStorage();
  const rootRef = useRef<HTMLDivElement>(null);
  useBlockResize(rootRef);

  const [keys, setKeys] = useState<AppStorageKeyEntry[]>([]);
  const [quota, setQuota] = useState<AppStorageQuota | null>(null);
  const [draftKey, setDraftKey] = useState('note-1');
  const [draftValue, setDraftValue] = useState('');
  const [status, setStatus] = useState<string | null>(null);

  // Sign-in gate via the SDK predicate, not an open-coded truthiness check.
  const isAnon = ready && !isSignedIn(viewer);

  const refresh = useCallback(async () => {
    if (isAnon) return;
    try {
      const [list, q] = await Promise.all([storage.list({ prefix: 'note-' }), storage.getQuota()]);
      setKeys(list.keys);
      setQuota(q);
    } catch (err) {
      setStatus(storageFailureMessage(err, 'load your notes'));
    }
  }, [storage, isAnon]);

  useEffect(() => {
    if (ready && !isAnon) void refresh();
  }, [ready, isAnon, refresh]);

  const save = useCallback(async () => {
    setStatus(null);
    try {
      const res = await storage.set(draftKey, { text: draftValue, savedAt: Date.now() });
      setStatus(`saved ${draftKey} (${res.sizeBytes ?? '?'} bytes)`);
      setDraftValue('');
      await refresh();
    } catch (err) {
      setStatus(storageFailureMessage(err, 'save that note'));
    }
  }, [storage, draftKey, draftValue, refresh]);

  const load = useCallback(
    async (key: string) => {
      const value = await storage.get<{ text: string }>(key);
      setDraftKey(key);
      setDraftValue(value?.text ?? '');
    },
    [storage],
  );

  const remove = useCallback(
    async (key: string) => {
      const res = await storage.delete(key);
      setStatus(res.deleted ? `deleted ${key}` : `${key} was already gone`);
      await refresh();
    },
    [storage, refresh],
  );

  if (!ready) {
    // No `rootRef` here: the host shows its own loading state until BLOCK_READY,
    // and `useBlockResize` observes the real root whenever it mounts.
    return (
      <div data-theme={theme} className="hw-root">
        Loading…
      </div>
    );
  }

  if (isAnon) {
    return (
      <div ref={rootRef} data-theme={theme} className="hw-root">
        <strong>Notes</strong>
        <div className="hw-card">Sign in to save notes — storage is per-viewer.</div>
      </div>
    );
  }

  return (
    <div ref={rootRef} data-theme={theme} className="hw-root">
      <strong>Notes (KV-backed)</strong>

      <div className="hw-card" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <input value={draftKey} onChange={(e) => setDraftKey(e.target.value)} placeholder="key" />
        <textarea
          rows={3}
          value={draftValue}
          onChange={(e) => setDraftValue(e.target.value)}
          placeholder="note text"
          style={{ resize: 'vertical' }}
        />
        <button onClick={save} style={buttonStyle}>
          set()
        </button>
      </div>

      <div className="hw-card">
        <div style={{ fontWeight: 600 }}>list({`{ prefix: 'note-' }`})</div>
        {keys.length === 0 ? (
          <div style={{ opacity: 0.7 }}>no notes yet</div>
        ) : (
          keys.map((k) => (
            <div key={k.key} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <code style={{ flex: 1 }}>{k.key}</code>
              <span style={{ fontSize: 11, opacity: 0.6 }}>{k.updatedAt.toLocaleString()}</span>
              <button onClick={() => load(k.key)} style={linkButtonStyle}>
                get
              </button>
              <button onClick={() => remove(k.key)} style={linkButtonStyle}>
                delete
              </button>
            </div>
          ))
        )}
      </div>

      {quota ? (
        <div className="hw-card" style={{ fontSize: 12 }}>
          {fmtBytes(quota.usedBytes)} of {fmtBytes(quota.limitBytes)} used · {quota.rowCount} /{' '}
          {quota.limitRows} rows
        </div>
      ) : null}

      {status ? <div style={{ fontSize: 12, opacity: 0.8 }}>{status}</div> : null}
    </div>
  );
}

/**
 * Viewer copy THIS APP owns for a storage failure, with the host's own words
 * logged for the developer.
 *
 * 🔴 `err.message` HERE IS HOST-AUTHORED, NOT A LOCAL LITERAL. `useAppStorage`
 * builds its rejections as `new Error(result.error)`, so the message is whatever
 * string the host put on the wire — the same class of value as a workflow
 * `snapshot.error`, and the same reason not to render it. These lines used to
 * put it straight into the status line.
 *
 * 🔴 **THE SPECIFIC ARM BELOW ONLY FIRES UNDER `dev:mock`. SAY SO OUT LOUD.**
 * `createMockHost` and this example's harness answer the literal string
 * `PAYLOAD_TOO_LARGE` for the per-value cap, the byte budget and the row budget
 * alike — so locally the match succeeds and the viewer gets the actionable
 * copy. The real host does NOT send that code: the bridge forwards the
 * TRPCError's *message*, so a live block receives prose like `per-user row
 * limit exceeded`, `/payload_too_large/i` does not match, and the viewer gets
 * the generic fallback instead. That is civitai/civitai-app-starters#343.
 *
 * So: **in production this function currently has one branch, the fallback.**
 * An earlier revision of this comment claimed the copy "stays correct either
 * way". It does not — the copy is correct, and unreachable.
 *
 * It is left narrow on purpose rather than widened: adding `/row limit/`,
 * `/quota/` and friends means guessing at host prose nobody here has
 * enumerated, and a guessed pattern that misses fails exactly as it does today
 * while *looking* handled — a guard spelled rather than structural. #343 is
 * where the host's real rejection contract gets pinned; widen this arm when it
 * lands, in the same change, against the enumerated strings.
 *
 * Copy the SHAPE of this function (own your viewer copy, log the host's words,
 * never render them). Do not copy `/payload_too_large/i` expecting it to fire
 * against the host.
 */
function storageFailureMessage(err: unknown, attempted: string): string {
  const raw = err instanceof Error ? err.message : String(err);
  console.warn(`[kv-storage] could not ${attempted}:`, raw);
  // MOCK-ONLY ARM — see the docblock. Matches `createMockHost` / this example's
  // harness, which answer `PAYLOAD_TOO_LARGE` for all three ceilings, so there
  // is no second string to select locally and the copy names every possibility.
  // Against the live host this does not match at all (#343) and the fallback
  // below is what a viewer sees.
  if (/payload_too_large/i.test(raw)) {
    return 'That note is too large, or your storage is full. Try a shorter note or delete one.';
  }
  return `Could not ${attempted}. Please try again.`;
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const buttonStyle = {
  padding: '8px 14px',
  border: 'none',
  borderRadius: 6,
  background: '#1971c2',
  color: '#fff',
  fontWeight: 600,
  cursor: 'pointer',
} as const;

const linkButtonStyle = {
  border: 'none',
  background: 'transparent',
  color: 'inherit',
  textDecoration: 'underline',
  cursor: 'pointer',
  fontSize: 12,
} as const;
