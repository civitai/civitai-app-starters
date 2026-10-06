---
'@civitai/components-chat': minor
---

Chat replies use the viewer's free daily allowance (`X-Civitai-Tier: free`). Settings' Assistant choice gains Auto (free replies first, then Buzz; the default) and Free (free replies only; when used up a reply offers Continue with Buzz) next to Default (always Buzz), the configured models and Custom.

The package no longer lists a "Smart" model by default; hosts add their own with `configureChat({ models })`.
