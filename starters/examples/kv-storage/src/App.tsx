import { useCallback, useEffect, useRef, useState } from 'react';

import { useAppStorage, useBlockContext, useBlockResize } from '@civitai/blocks-react';
import { Button, Card, Group, Stack, TextInput, Textarea } from '@civitai/blocks-react/ui';
import type { AppStorageKeyEntry, AppStorageQuota } from '@civitai/blocks-react';
import { classifyAppStorageError, isSignedIn } from '@civitai/app-sdk/blocks';

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
 * 🔴 STORAGE IS A DECLARED SCOPE, NOT AMBIENT. The host gates every call by
 * PRESENCE in the block's approved scope set: `get` / `list` / `getQuota` need
 * `apps:storage:read`, `set` / `delete` need `apps:storage:write`. This
 * example's `block.manifest.json` declares both (with justifications); drop
 * one and every matching call is refused — in production, and in the local
 * harness too, which reads its `declaredScopes` from the same manifest. Anon
 * viewers: `get`/`list` no-op (null / empty), writes reject.
 *
 * This example is a tiny notes pad backed by KV.
 */
export function App() {
  const { ready, viewer, theme } = useBlockContext();
  const storage = useAppStorage();
  const rootRef = useRef<HTMLDivElement>(null);
  useBlockResize(rootRef);

  // Keep <html> in step with the host theme (see hello-world for the why).
  useEffect(() => {
    if (!ready) return;
    document.documentElement.dataset.theme = theme;
  }, [ready, theme]);

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

  if (!ready) return <div style={{ padding: 16 }}>Loading…</div>;

  if (isAnon) {
    return (
      <div ref={rootRef} data-theme={theme} style={{ padding: 16 }}>
        <Stack gap={8}>
          <strong>Notes</strong>
          <Card>Sign in to save notes — storage is per-viewer.</Card>
        </Stack>
      </div>
    );
  }

  return (
    <div ref={rootRef} data-theme={theme} style={{ padding: 16 }}>
      <Stack gap={8}>
        <strong>Notes (KV-backed)</strong>

        <Card>
          <Stack gap={8}>
            <TextInput label="Key" value={draftKey} onChange={(e) => setDraftKey(e.target.value)} />
            <Textarea label="Note" minRows={3} value={draftValue} onChange={(e) => setDraftValue(e.target.value)} />
            <Button onClick={save}>set()</Button>
          </Stack>
        </Card>

        <Card>
          <Stack gap={4}>
            <strong>list({`{ prefix: 'note-' }`})</strong>
            {keys.length === 0 ? (
              <small style={dimmed}>no notes yet</small>
            ) : (
              keys.map((k) => (
                <Group key={k.key} gap={8} wrap={false}>
                  <code style={{ flex: 1 }}>{k.key}</code>
                  <small style={dimmed}>{k.updatedAt.toLocaleString()}</small>
                  <Button variant="subtle" size="sm" onClick={() => load(k.key)}>
                    get
                  </Button>
                  <Button variant="subtle" size="sm" onClick={() => remove(k.key)}>
                    delete
                  </Button>
                </Group>
              ))
            )}
          </Stack>
        </Card>

        {quota ? (
          <small style={dimmed}>
            {fmtBytes(quota.usedBytes)} of {fmtBytes(quota.limitBytes)} used · {quota.rowCount} /{' '}
            {quota.limitRows} rows
          </small>
        ) : null}

        {status ? <small role="status">{status}</small> : null}
      </Stack>
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
 * 🔴 **DO NOT SPELL A HOST STRING HERE, AND DO NOT INVENT ONE.**
 * `classifyAppStorageError` is the single matcher; the strings it matches are
 * measured against the host and live in `@civitai/app-sdk/blocks`, where
 * `createMockHost` and this example's harness also read them. That is what
 * makes an arm that DOES fire under `dev:harness` fire on the same rejection in
 * production — the property this function did not have until #343. It is NOT a
 * claim that every arm is reachable locally: this harness reaches three of the
 * six reasons (see the README's table), and the `default:` arm none at all.
 *
 * What it looked like when it did not: the one arm tested
 * `/payload_too_large/i`, which is the TRPC *code*. The bridge forwards the
 * *message*, so the arm matched the mock's fiction and nothing the host sends.
 * Locally the viewer got actionable copy; live, every rejection — not one of
 * which retrying can fix — fell through to "Please try again."
 *
 * 🔴 **KEEP THE `default` ARM GENERIC — AND DO NOT WRITE "please try again" IN
 * IT.** `classifyAppStorageError` answers `null` for a string it does not
 * recognise, and that is a REAL outcome with three very different causes. One
 * is a reworded or newly-added ceiling message that an older SDK has not seen.
 * The second — the common one in production — is an AUTHORIZATION failure: the
 * host's bridge catches every rejection out of `apps.storage.*` with a blanket
 * `catch` and forwards its message on this same field, so an expired block
 * token (`invalid block token`), a revoked instance, an unapproved block and a
 * missing `apps:storage:write` scope all land on `null` too — that list is
 * ILLUSTRATIVE, not a bound on the bucket. The third is a zod INPUT rejection,
 * which never reaches a handler at all: the host caps `key` at 200 characters
 * and nothing in this repo caps it, so a key built from a URL or a title saves
 * fine in this harness and fails forever in production
 * (civitai/civitai-app-starters#370).
 *
 * Retrying fixes none of those, so the arm below offers a RELOAD (which
 * re-mints the token, and also covers a genuine transport blip) and concedes
 * that saving may simply be unavailable. `'request-failed'` is split out above
 * it precisely because that reason IS the transport one, and is the only place
 * honest retry copy belongs.
 *
 * Copy the SHAPE of this function: own your viewer copy, log the host's words,
 * never render them, and branch on the classification rather than on prose.
 */
function storageFailureMessage(err: unknown, attempted: string): string {
  const raw = err instanceof Error ? err.message : String(err);
  console.warn(`[kv-storage] could not ${attempted}:`, raw);
  switch (classifyAppStorageError(err)) {
    // The value itself is too big. Nothing to delete — the note has to shrink.
    case 'value-too-large':
      return 'That note is too long to save. Try shortening it.';
    // Out of ROWS, not bytes: the ceiling a notes app hits first, and the one
    // a bytes-only "x of y used" readout gives no warning about. Deleting any
    // note frees a slot, however small it is.
    case 'user-row-limit':
      return 'You have no note slots left. Delete a note to make room.';
    // Out of BYTES. Same remedy, different explanation — and here the SIZE of
    // what gets deleted is what matters, so say so.
    case 'user-quota-exceeded':
      return 'Your notes have filled your storage. Delete a long one to make room.';
    // App-wide ceilings. The viewer is not over any limit of their own and
    // deleting their notes will not reliably help; this is the developer's
    // problem, so do not send the viewer on an errand that cannot work.
    case 'app-quota-exceeded':
    case 'app-row-limit':
      return 'This app is out of storage space. Saving is unavailable right now.';
    // The BRIDGE's fallback, for a failure that carried no message of its own
    // — a transport fault, a non-`Error` throw. This one really is transient,
    // so this is the one arm where "try again" is honest advice.
    case 'request-failed':
      return `Could not ${attempted}. Please try again.`;
    // `null` — the classifier did not recognise the message. NOT a synonym for
    // "transient": an expired block token, a revoked instance, an unapproved
    // block or a missing storage scope all arrive here (the host's bridge
    // forwards every `apps.storage.*` rejection on the same field), and so do
    // a ceiling message this SDK version predates and a zod input rejection
    // such as the host's 200-character `key` cap. A reload re-mints the token,
    // so it fixes the token cases and retries a transport blip; it does
    // nothing for a key that is too long, which fails identically every time.
    // No one line of advice is right for every `null`, which is why the copy
    // below hedges instead of promising a remedy.
    default:
      // `attempted` covers loads as well as saves, so the copy says "storage",
      // not "saving".
      return `Could not ${attempted}. Try reloading the page — if that does not help, storage may be unavailable for this app right now.`;
  }
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const dimmed = { color: 'var(--civitai-color-text-dimmed)' } as const;
