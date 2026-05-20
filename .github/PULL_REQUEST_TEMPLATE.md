<!--
Thanks for the PR! A few quick notes:

- Each starter under `starters/*` is intentionally self-contained so
  external devs can `tiged` a single one. Please don't share files
  across starters or fold logic into a shared `tooling/*` package.
- Reusable OAuth / orchestrator helpers belong in `@civitai/app-sdk`
  (under `packages/civitai-app-sdk`). The starters call them through
  a thin framework adapter.
- CI runs typecheck + lint + build per starter on every PR; e2e is
  manual against a live Civitai dev server.
-->

## Summary

<!-- One or two sentences: what changed and why. -->

## Affected

<!-- Check all that apply -->
- [ ] `packages/civitai-app-sdk`
- [ ] `starters/next-app`
- [ ] `starters/sveltekit-app`
- [ ] `starters/react-pwa`
- [ ] `starters/svelte-pwa`
- [ ] Repo-level (CI, docs, monorepo glue)

## Verification

<!-- What did you actually run? -->
- [ ] `pnpm install`
- [ ] `pnpm -r --filter "./starters/*" typecheck`
- [ ] `pnpm -r --filter "./starters/*" build`
- [ ] `pnpm e2e:all` (against a live Civitai dev environment)
- [ ] Manually exercised the demo flow in a browser

## Notes

<!-- Anything reviewers should look at first, breaking changes, follow-ups, etc. -->
