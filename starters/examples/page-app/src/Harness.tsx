import { useEffect, useState, type ReactNode } from 'react';

import { getTransport } from '@civitai/blocks-react';
import { Harness as MockHost } from '@civitai/blocks-react/testing';
// 🔴 `/live` is the REAL backend. This app spends no Buzz, but it does read and
// write YOUR real per-viewer storage there. It has its own subpath (never
// `/testing`) so the import line itself says so.
import { createLiveHost } from '@civitai/blocks-react/live';

import manifest from '../block.manifest.json' with { type: 'json' };
import { BOARD_KEY, type Board } from './board.js';

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
 * A starting board, so the page has something on it the first time you open it.
 * Placeholder ids and labels: "Open on Civitai" goes wherever the id points.
 */
const SEED_BOARD: Board = {
  pins: [
    { modelId: 4201, label: 'Portrait checkpoint', note: 'Good skin texture at low CFG.', addedAt: 1759700000000 },
    { modelId: 133005, label: 'Go-to SDXL base', note: '', addedAt: 1759710000000 },
    { modelId: 7240, label: 'Watercolour LoRA', note: 'Weight 0.6 is plenty.', addedAt: 1759720000000 },
  ],
};

export function Harness({ children }: { children: ReactNode }) {
  if (import.meta.env.VITE_LIVE_MODE === 'true') return <LiveHost>{children}</LiveHost>;
  // The SDK's mock host: no network, no Buzz. Its default `context` is already a
  // complete PAGE slot (`slotId: 'app.page'`, `slug`, `subPath: ''`, viewer
  // ids), which is what this app runs in, so none is passed.
  //
  // `declaredScopes` is the manifest's own list: drop `apps:storage:read` or
  // `apps:storage:write` from block.manifest.json and every load or save is
  // refused here, as the real host refuses it.
  //
  // URL knobs: `?viewer=anon` (the sign-in path), `?theme=light`,
  // `?consent=ungrantable` (the CONSENT_UNAVAILABLE path). URL wins over props.
  return (
    <MockHost
      declaredScopes={manifest.scopes}
      blockId={manifest.blockId}
      storage={{ seed: { [BOARD_KEY]: SEED_BOARD } }}
      // 🔴 MOCK DIVERGENCE #1 — consent. The stock mock GRANTS any known scope a
      // block names in `requestConsent({ scopes })`, declared or not. The real
      // page host grants only the consent-gated scopes the MINT found missing,
      // and those come from the approved manifest (civitai
      // src/components/AppBlocks/PageBlockHost.tsx, the REQUEST_CONSENT handler:
      // `resolveRequestConsent(gateStatus, missingScopes)`). So a scope the
      // manifest does not declare can never be granted, and the host pushes
      // CONSENT_UNAVAILABLE instead. `user:read:self` is this app's only
      // consent-gated scope, so this one line reproduces that rule exactly:
      // remove it from the manifest and the harness refuses.
      consentGrantable={manifest.scopes.includes('user:read:self')}
      // 🔴 MOCK DIVERGENCE #2 — routing. The stock mock IGNORES `NAVIGATE`, so
      // `useCivitaiRoute()` would never move under `dev:harness`. The real page
      // host (and `createLiveHost`) answer an app-scoped navigation by pushing
      // `ROUTE_CHANGED { subPath }` back into the block; this reproduces just that
      // half. A `scope: 'site'` navigation leaves the app on civitai.com, so here
      // it only shows up in the harness log.
      onOutbound={reflectAppNavigation}
    >
      {children}
    </MockHost>
  );
}

let currentSubPath = '';

/** Push `ROUTE_CHANGED` for an app-scoped, current-tab `NAVIGATE`, as PageBlockHost does. */
function reflectAppNavigation(msg: { type: string; payload?: unknown }) {
  if (msg.type !== 'NAVIGATE') return;
  const payload = (msg.payload ?? {}) as { path?: unknown; scope?: unknown; target?: unknown };
  if (typeof payload.path !== 'string' || payload.scope === 'site' || payload.target === 'new_tab') return;
  // The host normalises a leading slash away and sends the segment below the app
  // root with none: `'/pin/7'` and `'pin/7'` are one route, reported as `'pin/7'`.
  const subPath = payload.path.replace(/^\/+/, '').replace(/\/+$/, '');
  if (subPath === currentSubPath) return; // the host sends only on a CHANGE
  currentSubPath = subPath;
  window.setTimeout(() => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'ROUTE_CHANGED', payload: { subPath } },
        origin: window.location.origin,
      }),
    );
  }, 0);
}

/** `createLiveHost` forwards the bridge to the real API through the vite proxy. */
function LiveHost({ children }: { children: ReactNode }) {
  const token = import.meta.env.VITE_LIVE_BLOCK_TOKEN as string | undefined;
  const [installed, setInstalled] = useState(false);
  useEffect(() => {
    if (!token) return;
    // `backendBaseUrl: ''` = same origin; vite.config.ts proxies `/api`. No
    // `context`: the live host's default is a complete page slot too, and it
    // reflects app-scoped NAVIGATE into ROUTE_CHANGED itself.
    const host = createLiveHost({
      blockToken: token,
      backendBaseUrl: '',
      fetchImpl: (input, init) => fetch(input, init), // bound: a detached `fetch` throws
    });
    const uninstall = host.install();
    setInstalled(true);
    return uninstall;
  }, [token]);
  if (!token) return <p>dev:live needs VITE_LIVE_BLOCK_TOKEN in .env.development.local (see .env.example).</p>;
  return installed ? children : null;
}
