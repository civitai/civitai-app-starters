/**
 * Builds a `MessageEvent` that mimics a parent-frame postMessage so tests can
 * exercise `IframeTransport.handleMessage` without a real cross-frame setup.
 *
 * Lives in `test/`, NOT in `src/`, on purpose (#334). It used to be exported
 * from `@civitai/blocks-react/testing`, where it counted as public API — and
 * `test/` is excluded from the build, so keeping it here also keeps it out of
 * the published tarball.
 *
 * It DOES have consumers. A full enumeration of all 489 directories under the
 * local `civit` tree found two shapes:
 *   - `dogfood-app/dogfood-2/src/mock-buzz.ts:32` (import), dispatched at `:124`;
 *   - 🔴 `civitai/cli`'s scaffold template
 *     `internal/scaffold/templates/page-money/src/mock-buzz.ts.tmpl:33`. That
 *     template pins `"@civitai/blocks-react": "^0.53.0"`, and a caret on `0.x`
 *     pins the minor — so new scaffolds keep resolving `0.53.x` and are fine
 *     until someone bumps that pin. Whoever bumps it must fix the import in
 *     the SAME change, or `civitai app init` starts emitting projects that do
 *     not typecheck.
 * It is removed anyway because the whole helper is the two-line body below — a
 * consumer inlines it rather than taking a public-API dependency on it. The
 * changeset for this release names both and shows the replacement.
 *
 * If a block author ever needs it back, re-export it from `src/testing.tsx`,
 * add it to the ledger in `test/testingSurface.test.ts` AND to the README
 * section that test parses, and write a changeset.
 */
export function mockParentMessage(data: unknown, origin: string): MessageEvent {
  return new MessageEvent('message', { data, origin, source: null });
}
