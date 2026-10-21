---
'@civitai/components-chat': minor
---

A generation whose mature results are shown blurred, because it was paid with Buzz that doesn't cover mature content, now offers **Unlock** on its card. Unlocking pays for it with Buzz that does and refunds the first payment (`PUT /v2/consumer/workflows/{id}` with `allowMatureContent: true`), then shows the results from a fresh read. With too little Buzz, the card says so and links to getting more. It is offered only to a viewer who shows mature content. `CardJob` gains optional `locked`, `unlocking`, `unlockError` and `unlock()`.

The model list leaves out OpenRouter's `:batch` variants, which answer hours later and never within a chat reply.

Settings no longer has an **Assistant** choice. Each chat's model picker is where a model is chosen, and a chat without its own model uses the page's `model`; replies use free replies while they last, then Buzz. A default model or a Free-only / Always-paid choice saved by an earlier version is ignored. `Settings` loses `assistantModel` and `assistantTier`, and `<civitai-chat-model-picker>` loses `defaultModel`.
