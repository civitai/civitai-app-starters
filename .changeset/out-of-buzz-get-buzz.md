---
'@civitai/components-chat': minor
---

A reply that stopped because the viewer's Civitai account is out of Buzz (`insufficient_buzz`: a paid step the account could not pay for, or a chat balance that could not be topped up from it) now shows **Get Buzz**, a link to the buy-Buzz page in a new tab, and on the latest reply **Continue**, which asks for the reply again as Retry does (`reply-resume` with `trigger: 'retry'` first) and carries on from its finished steps. A host's own `backend` is unchanged: its 402 is its own refusal. `<civitai-chat-thread>` and `<civitai-chat-turn>` take `hosted`.

With `runner="remote"` the chat no longer keeps a chat balance (`session.fund` is undefined): a server runner bills each paid step to the viewer's Civitai account, never the balance, so the balance badge and its Top up / Top up when empty controls are gone there. The welcome's fine print no longer says you'll see the price first. It now says who pays: in the page, the Civitai account, or the free allowance and chat balance on models that have one; on a runner, the account, about 1 Buzz per step, up to a daily limit (`<civitai-chat-welcome account-billed>`).
