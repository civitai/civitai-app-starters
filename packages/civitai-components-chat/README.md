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

The chat needs an `AppClient` from [`@civitai/sdk`](../civitai-sdk) with `ai:write:budgeted`. A page
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

| Property | What it does |
|---|---|
| `app` | The signed-in `AppClient`; the chat starts when it is set. |
| `signIn` | `({ signal }) => Promise<AppClient>`, called from the viewer's click or key press when they first send something without `app`. Reject with an error whose `code` is `'canceled'` when they give up; their message stays in the box. |
| `tools` | The page's own tools, by name: `description`, `inputSchema` (JSON Schema), `execute(input, { files })`, optional `activity` and `render`. A built-in tool of the same name wins. |
| `toolViews` | How calls of any tool show, by tool name, including built-in and Civitai ones: `activity` (the line shown while it runs) and `render(call)`, which replaces the card with a lit template, DOM node or string; return `undefined` to keep the default. `call` is `{ name, input, state, output, error }`. |
| `instructions` | A string or function, read at every reply: what the page is and shows. |
| `systemPrompt` | Replaces the built-in rules (a string) or edits them (a function of the defaults). |
| `mcp` | `{ orchestration?: boolean \| { exclude: string[] }, site?: boolean }`, both on by default: making media, and Civitai model search. `orchestration: { exclude: ['run_step', 'run_workflow'] }` keeps the service lookups but never runs (or charges for) a generation; the panels, which run through `run_step`, go with it. Other tools that charge per call, such as `transcribe_audio`, stay unless they are listed too; the microphone button transcribes on its own, not through the assistant, so neither `exclude` nor `beforeToolCall` stops voice input from charging. |
| `mcpServers` | More MCP servers whose tools the assistant may use (property only); see [More MCP servers](#more-mcp-servers). |
| `holdReason` | While set (also `hold-reason`), nothing is sent to the assistant: the message box keeps what the viewer typed, Send is off and the box shows this text, e.g. "The sandbox is starting…". Stop still works. The chat also holds by itself, as "Connecting to *label*…", while an added server is listing its tools (at most 15 s). |
| `beforeToolCall` | `(name, input, { conversationId, signal }) => { refuse: string } \| { allow: true }` (or a promise of one), asked before every tool call: Civitai's, an added server's and the page's own. A refusal stops the call before anything runs and the assistant gets the reason as the tool's error; a hook that throws refuses too. `signal` aborts when the viewer stops the reply: the reply stops at once even if the hook never answers, and the call never runs. See [Gating tool calls](#gating-tool-calls). |
| `scope` | Set before `app`. Keeps the page's chats and preferences apart from every other page's. |
| `layout` | Where the chat list goes: `auto` (a column, or a dropdown at 900px or less of the chat's own width), `compact` or `wide`. |
| `full-page` | Only for a chat that is the whole page: it then sets the theme, takes Ctrl+K and Ctrl+Shift+O, and picks up after a redirect. Embedded, the page keeps all of these. |
| `can-sign-out` | Shows Sign out in settings (with `full-page`); the chat then emits `cvt-sign-out`. |

Methods: `send(text)`, `compose(text)` (fills the message box), `newChat()`, `addFiles(files)`,
`focusComposer()`. Slot `welcome` replaces what an empty chat shows.

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
refused call (with `refused` set to the reason), a tool that threw, and an output carrying `error`.

Give the chat a height, as for any panel. Theming stays with the page: the chat reads the
`--civitai-*` tokens and follows `data-theme` on the page.

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
    token: () => workspace.token, // required; sent as a bearer token
    label: 'Workspace', // shown while one of its tools runs, and to the assistant
  },
] satisfies ChatMcpServer[];
```

- **Names.** Every tool of an added server is offered as `${id}__${tool}`, e.g.
  `workspace__run_command`, whether or not anything else uses the name. So a tool's name never
  depends on what else is loaded, and saved conversations keep pointing at the same tool. A tool
  whose full name is not 1-64 letters, digits, `_` or `-`, or that a built-in tool already has, is
  left out with a console warning. Use the full name in `toolViews` and in `instructions`.
- **Connections.** Each server uses the same client as the built-in ones, including a new session
  when the server forgets the old one (a 404 or 400). `token` is required, is asked for on every
  request, and may return a string or a promise. The chat never sends an added server the viewer's
  Civitai token: an entry without `token` is skipped with a console warning.
- **Changes.** Assigning a new array opens the servers it adds and closes the ones it drops or
  whose `url` changed. A call still running on a closed connection fails, and so does any later
  call through it (a tool built before the change): a closed connection never reconnects. Listing
  the same `id` and `url` again opens a new connection. The conversation stays as it is. An array equal in `id` and `url` to the current one changes nothing:
  `token` and `label` changes apply without reconnecting.
- **Long calls.** Calls ask for MCP progress notifications, and each one restarts a 610 s timeout,
  so a tool that keeps reporting progress (a build, a test run) is not cut off however long it runs.
- **Failures.** A server that cannot be reached, or does not list its tools within 15 s, adds no
  tools. The viewer sees a toast once while it stays down, as for the built-in servers, and the
  chat and every other server carry on. The chat tries again at the next reply, on a new connection,
  so a request that hung does not hold up later replies.
- **Inputs.** Arguments go to the server exactly as the assistant wrote them. Unlike Civitai's own
  tools and the page's `tools`, a chat file id (like `up1-1`) is not swapped for the file's signed
  URL, so a third-party server never gets a link to the viewer's files.
- **Results.** A reply goes back to the assistant as text. A long one keeps its first 2,000 and last
  6,000 characters with a note of how many were left out between, since a build or a test run prints
  its errors last. (Civitai's own tools keep the first 4,000.)

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

## When a reply fails

A reply that fails fires `reply-error` on the chat, for the page's own telemetry: `detail` is
`{ kind, message, detail, trace }`, where `message` is what the viewer saw and `trace` (type
`ChatErrorTrace`) says where it broke: `stage` (`tools`, `request`, `stream` or `tool`), `step`, the
last tool call, and for a service error its `statusCode`, host, `cause`, request id and the first 500
characters of the response body. The viewer sees a one-line summary of it under Details; it is not
saved with the conversation.

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

## Where chats live

Every turn is a free, tagged `echo` workflow on the orchestrator, and every generation a tagged
workflow, so a viewer's chats follow them to any device and expire with the orchestrator's 30-day
retention. Panels are saved on the conversation, and their runs are tagged workflows like any other.
Nothing is kept on the page beyond preferences.
