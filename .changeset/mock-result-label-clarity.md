---
'@civitai/blocks-react': patch
---

Mock host: label the default synthetic generation result image as `MOCK`.

When a block runs in `dev:harness` with no custom `generation.image(s)` configured, the mock host returns a `placehold.co` placeholder for the succeeded workflow. It previously showed only the last 4 chars of the workflow id, which looked like a real (or broken) result — a first-run developer who ran `civitai app create` → `npm run dev:harness` → Generate reported mistaking it for a real generation. The placeholder now prominently reads `MOCK` (with the short workflow id retained on a second line for per-gen uniqueness), so the scaffolded result is unmistakably a mock.
