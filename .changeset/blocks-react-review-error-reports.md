---
'@civitai/blocks-react': minor
---

**A moderator's review preview sees the block's errors.** When the host lists `blockErrors:v1` in `BLOCK_INIT.capabilities` (civitai.com does on its review preview), `IframeTransport` forwards uncaught errors, unhandled promise rejections and `console.error` calls to the host as non-fatal `BLOCK_ERROR`s carrying `source`, `stack` (when there is one) and `at` (epoch ms). It is the forwarding `@civitai/sdk` does from 0.29.0, with the same limits: messages and stacks redacted (JWT-shaped strings, `Bearer …`, the frame's own token) and truncated to 2,000 / 4,000 characters, a repeat within 10 s dropped, and at most 20 a minute.

- `console.error` still reaches the console first, unchanged. Nothing is swallowed.
- Every other host, and every production embed, sends nothing new.
- The civitai.com review page currently tells a moderator that a `@civitai/blocks-react` app does not report other errors. It needs its own update to recognise a version of this package that does.
