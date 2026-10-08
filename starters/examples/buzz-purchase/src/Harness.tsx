import { useEffect, useState, type ReactNode } from 'react';

import { getTransport } from '@civitai/blocks-react';
import { Harness as MockHost } from '@civitai/blocks-react/testing';
// 🔴 `/live` is the REAL backend: a submit there spends your own Buzz. It has its
// own subpath (never `/testing`) so the import line itself says so.
import { createLiveHost } from '@civitai/blocks-react/live';
import type { ModelSlotContext } from '@civitai/app-sdk/blocks';

import manifest from '../block.manifest.json' with { type: 'json' };

/**
 * Dev-only host for `npm run dev:harness` (mock) and `npm run dev:live` (real
 * backend). Never mounted in a production build — see src/main.tsx.
 *
 * Both hosts post their replies from this page's own origin, and the SDK
 * transport drops messages from any origin it was not told to trust. So the
 * transport is created HERE, before any hook runs, with this origin allowed
 * (gotcha #53) — no `.env` value has to match a port.
 */
export function installDevTransport() {
  getTransport({ allowedParentOrigins: [window.location.origin] });
}

/**
 * What the host sends a block in the `model.sidebar_top` slot. Placeholder ids:
 * for `dev:live`, put a real model's ids here.
 */
const MODEL_SLOT: ModelSlotContext = {
  slotId: 'model.sidebar_top',
  modelId: 12345,
  modelVersionId: 67890,
  modelName: 'Dev Mock Model',
  modelType: 'Checkpoint',
  modelNsfwLevel: 1,
};

/**
 * Whether the mock starts with the spend scope already granted. Default yes, so
 * the top-up demo is one click away. `?consent=0` starts WITHOUT it — the
 * "Allow generations" step, which grants on Allow; `?consent=ungrantable`
 * starts without it in a host that can never grant it (the refusal path). The
 * mock's own `?consent=granted` can only turn consent ON, which is why this
 * reads the URL itself.
 */
function startsWithConsent(): boolean {
  const consent = new URLSearchParams(window.location.search).get('consent');
  return consent !== '0' && consent !== 'ungrantable';
}

/**
 * The starting wallet: 50, or `?balance=N`. The mock reads `?balance` for the
 * balance a submit is checked against; this applies the same number to the
 * balance `useBuzzBalance` reports, which the mock keeps separately.
 */
function startingWallet(): number {
  const raw = new URLSearchParams(window.location.search).get('balance');
  const n = raw === null || raw.trim() === '' ? NaN : Number(raw);
  return Number.isFinite(n) ? n : 50;
}

export function Harness({ children }: { children: ReactNode }) {
  if (import.meta.env.VITE_LIVE_MODE === 'true') return <LiveHost>{children}</LiveHost>;
  // The SDK's mock host: no network, no Buzz. `declaredScopes` is the
  // manifest's own list, so a scope the manifest forgot fails here exactly as
  // the real host refuses it. URL knobs: `?theme=light`, `?viewer=anon`, …
  return (
    <MockHost
      declaredScopes={manifest.scopes}
      blockId={manifest.blockId}
      context={MODEL_SLOT}
      // A 120-Buzz generation against a 50-Buzz wallet: the first Generate is
      // stopped by the pre-submit wallet check, which offers a top-up; the mock
      // purchase refills the wallet and the retry lands. `?costPerGen=600` prices
      // it over the mock's 200-Buzz per-generation budget instead — no top-up.
      //
      // `?consent=0` starts at the "Allow generations" step instead (see
      // `startsWithConsent`). Note the mock prices a generation even without the
      // spend scope, which the real host refuses; the example never asks it to.
      //
      // A submit that DOES reach the mock with a short wallet is REJECTED with
      // 'exception', as in production; the app then re-reads the wallet and
      // offers the top-up only if that read shows the shortfall. The mock keeps
      // TWO balances — `buzz.balance` (what a submit is checked against) and
      // `buzzBalance` (what `useBuzzBalance` reads) — so `?balance=N` sets both
      // here, keeping the re-read truthful. `?insufficient=1&costPerGen=40`
      // forces the rejection with the wallet still reading 50: no shortfall, so
      // the app shows "Could not start" — what production shows when the
      // wallet read says there is enough.
      consentGranted={startsWithConsent()}
      generation={{ costPerGen: 120 }}
      buzz={{ balance: startingWallet() }}
      buzzBalance={{ blue: startingWallet(), green: 0, yellow: 0 }}
    >
      {children}
    </MockHost>
  );
}

/** `createLiveHost` forwards the bridge to the real API through the vite proxy. */
function LiveHost({ children }: { children: ReactNode }) {
  const token = import.meta.env.VITE_LIVE_BLOCK_TOKEN as string | undefined;
  const [installed, setInstalled] = useState(false);
  useEffect(() => {
    if (!token) return;
    // `backendBaseUrl: ''` = same origin; vite.config.ts proxies `/api`.
    const host = createLiveHost({
      blockToken: token,
      backendBaseUrl: '',
      context: MODEL_SLOT,
      fetchImpl: (input, init) => fetch(input, init), // bound: a detached `fetch` throws
    });
    const uninstall = host.install();
    setInstalled(true);
    return uninstall;
  }, [token]);
  if (!token) return <p>dev:live needs VITE_LIVE_BLOCK_TOKEN in .env.development.local (see .env.example).</p>;
  return installed ? children : null;
}
