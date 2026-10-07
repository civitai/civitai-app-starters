import { useCallback, useEffect, useRef, useState } from 'react';

import { useBlockContext, useBlockResize, useBlockToken, useHostOrigin } from '@civitai/blocks-react';
import { Button, Card, Stack } from '@civitai/blocks-react/ui';

import manifest from '../block.manifest.json' with { type: 'json' };

/**
 * scopes-api — declare scopes + call scope-gated REST endpoints.
 *
 * Some things a block needs aren't on the postMessage bridge — they're plain
 * Civitai REST endpoints, gated by the scopes in the block's JWT. The block
 * calls them directly with that token in an Authorization header.
 *
 *  1. Declare the scopes you need in `block.manifest.json` (`scopes: [...]`).
 *     A moderator sees them at review; the issued JWT carries the granted
 *     intersection.
 *  2. Read the raw JWT with `useBlockToken().raw` (it auto-refreshes; after a
 *     401 call `refresh()`, which resolves WITH the new token, and retry once
 *     using that resolved `raw` — not the one your closure captured).
 *  3. Send it to `useHostOrigin()` — the origin that passed the SDK's
 *     allowlist, never a hard-coded host or anything read off the parent page.
 *     The token is a bearer credential; it goes only to the origin that sent it.
 *
 * `/api/v1/blocks/me` is the who-am-i. It needs `user:read:self` and 403s
 * without it. In a real block that only wants the viewer, prefer `useViewer()`:
 * the same `{ id, username, status, buzzBudget }` body over the host bridge,
 * with no fetch of your own. This example fetches to show the REST pattern.
 *
 * Locally: under `dev:harness` the mock token is not a real RS256 JWT, so the
 * call answers 401. Under `dev:live` (a real dev token) it returns real data.
 */
export function App() {
  const { ready, theme, token } = useBlockContext();
  const { raw, refresh } = useBlockToken();
  const hostOrigin = useHostOrigin(); // undefined until BLOCK_INIT
  const rootRef = useRef<HTMLDivElement>(null);
  useBlockResize(rootRef);

  const [result, setResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Keep <html> in step with the host theme (see hello-world for the why).
  useEffect(() => {
    if (!ready) return;
    document.documentElement.dataset.theme = theme;
  }, [ready, theme]);

  const callBlocksMe = useCallback(async () => {
    if (!hostOrigin) return;
    setLoading(true);
    setResult(null);
    const doFetch = (jwt: string) =>
      fetch(`${hostOrigin}/api/v1/blocks/me`, { headers: { Authorization: `Bearer ${jwt}` } });
    try {
      let res = await doFetch(raw);
      if (res.status === 401) {
        // Token may have just rotated — force a fresh mint and retry once.
        //
        // 🔴 RETRY WITH THE RESOLVED TOKEN. `refresh()` resolves WITH the new
        // `BlockToken`; use `fresh.raw`, NOT the `raw` destructured above, which
        // this callback captured before the refresh and cannot see change.
        const fresh = await refresh();
        res = await doFetch(fresh.raw);
      }
      // 🔴 DELIBERATE, AND DELIBERATELY NOT A PRODUCT PATTERN. Showing the raw
      // status + body IS this example's point — a developer probe rendered into
      // a <pre>. Don't copy it into a block viewers see: an API body is
      // server-authored and unsanitised; every other example here logs server
      // text and shows copy the app owns.
      const body = await res.text();
      setResult(`${res.status} ${res.statusText}\n${body}`);
    } catch (err) {
      setResult(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [hostOrigin, raw, refresh]);

  if (!ready) return <div style={{ padding: 16 }}>Loading…</div>;

  return (
    <div ref={rootRef} data-theme={theme} style={{ padding: 16 }}>
      <Stack gap={8}>
        <strong>Scopes + REST API</strong>

        <Card>
          <strong>Declared scopes (manifest)</strong>
          <div>
            <code>{manifest.scopes.join(', ')}</code>
          </div>
        </Card>

        <Card>
          <strong>Granted scopes (this JWT)</strong>
          <div>
            <code>{token.scopes.join(', ') || '(none)'}</code>
          </div>
          <small style={dimmed}>
            The issued token carries the granted intersection of what you declared and what the user
            consented to.
          </small>
        </Card>

        <div>
          <Button onClick={callBlocksMe} loading={loading} disabled={!hostOrigin}>
            GET /api/v1/blocks/me
          </Button>
        </div>

        {result ? <pre style={preStyle}>{result}</pre> : null}

        <small style={dimmed}>
          Under <code>dev:harness</code> this answers 401: the mock token is not a real JWT. Run{' '}
          <code>dev:live</code> with a dev token to see real data.
        </small>
      </Stack>
    </div>
  );
}

const dimmed = { color: 'var(--civitai-color-text-dimmed)' } as const;

const preStyle = {
  margin: 0,
  padding: 8,
  borderRadius: 'var(--civitai-radius)',
  background: 'var(--civitai-color-surface)',
  fontFamily: 'var(--civitai-font-mono)',
  fontSize: 12,
  whiteSpace: 'pre-wrap',
  overflow: 'auto',
} as const;
