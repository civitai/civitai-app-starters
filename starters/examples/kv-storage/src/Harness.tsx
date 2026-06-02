import { useEffect, useRef, useState, type ReactNode } from 'react';

import type { BlockInitPayload, ModelSlotContext } from '@civitai/app-sdk/blocks';

const DEV_TOKEN = 'dev.harness.mock.jwt.NOT.A.REAL.RS256';
const DEV_INSTANCE_ID = 'bki_dev_kv_storage';
const DEV_BLOCK_ID = 'kv-storage-demo';
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

    const nextToken = () => {
      tokenSerialRef.current += 1;
      return {
        raw: `${DEV_TOKEN}.${tokenSerialRef.current}`,
        scopes: ['models:read:self'],
        expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
      };
    };

    // In-memory store mocking the host's per-(instance, viewer) KV datastore.
    const store = new Map<string, { value: unknown; updatedAt: string; bytes: number }>();
    const PER_VALUE_CAP = 64 * 1024;
    const QUOTA_BYTES = 50 * 1024 * 1024;
    const QUOTA_ROWS = 1_000_000;
    const usedBytes = () => [...store.values()].reduce((n, e) => n + e.bytes, 0);

    const parentMock = {
      postMessage: (msg: unknown) => {
        if (typeof msg !== 'object' || msg === null || typeof (msg as { type?: unknown }).type !== 'string') {
          return;
        }
        const typed = msg as {
          type: string;
          payload?: { requestId?: string; key?: string; value?: unknown; prefix?: string };
        };
        setOutbound((prev) => [...prev, { type: typed.type, payload: typed.payload }]);
        const requestId = typed.payload?.requestId;

        if (typed.type === 'REQUEST_TOKEN') {
          dispatchToBlock({
            type: 'TOKEN_REFRESH_RESPONSE',
            payload: { ...(requestId ? { requestId } : {}), token: nextToken() },
          });
        }

        if (typed.type === 'APP_STORAGE_GET') {
          const entry = store.get(typed.payload?.key ?? '');
          dispatchToBlock({
            type: 'APP_STORAGE_GET_RESULT',
            payload: { requestId, value: entry ? entry.value : null },
          });
        }

        if (typed.type === 'APP_STORAGE_SET') {
          const key = typed.payload?.key ?? '';
          const bytes = new TextEncoder().encode(JSON.stringify(typed.payload?.value ?? null)).length;
          if (bytes > PER_VALUE_CAP || usedBytes() + bytes > QUOTA_BYTES) {
            dispatchToBlock({
              type: 'APP_STORAGE_SET_RESULT',
              payload: { requestId, ok: false, error: 'PAYLOAD_TOO_LARGE' },
            });
          } else {
            store.set(key, { value: typed.payload?.value, updatedAt: new Date().toISOString(), bytes });
            dispatchToBlock({
              type: 'APP_STORAGE_SET_RESULT',
              payload: { requestId, ok: true, sizeBytes: bytes },
            });
          }
        }

        if (typed.type === 'APP_STORAGE_DELETE') {
          const deleted = store.delete(typed.payload?.key ?? '');
          dispatchToBlock({
            type: 'APP_STORAGE_DELETE_RESULT',
            payload: { requestId, ok: true, deleted },
          });
        }

        if (typed.type === 'APP_STORAGE_LIST') {
          const prefix = typed.payload?.prefix ?? '';
          const keys = [...store.entries()]
            .filter(([k]) => k.startsWith(prefix))
            .map(([k, e]) => ({ key: k, updatedAt: e.updatedAt }));
          dispatchToBlock({ type: 'APP_STORAGE_LIST_RESULT', payload: { requestId, keys } });
        }

        if (typed.type === 'APP_STORAGE_QUOTA') {
          dispatchToBlock({
            type: 'APP_STORAGE_QUOTA_RESULT',
            payload: {
              requestId,
              usedBytes: usedBytes(),
              rowCount: store.size,
              limitBytes: QUOTA_BYTES,
              limitRows: QUOTA_ROWS,
            },
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
