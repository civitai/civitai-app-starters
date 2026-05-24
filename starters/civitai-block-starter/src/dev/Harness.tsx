import { useEffect, useRef, useState, type ReactNode } from 'react';

import type { BlockInitPayload, ModelSlotContext } from '@civitai/app-sdk/blocks';

const DEV_TOKEN = 'dev.harness.mock.jwt.NOT.A.REAL.RS256';
const DEV_INSTANCE_ID = 'bki_dev_starter';
const DEV_BLOCK_ID = 'dev-block';
const DEV_APP_ID = 'app_dev';

/**
 * Local development harness.
 *
 * Civitai App Blocks normally mount inside an iframe that the host page on
 * civitai.com controls. Locally we have no host — `pnpm dev:harness` wraps
 * the block in this component, which:
 *
 * 1. Intercepts `window.parent.postMessage` so outbound block messages
 *    (`BLOCK_READY`, `RESIZE_IFRAME`, `REQUEST_TOKEN`, etc.) land in a
 *    debug log instead of bubbling out of the dev page.
 * 2. Echoes a few host-side replies the block depends on:
 *      - `REQUEST_TOKEN` → `TOKEN_REFRESH_RESPONSE` with a fresh mock token
 * 3. Dispatches a fake `BLOCK_INIT` from the configured allowed-parent
 *    origin so the transport accepts it (no origin spoofing — set
 *    `VITE_BLOCK_ALLOWED_PARENT_ORIGINS=http://localhost:5173` to match).
 *
 * The mock token is NOT a real RS256 JWT — any call to the orchestrator or
 * to civitai.com that tries to verify it will fail. The harness is for UI
 * iteration, not full integration testing.
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

    const parentMock = {
      postMessage: (msg: { type?: string; payload?: { requestId?: string } } | unknown) => {
        if (typeof msg !== 'object' || msg === null || typeof (msg as { type?: unknown }).type !== 'string') {
          return;
        }
        const typed = msg as { type: string; payload?: { requestId?: string } };
        setOutbound((prev) => [...prev, { type: typed.type, payload: typed.payload }]);

        // Echo a TOKEN_REFRESH_RESPONSE so refresh() / scheduled refresh
        // actually completes; the block's snapshot rolls over.
        if (typed.type === 'REQUEST_TOKEN') {
          const requestId = typed.payload?.requestId;
          dispatchToBlock({
            type: 'TOKEN_REFRESH_RESPONSE',
            payload: { ...(requestId ? { requestId } : {}), token: nextToken() },
          });
        }
      },
    };
    Object.defineProperty(window, 'parent', {
      value: parentMock,
      configurable: true,
      writable: true,
    });

    // Mock a ModelSlotContext — block authors targeting `model.sidebar_top`
    // or `model.below_images` will narrow to this shape.
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
      theme: 'light',
    };
    const payload: BlockInitPayload = {
      blockInstanceId: DEV_INSTANCE_ID,
      blockId: DEV_BLOCK_ID,
      appId: DEV_APP_ID,
      token: nextToken(),
      context,
      settings: { publisherSettings: {}, userSettings: {} },
      viewer: { id: 2, username: 'dev-viewer', status: 'active' },
      theme: 'light',
      renderMode: 'iframe',
    };
    // Defer one tick so the block app's transport listener is registered
    // before the message fires (the transport sets it up in its constructor
    // when the first hook calls getTransport()).
    const timer = window.setTimeout(() => dispatchToBlock({ type: 'BLOCK_INIT', payload }), 0);

    return () => {
      window.clearTimeout(timer);
      Object.defineProperty(window, 'parent', {
        value: originalParent,
        configurable: true,
        writable: true,
      });
    };
  }, [parentOrigin]);

  return (
    <div style={{ display: 'grid', gridTemplateRows: 'auto 1fr auto', minHeight: '100vh' }}>
      <header
        style={{
          padding: '8px 12px',
          background: '#222',
          color: '#fff',
          fontSize: 12,
          fontFamily: 'ui-monospace, SFMono-Regular, monospace',
          display: 'flex',
          gap: 16,
          alignItems: 'center',
        }}
      >
        <strong>DEV HARNESS</strong>
        <span>mock BLOCK_INIT from {parentOrigin}</span>
        <span style={{ marginLeft: 'auto' }}>outbound: {outbound.length}</span>
      </header>
      <main style={{ border: '1px dashed #888', margin: 16 }}>{children}</main>
      <pre
        style={{
          margin: 0,
          padding: 12,
          background: '#111',
          color: '#7fc',
          fontSize: 11,
          maxHeight: 240,
          overflow: 'auto',
        }}
      >
        {outbound.length === 0
          ? '// no outbound messages yet'
          : outbound.map((m, i) => `${i + 1}. ${m.type} ${JSON.stringify(m.payload ?? {})}`).join('\n')}
      </pre>
    </div>
  );
}
