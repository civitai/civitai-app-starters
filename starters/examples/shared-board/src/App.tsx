import { useCallback, useEffect, useRef, useState } from 'react';

import {
  useAppStorage,
  useBlockContext,
  useBlockResize,
  useBlockToken,
  useRequestConsent,
  useRequestSignIn,
  useSharedStorage,
  useViewer,
} from '@civitai/blocks-react';
import type { SharedListItem } from '@civitai/blocks-react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  ReportButton,
  Stack,
  TextInput,
  Textarea,
} from '@civitai/blocks-react/ui';
import { classifyAppStorageError, isModelSlotContext, isSignedIn } from '@civitai/app-sdk/blocks';

/**
 * shared-board — an idea board every viewer of this app reads and writes,
 * beside a private draft only the current viewer can see.
 *
 * TWO STORES, AND THE DIFFERENCE IS THE POINT:
 *
 *  - `useSharedStorage()` — ONE board per APP. Every viewer, on every model page
 *    the app is installed on, reads the same list. Entries are structured
 *    `{ title, body?, data? }` records with a server-minted key, an author and a
 *    vote count. Scopes: `apps:storage:shared:read` (list) and
 *    `apps:storage:shared:write` (append / update / vote / unvote / withdraw /
 *    report).
 *  - `useAppStorage()` — a private key-value store per (block INSTANCE,
 *    viewer). Nobody else can read it. Here it holds the viewer's unposted draft
 *    and the keys they have reported. Scopes: `apps:storage:read` /
 *    `apps:storage:write`.
 *
 * WHAT THE HOST ACTUALLY DOES (civitai/civitai `src/server/routers/
 * apps-shared.router.ts`; the README cites the lines):
 *
 *  - APPEND IS INSERT-ONLY WITH A SERVER-MINTED KEY. The block never chooses a
 *    key, so two viewers cannot collide and nobody can overwrite anyone else's
 *    row. There is no "set this key" on the shared store.
 *  - UPDATE IS AUTHOR-ONLY AND LAST-WRITE-WINS. A plain `UPDATE … WHERE key AND
 *    author` with no version or precondition: the only writer that can race an
 *    edit is the same author in another tab, and the later write wins. Votes,
 *    reports, the key and `createdAt` survive an edit.
 *  - VOTES ARE ONE PER VIEWER AND ATOMIC. `vote`/`unvote` are idempotent and
 *    resolve with the AUTHORITATIVE total after the change — render that number,
 *    never a local +1.
 *  - WITHDRAW deletes only the caller's own row; on anyone else's it resolves
 *    `{ deleted: false }` rather than throwing.
 *  - LIST is newest-first, keyset-paginated on the key (cursor), 1–100 per page.
 *
 * 🔴 `data` IS NOT MODERATED. `title`/`body` go through the host's blocking
 * content-safety check; `data` is opaque app state stored beside them. Keep
 * every word another viewer will read in `title`/`body`. This app puts only a
 * model id and an edit timestamp in `data`.
 */

/**
 * The host's input bounds for a shared entry. NOT exported by
 * `@civitai/app-sdk` (as of 0.58.0), so they are stated here once, with their
 * source, rather than in each control. Re-read the host before trusting them.
 *
 *  - title ≤ 200, body ≤ 4096 characters: `SHARED_TITLE_MAX` /
 *    `SHARED_BODY_MAX` in `src/server/services/apps/shared-content-safety.ts`,
 *    enforced by zod on `sharedValueInput` in `apps-shared.router.ts`.
 *
 * Capping the inputs at these lengths also keeps every value this app writes far
 * below the host's 64 KB whole-value cap (4,296 characters, at most 6 JSON bytes
 * each, is under 26 KB), so that ceiling is unreachable from this UI by
 * construction rather than handled after the fact.
 */
const TITLE_MAX = 200;
const BODY_MAX = 4096;
/** Page size for `list()`. The host clamps any request into 1..100. */
const PAGE_SIZE = 10;
/** Per-viewer keys (private store). */
const DRAFT_KEY = 'draft';
const REPORTED_KEY = 'reported';
/** Bound the remembered report list so it can never approach the value cap. */
const REPORTED_MAX = 200;

/** What this app stores in the unmoderated `data` blob. Structure only — no prose. */
interface IdeaData {
  modelId?: number;
  editedAt?: string;
}

interface Draft {
  title: string;
  body: string;
}

export function App() {
  const { ready, viewer, theme, context } = useBlockContext();
  const shared = useSharedStorage();
  const storage = useAppStorage();
  const { requestSignIn } = useRequestSignIn();
  const { requestConsent } = useRequestConsent();
  const { scopes } = useBlockToken();
  // The authoritative identity read (GET_VIEWER → `user:read:self`). Used ONLY
  // to tell which rows are the viewer's own; `useBlockContext().viewer.id` is
  // deprecated and must not be used for that.
  const { viewer: identity, error: identityError, refetch: refetchMe } = useViewer();
  const rootRef = useRef<HTMLDivElement>(null);
  useBlockResize(rootRef);

  // Keep <html> in step with the host theme (see hello-world for the why).
  useEffect(() => {
    if (!ready) return;
    document.documentElement.dataset.theme = theme;
  }, [ready, theme]);

  // Sign-in gate via the SDK predicate, not an open-coded truthiness check.
  const signedIn = ready && isSignedIn(viewer);
  const myId = signedIn ? (identity?.id ?? null) : null;
  const modelId = isModelSlotContext(context) ? context.modelId : undefined;

  const [items, setItems] = useState<SharedListItem[]>([]);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [loadingBoard, setLoadingBoard] = useState(false);
  const [boardError, setBoardError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({ title: '', body: '' });
  const [reported, setReported] = useState<string[]>([]);
  const [editing, setEditing] = useState<{ key: string; title: string; body: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);

  // ---- SHARED: list (newest-first, keyset-paginated) ----
  const loadBoard = useCallback(
    async (after?: string) => {
      setLoadingBoard(true);
      setBoardError(null);
      try {
        const page = await shared.list({ limit: PAGE_SIZE, cursor: after });
        // A first page REPLACES; a cursor page APPENDS. The cursor is keyset (the
        // last key seen), so a post made after page 1 loaded never shifts what
        // page 2 returns — it appears at the top on the next refresh.
        setItems((prev) => (after ? [...prev, ...page.items] : page.items));
        setCursor(page.nextCursor);
      } catch (err) {
        setBoardError(boardFailureMessage(err, 'load the board'));
      } finally {
        setLoadingBoard(false);
      }
    },
    [shared],
  );

  useEffect(() => {
    if (ready) void loadBoard();
  }, [ready, loadBoard]);

  // ---- PRIVATE: the viewer's draft + the keys they reported ----
  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    void (async () => {
      try {
        const [d, r] = await Promise.all([
          storage.get<Draft>(DRAFT_KEY),
          storage.get<string[]>(REPORTED_KEY),
        ]);
        if (cancelled) return;
        if (d) setDraft({ title: d.title ?? '', body: d.body ?? '' });
        if (Array.isArray(r)) setReported(r);
      } catch (err) {
        if (!cancelled) setStatus({ tone: 'error', text: boardFailureMessage(err, 'load your draft') });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [signedIn, storage]);

  // When the viewer grants `user:read:self`, the host re-mints the token; read
  // the identity again once the scope is on it.
  const hasUserScope = scopes.includes('user:read:self');
  useEffect(() => {
    if (hasUserScope) refetchMe();
  }, [hasUserScope, refetchMe]);

  const saveDraft = useCallback(async () => {
    setStatus(null);
    try {
      await storage.set(DRAFT_KEY, draft);
      setStatus({ tone: 'info', text: 'Draft saved. Only you can see it.' });
    } catch (err) {
      setStatus({ tone: 'error', text: boardFailureMessage(err, 'save your draft') });
    }
  }, [storage, draft]);

  const post = useCallback(async () => {
    const title = draft.title.trim();
    if (!title) return;
    setBusy(true);
    setStatus(null);
    try {
      const body = draft.body.trim();
      const data: IdeaData = modelId !== undefined ? { modelId } : {};
      await shared.append({ title, ...(body ? { body } : {}), data });
      setDraft({ title: '', body: '' });
      // The draft has become a post; drop the private copy. Best effort.
      await storage.delete(DRAFT_KEY).catch(() => {});
      setStatus({ tone: 'info', text: 'Posted. Everyone using this app can see it now.' });
      await loadBoard();
    } catch (err) {
      setStatus({ tone: 'error', text: boardFailureMessage(err, 'post that idea') });
    } finally {
      setBusy(false);
    }
  }, [draft, modelId, shared, storage, loadBoard]);

  const toggleVote = useCallback(
    async (item: SharedListItem) => {
      setStatus(null);
      try {
        // Both resolve with the host's total AFTER the change — the truth, even
        // when another viewer voted in the meantime.
        const count = item.viewerVoted ? await shared.unvote(item.key) : await shared.vote(item.key);
        setItems((prev) =>
          prev.map((i) => (i.key === item.key ? { ...i, count, viewerVoted: !item.viewerVoted } : i)),
        );
      } catch (err) {
        setStatus({ tone: 'error', text: boardFailureMessage(err, 'record your vote') });
      }
    },
    [shared],
  );

  const saveEdit = useCallback(async () => {
    if (!editing) return;
    const title = editing.title.trim();
    if (!title) return;
    const current = items.find((i) => i.key === editing.key);
    setBusy(true);
    setStatus(null);
    try {
      const body = editing.body.trim();
      const prevData = (current?.value.data ?? {}) as IdeaData;
      const data: IdeaData = { ...prevData, editedAt: new Date().toISOString() };
      // Author-only, last-write-wins: no version is sent because the host checks
      // none. The key, votes and createdAt are preserved.
      await shared.update(editing.key, { title, ...(body ? { body } : {}), data });
      setEditing(null);
      await loadBoard();
    } catch (err) {
      setStatus({ tone: 'error', text: boardFailureMessage(err, 'save your edit') });
    } finally {
      setBusy(false);
    }
  }, [editing, items, shared, loadBoard]);

  const withdraw = useCallback(
    async (key: string) => {
      setStatus(null);
      try {
        const res = await shared.withdraw(key);
        setStatus({ tone: 'info', text: res.deleted ? 'Your idea was removed.' : 'That idea was already gone.' });
        setItems((prev) => prev.filter((i) => i.key !== key));
      } catch (err) {
        setStatus({ tone: 'error', text: boardFailureMessage(err, 'remove your idea') });
      }
    },
    [shared],
  );

  // Rejects on failure so ReportButton stays armed instead of reading as filed.
  const report = useCallback(
    async (key: string) => {
      await shared.report(key);
      const next = [key, ...reported.filter((k) => k !== key)].slice(0, REPORTED_MAX);
      setReported(next);
      // Remembered privately so the control stays "Reported" across reloads —
      // the shared store has no per-viewer "you reported this" field.
      await storage.set(REPORTED_KEY, next).catch(() => {});
    },
    [shared, storage, reported],
  );

  if (!ready) return <div style={{ padding: 16 }}>Loading…</div>;

  return (
    <div ref={rootRef} data-theme={theme} className="board-root">
      <header className="board-header">
        <div>
          <strong className="board-title">Idea board</strong>
          <div className="dimmed">
            One board for everyone using this app, on every model page it is installed on.
          </div>
        </div>
        <Button variant="subtle" size="sm" onClick={() => loadBoard()} loading={loadingBoard}>
          Refresh
        </Button>
      </header>

      <div className="board-layout">
        <aside className="board-compose">
          {signedIn ? (
            <Card>
              <Stack gap={8}>
                <Group gap={8}>
                  <strong>New idea</strong>
                  <Badge size="sm" variant="outline">
                    draft: only you
                  </Badge>
                </Group>
                <TextInput
                  label="Title"
                  required
                  maxLength={TITLE_MAX}
                  value={draft.title}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                  description={`${draft.title.length} / ${TITLE_MAX}`}
                />
                <Textarea
                  label="Details (optional)"
                  minRows={3}
                  maxLength={BODY_MAX}
                  value={draft.body}
                  onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                  description={`${draft.body.length} / ${BODY_MAX}`}
                />
                <Group gap={8}>
                  <Button onClick={post} disabled={!draft.title.trim() || busy} loading={busy}>
                    Post to board
                  </Button>
                  <Button variant="light" onClick={saveDraft} disabled={busy}>
                    Save draft
                  </Button>
                </Group>
                <small className="dimmed">
                  A posted idea is public to every viewer of this app. A saved draft is stored in your
                  private storage and is never shown to anyone else.
                </small>
              </Stack>
            </Card>
          ) : (
            <Card>
              <Stack gap={8}>
                <strong>Sign in to post and vote</strong>
                <span className="dimmed">
                  Reading is open; posting, voting and reporting need a Civitai account.
                </span>
                <Button onClick={() => requestSignIn()}>Sign in</Button>
              </Stack>
            </Card>
          )}

          {signedIn && identityError ? (
            <Alert color="warning" title="Your own ideas can't be identified yet">
              <Stack gap={8}>
                <span>
                  Editing and removing your ideas needs permission to read your account identity.
                </span>
                <Button
                  size="sm"
                  variant="light"
                  onClick={() => requestConsent({ scopes: ['user:read:self'] })}
                >
                  Allow
                </Button>
              </Stack>
            </Alert>
          ) : null}

          {status ? (
            <Alert color={status.tone === 'error' ? 'error' : 'info'} role="status">
              {status.text}
            </Alert>
          ) : null}
        </aside>

        <section className="board-feed" aria-label="Ideas">
          {boardError ? <Alert color="error">{boardError}</Alert> : null}
          {!boardError && !loadingBoard && items.length === 0 ? (
            <Card>
              <span className="dimmed">No ideas yet. Be the first.</span>
            </Card>
          ) : null}

          <ul className="board-grid">
            {items.map((item) => {
              const mine = myId !== null && item.authorUserId === myId;
              const data = (item.value.data ?? {}) as IdeaData;
              const isEditing = editing?.key === item.key;
              return (
                <li key={item.key} data-testid="idea">
                  <Card>
                    <Stack gap={8}>
                      {isEditing && editing ? (
                        <>
                          <TextInput
                            label="Title"
                            required
                            maxLength={TITLE_MAX}
                            value={editing.title}
                            onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                          />
                          <Textarea
                            label="Details"
                            minRows={2}
                            maxLength={BODY_MAX}
                            value={editing.body}
                            onChange={(e) => setEditing({ ...editing, body: e.target.value })}
                          />
                          <Group gap={8}>
                            <Button size="sm" onClick={saveEdit} disabled={!editing.title.trim() || busy}>
                              Save
                            </Button>
                            <Button size="sm" variant="subtle" onClick={() => setEditing(null)}>
                              Cancel
                            </Button>
                          </Group>
                        </>
                      ) : (
                        <>
                          <strong className="idea-title">{item.value.title}</strong>
                          {item.value.body ? <p className="idea-body">{item.value.body}</p> : null}
                        </>
                      )}

                      <small className="dimmed">
                        {mine ? 'you' : `user #${item.authorUserId}`} · {item.createdAt.toLocaleString()}
                        {data.editedAt ? ' · edited' : ''}
                        {data.modelId !== undefined
                          ? data.modelId === modelId
                            ? ' · from this model'
                            : ` · from model #${data.modelId}`
                          : ''}
                      </small>

                      <Group gap={8}>
                        <Button
                          size="sm"
                          variant={item.viewerVoted ? 'filled' : 'outline'}
                          aria-pressed={item.viewerVoted}
                          aria-label={`${item.viewerVoted ? 'Remove your vote' : 'Vote'} (${item.count})`}
                          disabled={!signedIn}
                          onClick={() => toggleVote(item)}
                        >
                          ▲ {item.count}
                        </Button>
                        {mine && !isEditing ? (
                          <>
                            <Button
                              size="sm"
                              variant="subtle"
                              onClick={() =>
                                setEditing({
                                  key: item.key,
                                  title: item.value.title,
                                  body: item.value.body ?? '',
                                })
                              }
                            >
                              Edit
                            </Button>
                            <Button size="sm" variant="subtle" onClick={() => withdraw(item.key)}>
                              Remove
                            </Button>
                          </>
                        ) : null}
                        {signedIn && !mine ? (
                          <ReportButton
                            noun="idea"
                            reported={reported.includes(item.key)}
                            onReport={() => report(item.key)}
                            data-testid={`report-${item.key}`}
                          />
                        ) : null}
                      </Group>
                    </Stack>
                  </Card>
                </li>
              );
            })}
          </ul>

          {cursor ? (
            <Button variant="light" onClick={() => loadBoard(cursor)} loading={loadingBoard}>
              Load more
            </Button>
          ) : null}
        </section>
      </div>
    </div>
  );
}

/**
 * Viewer copy THIS APP owns for a storage failure, with the host's own words
 * logged for the developer. Same shape as the `kv-storage` example's
 * `storageFailureMessage`; read that for the full reasoning.
 *
 * 🔴 `classifyAppStorageError` WAS WRITTEN FOR THE PER-VIEWER STORE, AND ON THE
 * SHARED ONE IT RECOGNISES ONLY THREE THINGS. The shared router throws the same
 * `app quota exceeded` / `app row limit exceeded` strings as the per-viewer one,
 * and both bridges fall back to `storage request failed`, so those three
 * classify. Everything else the shared store can refuse with lands on `null`:
 * the per-viewer post cap, the daily post/edit and per-minute vote rate limits,
 * the account-trust gate, the feature flag, a missing scope, and an anonymous
 * caller. (Its `value-too-large` arm cannot fire here: the shared store's
 * whole-value message is worded differently, and this UI's input caps keep
 * every value far below that cap anyway.)
 *
 * So the anonymous and scope cases are handled where they can be handled, not
 * by parsing: writes are only offered to a signed-in viewer (the anonymous
 * refusal is never provoked), and a missing scope is a manifest defect that the
 * dev harness refuses exactly like production. The `null` arm says what is
 * plausible and offers a reload, never "please try again".
 */
function boardFailureMessage(err: unknown, attempted: string): string {
  const raw = err instanceof Error ? err.message : String(err);
  console.warn(`[shared-board] could not ${attempted}:`, raw);
  switch (classifyAppStorageError(err)) {
    // App-wide ceilings: the board (or this app's storage) is full. Nothing the
    // viewer deletes will reliably fix it — the developer's problem.
    case 'app-quota-exceeded':
    case 'app-row-limit':
      return 'This board is full right now, so nothing new can be saved.';
    // The bridge's fallback for a failure with no message: genuinely transient.
    case 'request-failed':
      return `Could not ${attempted}. Please try again.`;
    // PER-VIEWER store only (the draft and the report list); see kv-storage.
    case 'user-row-limit':
    case 'user-quota-exceeded':
      return `Could not ${attempted}: your private storage for this app is full.`;
    case 'value-too-large':
      return `Could not ${attempted}: it is too long to save.`;
    default:
      return (
        `Could not ${attempted}. You may have reached a posting limit for your account, ` +
        'or the board may not be available to your account yet. Try reloading the page.'
      );
  }
}
