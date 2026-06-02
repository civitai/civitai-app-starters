import { useEffect, useRef, useState, type ReactNode } from 'react';

import type { BlockInitPayload, ModelSlotContext } from '@civitai/app-sdk/blocks';

const DEV_TOKEN = 'dev.harness.mock.jwt.NOT.A.REAL.RS256';
const DEV_INSTANCE_ID = 'bki_dev_buzz_purchase';
const DEV_BLOCK_ID = 'buzz-purchase-demo';
const DEV_APP_ID = 'app_dev';

/**
 * Local dev harness. App Blocks normally mount inside an iframe the civitai.com
 * host controls; locally there's no host. `pnpm dev:harness` wraps the block in
 * this component, which:
 *
 *  1. Intercepts `window.parent.postMessage` so the block's outbound messages
 *     (BLOCK_READY, RESIZE_IFRAME, REQUEST_TOKEN, …) land in a debug log.
 *  2. Echoes the host replies the block depends on (here: TOKEN_REFRESH_RESPONSE).
 *  3. Dispatches a fake BLOCK_INIT from the configured allowed-parent origin.
 *
 * GOTCHA #53: the IframeTransport drops any postMessage whose origin isn't in
 * `VITE_BLOCK_ALLOWED_PARENT_ORIGINS`. The harness fires BLOCK_INIT from
 * `window.location.origin`, so serve on the pinned origin
 * (`vite --host localhost --port 5180`, which `pnpm dev:harness` does) and set
 * `.env` to match, or BLOCK_INIT is origin-rejected and the block hangs on
 * "Loading…".
 *
 * The mock token is NOT a real RS256 JWT — orchestrator/API calls that verify
 * it will fail. The harness is for UI iteration, not integration testing.
 */
export function Harness({ children }: { children: ReactNode }) {
  const [outbound, setOutbound] = useState<Array<{ type: string; payload?: unknown }>>([]);
  const [parentOrigin] = useState(() => window.location.origin);
  const tokenSerialRef = useRef(0);

  useEffect(() => {
    const originalParent = window.parent;

    const dispatchToBlock = (data: unknown) => {
      window.dispatchEvent(new MessageEvent('message', { data, origin: parentOrigin }));
    };

    // Start with a budget BELOW the 120-Buzz cost so the first Generate trips
    // the insufficient-funds path. A "purchase" raises it so the retry passes.
    let buzzBudget = 50;

    const nextToken = () => {
      tokenSerialRef.current += 1;
      return {
        raw: `${DEV_TOKEN}.${tokenSerialRef.current}`,
        scopes: ['models:read:self', 'ai:write:budgeted'],
        expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
        buzzBudget,
      };
    };

    const parentMock = {
      postMessage: (msg: unknown) => {
        if (typeof msg !== 'object' || msg === null || typeof (msg as { type?: unknown }).type !== 'string') {
          return;
        }
        const typed = msg as { type: string; payload?: { requestId?: string; suggestedAmount?: number } };
        setOutbound((prev) => [...prev, { type: typed.type, payload: typed.payload }]);
        const requestId = typed.payload?.requestId;

        if (typed.type === 'REQUEST_TOKEN') {
          dispatchToBlock({
            type: 'TOKEN_REFRESH_RESPONSE',
            payload: { ...(requestId ? { requestId } : {}), token: nextToken() },
          });
        }

        if (typed.type === 'SUBMIT_WORKFLOW') {
          if (buzzBudget < 120) {
            // The host rejects under-budget submits. The hook surfaces the
            // ESTIMATE_RESULT/WORKFLOW_SUBMITTED `error` as a thrown Error.
            dispatchToBlock({
              type: 'WORKFLOW_SUBMITTED',
              payload: {
                requestId,
                snapshot: { workflowId: '', status: 'failed', error: 'insufficient Buzz budget' },
              },
            });
          } else {
            dispatchToBlock({
              type: 'WORKFLOW_SUBMITTED',
              payload: { requestId, snapshot: { workflowId: 'wf_ok', status: 'succeeded', cost: { total: 120 } } },
            });
          }
        }

        if (typed.type === 'OPEN_BUZZ_PURCHASE') {
          // Simulate a successful purchase that lifts the budget over the cost,
          // then push a fresh token so the retry's submit passes.
          buzzBudget = 1000;
          dispatchToBlock({
            type: 'TOKEN_REFRESH',
            payload: { token: nextToken() },
          });
          dispatchToBlock({
            type: 'BUZZ_PURCHASE_RESULT',
            payload: { requestId, purchased: true, newBalance: 1000 },
          });
        }
      },
    };
    Object.defineProperty(window, 'parent', { value: parentMock, configurable: true, writable: true });

    const context: ModelSlotContext = {
      slotId: 'model.sidebar_top',
      modelId: 12345,
      modelVersionId: 67890,
      modelName: 'Dev Mock Model',
      modelType: 'Checkpoint',
      modelNsfwLevel: 1,
      creatorUserId: 1,
      viewerUserId: 2,
      viewerNsfwEnabled: false,
      viewerUsername: 'dev-viewer',
      viewerStatus: 'active',
      theme: 'dark',
    };
    const payload: BlockInitPayload = {
      blockInstanceId: DEV_INSTANCE_ID,
      blockId: DEV_BLOCK_ID,
      appId: DEV_APP_ID,
      token: nextToken(),
      context,
      settings: { publisherSettings: {}, userSettings: {} },
      viewer: { id: 2, username: 'dev-viewer', status: 'active' },
      theme: 'dark',
      renderMode: 'iframe',
    };
    // Defer one tick so the block's transport listener is registered before
    // the message fires.
    const timer = window.setTimeout(() => dispatchToBlock({ type: 'BLOCK_INIT', payload }), 0);

    return () => {
      window.clearTimeout(timer);
      Object.defineProperty(window, 'parent', { value: originalParent, configurable: true, writable: true });
    };
  }, [parentOrigin]);

  return (
    <div style={{ display: 'grid', gridTemplateRows: 'auto 1fr auto', minHeight: '100vh' }}>
      <header style={harnessHeaderStyle}>
        <strong>DEV HARNESS</strong>
        <span>mock BLOCK_INIT from {parentOrigin}</span>
        <span style={{ marginLeft: 'auto' }}>outbound: {outbound.length}</span>
      </header>
      <main style={{ border: '1px dashed #888', margin: 16 }}>{children}</main>
      <pre style={harnessLogStyle}>
        {outbound.length === 0
          ? '// no outbound messages yet'
          : outbound.map((m, i) => `${i + 1}. ${m.type} ${JSON.stringify(m.payload ?? {})}`).join('\n')}
      </pre>
    </div>
  );
}

const harnessHeaderStyle = {
  padding: '8px 12px',
  background: '#222',
  color: '#fff',
  fontSize: 12,
  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
  display: 'flex',
  gap: 16,
  alignItems: 'center',
} as const;

const harnessLogStyle = {
  margin: 0,
  padding: 12,
  background: '#111',
  color: '#7fc',
  fontSize: 11,
  maxHeight: 240,
  overflow: 'auto',
} as const;
