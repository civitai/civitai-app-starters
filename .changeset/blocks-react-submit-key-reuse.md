---
'@civitai/blocks-react': patch
---

**`useBuzzWorkflow().submit()` reuses the idempotency key when a failed submit is retried with the same input.** Before, `submit()` minted a new key on every call that did not pass one. A block whose "try again" called `submit(body)` again after a timeout or an error therefore sent a new key, and when the first attempt had in fact reached the host (a lost reply, for example), the viewer was charged twice.

- **Same input** means the same body as canonical JSON: object keys sorted at every depth and `undefined`-valued keys dropped. A body holding anything that is not plain JSON (a `Map`, `Date`, class instance, `bigint`, non-finite number and so on) never counts as the same input, so it gets a new key as before.
- **Failed** means `submit()` rejected after the request was sent with an unknown outcome: a timeout, a transport error, or a `WorkflowSubmitError` with code `'exception'`. A `'workflow-failed'` rejection is a definite outcome that the host stores and would only replay, so it is treated like a resolved reply: the next submit, even of the same input, gets a new key and really runs again. Pass your own key if you want a retry to replay instead.
- A new input, or any submit after the remembered key's submit succeeded, gets a new key.
- A key you pass in `options.idempotencyKey` is always the one sent. It does not replace the remembered key and is not replaced by it.
- The hook remembers only the most recent failure, per hook instance. Pass your own key when retries can interleave with other inputs or cross a remount.
- `estimate()` still sends no key.
