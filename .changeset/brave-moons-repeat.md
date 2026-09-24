---
'@civitai/sdk': patch
---

`BREAKING.md` corrections. It ships in the tarball and is what a porting app
reads, so four of its rows were sending people the wrong way.

- The `APP_STORAGE_*` row said "No v1 route"; five routes exist. The row now
  names them and the scopes they take, and records the one migration delta the
  bridge/REST move introduces — an anonymous read that resolved to `null` on the
  bridge returns 403 on REST. The client's own contract stays in `README.md` and
  the `api:check`-guarded TSDoc rather than being restated here.
- The workflow row pointed at `app.orchestration`. It now points at
  `/api/v1/blocks/workflows/*`: the raw orchestrator drops the spend caps, the
  maturity clamp and the attribution tag, and the substitution type-checks.
- "Waiting on the host" item 1 said the OAuth token could not be minted. It is
  built — manifest `auth` plus server-side minting, with the interactive-flow bar
  that the security finding rests on left untouched. Its rollout state is
  deliberately not recorded here; it belongs on the docs site, which can be
  corrected after publication.
- Item 3 called per-app-user storage the largest remaining gap. It has landed.
