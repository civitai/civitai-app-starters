import { useEffect, useRef, useState, type ReactNode } from 'react';

import { createLiveHost } from '@civitai/blocks-react/testing';

/**
 * LIVE development harness — the real-backend sibling of {@link Harness}.
 *
 * Where `Harness` mocks every host reply locally (no network, no real Buzz),
 * this mounts `createLiveHost` from the SDK, which FORWARDS the App-Block
 * postMessage protocol to the REAL Civitai backend using a short-lived, pasted
 * DEV block token. `pnpm dev:live` flips this on. It lets you run your local
 * block code against real compute / real Buzz / the real catalog.
 *
 * ⚠️ REAL MONEY. A successful generation SPENDS YOUR OWN real Buzz. The dev
 * token's per-call budget + the per-user daily cap bound it server-side, but
 * this is not a sandbox.
 *
 * SETUP (see .env.example):
 *  1. Mint a dev token: `POST /api/v1/blocks/dev-token` with a personal API key
 *     (Bearer) and `{ "appBlockId": "<your approved app>" }` — mod-gated, pre-GA.
 *  2. Put the returned JWT in `VITE_LIVE_BLOCK_TOKEN` (it expires in ~15min;
 *     re-mint + restart when it does).
 *  3. Set `VITE_BLOCK_ALLOWED_PARENT_ORIGINS=http://localhost:5173` so the
 *     transport accepts the host replies (the live host fires from your own
 *     origin, same as the mock host).
 *  4. `pnpm dev:live`.
 *
 * SECURITY: `VITE_`-prefixed vars are BUNDLED into the client JS. Only ever put
 * a SHORT-LIVED pasted TOKEN here — NEVER an API key. (A dev-proxy that holds
 * the API key server-side and auto-mints is a future follow-up; scope doc §5.1.)
 *
 * Live v1 does NOT support pickers / app-storage / in-band Buzz purchase — those
 * reply with a clearly-labelled "not supported in live v1" outcome. Use
 * `pnpm dev:harness` (mock mode) for those flows.
 */
export function LiveHarness({ children }: { children: ReactNode }) {
  const [outbound, setOutbound] = useState<Array<{ type: string; payload?: unknown }>>([]);
  const [parentOrigin] = useState(() => window.location.origin);
  const blockToken = import.meta.env.VITE_LIVE_BLOCK_TOKEN as string | undefined;
  const backendBaseUrl = import.meta.env.VITE_LIVE_BACKEND_URL as string | undefined;
  // Snapshot once so the effect identity is stable (no re-install per render).
  const tokenRef = useRef(blockToken);

  useEffect(() => {
    if (!tokenRef.current) {
      // eslint-disable-next-line no-console
      console.error(
        '[LiveHarness] VITE_LIVE_BLOCK_TOKEN is not set. Mint a dev token via ' +
          'POST /api/v1/blocks/dev-token and set it in .env (see .env.example).',
      );
      return;
    }
    const host = createLiveHost({
      blockToken: tokenRef.current,
      ...(backendBaseUrl ? { backendBaseUrl } : {}),
      onOutbound: (msg) => {
        if (msg.type === 'RESIZE_IFRAME') return; // noise
        setOutbound((prev) => [...prev, msg]);
      },
    });
    return host.install();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backendBaseUrl]);

  const hasToken = !!tokenRef.current;

  return (
    <div style={{ display: 'grid', gridTemplateRows: 'auto 1fr auto', minHeight: '100vh' }}>
      <header
        style={{
          padding: '8px 12px',
          background: hasToken ? '#3b1f1f' : '#5a1010',
          color: '#fff',
          fontSize: 12,
          fontFamily: 'ui-monospace, SFMono-Regular, monospace',
          display: 'flex',
          gap: 16,
          alignItems: 'center',
        }}
      >
        <strong>LIVE HARNESS</strong>
        <span>
          {hasToken
            ? `forwarding to ${backendBaseUrl ?? 'https://civitai.com'} · REAL Buzz`
            : '⚠ no VITE_LIVE_BLOCK_TOKEN — see .env.example'}
        </span>
        <span style={{ marginLeft: 'auto' }}>outbound: {outbound.length}</span>
      </header>
      <main style={{ border: '1px dashed #888', margin: 16 }}>{children}</main>
      <pre
        style={{
          margin: 0,
          padding: 12,
          background: '#111',
          color: '#fc7',
          fontSize: 11,
          maxHeight: 240,
          overflow: 'auto',
        }}
      >
        {outbound.length === 0
          ? '// no outbound messages yet'
          : outbound
              .map((m, i) => `${i + 1}. ${m.type} ${JSON.stringify(m.payload ?? {})}`)
              .join('\n')}
      </pre>
    </div>
  );
}
