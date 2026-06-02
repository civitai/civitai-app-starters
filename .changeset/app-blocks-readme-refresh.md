---
'@civitai/app-sdk': patch
'@civitai/blocks-cli': patch
---

Refresh the published READMEs for the App Blocks packages (these ship in the
tarballs via `files`). `@civitai/app-sdk` gains an "App Blocks contract"
section (message/transport protocol, `BLOCK_INIT` shape, `defineBlock`
validator rules, version compatibility). `@civitai/blocks-react` documents
every hook with a minimal snippet, the `/ui` `SettingsForm` subexport, the
`useBuzzWorkflow` status semantics, and the self-set `data-theme` requirement;
it also fixes the quick-start `submit()` snippet (full `WorkflowBody`, not
`{ prompt }`) and lists all ten hooks (was eight). `@civitai/blocks-cli`
clarifies that `deploy` is preflight-only and maps the commands to the
`/apps/submit` review flow. No code changes.
