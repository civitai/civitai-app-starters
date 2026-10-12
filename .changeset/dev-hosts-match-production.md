---
'@civitai/blocks-react': minor
---

**The two development hosts now handle three messages the way the production hosts do (for `waitSeconds`, the production hosts as of civitai/civitai#5798).**

`createMockHost` / `Harness` (`/testing`) and `createLiveHost` (`/live`) each stand in for civitai.com. In three places they did something the production hosts do not, so code passed locally and behaved differently once deployed.

**`useCheckpointPicker().persist()` on a page is refused.** A full-page app (`app.page`) is bound to no model, so the page host has nowhere to write a checkpoint override. It answers every `SET_USER_CHECKPOINT`, including a clear (`null`), with `USER_CHECKPOINT_SET { requestId, ok: false, error: 'page blocks cannot persist a checkpoint override (no model binding)' }`. The mock used to answer `ok: true` there, and `dev:live` used to forward the call to the server. Both now send the page host's reply, and `dev:live` makes no backend call for it. Which host is imitated follows the `context` option: `app.page` (the default in both) is a page, anything else is a model slot, where `persist()` behaves as before.

**`dev:live` forwards `idempotencyKey` on `SUBMIT_WORKFLOW`.** It was dropped, so the server never saw the key `submit()` sent: a retry with the same key was a second submit, and a key in a format the server refuses was never refused. It is now forwarded as the production hosts forward it, only when it is a non-empty string.

**`dev:live` forwards `waitSeconds` on `POLL_WORKFLOW`.** It was dropped, so `watch()` could not hold a poll open in `dev:live`. The value is floored, a value of `0` or less (or a non-number) sends no field, and anything above 60 is sent as 60, which is the most the server's input accepts. The server decides the actual hold. This matches the production hosts as of civitai/civitai#5798; a production host without that change drops the field, so there a poll is answered at once.

**Migration.** A test that expects `persist()` to resolve under the default mock context now sees a rejection. If the block runs in a model slot, pass that slot as `context` (a complete `ModelSlotContext`) and it resolves as before. If the block is a page app, the test was asserting something production never does: remove the `persist()` call and keep the picked checkpoint in the app's own state.

An unknown message type still gets no reply from either development host. That matches production, which sends its `unsupported on this host` reply only for a request type it knows and has no handler for.
