---
'@civitai/blocks-react': patch
---

`createMockHost` now refuses a pass-through step input the real host refuses, so a block tested against the mock no longer goes green with a body production rejects. On `estimate`, each `useBatchEstimate` cell and `submit`, for a `kind: 'step'` body without a `step` id and for every step of a `kind: 'workflow'` body:

- **Inline media** — a `data:image/…`, `data:video/…` or `data:audio/…` URI, or a raw base64 string of 4096+ characters, anywhere in the step `input`. The error names the path and says to upload the file with `useImageUpload({ purpose: 'generationSource' })` or pick it with `useImagePicker()` and pass the returned `url`.
- **The byte cap** — `JSON.stringify(input).length` over 262144 on a `kind: 'step'` body (a workflow body keeps its existing summed cap).

Inline media is checked first, so an oversized photo gets the message that says what to do. The refusal has the real host's shape for a server validation failure: a `'failed'` snapshot with no `cost` whose `error` is the server's zod issue list. `estimate()` rejects with `WorkflowEstimateError` code `'failed'` and `submit()` with `WorkflowSubmitError` code `'exception'`; nothing is debited. It comes before the spend-scope check, as on the server.
