# @civitai/components-chat

## 0.8.0

### Minor Changes

- 2cdd0da: `<civitai-chat>` can run on a host's own backend: set `chat.backend = { url, fetch, model, models, store }` and the chat starts without an `app`, sends replies to the host's OpenAI-compatible `/v1/chat/completions` through the host's `fetch`, and keeps conversations in the host's `ChatConversationStore` (`list`, `load`, `save`, `delete`). Everything that runs on Civitai's services (built-in MCP, generations and panels, uploads, voice, posting, Buzz and free replies, sign-in) is then off and hidden, and a gateway refusal shows the gateway's own message (`{ "error": { "message" } }` or plain text). Without `backend` nothing changes. An added `mcpServers` entry may now bring its own `fetch` (signed in like the gateway, e.g. a same-origin session cookie), and `token` is optional when it does; an entry with neither is still skipped. See "Your own backend" and "More MCP servers" in the README.

## 0.7.0

### Minor Changes

- 29daaac: `beforeToolCall` can end the reply: `{ refuse, stop: true, message? }` refuses the call and asks the assistant nothing more in this reply, so a model that ignores a refusal can no longer keep making paid steps up to the step limit. The reply ends as done (not as an error) with `message` (or a default) and the same Continue button a reply that ran out of steps shows. Calls in the same step whose gate answers after the stop, and any later call in the reply, do not run; each is reported as a `tool-result` with `stopped: true`. A refusal without `stop` behaves as before, and Stop still stops the reply whatever the gate answers. The turn records the words as `assistant.stopped`. The gate's context now carries `reply`, the same number for every call in one reply and a new one for the next (Continue and Retry included), so a page can keep a per-reply count without guessing where a reply begins.

## 0.6.0

### Minor Changes

- 1ba6bac: A long chat no longer forgets what it is for. When the conversation is over its budget, the oldest turns' long tool results give way first (the call stays, its result becomes a note; a generation's, post's, panel's or choice's result is kept), and only then whole turns, with one "(N earlier turns omitted)" note in their place. The chat's first message and every answer to a set of options are kept even then, within a quarter of the budget. The budget is configurable: `configureChat({ contextBudgetTokens })` (default 24,000), and the model picker's context-window filter uses the same value.
- 1706173: Host controls for `<civitai-chat>`:

  - `mcp.orchestration` also takes `{ exclude: [...] }`, which keeps Civitai's tools on without the named ones, e.g. `{ exclude: ['run_step', 'run_workflow'] }` for a page where the assistant may look services up but never run (and charge for) one. The panels, which run through `run_step`, go with it; other per-call paid tools such as `transcribe_audio` stay unless listed too, and the microphone button transcribes on its own either way, past both `exclude` and `beforeToolCall`.
  - `holdReason` (property or `hold-reason`): while set, nothing is sent to the assistant. The message box keeps what the viewer typed and shows the reason, and Stop still works. The chat also holds by itself while an added MCP server is still listing its tools.
  - `beforeToolCall(name, input, { conversationId, signal })` is asked before every tool call, whether the tool is Civitai's, an added server's or the page's. `{ refuse }` stops the call before anything runs, and the assistant gets the reason as the tool's error; a hook that throws refuses too. `signal` aborts when the viewer stops the reply, which then stops at once and runs nothing, whether or not the hook answers. A `tool-result` event reports each finished call once (`name`, `input`, `output`, `isError`, `refused`).
  - `/model` says which default new chats keep, and where it is changed, when the viewer has stored one.

- 2781e61: `fetch_page` hands the assistant up to 17,000 characters of a page instead of 4,000 (above the page server's own 16,000-character cut, so its "[Page truncated]" marker arrives intact), and a cut reply of any Civitai tool says how many characters were left out (`…(N more characters not shown)`) instead of `…(truncated)`. A page already read in a chat is not fetched, or paid for, again: the assistant gets the same text, marked as already fetched. An added MCP server's tool call whose reply never comes now reaches the assistant as `{ error, retryable: true, note }`, telling it to check the call's effect before running it again, instead of failing as an ordinary tool error: when the timeout passes without progress (still after 610 s), and when the server ends or drops the call's event stream before answering, which now fails at once instead of waiting out that timeout.
- 6908851: A reply that runs out of steps now says so and offers **Continue**, even when its last step says nothing; `configureChat({ maxSteps })` sets the budget (default 10, kept within 2 to 1,000). Tool-call syntax a model writes as text in that last step (GLM's `<tool_call>…`) is no longer shown. `ask_choice` reports a choice shown only when the card can show it (options sent as a JSON string that parses are accepted), and an unusable one goes back to the assistant to fix in the same reply instead of ending it. A failed reply keeps a trace of where it broke (stage, step, status, cause, request id), shown under Details and sent to the page as a `reply-error` event.

### Patch Changes

- Updated dependencies [f3882f0]
  - @civitai/components@0.10.0

## 0.5.0

### Minor Changes

- ba1340c: A reply step may now write up to 16,384 tokens (it was 1,200), so a reasoning model has room to reason and still call a tool, and the assistant can write a file larger than about 4 KB in one call. Viewers set their own limit in Settings (**Longest reply step**, 1,024 to 32,768), and pages set the default with `configureChat({ maxOutputTokens })`; a stored value out of range or not a number is kept within the range. Conversation titles keep their own small limit.

  Each chat now has its own model. A button beside the add-file button shows it and opens a searchable list of the default, the page's `models`, the orchestrator's own models, and the OpenRouter models the orchestrator routes that cost at most $8 per million output tokens and support tool calls, each with its price (a $0 model shows "$0/M out", not "Free"). Models whose known context window is below a lower bound on what a reply needs (the reply cap, the conversation budget and the measured instructions and tools) are left out; a model that passes can still run out of room on an unusually long turn. The list loads once per session, and when it cannot load the button still offers the default, the page's models and any model id. The chat's model is saved with it; a reply uses the chat's model, else the viewer's default from Settings, else the page's `model`, so older chats behave as before. `/model` now shows or switches the current chat's model, and `/model default` makes the chat follow the viewer's default again.

  With Settings' Assistant set to **Free**, a model without free replies is no longer sent paid: the reply fails with "This model has no free replies, and you chose free replies only." and nothing is charged. The reply offers **Allow paid replies and try again**, and Settings shows a stored Free choice as "Free (unavailable)" when there are no free replies, so the viewer can switch.

## 0.4.1

### Patch Changes

- 51f106c: Chat replies on the free tier work again in browsers without `AbortSignal.any` (Safari before 17.4, Chrome before 116, Firefox before 124). Before this fix, every free reply in those browsers failed with `TypeError: AbortSignal.any is not a function`. The free request now follows the caller's abort by hand, and goes out already aborted if the caller stopped before it was sent.

## 0.4.0

### Minor Changes

- b95f747: `<civitai-chat>` takes more MCP servers through a new `mcpServers` property (also `mcp().mcpServers` in `ChatSession`), for per-user servers whose address is known only at runtime. Each entry is `{ id, url, token, label? }`, and `token` is required: the chat never sends an added server the viewer's Civitai token; its tools join the assistant's as `${id}__${tool}`. A new array opens and closes servers without touching the conversation, and an equal one changes nothing. A server that cannot be reached adds no tools and shows a toast, and the chat carries on. Long calls restart their 610 s timeout on every progress notification. Exports the `ChatMcpServer` type.

## 0.3.0

### Minor Changes

- 6d3d911: Chat replies use the viewer's free daily allowance (`X-Civitai-Tier: free`). Settings' Assistant choice gains Auto (free replies first, then Buzz; the default) and Free (free replies only; when used up a reply offers Continue with Buzz) next to Default (always Buzz), the configured models and Custom.

  The package no longer lists a "Smart" model by default; hosts add their own with `configureChat({ models })`.

- 7c4ac10: `<civitai-chat>` takes `commands`: a page adds its own slash commands (`{ usage, help, aliases?, run(arg, { send, compose, notify, conversationId }) }`), replaces a built-in by name or removes one with `null`, or builds the whole set from the built-ins with a function. Page commands show in suggestions, Tab completion and `/help`.
- 798337d: `configureChat({ name })` sets what the chat calls itself: the sidebar brand, the assistant's persona, posting messages and the conversation export's file name. It defaults to "Civitai Chat" (it said ChatCVT, the working name).

### Patch Changes

- 2559552: `<civitai-chat>` no longer calls `/api/v1/me` inside a civitai.com block. That route accepts an OAuth token but refuses the block-scoped one, so a block on the default token sent a request that failed on every mount and showed no name. In a block the chat now takes the viewer's name from the host (`app.viewer.username`), which needs no request and no consent. Outside a block it still asks `/me`, as before.
- 9887295: docs: the README listed "a block on civitai.com" as a plain way to sign the chat in, and by default it does not work

  The Signing in table offered `await initialize()` in a block, with the manifest asking for
  `ai:write:budgeted`, as one of three equal setups. The chat sends `app.getToken()` straight to the
  orchestrator (its chat model, its MCP and its workflow routes), and the token a block holds by
  default is the block-scoped one, which the orchestrator accepts on no route; `@civitai/sdk`'s own
  README says the same. So in a block with the default token every reply is refused.

  The README now says the chat needs an OAuth access token, links to `@civitai/sdk`'s README for when
  a block gets one, says nothing proxies the chat's own endpoints (its model and MCP), and says its generations then
  skip the controls the block workflow routes add.

  Prose only, no behaviour change. A patch release because the README ships in the package.

- Updated dependencies [13d004e]
- Updated dependencies [e174afd]
  - @civitai/components@0.9.3

## 0.2.0

### Minor Changes

- 1af1054: Panels: the assistant can build a set of controls for one kind of generation (`open_panel`) that the viewer runs as often as they like, straight on the orchestrator and without an assistant reply each time. It sees the panel's values and runs when asked for help, and changes it in place (`update_panel`). Panels use content-studios' input kinds and a `run_step`/`run_workflow` template, keep every version and the exact values of each run, and are saved with the conversation. Share copies a link that opens a copy of the panel in the viewer's own conversation (`openPanel()`, `holdSharedPanel()`, `panel-link-base`). `dock-panels` and `<civitai-chat-studio>` show a panel studio-style beside the chat. A panel's button can ask the assistant instead of running a generation (`run: { ask }`, `button`). Viewers can pick the assistant's model in Settings (`configureChat({ models })`, or a custom model id). Slash commands in the message box: `/clear`, `/model`, `/help`. Choices can stand for a block of inputs, and Adjust on a generation card turns it into a panel with the prompt and a priced model list. Tool calls render through views: `toolViews` and a page tool's `render` replace a call's card, and `activity` names what it is doing. Voice input: a microphone button streams the viewer's speech to a `liveTranscription` step so the words appear as they talk (phrase by phrase with `transcribe_audio` where audio worklets are missing), then puts the text in the message box or sends it.

## 0.1.1

### Patch Changes

- No source change. This records the version that is actually on the registry.

  `0.1.0` — this package's first-ever publish — FAILED in CI with
  `E404 Not Found - PUT https://registry.npmjs.org/@civitai%2fcomponents-chat`
  (release run 36747192297). Under npm OIDC trusted publishing that 404 means
  "unauthorized", and it is unavoidable on a first publish: a trusted publisher
  cannot be configured for a package the registry does not know yet, so there was
  nothing for the workflow's OIDC handshake to match. The other five packages in
  that run published normally — `changeset publish` continues past a failing
  package — so only this one was left behind.
  `0.1.1` was then published by hand from a maintainer's machine to bootstrap the
  name (npm user `devzacx`, 2026-09-30T18:01:58Z, no provenance attestations,
  unlike every other `@civitai/*` package), and the accompanying version bump was
  never committed.

  That left `main` permanently red: the tree said `0.1.0`, the registry held only
  `0.1.1`, so `pnpm assert:published` correctly reported
  `PUBLISH DID NOT HAPPEN — a package version in this tree is not on the registry.`
  on every push, blocking the release signal for every other package. Recording
  `0.1.1` here makes `changeset publish` skip the package as already-published and
  lets the assertion pass.

  🔴 **Still outstanding, and this bump does not fix it:** `@civitai/components-chat`
  has no GitHub Actions trusted publisher on npmjs.com. Until one is configured
  (owner `civitai`, repo `civitai-app-starters`, workflow `release.yml`,
  environment blank — the same trust the other six packages already have), the
  next changeset that bumps this package will fail to publish with the same E404.

## 0.1.0

### Minor Changes

- 407251d: New package: `<civitai-chat>`, a Civitai assistant as one element, the companion to `@civitai/components` for pages that want a chat that makes images, video and music on the viewer's Buzz. `@civitai/components-chat/civitai-chat/define` registers it; the agent loads lazily once the chat has a signed-in `AppClient`. A page hands over its own client (`app`) or lets the chat sign in on the first message (`signIn`, with `popupSignIn(auth)` built on `SignIn.signInWithPopup()`). Page tools, instructions, prompt, MCP switches, scope, layout and a welcome slot are the embedding API.

### Patch Changes

- Updated dependencies [c66ae73]
- Updated dependencies [38d0907]
  - @civitai/components@0.9.0
