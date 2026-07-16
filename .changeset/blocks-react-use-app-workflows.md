---
'@civitai/blocks-react': minor
---

Add `useAppWorkflows()` — the React hook for an app's **own** generator subqueue.
Returns `{ workflows, cursor, loading, error, refetch, cancel }` (fetch-on-mount,
paginated via `cursor`, unmount-safe, timeout-not-hang); `cancel(workflowId)` sends
`CANCEL_APP_WORKFLOW` and optimistically splices the confirmed terminal state into
`workflows` in place. Adds the `isValidAppWorkflowsResult` /
`isValidCancelAppWorkflowResult` transport validators (accepting the legitimate
`number | null` image dims / nsfwLevel / cost and `string | null` cursor), and
`createMockHost` / `createLiveHost` coverage for both bridges. Requires
`@civitai/app-sdk` ≥ 0.24.0 (peer range bumped to `^0.24.0`).
