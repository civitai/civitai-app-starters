/**
 * Builds a `MessageEvent` that mimics a parent-frame postMessage so tests can
 * exercise `IframeTransport.handleMessage` without a real cross-frame setup.
 *
 * Lives in `test/`, NOT in `src/`, on purpose (#334). It used to be exported
 * from `@civitai/blocks-react/testing`, where it had zero consumers outside
 * this package but did count as public API — and `test/` is excluded from the
 * build, so keeping it here also keeps it out of the published tarball.
 * If a block author ever needs it, re-export it from `src/testing.tsx`, add it
 * to the ledger in `test/testingSurface.test.ts`, and write a changeset.
 */
export function mockParentMessage(data: unknown, origin: string): MessageEvent {
  return new MessageEvent('message', { data, origin, source: null });
}
