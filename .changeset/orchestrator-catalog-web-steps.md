---
'@civitai/app-sdk': minor
---

`WORKFLOW_STEP_TYPES`: add `webScrape` and `webSearch` — the orchestrator accepts both and the catalog listed neither.

`WORKFLOW_STEP_TYPES` is a hand-maintained mirror of `components.schemas.WorkflowStepTemplate.discriminator.mapping` in `https://orchestration.civitai.com/openapi/v2-consumers.json`. That mapping is the defining surface for a step's `$type` and it moves per orchestrator build, so the catalog drifts behind it without anyone touching this repo — same class as `miniMaxMusic3` (#238) and the `qwen` engine drift (#229).

It had drifted by exactly two entries. Re-reading the live mapping gives **47** keys; the catalog listed **45**. The mapping was diffed in both directions: nothing else is missing, and nothing listed has been withdrawn. `IMAGE_GEN_ENGINES` was re-checked in the same pass and is unchanged at exactly the spec's 13.

Neither is a rename of anything already present — `scrape` and `search` each matched **0** times in `src/orchestrator/index.ts` (case-insensitive; `comfy` matched 16 as a positive control on that search).

**What they are.** Both are web-access steps, and neither carries a usable description in the spec: `WebScrapeStepTemplate.description` is the string `"WebScrape"` — what the generator emits when the source has no doc comment — so the descriptions below were derived from the input/output schemas, which do carry real prose.

- **`webScrape`** — `url` and `formats` are both required; `formats` picks which representations come back (the spec names `markdown`, `html`, `links`). The output carries those plus the page `title`, `description` and `statusCode`, each null when not requested or unavailable.
- **`webSearch`** — `query` and `limit` (1–10) are both required. Results come back in relevance order with `url`, `title` and the engine's snippet `description`. The optional `scrapeFormats` (e.g. `['markdown']`) also scrapes each result page; omit it and only titles, URLs and snippets are returned.

**Why `minor`.** `WorkflowStepType` is `keyof typeof WORKFLOW_STEP_TYPES`, so this widens that union — purely additive. Nothing that compiled before stops compiling, and there is no runtime behaviour change: this is a typing and discoverability fix.

The transcribed fixture (`test/fixtures/orchestrator-spec-catalogs.json`, `readOn` bumped to 2026-09-01) and the pinned expectation count in `test/orchestrator.test.ts` were updated in lockstep, which is what keeps the offline unit test and the live drift-check pinned to each other. `node scripts/check-orchestrator-catalogs.mjs` was observed exiting **1** on `origin/main` naming both missing keys, and **0** after this change.

**This is the manual fix only.** Automating the mechanical half — a scheduled job that re-reads the spec and opens a PR — is deliberately a separate change, so clearing the live drift does not wait on getting the automation right.
