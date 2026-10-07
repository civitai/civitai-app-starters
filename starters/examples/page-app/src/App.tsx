import { useCallback, useEffect, useState, type CSSProperties, type FormEvent } from 'react';

import {
  useAppStorage,
  useBlockAnalytics,
  useBlockBreakpoint,
  useBlockContext,
  useBlockToken,
  useCivitaiNavigate,
  useCivitaiRoute,
  useConsentUnavailable,
  useHostOrigin,
  useRequestConsent,
  useRequestSignIn,
  useViewer,
} from '@civitai/blocks-react';
import { Alert, Badge, Button, Card, Group, Stack, TextInput, Textarea } from '@civitai/blocks-react/ui';
import { classifyAppStorageError, isPageSlotContext, isSignedIn } from '@civitai/app-sdk/blocks';

import {
  BOARD_KEY,
  EMPTY_BOARD,
  MAX_LABEL,
  MAX_NOTE,
  MAX_PINS,
  parseModelId,
  parseRoute,
  readBoard,
  type Board,
  type Pin,
} from './board.js';

/**
 * page-app — a FULL-PAGE Civitai App: a "favourites board" where a viewer pins
 * the Civitai models they keep coming back to.
 *
 * What makes it a PAGE app rather than a slot block:
 *
 *  - The manifest declares `page` and no `targets`. The host mounts it at
 *    `/apps/run/<blockId>` and gives it the whole content area.
 *  - The frame is the size of that area, NOT of the content: the page host
 *    ignores `RESIZE_IFRAME`, so there is no `useBlockResize` here and the root
 *    fills the viewport (`minHeight: 100vh`) instead.
 *  - It owns a sub-path space. `useCivitaiRoute()` says which route is showing;
 *    `useCivitaiNavigate()` moves inside the app (`scope: 'app'`, the default)
 *    or out to a civitai.com page (`scope: 'site'`).
 *  - Its width runs from a phone to an ultrawide monitor, so the layout is
 *    driven by `useBlockBreakpoint()` — a container query on the frame.
 */
export function App() {
  const { ready, theme, viewer, context } = useBlockContext();
  const bp = useBlockBreakpoint();
  const route = parseRoute(useCivitaiRoute()); // read on EVERY render, never copied into state
  const { navigate } = useCivitaiNavigate();
  const { track } = useBlockAnalytics();
  const storage = useAppStorage();

  // Keep <html> in step with the host theme: BLOCK_INIT first, then every live
  // THEME_CHANGE. Gated on `ready`: before BLOCK_INIT `theme` is a placeholder.
  useEffect(() => {
    if (!ready) return;
    document.documentElement.dataset.theme = theme;
  }, [ready, theme]);

  // A SIGN-IN gate, not an identity read: `isSignedIn` only says whether there
  // is a viewer. The name comes from `useViewer()`, behind consent (AccountPanel).
  const signedIn = ready && isSignedIn(viewer);

  const [board, setBoard] = useState<Board>(EMPTY_BOARD);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // Load the board once we know who is looking. Anonymous viewers have no
  // per-viewer store (`get` answers null), so there is nothing to load.
  useEffect(() => {
    if (!ready) return;
    if (!signedIn) {
      setBoard(EMPTY_BOARD);
      setLoaded(true);
      return;
    }
    let cancelled = false;
    storage
      .get(BOARD_KEY)
      .then((value) => {
        if (cancelled) return;
        setBoard(readBoard(value));
        setLoaded(true);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setProblem(storageFailureMessage(err, 'load your board'));
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [ready, signedIn, storage]);

  /** Write the whole board, and only show it once the host has accepted it. */
  const save = useCallback(
    async (next: Board, attempted: string): Promise<boolean> => {
      setSaving(true);
      setProblem(null);
      try {
        await storage.set(BOARD_KEY, next);
        setBoard(next);
        return true;
      } catch (err) {
        setProblem(storageFailureMessage(err, attempted));
        return false;
      } finally {
        setSaving(false);
      }
    },
    [storage],
  );

  const addPin = useCallback(
    async (pin: Pin) => {
      const ok = await save({ pins: [pin, ...board.pins] }, 'save that pin');
      if (ok) track('pin_added', { modelId: pin.modelId });
      return ok;
    },
    [board, save, track],
  );

  const removePin = useCallback(
    async (modelId: number) => {
      const ok = await save({ pins: board.pins.filter((p) => p.modelId !== modelId) }, 'remove that pin');
      if (!ok) return;
      track('pin_removed', { modelId });
      // Leaving the detail page of a pin that no longer exists.
      if (route.view === 'pin' && route.modelId === modelId) navigate('');
    },
    [board, save, track, route, navigate],
  );

  const openPin = useCallback(
    (modelId: number) => {
      track('pin_opened', { modelId });
      navigate(`pin/${modelId}`); // app scope (the default): this app's own /pin/<id>
    },
    [navigate, track],
  );

  if (!ready) return <div style={{ padding: 16 }}>Loading…</div>;

  // Spacing and structure both come from the FRAME's width tier, not the device.
  const gutter = bp.atLeast('lg') ? 32 : bp.atLeast('sm') ? 24 : 12;
  const sidebar = bp.atLeast('md'); // ≥ 1024px: board beside a sticky side panel
  const slug = isPageSlotContext(context) ? context.slug : null;

  const account = <AccountPanel signedIn={signedIn} />;
  const form = signedIn ? <AddPinForm board={board} disabled={!loaded || saving} onAdd={addPin} /> : null;

  const main =
    route.view === 'pin' ? (
      <PinDetail
        pin={board.pins.find((p) => p.modelId === route.modelId) ?? null}
        loaded={loaded}
        slug={slug}
        wide={bp.atLeast('sm')}
        saving={saving}
        onBack={() => navigate('')}
        onRemove={removePin}
      />
    ) : route.view === 'missing' ? (
      <Card>
        <Stack gap={8}>
          <strong>Nothing here</strong>
          <Group>
            <Button variant="light" onClick={() => navigate('')}>
              Back to the board
            </Button>
          </Group>
        </Stack>
      </Card>
    ) : (
      <BoardGrid board={board} loaded={loaded} signedIn={signedIn} saving={saving} onOpen={openPin} onRemove={removePin} />
    );

  return (
    <div
      data-theme={theme}
      data-tier={bp.tier}
      style={{ boxSizing: 'border-box', width: '100%', minHeight: '100vh', padding: gutter }}
    >
      <Stack gap={gutter}>
        <header style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 8 }}>
          <h1 style={{ margin: 0, fontSize: bp.atLeast('sm') ? 28 : 22 }}>Favourites Board</h1>
          <span style={dimmed}>
            {board.pins.length} / {MAX_PINS} pinned
          </span>
        </header>

        {problem ? (
          <Alert color="error" withCloseButton onClose={() => setProblem(null)}>
            {problem}
          </Alert>
        ) : null}

        {sidebar ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 340px', gap: gutter, alignItems: 'start' }}>
            <div>{main}</div>
            <aside style={{ position: 'sticky', top: gutter }}>
              <Stack gap={16}>
                {account}
                {form}
              </Stack>
            </aside>
          </div>
        ) : (
          // Narrow (a phone, a split screen): one column, and the pins come
          // BEFORE the form, so the board is what a viewer sees first.
          <Stack gap={gutter}>
            {account}
            {main}
            {form}
          </Stack>
        )}
      </Stack>
    </div>
  );
}

/**
 * Who is looking, and the two host prompts a page app uses to change that:
 *
 *  - ANONYMOUS → `useRequestSignIn()`: the host opens civitai.com's login.
 *  - SIGNED IN, NAME NOT SHARED → `useRequestConsent()` for `user:read:self`.
 *    The real mint WITHHOLDS a consent-gated scope until the viewer grants it,
 *    so the first token lacks it, and `useViewer()` would be refused
 *    ("block lacks user:read:self scope"). So the name is asked for on a click,
 *    and `useViewer()` is only MOUNTED once the token carries the scope.
 *  - REFUSED → `useConsentUnavailable()`: the host's push saying this scope can
 *    NEVER be granted here, so the panel stops telling the viewer to retry.
 */
function AccountPanel({ signedIn }: { signedIn: boolean }) {
  const { requestSignIn } = useRequestSignIn();
  const { requestConsent } = useRequestConsent();
  const { refusal, reset } = useConsentUnavailable();
  const { scopes } = useBlockToken();
  const { track } = useBlockAnalytics();
  const [asked, setAsked] = useState(false);

  if (!signedIn) {
    return (
      <Card>
        <Stack gap={8}>
          <strong>Start your board</strong>
          <span style={dimmed}>Sign in to pin models. Your board is private to you.</span>
          <Group>
            <Button
              onClick={() => {
                track('sign_in_clicked');
                // No `returnUrl`: the host returns the viewer to this page.
                requestSignIn();
              }}
            >
              Sign in
            </Button>
          </Group>
        </Stack>
      </Card>
    );
  }

  if (scopes.includes('user:read:self')) return <ViewerName />;

  if (refusal) {
    return (
      <Card>
        <Stack gap={8}>
          <span style={dimmed}>Your Civitai name can't be shown in this app here. Your board still works.</span>
          <Group>
            <Button
              variant="subtle"
              size="sm"
              onClick={() => {
                reset();
                setAsked(false);
              }}
            >
              OK
            </Button>
          </Group>
        </Stack>
      </Card>
    );
  }

  return (
    <Card>
      <Stack gap={8}>
        <span style={dimmed}>
          {asked
            ? 'Confirm in the Civitai dialog. If you closed it, click again.'
            : 'Signed in. Show your Civitai name on your board?'}
        </span>
        <Group>
          <Button
            variant="light"
            size="sm"
            onClick={() => {
              setAsked(true);
              track('name_consent_requested');
              // 🔴 Name the scope. With no `scopes` hint the host cannot prove a
              // refusal, so it stays silent and `refusal` never arrives.
              requestConsent({ scopes: ['user:read:self'] });
            }}
          >
            Show my name
          </Button>
        </Group>
      </Stack>
    </Card>
  );
}

/** Mounted only once the token carries `user:read:self` (see AccountPanel). */
function ViewerName() {
  // Named `me`, not `viewer`: this is the consented `useViewer()` read, not the
  // BLOCK_INIT `viewer` that only `isSignedIn()` may gate on.
  const { viewer: me, loading, error, refetch } = useViewer();
  return (
    <Card>
      {loading ? (
        <span style={dimmed}>Loading your profile…</span>
      ) : error || !me ? (
        <Group justify="space-between">
          <span style={dimmed}>Couldn't load your name.</span>
          <Button variant="subtle" size="sm" onClick={refetch}>
            Retry
          </Button>
        </Group>
      ) : (
        <Group justify="space-between" wrap>
          <span>
            Signed in as <strong>@{me.username ?? `user ${me.id}`}</strong>
          </span>
          {me.status === 'muted' ? <Badge color="warning">muted</Badge> : null}
        </Group>
      )}
    </Card>
  );
}

function AddPinForm({
  board,
  disabled,
  onAdd,
}: {
  board: Board;
  disabled: boolean;
  onAdd: (pin: Pin) => Promise<boolean>;
}) {
  const [source, setSource] = useState('');
  const [label, setLabel] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const modelId = parseModelId(source);
    if (modelId == null) return setError('Paste a civitai.com model link or a model id.');
    if (board.pins.some((p) => p.modelId === modelId)) return setError('That model is already on your board.');
    if (board.pins.length >= MAX_PINS) return setError(`Your board holds ${MAX_PINS} pins. Remove one first.`);
    setError(null);
    const ok = await onAdd({
      modelId,
      label: label.trim().slice(0, MAX_LABEL) || `Model ${modelId}`,
      note: note.trim().slice(0, MAX_NOTE),
      addedAt: Date.now(),
    });
    if (ok) {
      setSource('');
      setLabel('');
      setNote('');
    }
  };

  return (
    <Card>
      <form onSubmit={submit}>
        <Stack gap={8}>
          <strong>Pin a model</strong>
          <TextInput
            label="Model link or id"
            placeholder="https://civitai.com/models/…"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            error={error ?? undefined}
          />
          <TextInput label="Label" maxLength={MAX_LABEL} value={label} onChange={(e) => setLabel(e.target.value)} />
          <Textarea
            label="Why you like it"
            maxLength={MAX_NOTE}
            minRows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <Group>
            <Button type="submit" disabled={disabled}>
              Pin it
            </Button>
          </Group>
        </Stack>
      </form>
    </Card>
  );
}

function BoardGrid({
  board,
  loaded,
  signedIn,
  saving,
  onOpen,
  onRemove,
}: {
  board: Board;
  loaded: boolean;
  signedIn: boolean;
  saving: boolean;
  onOpen: (modelId: number) => void;
  onRemove: (modelId: number) => void;
}) {
  if (!loaded) return <span style={dimmed}>Loading your board…</span>;
  if (board.pins.length === 0) {
    return (
      <Card>
        <span style={dimmed}>
          {signedIn ? 'Nothing pinned yet. Paste a model link to start.' : 'Pinned models show up here.'}
        </span>
      </Card>
    );
  }
  return (
    // Fills whatever width the frame has: one column on a phone, many on an
    // ultrawide. `min(100%, 240px)` keeps a 240px card from overflowing a
    // frame narrower than that.
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 240px), 1fr))',
        gap: 16,
      }}
    >
      {board.pins.map((pin) => (
        <Card key={pin.modelId} aria-label={pin.label}>
          <Stack gap={8} style={{ height: '100%' }}>
            <strong>{pin.label}</strong>
            <span style={dimmed}>Model #{pin.modelId}</span>
            {pin.note ? <span style={{ flex: 1 }}>{pin.note}</span> : <span style={{ flex: 1 }} />}
            <Group gap={8}>
              <Button size="sm" variant="light" onClick={() => onOpen(pin.modelId)}>
                Details
              </Button>
              <Button size="sm" variant="subtle" disabled={saving} onClick={() => onRemove(pin.modelId)}>
                Remove
              </Button>
            </Group>
          </Stack>
        </Card>
      ))}
    </div>
  );
}

function PinDetail({
  pin,
  loaded,
  slug,
  wide,
  saving,
  onBack,
  onRemove,
}: {
  pin: Pin | null;
  loaded: boolean;
  slug: string | null;
  wide: boolean;
  saving: boolean;
  onBack: () => void;
  onRemove: (modelId: number) => void;
}) {
  const { navigate } = useCivitaiNavigate();
  const { track } = useBlockAnalytics();
  // The VALIDATED host origin (it passed the transport's allowlist at
  // BLOCK_INIT) — never `document.referrer` or a guess. civitai.com, or
  // civitai.red, whichever the viewer is on.
  const hostOrigin = useHostOrigin();

  const back = (
    <Group>
      <Button variant="subtle" size="sm" onClick={onBack}>
        ← Back to the board
      </Button>
    </Group>
  );

  if (!loaded) return <span style={dimmed}>Loading…</span>;
  if (!pin) {
    return (
      <Stack gap={8}>
        {back}
        <Card>That pin isn't on your board.</Card>
      </Stack>
    );
  }

  const openOnCivitai = (target: 'current' | 'new_tab') => {
    track('open_on_civitai', { modelId: pin.modelId, target });
    // `scope: 'site'` resolves at the civitai.com root and LEAVES the app. Without
    // it this would be a request for this app's own `/models/<id>`.
    navigate(`models/${pin.modelId}`, { scope: 'site', target });
  };

  // A link a viewer can paste to come straight back to this pin. The page host
  // serves page apps at /apps/run/<slug>/<subPath>.
  const shareLink = hostOrigin && slug ? `${hostOrigin}/apps/run/${slug}/pin/${pin.modelId}` : null;

  const info = (
    <Card>
      <Stack gap={8}>
        <h2 style={{ margin: 0, fontSize: 22 }}>{pin.label}</h2>
        <span style={dimmed}>
          Model #{pin.modelId} · pinned {new Date(pin.addedAt).toLocaleDateString()}
        </span>
        {pin.note ? <p style={{ margin: 0 }}>{pin.note}</p> : null}
      </Stack>
    </Card>
  );

  const actions = (
    <Card>
      <Stack gap={8}>
        <Button onClick={() => openOnCivitai('current')}>Open on Civitai</Button>
        <Button variant="light" onClick={() => openOnCivitai('new_tab')}>
          Open in a new tab
        </Button>
        {shareLink ? (
          <TextInput
            label="Link to this pin"
            readOnly
            value={shareLink}
            onFocus={(e) => e.currentTarget.select()}
          />
        ) : null}
        <Button variant="subtle" color="error" disabled={saving} onClick={() => onRemove(pin.modelId)}>
          Remove from board
        </Button>
      </Stack>
    </Card>
  );

  return (
    <Stack gap={12}>
      {back}
      {wide ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(240px, 1fr)', gap: 16, alignItems: 'start' }}>
          {info}
          {actions}
        </div>
      ) : (
        <Stack gap={12}>
          {info}
          {actions}
        </Stack>
      )}
    </Stack>
  );
}

/**
 * Viewer copy THIS APP owns for a storage failure; the host's own words go to
 * the console, never to the screen (they are server prose, not copy). Branches
 * on `classifyAppStorageError`, never on the message. The full reasoning for
 * each arm is in the kv-storage example.
 */
function storageFailureMessage(err: unknown, attempted: string): string {
  console.warn(`[page-app] could not ${attempted}:`, err instanceof Error ? err.message : err);
  switch (classifyAppStorageError(err)) {
    case 'value-too-large':
      return 'Your board is too big to save. Remove a pin or shorten a note.';
    case 'user-row-limit':
    case 'user-quota-exceeded':
      return 'Your storage for this app is full. Remove a pin to make room.';
    case 'app-quota-exceeded':
    case 'app-row-limit':
      return 'This app is out of storage space. Saving is unavailable right now.';
    case 'request-failed':
      return `Could not ${attempted}. Please try again.`;
    default:
      // Unrecognised: an expired token, a missing storage scope, … — retrying
      // fixes none of them, so promise no remedy. Reloading re-mints the token.
      return `Could not ${attempted}. Saving may be unavailable here; reloading the page can help.`;
  }
}

const dimmed: CSSProperties = { color: 'var(--civitai-color-text-dimmed)' };
