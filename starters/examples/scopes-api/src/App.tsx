import { useCallback, useRef, useState } from 'react';

import { useBlockContext, useBlockResize, useBlockToken } from '@civitai/blocks-react';

import manifest from '../block.manifest.json' with { type: 'json' };

/**
 * scopes-api — declare scopes + call scope-gated REST endpoints.
 *
 * Some things a block needs aren't on the postMessage bridge — they're plain
 * civitai.com REST endpoints, gated by the scopes in the block's JWT. The
 * block calls them directly with the BLOCK_INIT token in an Authorization
 * header.
 *
 *  1. Declare the scopes you need in `block.manifest.json` (`scopes: [...]`).
 *     A moderator sees them at review; the issued JWT carries the granted
 *     intersection.
 *  2. Read the raw JWT with `useBlockToken().raw` (it auto-refreshes; after a
 *     401 call `refresh()`, which resolves WITH the new token, and retry once
 *     using that resolved `raw` — not the one your closure captured).
 *  3. `fetch('https://civitai.com/api/v1/blocks/me', { headers: { Authorization:
 *     `Bearer ${raw}` } })`.
 *
 * `/api/v1/blocks/me` is the authoritative who-am-i (the BLOCK_INIT viewer is a
 * coarse hint). It returns only what your granted scopes allow.
 *
 * NOTE: a successful call needs a REAL RS256 block JWT — the dev harness mints
 * a mock token, so the live call will 401 locally. The example shows the exact
 * request shape and the 401-refresh-retry pattern; run it against a deployed
 * block to see real data.
 */

const API_BASE = 'https://civitai.com';

export function App() {
  const { ready, theme, token } = useBlockContext();
  const { raw, refresh } = useBlockToken();
  const rootRef = useRef<HTMLDivElement>(null);
  useBlockResize(rootRef);

  const [result, setResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const callBlocksMe = useCallback(async () => {
    setLoading(true);
    setResult(null);
    const doFetch = (jwt: string) =>
      fetch(`${API_BASE}/api/v1/blocks/me`, {
        headers: { Authorization: `Bearer ${jwt}` },
      });
    try {
      let res = await doFetch(raw);
      if (res.status === 401) {
        // Token may have just rotated — force a fresh mint and retry once.
        //
        // 🔴 RETRY WITH THE RESOLVED TOKEN. `refresh()` resolves WITH the new
        // `BlockToken`; use `fresh.raw`, NOT the `raw` destructured above. That
        // `raw` is a const captured by this callback's closure before the
        // refresh, and awaiting cannot reassign it — re-reading it here would
        // re-send the stale JWT and 401 again for the same reason.
        const fresh = await refresh();
        res = await doFetch(fresh.raw);
      }
      // 🔴 DELIBERATE, AND DELIBERATELY NOT A PRODUCT PATTERN. Showing the raw
      // status + response body IS this example's whole point — it is a developer
      // probe for "what does /blocks/me actually answer for my token", rendered
      // into a <pre> for a developer to read.
      //
      // DO NOT copy this shape into a block that ships to viewers. An API body is
      // server-authored and unsanitised; every other example here routes server
      // text to `console` and shows copy the app owns (see `buzz-workflow`'s
      // `describeFailure` and `kv-storage`'s `storageFailureMessage`).
      const body = await res.text();
      setResult(`${res.status} ${res.statusText}\n${body}`);
    } catch (err) {
      setResult(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [raw, refresh]);

  if (!ready) {
    // No `rootRef` here: the host shows its own loading state until BLOCK_READY,
    // and `useBlockResize` observes the real root whenever it mounts.
    return (
      <div data-theme={theme} className="hw-root">
        Loading…
      </div>
    );
  }

  return (
    <div ref={rootRef} data-theme={theme} className="hw-root">
      <strong>Scopes + REST API</strong>

      <div className="hw-card">
        <div style={{ fontWeight: 600 }}>Declared scopes (manifest)</div>
        <code>{manifest.scopes.join(', ')}</code>
      </div>

      <div className="hw-card">
        <div style={{ fontWeight: 600 }}>Granted scopes (this JWT)</div>
        <code>{token.scopes.join(', ') || '(none)'}</code>
        <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
          The issued token carries the granted intersection of what you declared
          and what the user consented to.
        </div>
      </div>

      <button onClick={callBlocksMe} disabled={loading} style={buttonStyle}>
        {loading ? 'calling…' : 'GET /api/v1/blocks/me'}
      </button>

      {result ? <pre style={preStyle}>{result}</pre> : null}

      <div style={{ fontSize: 12, opacity: 0.7 }}>
        Locally this returns 401 — the harness token is a mock, not a real RS256
        JWT. Deploy the block to see real data.
      </div>
    </div>
  );
}

const buttonStyle = {
  padding: '8px 14px',
  border: 'none',
  borderRadius: 6,
  background: '#1971c2',
  color: '#fff',
  fontWeight: 600,
  cursor: 'pointer',
  alignSelf: 'flex-start',
} as const;

const preStyle = {
  margin: 0,
  padding: 8,
  borderRadius: 6,
  background: 'rgba(127,127,127,0.12)',
  fontSize: 12,
  whiteSpace: 'pre-wrap',
  overflow: 'auto',
} as const;
