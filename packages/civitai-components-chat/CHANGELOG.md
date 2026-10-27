# @civitai/components-chat

## 0.32.1

### Patch Changes

- 2e207a2: A reply step that carried a tool's image and was refused inside the stream (a status 200 answer whose stream holds one error event with `code: "upstream_rejected"`, as Civitai's orchestration sends when the upstream model refuses a streamed request) is now asked once more without the image, as a refusal by status (400, 404, 413, 415, 422) already was. At most once per reply; no image is sent for the rest of that reply. Other errors inside the stream, such as a failed job or a timeout, still end the reply as before.

## 0.32.0

### Minor Changes

- 51327b2: Models Civitai routes to other providers are premium models, off by default: the message box shows no model button and `/model` is not offered, and every chat answers with the default model, also one saved with another. Settings → **Premium models** turns them on. Their prices show in Buzz and as an estimate ("~195 in · ~793 out Buzz/M tokens", at 1,300 Buzz per USD of the provider's cost), since a reply is charged what it actually cost.

## 0.31.0

### Minor Changes

- 4bb44b1: Edit the latest message. While no reply runs (after a reply finished, after Stop, after an error), the viewer's latest message shows **Edit**: Save replaces its words, drops the reply that followed it and asks for a reply afresh (a new reply, charged like one); Cancel leaves it as it was. Keyboard: Enter saves, Shift+Enter is a new line, Escape cancels and puts focus back on Edit. The chat is saved at once with the edited message and no reply. An edit fires `before-send` with `edit: true`. Remote mode: Edit shows only once the runner lists `features: ['edit']` on a start's or a lookup's answer; the runner protocol adds `turn.edit` on `StartRunRequest` and `features` on `StartRunResponse` and `RunLookupResponse` (both optional, so older runners and pages keep working).

### Patch Changes

- f3ce921: Remote runner mode: a reply whose start keeps failing (no answer from the runner, or a 5xx, 408 or 429) is no longer asked again forever behind a spinner. It is asked again on the 1, 2, 5, 10, 30 s waits for at most a minute from the first ask, or from when the page last woke (`START_GIVE_UP_MS`; six asks over 48 s when each fails fast), then the reply fails with the chat's usual error and Retry, which starts asking afresh with the same idempotency key (the rest of the start built as any Retry's), so a run an earlier ask did start is followed rather than refused. A 4xx refusal still fails at once.

## 0.30.0

### Minor Changes

- 5490038: `<civitai-chat>` takes the page's own content in two named slots: `composer-top`, just above the message box, and `thread-end`, after the last message inside the thread's scroll, brought into view like a new message. Nothing slotted takes no space.

### Patch Changes

- cd1844c: `send()` no longer puts a message it cannot send now (the chat holds, or the Buzz grant is refused) into the empty message box while the viewer is `dictating`: the box is hidden behind the recording bar and their words are joined onto it, so the message landed glued to the front of what they said. Not dictating, it is kept in the empty box as before.

## 0.29.1

### Patch Changes

- 831fd6e: A panel's slider shows its track: the theme's dark track colour is the surface a panel sits on, so only the handle was visible. Panel fields now use the border colour for it.

## 0.29.0

### Minor Changes

- 8e6868c: The chat can tell the assistant the viewer's date in their own time zone. `<civitai-chat>` takes a `time-zone` attribute (also `timeZone`), an IANA name such as `America/Chicago`: the system prompt's date line then gives that zone's calendar day, weekday and name ("Today is Thursday 2026-10-22 (America/Chicago).") instead of UTC's date, so late in the evening west of UTC "today" is still the viewer's today. Subagents get the same line. Unset, or a name the runtime does not know, the line is UTC's date exactly as before. A server runner on `/core` passes the same zone as `buildSystemPrompt({ timeZone })`; `dateLine(now, timeZone)` is that one line.

## 0.28.0

### Minor Changes

- d6c6c35: The chat balance has **Withdraw**, which pays what is left back to the viewer, and a balance left unused for 7 days is now paid back rather than lost. Needs the orchestrator release that refunds a single depositor's fund (`POST /v2/consumer/funds/{id}/refund`, and on expiry). Balances opened before it keep the old rule.
- aaed7ea: A reply step whose stream the network cut no longer pays for a second orchestration workflow when it is asked for again. The chat reads the step's workflow id from orchestration's `X-Civitai-Workflow-Id` response header and, before asking again, reads that workflow back: one that succeeded has its answer (words and tool calls) rebuilt with no new request, and what it cost counted on the reply, one still running is waited for (at most 10 minutes), and one that failed, has no answer, or is still running after that is canceled when still running before the step is asked for again. Stop (or any request given up on mid-answer) now cancels the step's workflow, so the model stops working on it. An orchestration without the header gets the old behaviour.

  `createAssistantModel` takes a new, opt-in `recoverWorkflows: boolean` option (`<civitai-chat>` turns it on; other callers are unchanged).

- 7101b12: An image in an added MCP server's tool result (a JPEG, PNG, WebP or GIF, such as a screenshot of the app) is now shown to the assistant once, in the next step, instead of being dropped. It goes to the model as a message right after that step's tool results, and the result itself keeps a one-line note in its place: the saved conversation holds only the note, never the image. A result shows at most 2 images and 512 KiB in all; anything past that, other image types and other binary content (which was dropped silently) are left out with a note saying why. A model that takes no images refuses that request; the step is then asked for again without the image, and no image is sent for the rest of the reply. A server runner on `/core` gets this through `AgentCore` and `extraToolSet` with no change.

### Patch Changes

- d6c6c35: The free allowance shows as a percentage ("74% free", "26% used") instead of a count of replies, and is called the free allowance: one reply can take several model calls (a search, a price check), each drawing on it, so a count of "replies" read as double charging. The top-up card and the balance details say that each step the assistant takes uses about 1 Buzz.
- d6c6c35: A reopened chat no longer shows Buzz spent on free replies: saving a turn was assumed to cost 1 Buzz until a save in the session said otherwise, but saves cost nothing.

## 0.27.0

### Minor Changes

- d1ce3b2: An added MCP server's `resultLimit` sets how much of each of its replies (and errors) the assistant gets: `{ head, tail }` keeps those counts from the start and end instead of 2,000 and 6,000, and `false` passes replies whole, for a server that caps its own. Unset, nothing changes. It applies on the element (`mcpServers`) and to a server runner using `McpServerPool` + `extraToolSet` from `./core`, which also exports `limitResult` and the `ChatMcpResultLimit` type. A zero `tail` now keeps nothing from the end, where `keepEnds` used to return the whole text.

## 0.26.0

### Minor Changes

- c2a645d: Once a model's free replies are used up, replies draw from a prepaid chat balance instead of the viewer's Buzz. The chat says when the free replies come back and offers to top up 100 Buzz, once or whenever the balance runs out. A badge in the top bar shows the free replies left and the balance, and tops it up. A free reply that is slow to start no longer switches to a paid one.

  The Buzz spent in a chat now counts each reply at what it was charged, read from the orchestrator's closing usage (`stream_options.include_usage`, `usage.cost` in Buzz), so a free reply counts 0 and a premium model its real price. Replies saved before this keep the old estimate of 1 per call. Needs orchestrator v2.48.8 or later; older ones report the provider's USD cost there.

- 8408f83: Settings → Your chats has **Delete all chats**: after a warning that it can't be undone, it deletes every chat and what was made in it, also those not loaded into the list yet. Not offered where a host's runner must stop a reply before its chat can go.

### Patch Changes

- 8408f83: Links follow the viewer's "Show mature content" setting: with it on, model cards, the models a result was made with, a new post's link and the links in the assistant's replies go to civitai.red, where mature content is shown; with it off, to civitai.com.
- 8408f83: A panel choice's text may hold placeholders of its own (`"Calm": "a calm {{voice}} voice"`): they are filled in when it runs, and count as using that input. An input the run never uses is left out of the panel, with a note to the assistant, instead of refusing the panel. After three refused panel calls in one reply, the assistant is told to stop and tell the user instead of trying again.
- 8408f83: The Civitai MCP's browse tools (model and image search) are now called as the signed-in viewer, not anonymously, so what they find can follow the viewer's own preferences. If the server refuses the viewer's token, the chat carries on anonymously for the rest of the session.

## 0.25.0

### Minor Changes

- 4581568: The chat now asks before every generation by default: `configureChat({ autoRunLimit })` defaults to 0 (was 100). A viewer who saved a limit keeps it. The confirmation offers **Yes, don't ask up to X Buzz** beside **Go ahead**, where X is the smallest Settings choice (25, 50, 100 or 250) that covers a fixed price: it runs the job and sets the viewer's limit to X. A variable price, or one above 250, still only offers Go ahead. `<civitai-chat-generation-card>` gains `raiseSteps` and the `job-raise-limit` event (`{ limit }`); the steps are exported as `AUTO_RUN_STEPS`.

  The confirmation now says what it would make: the request in its own words (a prompt, a song description, a script) under the title, up to three lines, so "Make it?" and **Adjust** refer to something on screen. `GenerationJob.request` and the card's optional `CardJob.request` carry it.

- 4581568: A panel's model list can grow past what it offered. A panel with a `model` choice (every **Adjust** panel) ends that choice with **Find another model…**, which starts the request in the message box for the viewer to finish and send; model cards from a search get **Generate with**, which asks it to add that model (by AIR) and select it, instead of only linking to the site. `update_panel` gains `addOptions` (`{ "<input>": { "<label>": settings } }`), which adds choice options and keeps the existing ones, and the panel context shows the settings behind each choice's selected option so the assistant can copy them with the new model swapped in. Before, asked to add a model, the assistant could only replace the whole choice and said it had added one when the list was unchanged. `<civitai-chat-model-card>` gains `action` and the `model-use` event.

  A LoRA goes on top of the picked model instead of standing in for one: a panel's run input can spread blocks of settings in turn (`"input": {"...": ["{{model}}", "{{lora}}"]}`), so a **LoRA** choice (with **None**) applies to whichever model is selected, and the assistant is told to set panels up that way.

- f358018: - A reopened chat brings back the post card for a picture a panel made. Panels are now restored before posts, so a post of a panel's run finds its picture; before, the card was silently left out.
  - Panels can be closed: a × on the panel, and a `close_panel` tool for when the viewer asks the assistant. A closed panel folds to one line with **Reopen**, keeps what it made, stays closed after a reload, and is left out of what the assistant is told until it is changed or reopened. `update_panel` no longer has to stand in for closing, which only moved the panel down.
- c439b15: Server runner (`runner="remote"`): a reply that ends on the page without the run saying so (the runner refused Stop, Stop's 10-second grace ran out, or the runner refused the viewer the reply's events) now keeps what it had shown, instead of going blank when the chat is read again; only a saved reply that finished, or holds more, replaces it. A chat the page left and came back to while its live-run lookup was on its way is now looked up again and followed. An event stream that ends its last event with a bare CR blank line delivers that event.

  **Type change:** `ChatSubagentStatus` (a subagent result's `status`) gains `'unreceived'`: a subagent of such a reply whose result never reached the page (its card reads "Result not received"), with the new optional `changedCount` for a write subagent's files changed when last seen. A page that maps every status (e.g. a `Record<ChatSubagentStatus, string>`) needs an entry for it; this is a minor for that reason, as `'interrupted'` came in a minor (0.20.0).

- d655999: A live reply now shows a status line under it from the moment it starts until it ends, with how long it has run: _Working · 0:42_. Before, the busy dots showed only before the first words and between a finished call and the next step, so a reply went blank, looking frozen, while the model wrote words or a long call it had not sent yet, and while a call whose own card shows nothing moving ran. The line reads _Reconnecting…_ while the connection is down (a dropped model stream asked for again; with `runner="remote"`, the runner's event stream silent past a missed keep-alive (20 s) or opened again, or the runner asking its model again after a drop) and _Still working on the server_ for a server-runner reply the page found running when it opened the chat (a reload, another device), counting from when that run started. Its polite `role="status"` region says each change of state once (the start is said once, by the thread), never the seconds. With `prefers-reduced-motion: reduce` its dots hold still.

  New: `awaitingApproval` (attribute `awaiting-approval`) on `<civitai-chat>`. A page that asks the viewer to approve calls itself (a `beforeToolCall` that waits for a click, or approval cards it draws for a server runner's gate) sets it while a call waits, and the line reads _Waiting for your approval_. It goes back to `false` by itself when the reply it was set during ends, so a Stop while a call waited does not start the next reply on it.

  `LiveTurn` (the agent's `live`) gains the optional `startedAt`, `reconnecting` and `reattached`.

- b8ebf7c: The assistant can change its own standing instructions when the viewer asks it to behave differently from now on (a personality, a tone, a name, something to always do or avoid). Its `update_instructions` tool proposes the complete new text on a card, where the viewer can edit it; **Save** writes it to Settings → Custom instructions, used in every chat from the next reply, and **Not now** leaves them as they were. Nothing changes without Save, so text the assistant reads elsewhere cannot rewrite its instructions on its own. The card stays saveable after later replies until it is saved or put aside; one already saved reads as saved.

### Patch Changes

- f455917: A failed tool call the assistant fixed itself (the same tool worked later in the reply) no longer shows "… didn't work" with the raw error; a failure nobody fixed still does.
- 4581568: - An option added to a panel's choice without a value is selected, so the panel shows the model the viewer asked for.
  - A choice option with a long label keeps its settings: labels, their settings' keys and a value picking one are cut to 60 characters alike. Before, a long model name lost its settings and the run sent the label as the input.
  - A block choice used as a field inside another option's settings (`"loras": "{{lora}}"` in a model's settings) is refused with the spread to use, and the advice for an unused block choice is to spread it beside the model, not nest it.
  - Failed tool calls show no note while the reply is still running (the assistant may yet fix them); one never fixed shows once the reply ends.
  - **Adjust** prices other models in rank order, four at a time, until it has eight, and asks each service for its input schema once per session, instead of firing about eighty requests at once.
  - The assistant is told to make one `run_step` per thing the viewer asked for, never two versions side by side.

## 0.24.0

### Minor Changes

- 2f2ccbe: A host `backend` can bring its own speech-to-text: `backend.transcribe(audio, { language, signal })` resolving to `{ text }` (types `ChatTranscribe`, `ChatTranscribeOptions` and `ChatTranscription`, on both `ChatBackend` and `ChatStoreBackend`). With it, `<civitai-chat>` offers the microphone on a backend, in `runner="browser"` and `runner="remote"` alike: the viewer records, sees the level, stops to edit or sends, and each recorded phrase goes to `transcribe` with the language chosen beside the microphone; cancelling aborts `signal`. Words are not streamed live, and the spoken conversation (`voice-conversation`) stays off on a backend. Without `transcribe` a backend still has no microphone, and a chat on Civitai dictates as before. `<civitai-chat-composer>` gains `hostVoice` (`host-voice`), which records phrases only and shows no Buzz price.

## 0.23.0

### Minor Changes

- 3f80548: A generation whose mature results are shown blurred, because it was paid with Buzz that doesn't cover mature content, now offers **Unlock** on its card. Unlocking pays for it with Buzz that does and refunds the first payment (`PUT /v2/consumer/workflows/{id}` with `allowMatureContent: true`), then shows the results from a fresh read. With too little Buzz, the card says so and links to getting more. It is offered only to a viewer who shows mature content. `CardJob` gains optional `locked`, `unlocking`, `unlockError` and `unlock()`.

  The model list leaves out OpenRouter's `:batch` variants, which answer hours later and never within a chat reply.

  Settings no longer has an **Assistant** choice. Each chat's model picker is where a model is chosen, and a chat without its own model uses the page's `model`; replies use free replies while they last, then Buzz. A default model or a Free-only / Always-paid choice saved by an earlier version is ignored. `Settings` loses `assistantModel` and `assistantTier`, and `<civitai-chat-model-picker>` loses `defaultModel`.

## 0.22.1

### Patch Changes

- ff6e71f: Export MCP connection, result trimming and host-tool helpers from /core for server runners: `createMcpConnection` (with `McpConnectionClosedError`, `McpStreamLostError` and the connection types), `mcpResultToText`, `keepEnds`, `hostToolSet` (with its types), `MEDIA_NOTE` and `HOST_TOOL_FAILED_NOTE`.

## 0.22.0

### Minor Changes

- 78efe14: Deep-linking a conversation: `<civitai-chat conversation-id="…">` (property `conversationId`) opens a saved conversation by its id, with the orchestrator store, a host's store, and with the server runner on either (a chat whose reply is still running is followed again). An id with nothing saved under it, or one the store cannot read, shows "Could not open that chat." and leaves the open chat, and any reply running in it, as they are. Opening a chat saves nothing. `chat-change` now carries `saved` (`{ chatId, saved }`), and fires once more when a new chat's first save lands, so a page writes only a saved chat's id into its URL and a reload never asks for a chat that does not exist yet. Stores' `open(id, { existing: true })` rejects with a `not-found` error instead of opening an empty chat, and stores have `isSaved(id)` and a `saved-change` event.

  A host backend's new `newChatModel` option, on a backend with a gateway and on a store-only backend: the model a new chat starts on (say, the viewer's last pick), when it is one of `models`. A saved chat keeps its own model, and one saved without a model keeps following `model`. New `model-change` event (`ModelChangeDetail`: `{ chatId, model }`) when the viewer changes the open chat's model.

- 10c5103: Experimental: `runner="remote"` now works with a host's own conversation store. Pass a store-only backend (`ChatStoreBackend`: `store`, `model`, `models`, and no `url` or `fetch`). The chat list, opening a chat and deleting one go to the host's store, and each reply runs on the server runner, which is the only writer of the saved conversation: the page never calls `store.save`, and sends title and model changes to the runner as patches. Deleting a chat in this mode first stops its live run on the runner and waits until the runner lists it as ended (its final save done), with the chat's row shown busy; if the runner cannot be reached, refuses the stop, or the run has not ended within the runner's timeout, nothing is deleted and the viewer stays on the chat with an error saying which. In remote mode, a backend that names a gateway (`url` or `fetch`) is refused, and so is a backend without a `url` in the browser; a blank `url` counts as none in both modes. `<civitai-chat>` shows such a refusal in place of the chat instead of an endless spinner, and setting `runner` or `remoteRunner` afterwards starts it again. `runner="browser"` with a gateway backend and `runner="remote"` without a backend are unchanged. `@civitai/components-chat/core` now also exports the page's MCP-to-tools adapter (`McpServerPool`, `extraToolSet`, `namespacedToolName`, `RESULT_HEAD_CHARS`, `RESULT_TAIL_CHARS`), so a server runner gives an MCP server's tools the same `${id}__${tool}` names and the same trimmed replies as the page. The run protocol is unchanged.

## 0.21.0

### Minor Changes

- ee75914: Experimental server runner: `<civitai-chat runner="remote">` with `remoteRunner = { url, headers, pageState }` runs each reply on a server that implements the new run protocol (`@civitai/components-chat/runner-protocol`), so a reply keeps going while the page sleeps or closes. The page follows the run's event stream into the same thread, tool views and subagent cards, reconnects with `Last-Event-ID` after a drop or a wake, finds a chat's live run again after a reload, and Stop asks the runner to stop. In remote mode the runner is the only writer of the saved conversation. The default stays `runner="browser"`, unchanged. New `@civitai/components-chat/core` entry: `AgentCore` and the rest of the reply loop with no DOM or Lit imports, for running it in Node. Both new entries are experimental: protocol v1 may change in a minor release until the first server runner ships.

### Patch Changes

- 5ddb17a: The default chat model is now `civitai/qwen3.8`, the orchestrator's alias for its current Qwen 3.8 deployment, and is shown by that name. The model list offers the orchestrator's hosted models by alias only: the AIRs behind them are no longer listed, though a typed AIR still works. OpenRouter models show their input and output price per million tokens ("$0.15 in · $0.60 out /M").

## 0.20.0

### Minor Changes

- 31eacec: Write subagents, off unless the page opts in. `subagents.write` (`{ tools, instructions?, files?, commands? }`) lets `dispatch_agent` take `mode: "write"`: a subagent that may use any tool in `write.tools` (a free-form command tool included; never `dispatch_agent`, `ask_choice`, `open_panel` or `update_panel`), with write rules in its system prompt and `write.instructions` after them. Its result adds `mode: 'write'`, `changed: { path, op }[]` (built only from the successful results of the tools named in `files`, never from the subagent's words) and `ranCommands` (calls to the `commands` tools that ran; what they changed is not in `changed`). Its calls reach `beforeToolCall` and `tool-result` with `subagent` set, like a read subagent's. A write subagent saves its progress with the reply's, so one interrupted by a closed page comes back on Continue as `status: 'interrupted'` with the `changed` list saved so far, and is never run again. Its card says "Subagent · edits" with files changed and commands run. Concurrent write subagents are not kept apart (no path scopes or locks): two may edit the same file. Stop stops every subagent; there is no per-subagent Stop. Without `write`, `mode: "write"` is refused as before, and read subagents are unchanged.

## 0.19.0

### Minor Changes

- 6fb166b: Read-only subagents, off unless the page opts in. Set `subagents` on `<civitai-chat>` (`{ tools, instructions?, model?, maxLive?, maxPerReply?, maxSteps?, maxToolCalls? }`) and the assistant gets a `dispatch_agent` tool that starts another assistant on one research task, in its own context, with only the allowlisted tools (never `dispatch_agent` itself or a tool that waits for the viewer), and gets back a short result (`status`, `summary` cut to 4,000 characters, `steps`, `toolCalls`, `activity`), never the transcript. Caps default to 3 running at once, 8 per reply, 30 steps and 40 tool calls per subagent. A subagent's calls reach `beforeToolCall` and the `tool-result` event with the reply's own `reply` number and a new `subagent` field (the `dispatch_agent` call's id), so a page's per-reply tool budget can leave them out. `mode: "write"` is refused. Every output of the chat's own `dispatch_agent` carries `kind: 'subagent'`; only those show as cards and count in the badge. Stop, and a page `stop: true` on one of the reply's own calls, end every subagent; a subagent that reaches its tool-call cap takes one last step in words; each shows as a card in the thread (live, and from the saved result after a reload); the Buzz badge counts subagent steps and says how many it includes. Without `subagents`, the reply's tools are exactly as before.
- 9571fe7: `<civitai-chat voice-conversation>` offers a hands-free spoken conversation: the viewer talks, each reply is read aloud as it streams, and talking over a reply stops it. An end-of-turn model decides when the viewer has finished, so a pause to think is not cut off. Nothing for it loads or is billed until the viewer starts one; the voice is set with `configureChat({ conversationVoice })`.

## 0.18.0

### Minor Changes

- e69e6d0: A reply is saved as it runs, call by call, so a page that sleeps, closes or is unloaded mid-reply loses at most the words of the step it was on, and Continue never runs a call again.

  - **Checkpoints as it runs.** While a reply runs, the conversation head is saved as v3 as each tool call starts, as each result comes in and as each step finishes, with the reply `running`, every step so far and the time of that save. Continue sends a call that finished with its own result, and one that started and did not finish as `interrupted: this call did not finish and was not re-run`. Neither runs again. Its end is saved as before, as v2 again. Each save is a free metadata update of the turn's own head. At most one waits at a time, and steps that finish while it waits go with it.
  - **Single writer in a tab.** Every save of the chat (title, model, post, panel, step) is built from everything the tab holds when it goes, one at a time, so none of them drops another's change. A post saved mid-reply keeps the reply running instead of dropping its steps.
  - **A reply still running elsewhere reads live as long as its steps keep landing**, however long it runs. Before, it read live only for 5 minutes from its start.
  - **Which tab runs it.** A tab running a reply holds a Web Lock for it. Another tab of the browser reads the reply as still replying while the lock is held, however old its last save. The tab also notes the reply in its `sessionStorage`, so the tab reloaded (for example after the browser unloads it to save memory) reads its own reply as gone at once once the lock is free, with Continue where it can, instead of "Still replying…" for 5 minutes. A copy of the tab does not take the original's running reply as its own.

  Pages showing these chats need 0.17.0 or later first: older versions leave a v3 head out of their list, and show it as an empty chat when opened.

## 0.17.0

### Minor Changes

- d2734bb: Groundwork for replies that survive a sleeping or closed page, and a reply still running in another tab no longer reads as cut off.

  - **A reply still running elsewhere says so.** A reply that had not ended when the chat was last saved used to read "This reply was cut off. Ask again?", even while another tab or window was still running it, inviting a second run paid twice. Its save time now decides (the turn's start for v2, the latest step's save for v3). Under 5 minutes (`LIVE_REPLY_MS`) it shows "Still replying in another tab or window…" with nothing offered, and the chat reads itself again on view, on focus and as it passes 5 minutes. Past that, it is cut off as before.
  - **Reads v3 conversation heads.** v3 is v2 plus a reply saved while it was still running, with the steps it had finished and the save's time. Gone (past 5 minutes) with finished steps whose every tool call has its result, it offers **Continue**, which carries on from those steps through Retry's path, so no tool in them runs again. This version still writes v2. A v2 reader leaves v3 heads out of its list, so this reader ships before any v3 writer. Heads of any other version are still left out.
  - **Headless `AgentCore`.** The reply loop (steps, stop conditions, automatic retries of a dropped connection, the parts shown so far) moves out of `Agent` into `AgentCore`, which has no store, page or element. `Agent` keeps its surface and delegates to it. `agent.live` is now a read-only getter.

- 11de101: **A chat on a host's own `backend` shows the examples its page sets with `examples`.** Clicking one puts its `prompt` in the message box, as on any other chat; that chat takes no files, so `wantsFile` opens no picker there. With `examples` unset it still shows none, and never the built-in ones (making a picture, a song…), and an empty list shows none. The greeting stays plain: no Buzz fine print, the same heading and user name as before. A chat without a `backend` is unchanged.
- 763b1ad: **The model button names the default model, the Buzz badge opens its breakdown, and the assistant's replies sit in a bubble that never widens the thread.**

  - The model picker shows the default model by its name with a marker ("GPT-6 Luna · default"), never the bare word "Default": the page's label for that model, else OpenRouter's name, else its id made readable (`urn:air:…:org/Qwen3.8-27B@main.tar` → "Qwen3.8-27B"). A viewer who set their own default in Settings sees that model's name, marked the same way, and the Settings dialog's Assistant choice shows the default model's name with the marker too. Typing "default" or the default row's whole name picks that row, and `/model default` works as before. `buildModelList` now labels its `default` entry with the model's name (no longer `'Default'`); the marker is added where it is shown.
  - The Buzz badge in the top bar ("≈ 12") is a button that opens the breakdown: the total, what was made, the assistant, and a line saying it is an estimate of the Buzz spent in this chat. It used to show this only in a hover tooltip, which a phone never shows. It opens on click, Enter or Space, has `aria-expanded` and `aria-controls`, closes on Escape with focus on the badge or in the breakdown (focus goes back to the badge; Escape elsewhere, such as in the message box, is left alone) or a click elsewhere, and is a 44px touch target. It still shows nothing at 0.
  - The assistant's text sits in a left bubble on the surface colour; tool calls, cards and what it made stay outside it, and the viewer's bubble is unchanged.
  - Fixed: a long reply (a code block, a long unbroken word or link) made the whole thread scroll sideways on a phone. A code block now scrolls inside itself and the rest wraps.

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
