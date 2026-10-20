# @civitai/components-chat

`<civitai-chat>`: a Civitai assistant as one element. People ask in plain words; it finds Civitai
models, makes images, video and music on the viewer's Buzz, edits and upscales what they upload, and
keeps their chats in their Civitai account. It belongs with [`@civitai/components`](../civitai-components):
same `civitai-*` tags, same theme, same entry-point layout. It is its own package only because it
carries an AI agent (the Vercel AI SDK and an MCP client) that a page with a few buttons should not
have to install.

```ts
import '@civitai/theme/styles.css';
import '@civitai/components-chat/civitai-chat/define';
```

```html
<civitai-chat scope="moodboard"></civitai-chat>
```

`civitai-chat/define` registers only what an empty or signed-out chat shows. The agent, its tools
and the thread (about 240 kB gzipped, most of it the AI SDK) load with `import()` once the chat has a
signed-in client, so a page where nobody opens the chat never downloads them.

## Signing in

A host with its own sign-in, model gateway and storage skips this: see [Your own backend](#your-own-backend).
Otherwise the chat needs an `AppClient` from [`@civitai/sdk`](../civitai-sdk) with `ai:write:budgeted`. A page
that already has one hands it over, and the chat shares its session, token refresh and grant
requests. The chat sends that client's token straight to the orchestrator (its chat model, its MCP
and its workflow routes), so the token must be an OAuth access token:

| The page | `chat.app` |
|---|---|
| A browser app on `createSignIn` | `await initialize(auth)`, the client it already uses |
| An app whose server holds the tokens | `await initialize({ token: () => fetch('/api/civitai/token').then((r) => r.text()), requestGrants: () => true })`, behind a route that returns the session's access token |
| A block on civitai.com | `await initialize()`, only with an OAuth token: see below |

Inside a civitai.com block the host hands over the block-scoped token by default, and the
orchestrator accepts no block token on any route, so every reply and every generation is refused.
The chat works in a block only when the host hands it an OAuth access token instead; when and how
it does is in `@civitai/sdk`'s README, under [`initialize()`](../civitai-sdk/README.md#initialize)
and its [When the token is the block-scoped one](../civitai-sdk/README.md#when-the-token-is-the-block-scoped-one),
and the manifest also asks for `ai:write:budgeted`. Nothing proxies the endpoints this chat calls
(the orchestrator's chat model and MCP). The block routes under `/api/v1/blocks/workflows/*` can
run a `chat-completion` step, which keeps the block path's controls, but `<civitai-chat>` does not
use them. And with an OAuth
token the chat's generations go to the orchestrator directly, without the spend caps, maturity clamp
and app attribution the block routes add (`@civitai/sdk`'s
[`BREAKING.md`](../civitai-sdk/BREAKING.md#what-a-direct-orchestrator-call-loses)).

Or the chat opens signed out and asks only when the viewer first sends something. `popupSignIn`
runs the page's own `createSignIn()` in a popup (`@civitai/sdk` 0.9 or later), so the page is never
navigated away from:

```ts
import { createSignIn } from '@civitai/sdk';
import { popupSignIn } from '@civitai/components-chat/civitai-chat';

const auth = await createSignIn({ clientId, scopes: ['ai:write:budgeted'] });
const chat = document.querySelector('civitai-chat')!;
chat.signIn = popupSignIn(auth);
```

Civitai returns the popup to the page, whose own `createSignIn()` call completes it. Before the first
message the chat calls `app.requestGrants(['ai:write:budgeted'])`: it resolves at once when the scope
is held, and a refusal sends nothing and keeps the message. A client built from a bare `token`
refuses every grant request, so a server-side session that holds the scope passes
`requestGrants: () => true`. The chat never keeps a token in storage.

## Your own backend

A host that runs its own model gateway and storage can use the same element without Civitai: its
own sign-in, its own OpenAI-compatible gateway (which may run as the signed-in viewer and enforce
its own limits), its own conversation storage and its own MCP servers. Set `backend` instead of
`app`:

```ts
import type { ChatBackend, ChatConversationStore } from '@civitai/components-chat/civitai-chat';

const csrf = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')!.content;
// Every request the chat makes to the gateway goes through this: the host's session cookie and CSRF header.
const send: typeof fetch = (input, init) => {
  const headers = new Headers(init?.headers);
  headers.set('X-CSRF-Token', csrf);
  return fetch(input, { ...init, headers, credentials: 'include' });
};
const ok = async (response: Response) => {
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  return response;
};
const chats = (path = '') => `/api/chats${path}`;

const store: ChatConversationStore = {
  list: async ({ scope, cursor }) =>
    (await ok(await send(chats(`?${new URLSearchParams({ ...(scope ? { scope } : {}), ...(cursor ? { cursor } : {}) })}`)))).json(),
  load: async (id) => {
    const response = await send(chats(`/${encodeURIComponent(id)}`));
    return response.status === 404 ? null : (await ok(response)).json();
  },
  save: async (conversation) => {
    await ok(await send(chats(`/${encodeURIComponent(conversation.id)}`), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(conversation) }));
  },
  delete: async (id) => {
    await ok(await send(chats(`/${encodeURIComponent(id)}`), { method: 'DELETE' }));
  },
};

const chat = document.querySelector('civitai-chat')!;
chat.backend = {
  url: '/api/llm', // replies are POST /api/llm/v1/chat/completions
  fetch: send,
  model: 'assistant-default',
  models: [{ id: 'assistant-large', label: 'Large', note: 'Slower, more thorough.' }], // optional
  store,
} satisfies ChatBackend;
chat.mcpServers = [{ id: 'tools', url: '/api/mcp', label: 'Tools', fetch: send }]; // signed in like the gateway
chat.systemPrompt = 'You are the assistant in Acme Notes. …'; // the built-in rules talk about Civitai
```

Set `backend` once, with an object you keep: the chat compares it by identity, so assigning a new
object, even an equal one, starts a new session (the open chat is reloaded from the store).

With `backend` set the chat starts at once, with no `app` and no sign-in (`app` and `signIn` are
then ignored), and it never sends a request to Civitai or to OpenRouter. Everything that runs on
Civitai's services is off and not shown: the built-in orchestration and Civitai search tools (so
`mcp` has no effect), generations, panels and their studio, file uploads, the microphone, posting,
Buzz prices, spend and the free-reply choice, sign-in and sign-out, and the welcome's examples. What
keeps working: `mcpServers`, `tools`, `toolViews`, `beforeToolCall`, `instructions`, `systemPrompt`,
`commands`, `scope`, `layout` and `full-page`, the chat list, rename, delete and export, and in
Settings the theme (full-page), **Longest reply step** and custom instructions. Set
`configureChat({ name })` for what the chat calls itself.

| `backend` field | |
|---|---|
| `url` | The base of an OpenAI-compatible API; replies are `POST ${url}/v1/chat/completions`. May be relative to the page. |
| `fetch` | Makes every request to `url`, so the host signs it in its own way (a cookie, a CSRF header). The chat adds no `Authorization` header. The page's `fetch` when unset. |
| `model` | The model id a chat uses unless the viewer picks one of `models`. Chats are named with it too. |
| `models` | Optional `{ id, label, note? }[]` the viewer may pick for a chat, by the button beside the message box or `/model <label>`. Without any, the button and `/model` are gone. Only these ids are ever sent: a chat saved with another model uses `model`. |
| `store` | Where conversations are kept: see below. |

### The model endpoint

A reply is one or more `POST ${url}/v1/chat/completions` requests, one per step, in the OpenAI Chat
Completions format: `model`, `messages` (`system`, `user`, `assistant` with `tool_calls`, and `tool`
with `tool_call_id`), `tools` (`{ type: 'function', function: { name, description, parameters } }`,
parameters as JSON Schema), `max_tokens`, `temperature`, `stream: true`, and `tool_choice` (`'auto'`, or
`'none'` on a reply's last allowed step, which must answer in words). Answer with `text/event-stream`:

```text
data: {"id":"r1","object":"chat.completion.chunk","created":0,"model":"assistant-default","choices":[{"index":0,"delta":{"role":"assistant","content":"Hello"},"finish_reason":null}]}

data: {"id":"r1","object":"chat.completion.chunk","created":0,"model":"assistant-default","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}

data: [DONE]
```

A tool call streams as `delta.tool_calls: [{ index, id, type: 'function', function: { name,
arguments } }]` (the arguments as a JSON string, in pieces if you like) and ends with
`finish_reason: "tool_calls"`. The chat runs the tool itself (a page tool or an added MCP server's)
and sends the next request with the `assistant` message carrying the call and a `tool` message
carrying the result. Naming a new chat is one request without `stream`, answered with a plain JSON
`chat.completion` (`choices[0].message.content`).

### Errors

When the gateway refuses, its own words reach the viewer: the reply ends in the error card with
them, and `reply-error`'s `detail.message` is the same text. Answer with a non-2xx status and a body of

```json
{ "error": { "message": "You have used this month's budget. It resets on the 1st." } }
```

on a 4xx status (`{ "error": "…" }`, `{ "message": "…" }` and a plain-text body work too; the first
500 characters are shown, and an HTML page is never shown). A 5xx body is never shown, since it is
more often a stack trace or an upstream provider's error than words for the viewer: the viewer gets a
plain sentence, `detail.detail` (shown under Details and saved with the turn) only names the status,
and the body stays in `reply-error`'s trace, which is neither saved nor shown whole: in
`detail.trace.responseBody`, and for a JSON body with a message also in `detail.trace.message` (scrub
both if the page sends the trace anywhere). An error after the
stream started is a frame of the same shape, `data: {"error":{"message":"…"}}`, and is shown. Without
a message the viewer sees a plain sentence that names neither Civitai nor Buzz.

408, 409, 429 and 5xx are retried twice first, honouring `Retry-After` (or `retry-after-ms`) under
60 s, so the message shows after the last try; answer a refusal that retrying cannot change with 402
or 403. A retry is the same request again, with no idempotency key: if the gateway already did (and
charged for) the work before it answered with a 5xx, the retry does it again. Only the model request
is retried; a tool call is never run again by a retry. `detail.kind` is a best guess from the status
(402 `insufficient_buzz`, 401/403 `auth`, 429 `rate_limit`, 502/503 `unavailable`) and the words.

### The conversation store

```ts
interface ChatConversationStore {
  list(options: { scope?: string; cursor?: string }): Promise<{ items: ChatConversationSummary[]; next?: string | null }>;
  load(id: string, options: { scope?: string }): Promise<ChatConversation | null>;
  save(conversation: ChatConversation): Promise<void>;
  delete(id: string, options: { scope?: string }): Promise<void>;
}

interface ChatConversationSummary {
  id: string;
  title: string;
  updatedAt: string; // ISO 8601
}

interface ChatConversation {
  id: string; // made by the chat (a ULID)
  title: string;
  titleSource: 'first-message' | 'llm' | 'user';
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601, the latest message
  turns: ChatSavedTurn[]; // the chat's own JSON: keep it as it is
  model?: string;
  scope?: string; // the chat's `scope`
}
```

- `list` returns the viewer's conversations in `scope`, newest first; `next` is a cursor for the
  following page (the chat asks for it with **Show older chats**), absent or `null` on the last.
- `load` returns a conversation exactly as last saved, or `null` for an id the store does not have
  (the chat then opens it empty). The chat loads a conversation only after any save of it still on
  its way, so what loads is never older than what it saved.
- `save` creates or replaces the whole conversation. It is called when the viewer sends a message
  (with the reply still missing, so a reload mid-reply shows it as cut off), when the reply ends,
  when the chat is named or renamed and when its model changes. Saves of one conversation come one
  at a time, in order; each carries every turn so far. Renaming a chat that is not open is a `load`
  then a `save` of the same record with the new title (and the chat's `scope`), queued behind any
  save of it still on its way.
- `delete` removes a conversation. It takes its turn among that conversation's writes: saves asked
  before it are made first, and anything asked after it (a reply still running, its title, a rename)
  is dropped once the delete worked, or made as usual if it failed, so a failed delete keeps
  everything said in the chat. A conversation leaves the list, and the viewer leaves it for a new
  chat, the moment its delete starts, so a slow (or hung) delete holds nothing up; it comes back to
  the list if the delete fails. The chat never loads a conversation while its delete runs, and never
  opens one whose delete worked. A conversation deleted twice in a row is deleted once: the chat does
  not ask `delete` again for one it already deleted.
- A chat that finishes loading after the viewer opened or started another one is dropped: theirs
  stays open, with nothing said.
- Any method may reject, and the viewer sees one short note per failure: "Could not load your
  chats." for `list` ("Could not load older chats." for a later page), "Could not open that chat."
  for `load` when they open one (at start-up the chat opens a new one instead), "Could not delete
  that chat." for `delete`, and for `save` "Could not save this chat. It is saved again with your next
  message." once per message sent (even when the viewer has moved on to another chat by the time its
  reply ends), "Could not rename that chat." for a rename, or "Could not save this chat's model; it
  applies until you reload." for a model change, by the model button or `/model`. A chat's automatic
  title is the one save not announced: every later save carries it again. Every save carries the
  whole conversation, so the next one that succeeds makes up for one that failed.
- Every method must settle (resolve or reject), with a timeout of the host's own if its server can
  hang: saves of a conversation wait for each other, and opening, renaming or deleting it waits for
  its saves, so a save that never settles holds that conversation back for the rest of the session.

Conversations are the host's to keep, for as long as it likes; the chat stores nothing on the page
but preferences (in `localStorage`, by `scope`).

## The page's own tools

```ts
import type { ChatTool } from '@civitai/components-chat/civitai-chat';

chat.tools = {
  pin_to_board: {
    description: "Pin a picture from this chat to the user's board.",
    activity: 'Pinning it to your board…',
    inputSchema: { properties: { file: { type: 'string' } }, required: ['file'] },
    execute: (input, { files }) => board.add(files[0].url), // file ids arrive as fresh URLs
  },
} satisfies Record<string, ChatTool>;
chat.instructions = () => `The board has ${board.size} pins.`; // read at every reply
```

A tool's call shows as its `activity` while it runs and as nothing once done, unless it has a
`render`. It is called again on every change, so it can show progress and the result:

```ts
chat.tools.pin_to_board.render = (call) => (call.state === 'done' ? `Pinned to “${(call.output as { board: string }).board}”` : undefined);
chat.toolViews = { search_models: { activity: 'Browsing the catalog…' } };
```

### Showing what the assistant called

A page whose assistant uses many tools (an added MCP server's, say) can let the viewer see what it
did. Set `tool-calls="details"` (or `chat.toolCalls = 'details'`); the default, `activity`, is the
behaviour above.

```html
<civitai-chat tool-calls="details"></civitai-chat>
```

With `details`, every call that would otherwise show nothing once finished stays in the thread as a
row: the tool's name (and its server's id, for a tool of a server now in
[`mcpServers`](#more-mcp-servers); any other name, `__` or not, shows whole), a short line of its input, and Running, Done or Failed. Clicking or tapping it opens the whole input and the
result or error, pretty-printed in a box that scrolls rather than widening the thread; past 50,000
characters a value is cut, with a note of how many more there were. Calls in a row, with no words
between them, fold into one row, "Used 3 tools" ("Using 3 tools…" while any still runs, and how
many failed), which opens to the calls. A single call is not wrapped in a group; one the viewer
opened that becomes the first of a group as the reply streams opens the group with it, and focus on
its button moves to the same row in the group. The rows are
buttons with `aria-expanded`, so the keyboard opens them too, and opening animates only without
`prefers-reduced-motion`.

A call that has a view keeps it, exactly as with `activity`, and ends a run: a `render` in
`toolViews` or `tools`, the built-in generation, panel, post and choice cards, and a call that
answered with model cards. A `render` that returns `undefined` for a call (the built-in cards do
when their generation, panel or post is not there) shows nothing of its own, so that call is a row.
A failed call with a `render` also keeps its "didn't work" note. A chat
reopened from storage groups the same as it did live.

| Property | What it does |
|---|---|
| `app` | The signed-in `AppClient`; the chat starts when it is set. |
| `backend` | A host's own model gateway and conversation store, instead of `app`: see [Your own backend](#your-own-backend). |
| `signIn` | `({ signal }) => Promise<AppClient>`, called from the viewer's click or key press when they first send something without `app`. Reject with an error whose `code` is `'canceled'` when they give up; their message stays in the box. |
| `tools` | The page's own tools, by name: `description`, `inputSchema` (JSON Schema), `execute(input, { files })`, optional `activity` and `render`. A built-in tool of the same name wins. |
| `toolViews` | How calls of any tool show, by tool name, including built-in and Civitai ones: `activity` (the line shown while it runs) and `render(call)`, which replaces the card with a lit template, DOM node or string; return `undefined` to keep the default. `call` is `{ name, input, state, output, error }`. |
| `tool-calls` | `activity` (the default: a line while a call runs, then nothing) or `details` (each call with no view of its own as a row to open, calls in a row as one group). Also `toolCalls`. See [Showing what the assistant called](#showing-what-the-assistant-called). |
| `instructions` | A string or function, read at every reply: what the page is and shows. |
| `systemPrompt` | Replaces the built-in rules (a string) or edits them (a function of the defaults). |
| `mcp` | `{ orchestration?: boolean \| { exclude: string[] }, site?: boolean }`, both on by default: making media, and Civitai model search. `orchestration: { exclude: ['run_step', 'run_workflow'] }` keeps the service lookups but never runs (or charges for) a generation; the panels, which run through `run_step`, go with it. Other tools that charge per call, such as `transcribe_audio`, stay unless they are listed too; the microphone button transcribes on its own, not through the assistant, so neither `exclude` nor `beforeToolCall` stops voice input from charging. |
| `mcpServers` | More MCP servers whose tools the assistant may use (property only); see [More MCP servers](#more-mcp-servers). |
| `holdReason` | While set (also `hold-reason`), nothing is sent to the assistant: the message box keeps what the viewer typed, Send is off and the box shows this text, e.g. "The sandbox is starting…". Stop still works. The chat also holds by itself, as "Connecting to *label*…", while an added server is listing its tools (at most 15 s). |
| `beforeToolCall` | `(name, input, { conversationId, reply, signal }) => { refuse: string, stop?: boolean, message?: string } \| { allow: true }` (or a promise of one), asked before every tool call: Civitai's, an added server's and the page's own. A refusal stops the call before anything runs and the assistant gets the reason as the tool's error; a hook that throws refuses too. With `stop: true` the refusal also ends the reply, with no further (paid) step: see [Ending a reply](#ending-a-reply). `reply` is the same number for every call in one reply and a new one for the next, Continue and Retry included. `signal` aborts when the viewer stops the reply: the reply stops at once even if the hook never answers, and the call never runs. See [Gating tool calls](#gating-tool-calls). |
| `scope` | Set before `app`. Keeps the page's chats and preferences apart from every other page's. |
| `layout` | Where the chat list goes: `auto` (a column, or a dropdown at 900px or less of the chat's own width), `compact` or `wide`. |
| `full-page` | Only for a chat that is the whole page: it then sets the theme, takes Ctrl+K and Ctrl+Shift+O, and picks up after a redirect. Embedded, the page keeps all of these. |
| `can-sign-out` | Shows Sign out in settings (with `full-page`); the chat then emits `cvt-sign-out`. |
| `examples` | What an empty chat offers to start from, in place of the built-in ones (property only). On a host `backend` only these show, never the built-in ones. See [The empty chat](#the-empty-chat). |
| `voice-conversation` | Offers a hands-free spoken conversation (also `voiceConversation`); see [Talking with the assistant](#talking-with-the-assistant). Off by default, and never offered with a host `backend`. |
| `placeholder` | The message box's hint while it is empty, in place of the built-in "Ask for a picture, a video, a song… or anything about Civitai" (or "Ask anything" on a host `backend`). Set back to `undefined` (or the attribute removed), the built-in returns; an empty string shows no hint. |

Methods: `send(text)`, `compose(text)` (fills the message box), `giveBack(text)` (see
[A message that waits](#a-message-that-waits)), `newChat()`, `addFiles(files)`, `focusComposer()`. Slot `welcome` replaces what an empty chat shows.

`send(text)` sends as if the viewer typed it and pressed Enter, once the chat has started (signed
out, it asks them to sign in first). While `holdReason` is set it sends nothing and leaves the text
in an empty message box; while a reply is still running it sends nothing. It fires `before-send`
like a typed message. `canSend` says whether it would send now, and `can-send-change` when that
changes: see [When a message can go](#when-a-message-can-go).

### Before a message goes

`before-send` fires with `{ text, queue }` (type `BeforeSendDetail`; it bubbles, is composed and is
cancelable) at the last moment before a new message goes as the viewer's, once per message. Call
`preventDefault()` and the message is not sent, not shown in the chat and not saved. To get something
ready first, say wake the app the reply will work on, call `queue(waiting)` instead: the message shows
at once as the viewer's, marked with `waiting`, and goes when you call `release()` on what `queue()`
returns, with no second `before-send` (see [A message that waits](#a-message-that-waits)).

- **It fires for** a typed message (Enter or Send), the voice recorder's "Send what you said",
  `send(text)`, a choice the viewer clicks in a reply, Continue, a menu action on a result that asks
  for something (such as making a video of it), a message the assistant's own tools send for the
  viewer, and a page command's `send`.
- **It does not fire for** a slash command the chat handles itself (`/clear`, `/model`, `/help`),
  a reply asked for again ("Continue with Buzz", "Allow paid replies and try again", and the
  automatic retries after a dropped connection: none of them sends a new message), a message the page kept back with `queue()` as it goes on `release()`, or a message the chat does not send anyway: one held by `holdReason` (it waits in the
  message box), one sent while a reply is running, and one sent before sign-in finishes (it fires once
  the viewer is signed in and the message goes).
- **Files only:** a message with files and no words fires with `text: ''`.
- **When you cancel**, the message box is already empty (it clears as the viewer sends, before the
  chat asks you), and the files and earlier results added to the message stay attached, for the
  message you send in its place. The text is yours from then on: send it with `send(text)`, or put it
  back for the viewer with `compose(text)` if you decide not to.

```ts
import type { BeforeSendDetail } from '@civitai/components-chat';

chat.addEventListener('before-send', (e) => {
  if (appIsAwake()) return;
  const waiting = (e as CustomEvent<BeforeSendDetail>).detail.queue('Waiting for your app…');
  wakeApp().then(() => waiting.release(), () => waiting.cancel());
});
```

### Which chat is open

`chat.chatId` is the id of the chat now open (`null` before the chat has started). A new chat has
its id from the start, before anything in it is saved, and keeps it once it is. `chat-change` fires
with `{ chatId }` (type `ChatChangeDetail`; it bubbles and is composed) each time that changes: when
the last chat is opened on load (or a fresh one started), when the viewer opens one from the list,
on `newChat()`, and when the open chat is deleted (naming the new chat that replaces it). It fires
once per change; reloading the chat already open, or deleting another one, fires nothing.

```ts
chat.addEventListener('chat-change', (e) => restoreFor(e.detail.chatId));
```

### What is in the message box

Two read-only properties tell the page what the viewer has in the message box, signed in or out,
without reaching into the chat's shadow root:

- `chat.draft` is the text in the message box now: what the viewer typed, or what `compose(text)`
  (or an example) put there. It is `''` while the chat has no message box, e.g. before it is on the
  page or while it is still starting. No event fires as it changes; read it when you need it.
- `chat.dictating` is `true` from the moment the viewer starts talking into the microphone until
  what they said has been added to the end of `draft` (or sent, with "Send what you said", or thrown
  away). That takes in the recording, the moment after they stop while the recorder hands over their
  last words, and turning it all into text. Meanwhile the box is hidden behind the recording or
  transcribing bar (but for that moment) and `draft` is what it held before; once `dictating` is
  `false` again the words are in `draft`. A chat on a host `backend` has no microphone, so it is
  always `false` there, as it is signed out.

```ts
// Keep what the viewer was writing when the page navigates away, unless words are still on their way.
if (!chat.dictating && chat.draft) saveDraft(chat.chatId, chat.draft);
```

### When a message can go

`chat.canSend` is `true` when `send(text)` would send now: the chat has started (signed in, or on a
host `backend`), no reply is running, and nothing holds it. These hold it, each shown in the message
box, which keeps whatever is sent meanwhile (the Send button is off):

- the page's `holdReason`;
- a saved chat the viewer is opening, until the last one they picked has loaded (until then the chat
  they are leaving may still be the open one; opened one after another, the last one picked is the one
  that ends open);
- a message on its way, from the moment `send(text)` takes it until its reply starts, which includes
  asking the viewer to let the chat use their Buzz. A viewer who closes that request without answering
  counts as not having agreed after two minutes: the message goes back in the box;
- a new `app` or `backend`, while the chat starts again for it;
- an added server still listing its tools (at most 15 s; see [More MCP servers](#more-mcp-servers));
- a message the page keeps back with `queue()`, until it went or came back (see
  [A message that waits](#a-message-that-waits)).

It is `false` before the chat has started and while the viewer is signed out.

`can-send-change` fires with `{ canSend }` (type `CanSendChangeDetail`; it bubbles and is composed)
each time that changes, once per change: as the chat starts, as a hold begins or lifts, and as a
reply starts and ends. A page holding a message of its own sends it then, once, instead of trying
again on a timer. Even then two things can still stop it: the page's own `before-send`, and a viewer
who has not yet let the chat use their Buzz (they are asked; refused, the text stays in an empty
message box).

```ts
/** Sends `text` as soon as the chat can take it. */
function sendWhenReady(text: string): void {
  if (chat.canSend) return void chat.send(text);
  const go = (): void => {
    if (!chat.canSend) return;
    chat.removeEventListener('can-send-change', go);
    void chat.send(text);
  };
  chat.addEventListener('can-send-change', go);
}
```

### A message that waits

A page that must get something ready before a message can go keeps it back from its `before-send`
listener with `queue(waiting)`. The chat shows it at once as the viewer's bubble, marked with `waiting`
(say "Waiting for your app…", also said once to screen readers), takes its files and earlier results
with it, and holds (`canSend` is `false`; a message sent meanwhile stays in the message box). It goes
once the page calls `release()` on the `QueuedMessage` that `queue()` returned, and the chat can send:
after a `holdReason` it set meanwhile lifts, or a reply ends. It goes as it is: `before-send` and the
Buzz grant were asked as the viewer sent it, from their click, and are not asked again. Call `queue()`
from the listener itself; once the listener has returned it throws, and a second call returns the same
message. One message waits at a time.

The waiting bubble has **Edit**: the message goes back in the box, ahead of anything typed there since,
with its files, and does not go. It also comes back to the viewer, without going, when the page calls
`cancel()`, after `QUEUE_TIMEOUT_MS` (3 minutes; a chat taken off the page stops the wait, and put
back starts all 3 minutes again), or when another chat is opened. It comes back into the message box when that is empty and the viewer is not
dictating (their words would be joined to it); otherwise it shows above the box as an alert, "This
message was not sent", saying how many files it has, with **Put it back** (ahead of what they typed,
its files beside the box's) and **Dismiss**. Sending the same words again clears that notice. Signed
out, or handed any other `app` or `backend` object (the chat cannot tell whether it is the same person,
so it treats it as someone else), a waiting message and every such notice are dropped unseen: a viewer
never sees another's words. A message sent just before that, while the viewer was being asked to let
the chat use their Buzz, does not go, wait or come back either; handed the same object again (A, then
B, then A), the message comes back into A's box rather than going on the session A had before.

`giveBack(text)` brings back a message the page tried to send and could not (the chat was replying or
holding, so `send(text)` went nowhere) the same way: into an empty box, else as that notice (one notice
for the same words given back twice). Nothing happens when the box already holds exactly these words.
It returns `false` and does nothing before the chat has started or while it is signed out, and `true`
otherwise.

### The empty chat

An empty chat greets the viewer and offers a few examples to start from: making a picture, changing a
photo, a short video, a song, finding a model and reading text aloud. A page whose chat does something
else sets its own with `examples`, and its own message-box hint with `placeholder`:

```ts
import type { ChatExample } from '@civitai/components-chat/civitai-chat';

chat.examples = [
  { title: 'Tip calculator', prompt: 'Build a tip calculator that splits the bill between friends' },
  { title: 'Restyle my photo', prompt: 'Turn my photo into a watercolor painting', wantsFile: true },
] satisfies ChatExample[];
chat.placeholder = 'Describe the app you want to build';
```

Clicking an example puts its `prompt` in the message box for the viewer to edit or send; with
`wantsFile: true` it also opens the file picker. The examples show signed in and signed out, and a
change applies at once. Leave `examples` unset for the built-in ones; an empty list shows none. A chat
on a host's own `backend` greets the viewer plainly and shows only the page's `examples`: unset, it
shows none, since the built-in ones are about making things on Civitai. It takes no files, so
`wantsFile` opens no picker there. Slot `welcome` replaces the whole greeting
instead, examples included, and then clicking does nothing the page does not wire itself.

### Gating tool calls

`beforeToolCall` and the `tool-result` event let a page decide on, and watch, every tool call the
assistant makes, whichever server or page defines the tool:

```ts
chat.beforeToolCall = (name, input) =>
  name === 'workspace__run_command' && /app create/.test(String((input as { command?: string }).command))
    ? { refuse: 'Confirm the feature list first.' }
    : { allow: true };

chat.addEventListener('tool-result', (event) => {
  const { name, input, output, isError, refused } = (event as CustomEvent<ChatToolResult>).detail;
});
```

`tool-result` fires once per finished call (it bubbles and is composed). `isError` is true for a
refused call (with `refused` set to the reason), a tool that threw, an output carrying `error`, and a
call that did not run because the reply was stopped or ended (with `stopped: true` when the page ended
it; `refused` is then set only on the call the page refused).

#### Ending a reply

A plain refusal goes back to the assistant, which may ignore it and call again: every try is another
paid step, up to the step limit. To cap a reply (a per-reply tool budget, say), refuse with `stop: true`:

```ts
const LIMIT = 50;
let counted = { reply: -1, calls: 0 };
chat.beforeToolCall = (_name, _input, { reply }) => {
  // A new reply (Continue and Retry included) starts its count afresh.
  if (counted.reply !== reply) counted = { reply, calls: 0 };
  return ++counted.calls <= LIMIT
    ? { allow: true }
    : { refuse: 'Tool budget for this reply is used up.', stop: true, message: 'This reply used its tool budget.' };
};
```

The refused call does not run and the assistant is not asked again in this reply. The reply ends as
done, not as an error, showing `message` (or *"The page ended this reply before the assistant could do
more."*) with the same Continue button a reply that ran out of steps gets; Continue sends a new reply, whose
calls come to the gate with a new `reply`, so a count kept by `reply` starts again there. Other calls the assistant made in the same step do not run either if their
gate answer comes after the stop (whatever it is), and no later call in the reply is put to the gate;
a call that was already running finishes. Each call that did not run is reported as a `tool-result`
with `stopped: true`. Stop still works as before: a reply the viewer stopped is stopped, whatever the
gate answers.

Give the chat a height, as for any panel. Theming stays with the page: the chat reads the
`--civitai-*` tokens and follows `data-theme` on the page.

## Subagents

`subagents` gives the assistant a `dispatch_agent` tool: it starts a **read-only subagent** (or, with
`write`, a [write subagent](#write-subagents)), another
assistant that works on one research task in its own context and gives back a short summary, so a reply
that needs a conclusion drawn from many files or pages does not carry all of them for the rest of the
reply. Off unless set: without it (or with none of its tools there this reply) `dispatch_agent` is not
offered and the reply's tools are exactly as before. Read at the start of every reply.

```ts
import type { ChatSubagents } from '@civitai/components-chat/civitai-chat';

chat.subagents = {
  // An allowlist of the exact tool names the assistant sees; a tool added later stays out until listed.
  tools: ['sandbox__read_file', 'sandbox__list_dir', 'get_guide'],
  instructions: 'Give paths relative to the app folder.', // optional, added to the subagent's rules
  model: 'my/cheaper-model', // optional; the reply's own model when unset
  // optional caps (defaults shown)
  maxLive: 3, maxPerReply: 8, maxSteps: 30, maxToolCalls: 40,
} satisfies ChatSubagents;
```

| | Default | What happens past it |
|---|---|---|
| `maxLive` | 3 | the next `dispatch_agent` is refused (a tool error the assistant reads), and nothing runs |
| `maxPerReply` | 8 | the same, for the rest of the reply |
| `maxSteps` | 30 | the subagent's last step must answer in words; it ends `ran_out` |
| `maxToolCalls` | 40 | the next call does not run (the page is not asked); the subagent takes one last step, in words, and ends `ran_out` |

Each value is kept within bounds (1–10, 1–50, 2–200, 1–500). Several `dispatch_agent` calls in one
step run at the same time, and are admitted in the order they start.

**What a subagent gets.** A history of its own: only the task. Its system prompt is the chat's built-in
rules for its tools, then the subagent rules (it cannot talk to the user or ask anything, it stays
read-only, and it finishes with what it found in at most 200 words), then `instructions`. Its tools are
the allowlisted ones this reply has, behind the page's `beforeToolCall`. Never `dispatch_agent` itself
(one level only), and never a tool that waits for the viewer (`ask_choice`, `open_panel`,
`update_panel`), even when listed; a page tool whose result says `awaitsUser` comes back to it as an
error. Without `write` (below), `mode: "write"` is refused with *"write subagents are not available
yet"*, and nothing runs.

**What the assistant gets back** (the `dispatch_agent` result, saved with the reply), never the
subagent's transcript:

```ts
{
  kind: 'subagent',    // on every output of the chat's own dispatch_agent, a refusal ({ kind, error, note }) included
  status: 'done' | 'ran_out' | 'stopped' | 'error' | 'interrupted', // 'interrupted': a write subagent only, see below
  summary: string,     // its final words, cut to 4,000 characters
  steps: number,       // model requests it made
  toolCalls: number,
  activity: { tool: string; arg: string }[], // each call's tool and a short argument (a path, a query), at most 50, no outputs
  error?: string,      // status 'error'
}
```

**Telling a subagent's calls from the reply's own.** A subagent's calls go through `beforeToolCall` and
fire `tool-result` like any other, with the reply's own `reply` number, and carry `subagent`: the
`toolCallId` of the `dispatch_agent` call that started it. The reply's own calls (the `dispatch_agent`
call included) have no `subagent`. A page that keeps a per-reply tool budget leaves subagent calls out
of it, so subagents have their own caps instead:

```ts
chat.beforeToolCall = (_name, _input, { reply, subagent }) => {
  if (subagent !== undefined) return { allow: true }; // a subagent's call: its own caps apply
  if (counted.reply !== reply) counted = { reply, calls: 0 };
  return ++counted.calls <= LIMIT ? { allow: true } : { refuse: 'Tool budget used up.', stop: true };
};
chat.addEventListener('tool-result', (event) => {
  const { name, subagent } = (event as CustomEvent<ChatToolResult>).detail; // `subagent` set on a subagent's call
});
```

A refusal with `stop: true` given to a subagent's call ends that subagent (`ran_out`), not the reply. One
given to the reply's own call ends the reply and stops every subagent still running (`stopped`).

Only outputs marked `kind: 'subagent'` show as subagent cards and count in the Buzz badge, so a page tool
of its own named `dispatch_agent` (offered while `subagents` is off) shows as any other call. When an
earlier turn is trimmed to fit the history budget, a subagent's result keeps its conclusion and drops its
activity log; it is never replaced by the note that invites calling the tool again.

**Stop and retry.** Stopping the reply stops every subagent (`stopped`), and no further subagent request
is made. A reply step that called `dispatch_agent` is never asked again after a dropped connection, so a
subagent never runs twice; a subagent's own cut step that called no tool is asked again once. A
`dispatch_agent` still running when the page closed comes back on Continue as an interrupted call, like
any other tool call.

**What the viewer sees.** Each `dispatch_agent` call shows as a card: its task, steps and tool calls,
and status, live while it runs, and from the saved result after a reload; opened, its summary and what
it looked at. The Buzz badge counts each subagent step as one assistant call, read from the saved
results, and its breakdown says *"Including N subagent steps"*.

### Write subagents

`write` lets the assistant also start **write subagents** (`mode: "write"`): subagents that may edit
files and run commands, each on its own allowlist. Off unless set, and nothing about read subagents
changes when it is set.

```ts
import type { ChatSubagents } from '@civitai/components-chat/civitai-chat';

chat.subagents = {
  tools: ['sandbox__read_file', 'sandbox__list_dir'], // read subagents, as above; `tools: []` for write subagents only
  write: {
    // Every tool a write subagent may use, read tools included; any tool, a free-form command tool too.
    tools: ['sandbox__read_file', 'sandbox__list_dir', 'sandbox__write_file', 'sandbox__edit_file', 'sandbox__delete_path', 'sandbox__run_command'],
    instructions: 'Work inside the app folder.', // optional, for write subagents (instead of `instructions`)
    // The tools that change files, and where a call's input names the file (`path` unless set).
    files: {
      sandbox__write_file: { op: 'write' },
      sandbox__edit_file: { op: 'edit' },
      sandbox__delete_path: { op: 'delete', path: (input) => (input as { target?: string }).target },
    },
    commands: ['sandbox__run_command'], // counted in `ranCommands`
  },
} satisfies ChatSubagents;
```

- **Tools.** Exactly the `write.tools` this reply has; never `dispatch_agent`, `ask_choice`,
  `open_panel` or `update_panel`, even when listed, and a tool whose result says `awaitsUser` comes back
  as an error. With none of them there this reply, `mode: "write"` is refused and nothing runs. The
  caps (`maxLive`, `maxPerReply`, `maxSteps`, `maxToolCalls`) and `model` are shared with read
  subagents: `maxLive` counts read and write subagents together.
- **Rules.** The chat's built-in rules for its tools, then the write rules (it may edit files and run
  commands, only for the task; another subagent may be editing at the same time, so it keeps each edit
  small and reads a file again right before editing it; it finishes with what it changed, what it ran
  and what it could not do, in at most 200 words), then `write.instructions`.
- **What comes back.** The read result, plus:

  ```ts
  {
    mode: 'write',
    changed: { path: string; op: string }[], // one entry per path and op
    ranCommands: number,
  }
  ```

  `changed` is built only from the **successful results** of the tools named in `files`: a call that
  failed (its result has `error`), threw, was refused by the page or never ran is not in it, and neither
  is anything the subagent *says* it changed. A call to a `commands` tool that ran (failed or not) counts
  in `ranCommands`, and what it changed is **not** in `changed`, so after a write subagent the assistant
  should re-read what it needs and run its checks again.
- **Your checks see every write.** A write subagent's calls go through `beforeToolCall` and fire
  `tool-result` with `subagent` set, exactly like a read subagent's, so a page that clears its
  "tests passed" state on a file change clears it for a subagent's change too.
- **Stop.** The one Stop button stops every subagent, read and write; there is no per-subagent Stop. A
  file or command a write subagent already changed stays changed.
- **Continue after the page closed.** A write subagent saves how far it got (`changed`, `ranCommands`,
  steps) with the reply's progress as it goes (where the chat saves progress at all: not with a host `backend`
  store). If the page closes while it runs, Continue gives that
  `dispatch_agent` call the result `status: 'interrupted'` with the `changed` list saved by then (it may
  have changed more after the last save), and the subagent is never run again.
- **Card.** It says *"Subagent · edits"*, and how many files it changed and commands it ran; opened, the
  list of changes.

> **Concurrent write subagents are not kept apart.** There are no path scopes or locks: two write
> subagents running at once may edit the same file, and the later write wins. The write rules ask each
> to keep edits small and re-read before editing, and the tool tells the assistant to give each its own
> files, but nothing enforces it. A free-form command tool is not confined either. Allow only what you
> are willing to have changed, and set `maxLive: 1` if you need write subagents to run one at a time.

## More MCP servers

`mcpServers` adds MCP servers beside the built-in two, for per-user servers whose address is known
only at runtime, such as a viewer's own workspace:

```ts
import type { ChatMcpServer } from '@civitai/components-chat/civitai-chat';

const workspace = await startWorkspace(); // your code: { mcpUrl, token }
chat.mcpServers = [
  {
    id: 'workspace', // [a-z0-9-]+
    url: workspace.mcpUrl, // a Streamable HTTP endpoint
    token: () => workspace.token, // sent as a bearer token
    label: 'Workspace', // shown while one of its tools runs, and to the assistant
  },
] satisfies ChatMcpServer[];
```

A server on the page's own site can be signed in the way the page signs in everything else, with
its own `fetch` instead of a token (the same one a [backend](#your-own-backend) uses for its gateway):

```ts
import type { ChatMcpServer } from '@civitai/components-chat/civitai-chat';

const csrf = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')!.content;
const send: typeof fetch = (input, init) => {
  const headers = new Headers(init?.headers);
  headers.set('X-CSRF-Token', csrf);
  return fetch(input, { ...init, headers, credentials: 'include' }); // the session cookie
};

chat.mcpServers = [{ id: 'tools', url: '/api/mcp', label: 'Tools', fetch: send }] satisfies ChatMcpServer[];
```

- **Names.** Every tool of an added server is offered as `${id}__${tool}`, e.g.
  `workspace__run_command`, whether or not anything else uses the name. So a tool's name never
  depends on what else is loaded, and saved conversations keep pointing at the same tool. A tool
  whose full name is not 1-64 letters, digits, `_` or `-`, or that a built-in tool already has, is
  left out with a console warning. Use the full name in `toolViews` and in `instructions`.
- **Connections.** Each server uses the same client as the built-in ones, including a new session
  when the server forgets the old one (a 404 or 400). `token` is asked for on every
  request, and may return a string or a promise. `fetch`, when set, makes every request to the
  server (initialize, listing, every call): the chat hands it the request with its MCP headers, and
  the `Authorization` header only when there is a `token`. Either is enough; with neither, the entry
  is skipped with a console warning, since the chat never sends an added server the viewer's Civitai
  token. A changed `token` or `fetch` applies from the next request, without reconnecting.
- **Changes.** Assigning a new array opens the servers it adds and closes the ones it drops or
  whose `url` changed. A call still running on a closed connection fails, and so does any later
  call through it (a tool built before the change): a closed connection never reconnects. Listing
  the same `id` and `url` again opens a new connection. The conversation stays as it is. An array equal in `id` and `url` to the current one changes nothing:
  `token` and `label` changes apply without reconnecting.
- **Long calls.** Calls ask for MCP progress notifications, and each one restarts a 610 s timeout,
  so a tool that keeps reporting progress (a build, a test run) is not cut off however long it runs.
  A reply that never comes (the timeout passes with no progress, or the server ends or drops the
  call's event stream before answering) reaches the assistant as `{ error, retryable: true, note }`
  rather than a failure: the call may have done its work, so the note tells it to check the effect
  before running it again. A stream the server made resumable (its events carry non-empty ids) is left to
  the MCP client, which reconnects for the reply.
- **Failures.** A server that cannot be reached, or does not list its tools within 15 s, adds no
  tools. The viewer sees a toast once while it stays down, as for the built-in servers, and the
  chat and every other server carry on. The chat tries again at the next reply, on a new connection,
  so a request that hung does not hold up later replies.
- **Inputs.** Arguments go to the server exactly as the assistant wrote them. Unlike Civitai's own
  tools and the page's `tools`, a chat file id (like `up1-1`) is not swapped for the file's signed
  URL, so a third-party server never gets a link to the viewer's files.
- **Results.** A reply goes back to the assistant as text. A long one keeps its first 2,000 and last
  6,000 characters with a note of how many were left out between, since a build or a test run prints
  its errors last. (Civitai's own tools keep the first 4,000 characters, and `fetch_page` the first
  17,000, which leaves the page server's own 16,000-character cut and its marker whole, each with a note of how many more were not shown. A page `fetch_page` already read in this
  chat is not fetched, or paid for, again: the assistant gets the same text, marked as already
  fetched, until the page reloads.)

## Configuration

`configureChat()` changes what every chat on the page uses, from its next reply:

```ts
import { configureChat } from '@civitai/components-chat/civitai-chat';

configureChat({ autoRunLimit: 0 }); // ask before every generation
```

`name` (what the chat calls itself in its sidebar, to its assistant and in messages; default
"Civitai Chat"), `model` (the default chat model), `models` (others the viewer may pick in Settings,
each `{ id, label, note }`; none by default, e.g. `configureChat({ models: [{ id: 'z-ai/glm-5.3-flash',
label: 'GLM 5.3 Flash', note: 'Follows instructions closely.' }] })`), `orchestrationMcpUrl`, `siteMcpUrl`, `autoRunLimit` (the Buzz a new viewer's
generations may cost before the chat asks) and `maxOutputTokens` (the most tokens one step of a
reply may write, its reasoning and tool-call arguments included, such as a file it writes; default
16,384, kept within 1,024 to 32,768) and `maxSteps` (the most steps, each one paid model request,
one reply may take; default 10, kept within 2 to 1,000; every step re-sends the reply's earlier steps
untrimmed, so with a large value a long reply can outgrow the model's context window and fail before
its last step) are the settings. A reply's last allowed step
cannot call tools and must say where things stand; a reply that used every step ends with **Continue**,
which asks the assistant to carry on. In Settings the viewer picks their default
model from the default, `models`, or any model id the orchestrator's chat endpoint serves (Custom),
and may set their own **Longest reply step** (`maxOutputTokens`), which wins over the page's;
conversation titles always use the default model.

Each chat has its own model. The button beside the add-file button shows it and opens a searchable
list: the default, `models`, the orchestrator's own models, and the OpenRouter models the
orchestrator routes that cost at most $8 per million output tokens and support tool calls (the
assistant works only through tool calls), each with its price per million output tokens. A model
whose known context window is smaller than a lower bound on what a reply needs (the viewer's reply
cap, plus the conversation budget (`contextBudgetTokens`, 24,000 by default), plus about 10,000 for the instructions and tool
definitions) is left out, so changing the cap changes the list. It is a lower bound, not a
guarantee: a long latest message or a page's own tools can still need more. The default, `models`
and the chat's current model always stay. The list
comes from OpenRouter's public `GET https://openrouter.ai/api/v1/models` and the orchestrator's
`GET /v1/models` (as the viewer), loaded once per session when the list is first opened; if either
cannot be reached the list still offers the default, `models` and any typed model id. A reply uses
the chat's own model, else the viewer's default from Settings, else `model`. A chat that never
picked one follows the viewer's default, and the pick is saved with the chat.

`contextBudgetTokens` (default 24,000, by the estimate of 3.5 characters a token) is about how much
earlier conversation a reply sends; raise it for a model with a large context window. The latest
turn always goes whole. When the rest is over the budget, earlier turns give way in this order:
first their long tool results (over 400 characters), oldest turn first, each replaced by a note
while its call stays (never a generation's, a post's, a panel's or a choice's, which report what the
chat did); then whole turns, oldest first, with one "(N earlier turns omitted)" note in
their place. The chat's first message (its task) and every answer to a set of options the chat showed keep their
user message even then, within a quarter of the budget: the task first (cut to fit if it must be),
then the latest answers.

Settings' Assistant choice also sets how replies are paid for, when the orchestrator has a free daily
allowance for the default model (`GET /v2/consumer/free-tier`; free requests carry
`X-Civitai-Tier: free`): **Auto** (the default) uses free replies while they last and then Buzz, and
also Buzz when a free reply has not started after 12 seconds (free work waits behind paid work);
**Free** uses only free replies, and once they are used up a reply says until when and offers
**Continue with Buzz**, which switches to Auto and runs it again; **Default** always uses Buzz. A
listed or custom model uses its own free allowance first if it has one. With **Free**, a model that
has no free replies is never sent paid: the reply says the model isn't free and nothing is charged.
Without a free tier the choice is the model alone.

The message box takes slash commands, run by the chat itself and never sent to the assistant:
`/clear` (or `/new`) starts a new chat, `/model` shows or switches this chat's model
(`/model default` goes back to the viewer's default, `/model <label of a listed model>`,
`/model <id>`), and `/help` lists them.

A page adds its own with `commands`, which can also replace or remove the built-ins:

```ts
import type { ChatCommandsOption } from '@civitai/components-chat/civitai-chat';

chat.commands = {
  pin: {
    usage: '/pin <name>',
    help: 'Pin the latest picture to your board',
    run: (arg, { send, compose, notify, conversationId }) => board.pinLatest(arg),
  },
  logo: { usage: '/logo <brand>', help: 'Start a logo panel', run: (arg, { send }) => send(`Build me a logo panel for ${arg}`) },
  model: null, // remove a built-in
} satisfies ChatCommandsOption;

// Or build the whole set from the built-ins:
chat.commands = (defaults) => ({ ...defaults, clear: { ...defaults.clear!, help: 'Start over' } });
```

A name adds a command or replaces the built-in of that name; `null` removes one. Names are a letter
followed by letters, digits, `_` or `-`. Page commands appear in the suggestions while typing, Tab
completion and `/help`. `run(arg, context)` gets the text after the name; `context.send` sends a
message as the viewer, `compose` puts text in the message box, and `notify` shows a short note. A
command that throws shows that it did not work.

The microphone button lets the viewer talk instead of typing. Where the browser has audio worklets,
it streams 16 kHz PCM to a `liveTranscription` step and the words appear as they are spoken (a few
hundred milliseconds behind). Long pauses are not sent (it is billed per second of audio, about 1 Buzz
per 15 s), and after 12 s without speech the step stops listening and its text goes in the message
box. A chip next to the microphone sets the language spoken (the model cannot detect it, and decodes
whatever it is told); it defaults to the first of the browser's languages the model knows.
Browsers without audio worklets cut the recording into phrases at pauses and transcribe each with
`transcribe_audio` (about 1 Buzz a phrase). Stop puts the text in the message box to edit; the arrow
sends it once the last words are back. Recordings stop by themselves after two minutes.

### Talking with the assistant

With `voice-conversation` set, a second button next to the microphone starts a spoken conversation:
the viewer talks, each reply is read aloud as it streams, and talking over a reply stops it. Their
words go out as their message, through `before-send` and every hold like a typed one, and the
assistant is told to answer the way people speak. A typed message sent meanwhile is read aloud too.

The reply goes out when the viewer has finished their turn, not after a fixed pause: an end-of-turn
model judges each pause, answering after a quarter of a second when they sound done and waiting up
to six seconds when they sound mid-thought. The server's verdicts are used from the start; the
in-browser model (about 8 MB, plus 11 MB of ONNX runtime, from Hugging Face and jsDelivr) is
fetched only once a conversation starts, and decides from then on because it answers sooner.
Nothing for the conversation loads, and nothing is billed, until the viewer starts one.

It is billed as it is used: speech heard at the `liveTranscription` rate (about 1 Buzz per 15 s;
silence is not sent) and replies read aloud at about 1 Buzz per 100 characters. The voice is
`configureChat({ conversationVoice: { speaker, instruct } })`, a Qwen3 TTS speaker (`vivian` by
default) and how it should speak. Without headphones the microphone hears the reply too, so while
it plays only sustained speech counts as talking over it.

## When a reply fails

A reply that fails fires `reply-error` on the chat, for the page's own telemetry: `detail` is
`{ kind, message, detail, trace }`, where `message` is what the viewer saw and `trace` (type
`ChatErrorTrace`) says where it broke, all of it about the error that ended the reply: `stage` (`tools`, `request`, `stream` or `tool`), `step`, the
last tool call, and for a service error its `statusCode`, host, `cause`, request id and the first 500
characters of the response body. The viewer sees a one-line summary of it under Details; it is not
saved with the conversation.

A reply cut off because the browser dropped its connection (it aborts every request in flight when
the network changes, e.g. the address changes) is not a failure yet: the chat asks again by itself,
up to three times for one drop, after 1.5 s, 4 s and 8 s (and, when the browser says it is offline,
until it is back online, at most 15 s). The first wait is past the second drop a browser makes about
a second after a network change. Each drop gets its own three tries once a step has finished after a
retry, so a long reply lives through several network changes; one reply retries at most 10 times in
all, so a network that keeps dropping still ends it. It resumes from the last step that finished, so tools that already ran are not called
again and words already kept are not repeated; the cut step's words are replaced by its new answer.
The cut is the error that ended the reply: an earlier error the reply got past by itself does not
count, and steps that finished after it are kept like any others. If the cut step had called a tool,
or any tool call comes after the cut before the stream ends, it is not asked again, so no tool can
run twice; a reply that then fails keeps every step that finished, with the calls it ran and their
results. Only two errors count as
a dropped connection: fetch's own `TypeError` with Chromium's wording (`Failed to fetch` for a request,
`network error` for a body), or Firefox's and Safari's wording for a failed request, and a 2xx answer
whose body was cut by one (`Failed to process successful response` caused by it). Other browsers'
wording for a cut body is not recognised yet. A stop, any status the service sent, and anything else
fail at once. A reply that fails after its retries says the connection was lost. Each retry fires `reply-retry` with `{ attempt, trace }` (type
`ChatReplyRetry`), and the turn keeps the traces in `assistant.networkRetries` for the session; only
when the retries run out does the reply fail with `reply-error`. A recovered reply shows no error, so
these are how a page, its telemetry or an eval harness can tell that a cut happened and was retried,
rather than that none happened.

### Retry, and asking again when the page wakes

A reply that still failed, because the connection was lost or the service was busy or could not run
the model for a moment (`kind` `network`, `rate_limit`, `unavailable` or `assistant_unavailable`),
shows **Retry** on its error, on the latest reply only. Retry asks for the same reply again: the
viewer's message is not sent a second time, and it carries on from the last step that finished, as
the automatic retries do, so a tool that already ran is not called again and stays on screen. Retry is
offered only where that holds: not when the step that failed had already called a tool (it may have
run, and is in no finished step to send as it is), and not on a failed reply in a chat opened again
later (where to carry on from is kept for the session only, not saved; a reply saved after each step
is the exception, see [A reply that had not ended when the chat was saved](#a-reply-that-had-not-ended-when-the-chat-was-saved)). A refusal (sign-in, Buzz,
the safety filter) and a failure of unknown cause get no Retry; asking again would only repeat it.

A phone that sleeps stops the page, and with it the reply and its retries; a reply that lost its
connection that way is asked for again **once, by itself**, when the page comes back into view
(`visibilitychange`, while the browser says it is online) or the browser says it is `online` again.
Only when it is the latest reply of the chat that is open (nothing was sent after it), the connection
was what failed (`kind` `network`; the other kinds get Retry only), no reply is running and nothing
holds the chat (`canSend`), Retry would be offered for it, and it failed less than 30 minutes ago: past
that the viewer has likely moved on, and Retry is still there. A desktop tab shown again counts as
waking too. Each reply is asked again by itself at most once, so a reply that fails again waits for
Retry instead of looping. While the chat holds, Retry shows but is off, and the hold's words in the
message box say why.

Retry and asking again by itself do **not** fire `before-send`: no new message goes. They fire
`reply-resume` first, with `{ trigger }` (type `ReplyResumeDetail`; `'retry'`, `'visible'` or
`'online'`; it bubbles and is composed), which is the page's hook. It is cancelable: a page whose
reply's tools are not there now (say, its app is paused) calls `preventDefault()`, gets them back, and
then calls `chat.retryReply()`. A cancelled ask by itself does not count as the one ask: the next wake
asks again, unless the page's `retryReply()` came first. `retryReply()` asks for the latest reply again
the way Retry does, without `reply-resume`, and only where Retry would be offered and the chat can send;
it resolves `true` when it asked and `false` when it asked nothing.

## Panels

When someone wants to explore one kind of thing (logos, beats, a character in different scenes)
rather than make it once, the assistant builds a panel with `open_panel`: a few controls in plain
words and a Run button with the price. Each press of Run goes straight to the orchestrator on the
viewer's Buzz; no assistant reply is needed, so it costs nothing beyond the generation. Ask the
assistant for help and it sees the panel's current values and what each run made, and changes the
panel in place with `update_panel`: filling in values, adding or removing controls.

A panel is a definition, not code: controls with content-studios' input kinds (`text`, `choice`,
`slider`, `aspect`, `count`, `seed`, `toggle`, plus `image` for a file from the chat) and a
`run_step` or `run_workflow` call with `{{input}}` placeholders. Every change is a new version, each
run records the version and exact values it used (seeds included), and the whole thing is saved with
the conversation, so a panel and its runs come back after a reload.

A panel's button can also ask instead of run: with `run: { "ask": "Post {{picture}} titled {{title}}" }`
and a `button` label, pressing it sends that message to the assistant as the viewer (with any picked
pictures attached), which then acts with its own tools; its confirmations still apply. That makes a
panel a form for anything the assistant can do, such as a post with an editable title and description.
A panel opened from a share link puts the message in the message box instead, since someone else
wrote it.

A choice can also stand for a whole block of inputs (`map: { "Krea 2 Turbo": { engine: "comfy", …,
prompt: "{{prompt}}" } }` with `input: "{{model}}"`), so one control switches between models whose
inputs differ. **Adjust** on a generation card uses that without the assistant: it turns the request
into a panel with its prompt and a model list (the current model plus others of the same kind, each
priced up front with a free check, cheapest first, refused ones left out).

Share on a panel copies a link that carries its latest version and values (not the author's files
or runs). Opening it starts a conversation of the viewer's own with a copy of the panel: they run it
on their Buzz and can ask their assistant to change it, which is told the panel came from someone
else and treats its text as content, not instructions. A full-page chat shares links to itself and
opens them on load; elsewhere, set `panel-link-base` to the page that calls `openPanel()`. A page
that may send the viewer to sign in first calls `holdSharedPanel()` before it does, since the
redirect back drops the link's hash.

A panel can also fill the page beside the chat, studio-style. Set `dock-panels` on the chat: the
thread then shows a chip where each panel was built or changed, and the chat fires
`active-panel-change` with the panel to show. Hand it to `<civitai-chat-studio>`
(`@civitai/components-chat/civitai-chat-studio/define`), which lays out the controls and Run, the run
on show, and every run; wire its `media-action` to the chat's `mediaAction()` and pass the chat's
`files` for image inputs.

```ts
chat.addEventListener('active-panel-change', (e) => (studio.panel = e.detail.panel));
studio.files = () => chat.files();
studio.addEventListener('media-action', (e) => chat.mediaAction(e.detail.id, e.detail.action));
```

## Server runner

Experimental, and so are the `@civitai/components-chat/runner-protocol` and `@civitai/components-chat/core`
entries: protocol v1 may still change in a minor release until the first server runner ships.

By default a reply runs on the page (`runner="browser"`): it stops when the page sleeps,
closes or loses its network for long. With `runner="remote"` each reply runs on a server instead, and
the page follows it, so a long reply keeps working while the viewer is away. The server implements the
run protocol in `@civitai/components-chat/runner-protocol` (types and a few pure helpers); this package
is its client. Set both before `app`:

```js
chat.runner = 'remote';
chat.remoteRunner = {
  url: 'https://runner.example.com/assistant/',
  // Asked before every request to the runner, so a renewed token applies at once.
  headers: async () => ({ authorization: `Bearer ${await getRunnerToken()}` }),
  // What the server's tools and gate need to know about the page for one reply; read as each reply starts.
  pageState: () => ({ appId: currentApp.id }),
};
chat.app = app;
```

What changes in remote mode:

- **The runner holds the tools, the gate and any subagents.** The page's own `tools` executors,
  `beforeToolCall`, `subagents`, `systemPrompt`, `mcp` and `mcpServers` do not apply, and the page asks no tool server
  anything; the `tools` views (`render`, `activity`) still draw the calls. What the server needs to decide
  on (the app open in the page, say) goes in `pageState`. The settings that shape a reply (model,
  custom instructions, `instructions`, output cap, free or paid, mature content, auto-run limit) go
  with each start, and the runner validates them. `tool-result` events still fire, as the runner's gate
  reports each call.
- **The reply survives the page.** The page reads the run's events (`GET /runs/<id>/events`, server-sent
  events) into the same thread, tool cards, subagent cards and badges a page-run reply shows. A
  dropped connection is opened again with `Last-Event-ID`, so nothing shows twice, and the page keeps
  trying for as long as the run is live: the turn stays replying, never "cut off". Coming back into
  view, back online or out of the back-forward cache reconnects at once. Opening the chat again (a
  reload, another device) asks the runner for its live run (`GET /runs?conversationId=`) and follows it
  from its start; what the journal already held when it was looked up is shown, but not announced to
  the page again, so `tool-result` still fires once per finished call. A runner that refuses the
  viewer the events (401, 403) ends the reply on the page with a sign-in error (`reply-error`, kind
  `auth`); the run itself goes on on the server.
- **Stop asks the runner to stop** (`POST /runs/<id>/stop`), and the reply shows stopped once the run
  says it ended, or after 10 seconds, or at once when the runner refuses the stop: the message box is
  always free again. Stop before the run's id is known (its start had no answer yet) ends the reply at
  once and stops the run by the start's key (`POST /runs/stop`). Opening another chat or starting a new one no longer stops a reply: it carries on, and
  is followed again when its chat is opened.
- **The runner is the only writer of the saved conversation.** The page writes no head: it reads the
  chat again once a run ends. A title or model the viewer sets goes to the runner as a patch
  (`POST /conversations/<id>/patch`). Posts and panels stay on the page, and a shared panel cannot be
  opened (`openPanel` rejects) nor a generation adjusted, since either would make a turn only the page
  has. Deleting a chat still deletes its saved workflows from the page; stop its reply first.
- No gateway: a backend's `url` (and `fetch`) are for replies that run on the page, so
  `runner="remote"` with a backend that names one is refused. A backend that keeps only the
  conversations is fine; see below.

### A host's own conversation store

A host with its own conversation store and no Civitai sign-in (see "Your own backend") can run its
replies on a server runner too. Give the chat a **store-only backend**: `store`, `model` and `models`,
without `url` or `fetch`. The chat then starts without `app`, and:

```js
chat.runner = 'remote';
chat.remoteRunner = { url: '/chat-runner/', fetch: send }; // `send` signs the page's requests in
chat.backend = {
  model: 'host/default',
  models: [{ id: 'host/big', label: 'Big' }],
  store, // the same ChatConversationStore as "The conversation store"
};
```

- **The chat list, opening a chat and deleting one go to `store`**, as with any backend, and so does
  reading a chat again once its run ends. The picker offers `model` and `models`, and the chat's
  model is sent with each run.
- **Each reply runs on the runner, and the runner is the only writer of the saved conversation.** The
  page never calls `store.save`, so the runner saves each turn into the host's store itself. A title or
  model the viewer sets after a chat's first turn goes to the runner as a patch
  (`POST /conversations/<id>/patch`), and so does a rename of a chat that is not open.
- What a host backend turns off stays off: Civitai's built-in tools, files, voice, Buzz, posting and
  sign-in.
- **Deleting a chat stops its live run first, and waits for it to end.** The chat asks the runner for
  the chat's run (`GET /runs?conversationId=`), stops it (`POST /runs/<id>/stop`; a `404` means it had
  already ended), and asks again every 250 ms until no run is live: a run saves its final state before
  it ends, so only then is `store.delete` called. The chat's row shows busy meanwhile. If the runner
  cannot be reached, refuses the stop, or still lists the run after the runner's `timeoutMs` (20
  seconds unless set), nothing is deleted and the viewer stays on the chat, with an error saying which.
  This orders the page's own delete after the run's last save; a delete from elsewhere (another tab, an
  API) is the host's to serialise against a live run, for example by refusing it until the run ends.

What the host's side does: the runner saves each turn into the host's store and implements
`POST /conversations/<id>/patch` against it.

These combinations are refused when the chat starts, before anything is wired. The element shows the
message in place of the chat, and setting `runner` or `remoteRunner` afterwards starts it again:

| `runner` | `backend` | Refused with |
|---|---|---|
| `'remote'` | names `url` or `fetch` | `The 'remote' chat runner takes a backend's store and models only: …` |
| `'browser'` or unset | no `url` | `A backend without url needs runner 'remote': …` |

`runner="browser"` with a backend that names its `url` works as before, and so does `runner="remote"`
with no backend (chats on the orchestrator, with a signed-in `app`).

The protocol, briefly (`runner-protocol.ts` has every field):

| Call | Body | Answer |
|---|---|---|
| `POST /runs` | `StartRunRequest`: `idempotencyKey`, `conversationId`, `scope`, `turn` (`seq`, `user`, `retry?`), `model`, `settings`, `page` | `StartRunResponse` (`runId`), or `RunErrorResponse` (`run-active`, `stale-turn`, `refused`, …) |
| `GET /runs?conversationId=` | | `RunLookupResponse`: the live run with the latest event id in its journal (`lastEventId`), or `null` |
| `GET /runs/<id>/events` | `Last-Event-ID` to resume | `RunEvent`s as SSE, `id:` the journal position |
| `POST /runs/<id>/stop` | `{ v: 1 }` | `202` |
| `POST /runs/stop` | `idempotencyKey`, `conversationId` | `202`: stops the run that start started, or keeps a later start with that key from replying |
| `POST /conversations/<id>/patch` | `title`, `titleSource`, `model` | `204` |

Every request and response carries `v: 1`. The events are `run-started`, the parts' edits
(`text-delta`, `tool-call`, `tool-result`, `tool-error`, `parts-truncate`), `subagent-progress`,
`tool-reported`, `network-retry`, `error`, and last `run-ended` with its status (`done`, `stopped`,
`error`, `ran_out`); an event of a type the page does not know is skipped. A runner gets the edits from the reply's
`AgentCore.live.parts` with `createPartsDiffer()` every 100 ms or so, and the page applies them with
`applyRunEvent()`, so the parts it shows are the parts the server's reply showed.

### Running the loop in Node

`@civitai/components-chat/core` is the reply loop without the page: `AgentCore`, the parts, the model
provider, the tool gate, the prompt and history builders, read-only subagents and the conversation
store. Nothing it imports needs a DOM or Lit (a test walks its import graph), so a server runner runs
a reply exactly as the page does:

```js
import { AgentCore, createAssistantModel, gateToolSet } from '@civitai/components-chat/core';
import { createPartsDiffer, encodeRunEvent } from '@civitai/components-chat/runner-protocol';
```

To offer an MCP server's tools exactly as the page offers its `mcpServers`, use the page's own adapter.
Each tool is named `${id}__${tool}` (a name the model's API cannot take is skipped), and a reply is cut
to its first `RESULT_HEAD_CHARS` (2,000) and last `RESULT_TAIL_CHARS` (6,000) characters:

```js
import { McpServerPool, extraToolSet, gateToolSet } from '@civitai/components-chat/core';

const pool = new McpServerPool({ onError: (server, error) => console.warn(server.id, error) });
pool.sync([{ id: 'docs', url: 'https://example.com/mcp', fetch: signedFetch, label: 'Docs' }]);
const tools = extraToolSet(await pool.tools(), { taken: {} }); // { docs__search, … }
```

## Where chats live

With a [backend](#your-own-backend), in its store. Otherwise every turn is a free, tagged `echo` workflow on the orchestrator, and every generation a tagged
workflow, so a viewer's chats follow them to any device and expire with the orchestrator's 30-day
retention. Panels are saved on the conversation, and their runs are tagged workflows like any other.
Nothing is kept on the page beyond preferences.

A conversation is saved as a v2 head, and as a v3 head while a reply runs. v3 is v2 plus that reply
saved `running`, with the steps it finished and the time of that save. A head of any other version is
left out, as before.

While a reply runs, the chat saves it as each tool call starts, as each call's result comes in, and as
each step that ran a tool finishes: the head becomes v3, with every step so far and the step now
running as far as its calls go. A step that ran no tool is a reply's last, and its end is saved as
before, as v2 again. A page that sleeps, closes or is unloaded mid-reply loses at most the words of the
step it was on, and another tab, or this one reloaded, can carry on from there with Continue: a call
that finished goes with its own result, and one that started and did not finish goes with the result
"interrupted: this call did not finish and was not re-run", so the assistant decides what to do. Neither
runs again. The one gap: a call that started in the moment before the page died, before its start was
saved (one save's round trip). Each save is an update of the turn's
own `echo` workflow's metadata, which the orchestrator does not charge for. At most one such save
waits at a time: steps that finish while it waits go with it. Every save of the chat (a title, the
model, a post, a panel, a step) is built from everything this tab holds when it goes, one at a time,
so none of them drops another's change.

Versions before 0.17.0 leave a v3 head out of their list and open it as an empty chat, so a chat whose
reply is running, or died mid-reply, is missing there until a later save makes it v2 again. Update every page that
shows these chats to 0.17.0 or later before shipping this version.

### A reply that had not ended when the chat was saved

A chat open in two tabs or windows, or opened while another one is still replying, can show a reply
that had not ended when it was last saved: a v2 head is saved as a reply starts, and a v3 head after
each step. Whether it is still running is read from that save's time: the turn's start for v2, the
latest step's save for v3. The latest reply only:

- **Saved under 5 minutes ago** (`LIVE_REPLY_MS`): "Still replying in another tab or window…". Nothing
  is offered and nothing asks again (no Retry, no Continue, and `retryReply()` resolves `false`),
  since a second run would be paid for twice. The chat reads itself again when the page comes into
  view or gets focus, and once more when the save passes 5 minutes, so it settles by itself. Sends are
  held for that read.
- **Saved longer ago:** the reply is taken as gone. A v3 reply with finished steps whose every tool call
  has its result shows "This reply stopped before it finished." with **Continue**. That is Retry's path
  (it fires `reply-resume` with `trigger: 'retry'`, and `retryReply()` does the same): it carries on
  from those steps, sent as they are, so no tool in them runs again. It reads the chat again first:
  if the reply has ended meanwhile, or saved a newer step, that shows instead and nothing is asked.
  Any other says "This reply was cut off. Ask again?", as before.

A save time more than a minute ahead of the page's clock (`SAVE_CLOCK_SKEW_MS`) was made by a clock
that is wrong, so it reads as gone. One ahead by less counts from now.

A reply saved by this version is dated by its latest step, so it reads as still replying for as long
as its steps keep finishing, however long it runs. One saved only as it started (by a version before
this one, or whose steps ran no tool for 5 minutes) reads as cut off 5 minutes after its last save,
while it may still run.

A tab running a reply holds a Web Lock for it (`navigator.locks`) until the reply ends; the browser lets
go of it when the tab closes, crashes or is unloaded. Another tab of the same browser that opens the
chat asks for it: held, the reply reads as still replying, however old its last save, and the chat
asks again each minute and when the page comes into view or gets focus. The tab also notes the reply in
its own `sessionStorage`, with the time of its latest save of it. That tab reloaded (or unloaded by the
browser to save memory, and opened again), or a copy of it once the original is gone, finds the note,
the reply unfinished and its lock free, so it reads as gone at once, with Continue where it can. A save
newer than the note was made elsewhere, and the 5-minute rule decides. Without Web Locks a note alone
never marks a reply gone. Tabs in other browsers or on other devices see only the 5-minute rule.
