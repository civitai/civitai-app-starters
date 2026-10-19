# @civitai/components-chat

## 0.16.0

### Minor Changes

- 3d7e8c8: **A page can let the viewer see what the assistant called: `tool-calls="details"` (or `toolCalls = 'details'`).** Every tool call that would otherwise show nothing once finished stays in the thread as a row: the tool's name (and its server's id, for an added MCP server's tool), a short line of its input, and Running, Done or Failed. Clicking or tapping it opens the whole input and the result or error, pretty-printed in a box that scrolls instead of widening the thread, cut past 50,000 characters. Calls in a row, with no words between them, fold into one "Used 3 tools" row ("Using 3 tools…" while one still runs) that opens to the calls; a single call is not grouped. The rows are buttons with `aria-expanded`, and opening animates only without `prefers-reduced-motion`. A call with a view (`toolViews` or `tools` `render`, the generation, panel, post and choice cards, model cards) shows as before and ends a run, unless its `render` returns `undefined`, which leaves it a row; and a chat reopened from storage groups the same as live. The default, `activity`, leaves the thread exactly as it was. New type `ChatToolCallsMode`.

## 0.15.0

### Minor Changes

- 5a564b4: **A page can keep a message back without losing it: `before-send`'s `queue(waiting)`.** The message shows at once as the viewer's bubble, marked with `waiting` (and said once to screen readers), with its files, and the chat holds; it goes, as it is and with no second `before-send` or Buzz grant, once the page calls `release()` on the returned `QueuedMessage` and the chat can send. `queue()` works only from the listener itself (later it throws) and once per message. The waiting bubble has Edit. A message that will not go (`cancel()`, `QUEUE_TIMEOUT_MS` = 3 minutes, or another chat opened) comes back into an empty message box with its files, or, when the viewer typed there or is dictating, as a "This message was not sent" alert with Put it back and Dismiss. Signed out or signed in as someone else, these are dropped unseen. New `giveBack(text)` brings back a message the page could not send the same way (it returns `false`, doing nothing, before the chat has started or while it is signed out). See "A message that waits" in the README. **Changed:** a message whose Buzz permission is answered after the chat was handed a different `app` or `backend` is now dropped instead of being put in the new viewer's message box (a viewer never sees another's words); handed the same object again, it comes back into that viewer's box, and nothing is ever sent on a session that was replaced.

## 0.14.0

### Minor Changes

- 4c29aec: **`<civitai-chat>` offers Retry on a reply that lost its connection, and asks for it again once by itself when the page wakes.** A reply that still failed because the connection was lost, or the service was busy or could not run the model for a moment, shows Retry on its error (latest reply only). Retry asks for the same reply again: the viewer's message is not sent twice, and it carries on from the last step that finished, so a tool that already ran is not called again and stays on screen. `agent.retry()`, which "Continue with Buzz" also uses, now carries on from there too instead of starting the reply over. Retry is offered only where that holds: not when the step that failed had already called a tool, and not on a failed reply in a chat opened again later (where to carry on from is kept for the session only, `assistant.resume`, and never saved). A reply that lost its connection (a phone that slept stops the page and its retries) is asked again once, by itself, when the page becomes visible again or the browser fires `online`: only for the latest reply of the open chat, while `canSend` is true, within 30 minutes of the failure, and at most once per reply. Retry is off while the chat holds. Retry and each automatic ask do not fire `before-send`; they fire a cancelable `reply-resume` with `{ trigger }` (type `ReplyResumeDetail`: `'retry'`, `'visible'` or `'online'`). A page that cancels it (its reply's tools are not there now) calls the new `retryReply()` once they are, which asks the same way Retry does and only where Retry would be offered. See "Retry, and asking again when the page wakes" in the README.

## 0.13.0

### Minor Changes

- 8d67d74: **`<civitai-chat>` says when a message can go: a read-only `canSend` property and a `can-send-change` event.** `canSend` is `true` when `send(text)` would send now: the chat has started, no reply is running, and nothing holds it (the page's `holdReason`, a saved chat the viewer is opening, a message still on its way, the chat starting again for a new `app` or `backend`, or an added MCP server still listing its tools). Each of these is shown in the message box, which keeps what is sent meanwhile, so a message sent while a saved chat opens no longer goes into the chat being left. On Civitai's own conversation store, as already on a host `backend`'s, an open that finishes after a later open or a new chat is now dropped: the last chat picked is the one that ends open, a chat whose open never answers no longer holds up the next pick, and New chat no longer waits for (and is no longer replaced by) a chat still loading. The Buzz permission request is now asked with a `signal`: a viewer who closes it without answering counts as not having agreed after two minutes, instead of leaving the chat waiting. `can-send-change` fires with `{ canSend }` (type `CanSendChangeDetail`; it bubbles and is composed) once each time that changes, so a page holding a message of its own can send it the moment the chat can take it instead of calling `send()` again on a timer. See "When a message can go" in the README.

## 0.12.0

### Minor Changes

- 3e3b63d: **`<civitai-chat>` has two new read-only properties, `draft` and `dictating`, so a page can read the message box without reaching into the chat's shadow root.** `draft` is the text in the message box now (what the viewer typed, or what `compose()` or an example put there), `''` while the chat has no message box yet. `dictating` is `true` from the moment the viewer starts talking into the microphone until what they said has been added to `draft` (or sent, or thrown away): while recording, in the moment after they stop while the recorder hands over their last words, and while it is turned into text. Both work signed in and signed out. See "What is in the message box" in the README.

## 0.11.0

### Minor Changes

- f89e8d6: **The page can follow which chat is open.** `<civitai-chat>` now fires `chat-change` with `{ chatId }` (type `ChatChangeDetail`; it bubbles and is composed) whenever the open chat changes: the last chat reopened on load (or a fresh one started), a chat opened from the list, `newChat()`, and deleting the open chat (naming the new chat that replaces it). It fires once per change. The new read-only `chatId` property gives the id of the chat now open, so a page can keep something per chat, such as what that chat last worked on, and bring it back when the viewer returns to it.

  **The page can hold a message before it goes.** `<civitai-chat>` now fires a cancelable `before-send` with `{ text }` (type `BeforeSendDetail`; it bubbles and is composed) once per new message, just before it goes as the viewer's: typed, spoken, `send(text)`, a clicked choice, Continue, a result's menu action, or a page command's `send`. `preventDefault()` keeps it from being sent, shown or saved; the message box is already cleared and any files stay attached, so the page sends the text itself later with `send(text)` (which fires `before-send` again) or hands it back with `compose(text)`. It does not fire for slash commands the chat handles itself, for a reply asked for again ("Continue with Buzz", automatic retries), or for a message held by `holdReason`.

  **Send stays inside the message box on narrow phones.** The row under the message box (add a file, the model picker, the keyboard hint, the voice controls, Send) could not get narrower than about 298px, so in a chat narrower than about 356px Send ran past the box's right edge (17px out on a 360px phone, 57px on a 320px one), and in a slightly wider chat the hidden keyboard hint wrapped and made the row three lines tall. The hint now gives way first, then the model's name truncates; the buttons keep their size.

## 0.10.3

### Patch Changes

- 7938ef9: **`<civitai-chat>` fits a phone-width host again.** The main column was an implicit grid track, which sizes to its widest content rather than to the chat, so a long chat title widened the whole chat past the screen: the New chat button, the Send button and the right edge of every message landed off-screen (a 359px chat laid out 427px wide on an iPhone 15; on an iPhone SE even a short title overflowed by 15px). The column is now bounded to the chat's width, and a long title truncates instead.

## 0.10.2

### Patch Changes

- Updated dependencies [ae33f6c]
  - @civitai/components@0.13.0

## 0.10.1

### Patch Changes

- 13bcd22: `<civitai-chat>` keeps recovering from network drops through a long reply. The retries a reply the browser's network cut off gets are now counted per drop, not per reply: a drop gets up to three retries, and the count starts again once a step finishes after a retry, so a reply of many minutes lives through several network changes; one reply still retries at most 10 times in all, so a network that keeps dropping ends it. The waits are now 1.5 s, 4 s and 8 s (were 500 ms and 2 s): a browser drops its connections twice about a second apart on one network change, and a retry inside that second failed at once and used up a try. `reply-retry`'s `attempt` counts the reply's retries. A drop that ends a reply after an earlier error the reply got past by itself (it carried on and finished more tool steps) is now retried: the cut is the error that ended the reply, so tools of steps that finished before it no longer block the retry, while a tool call in the cut step itself, or after it, still does. The error trace (`reply-error`'s `trace`, `assistant.errorTrace`) now describes that ending error throughout: its `stage`, `step` and `lastTool` were taken from the first error while its `message` and `name` came from the last.

## 0.10.0

### Minor Changes

- 0cbf14b: `<civitai-chat>` takes `examples` and `placeholder`, so a page whose chat does something other than make
  media can offer its own starting points and message-box hint. Unset, the chat keeps the built-in
  examples and hint; an empty `examples` list shows none. The `ChatExample` type is exported.

  Signing in from a signed-out chat through a popup sign-in (by adding a file or pressing Sign in) now keeps what the viewer had in the
  message box, such as an example's prompt, instead of starting the signed-in chat with an empty box.

## 0.9.2

### Patch Changes

- Updated dependencies [6727901]
  - @civitai/components@0.12.0

## 0.9.1

### Patch Changes

- Updated dependencies [f4adc63]
  - @civitai/components@0.11.0

## 0.9.0

### Minor Changes

- 58067b8: `<civitai-chat>` recovers by itself from a reply the browser's network cut off. A browser drops every request in flight when the client's network changes (e.g. its address changes), which used to end the reply in an error the viewer had to answer with "continue". Such a reply is now asked for again, up to twice after a short wait (and, when the browser says it is offline, once it is back online, at most 15 s), resuming from the last step that finished: tools that already ran are not called again and words already kept are not repeated. Only fetch's own dropped-connection `TypeError` (`Failed to fetch`, `network error`) and a 2xx answer whose body such a drop cut (`Failed to process successful response`) count; a stop, any status the service sent, and every other error fail at once as before. A cut step from which any tool call comes before its stream ends (even after the error) is not asked again, so no tool can run twice, and a reply that then fails keeps every step that finished, with the calls it ran and their results. A reply that fails after its retries now says the connection was lost, and a step the stream closed after an error is no longer kept twice. Each retry fires `reply-retry` with `{ attempt, trace }` (type `ChatReplyRetry`) and is kept on the turn as `assistant.networkRetries` for the session; `reply-error` fires only once the retries are used up.

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
