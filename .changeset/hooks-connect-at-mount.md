---
'@civitai/blocks-react': patch
---

**Every hook now connects the block to its host at mount.**

The host waits 10 seconds for a block's handshake (`BLOCK_HELLO`, then `BLOCK_READY` after `BLOCK_INIT`) before it shows "This app didn't load in time", retries twice and gives up. `bootSkeleton` removes the loading cover but not that deadline. The handshake is sent by the transport, which is created lazily. `useBlockContext()` and a few other hooks created it during render. Request-only hooks did not: `useBuzzWorkflow`, `useBatchEstimate`, `useWorkflowBatch`, `useBuzzPurchase`, `useCheckpointPicker`, `useResourcePicker`, `useCollectionFollow`, `useCreatePostFromApp`, `usePrepareTrainingDataset`, `useRunTraining`, `useRunConfirmedStep`, `useGatedImages`, `usePublishGenerationOutputs`, `useSaveImage`, `useUploadImageBytes`, `useCivitaiNavigate`, `useRequestSignIn`, `useRequestConsent`, `useBlockAnalytics`, `useBlockResize` (before its ref is attached), `useBlockBreakpoint`, `useNestedDocument`, and `useWildcardPack` with a non-positive id created it only on their first request, and the last three never created it at all. A block whose only SDK use was one of these rendered and then timed out before anyone could click.

Every hook exported from the package root now creates the transport in a mount effect. The effect does not run during server rendering, so these hooks stay safe to render on a server. Nothing is created when the package is imported, so `getTransport({ allowedParentOrigins })` called before the first component mounts, as dev harnesses and tests do, still takes effect. If no parent allowlist is configured, the mount-time connect logs one `console.error` instead of throwing, and the block keeps rendering. The first bridge call throws the same error as before.

No migration is needed. A block that uses no hook from this package still never connects. Call `useBlockContext()` at its root.
