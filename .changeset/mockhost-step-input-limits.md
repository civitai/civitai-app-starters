---
'@civitai/blocks-react': patch
---

`createMockHost` now refuses a pass-through step body the real host refuses, so a block tested against the mock no longer goes green with a body production rejects. On `estimate`, each `useBatchEstimate` cell and `submit`, for a `kind: 'step'` body without a `step` id (its `input`) and for a `kind: 'workflow'` body (every step `input`, then `arguments`):

- **Inline media** — a `data:image/…`, `data:video/…` or `data:audio/…` URI, or a raw base64 string of 4096+ characters, at any depth. The error names the first path in document order, e.g. `input.images[1] carries inline media (data URI/base64); pass a hosted url instead — …`, and says to upload with `useImageUpload({ purpose: 'generationSource' })` or pick with `useImagePicker` and pass the returned `url`.
- **Too many values** — more than 262144 values across those fields, counted with one shared budget, is refused outright (fail-closed), even when the body is tiny in bytes.
- **The byte cap** — `JSON.stringify(input).length` over 262144 on a `kind: 'step'` body (a workflow body keeps its existing summed cap). Not reported when inline media already refused the body.

The refusal has the real host's shape for a server validation failure: a `'failed'` snapshot with no `cost` whose `error` is the server's zod issue list. `estimate()` rejects with `WorkflowEstimateError` code `'failed'` and `submit()` with `WorkflowSubmitError` code `'exception'`; nothing is debited. It comes before the spend-scope check, as on the server.
