---
'@civitai/sdk': minor
---

In a dev-tunnel preview (the host's `BLOCK_INIT` carries `storageMode: 'local-preview'`; App Assistant's live preview included), `initialize()` now forwards the frame's uncaught errors, unhandled promise rejections and `console.error` calls to the host as `BLOCK_ERROR { message, fatal: false, source: 'error' | 'unhandledrejection' | 'console', stack?, at }`. JWT-shaped strings, `Bearer …` credentials and the frame's own token are redacted first; `message` is capped at 2,000 characters and `stack` at 4,000; at most 20 reports a minute, and the same `message` within 10 s of its last report is dropped. `console.error` still reaches the console first. A published app's frame never carries the signal and sends nothing new, and `host.reportError()` still sends exactly `{ message, fatal }`. An older host reads only `fatal` and ignores the rest.
