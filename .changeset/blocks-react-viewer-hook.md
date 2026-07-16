---
"@civitai/blocks-react": minor
---

Add `useViewer()` — the block-side hook for the `GET_VIEWER` → `VIEWER_RESULT` host bridge (host bridge `blocks.getMyViewer` shipped in parallel in civitai/civitai).

- **`useViewer()`** — the signed-in viewer as an on-demand authoritative self-read (`{ id, username, status, buzzBudget? }`), distinct from `useBlockContext().viewer` (the coarse BLOCK_INIT-time snapshot). Follows the `useBuzzBalance` model exactly (fetch on mount, `refetch`, timeout-not-hang, unmount-safe); returns `{ viewer, loading, error, refetch }`. Exported from the package root along with its `UseViewer` type + the SDK's `BlockViewer`.

The trust-boundary validator `isValidViewerResult` is wired into `payloadValidatorFor`; it validates `id` (number), `username` (`string | null`), `status` (`active`/`muted`), and `buzzBudget` (`number | null`) — per host PR #3152 both `username` and `buzzBudget` are present-but-NULLABLE, and the guard ACCEPTS `null` for both (rejecting a valid `null` is the too-strict-guard trap that previously hung a read hook on a null value). The `createMockHost` (canned viewer + `viewerError` knob) + `createLiveHost` (forwards to the `blocks.getMyViewer` tRPC mutation) dev harnesses answer the bridge.

Also documents the hooks shipped in 0.25.0 that the README had not yet covered — `useBuzzTransactions`, `useBuzzAccounts`, `useDailyCompensation`, `useWildcardPack` — plus this release's `useViewer`.

Bumps the `@civitai/app-sdk` peer dependency to `^0.22.0` (the new `GET_VIEWER` message types), matching the established lockstep pattern.
