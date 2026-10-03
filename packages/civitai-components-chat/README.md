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
requests:

| The page | `chat.app` |
|---|---|
| A block on civitai.com | `await initialize()`; the manifest asks for `ai:write:budgeted` |
| A browser app on `createSignIn` | `await initialize(auth)`, the client it already uses |
| An app whose server holds the tokens | `await initialize({ token: () => fetch('/api/civitai/token').then((r) => r.text()), requestGrants: () => true })`, behind a route that returns the session's access token |

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

| Property | What it does |
|---|---|
| `app` | The signed-in `AppClient`; the chat starts when it is set. |
| `signIn` | `({ signal }) => Promise<AppClient>`, called from the viewer's click or key press when they first send something without `app`. Reject with an error whose `code` is `'canceled'` when they give up; their message stays in the box. |
| `tools` | The page's own tools, by name: `description`, `inputSchema` (JSON Schema), `execute(input, { files })`, optional `activity`. A built-in tool of the same name wins. |
| `instructions` | A string or function, read at every reply: what the page is and shows. |
| `systemPrompt` | Replaces the built-in rules (a string) or edits them (a function of the defaults). |
| `mcp` | `{ orchestration?: boolean, site?: boolean }`, both on by default: making media, and Civitai model search. |
| `scope` | Set before `app`. Keeps the page's chats and preferences apart from every other page's. |
| `layout` | Where the chat list goes: `auto` (a column, or a dropdown at 900px or less of the chat's own width), `compact` or `wide`. |
| `full-page` | Only for a chat that is the whole page: it then sets the theme, takes Ctrl+K and Ctrl+Shift+O, and picks up after a redirect. Embedded, the page keeps all of these. |
| `can-sign-out` | Shows Sign out in settings (with `full-page`); the chat then emits `cvt-sign-out`. |

Methods: `send(text)`, `compose(text)` (fills the message box), `newChat()`, `addFiles(files)`,
`focusComposer()`. Slot `welcome` replaces what an empty chat shows.

Give the chat a height, as for any panel. Theming stays with the page: the chat reads the
`--civitai-*` tokens and follows `data-theme` on the page.

## Configuration

`configureChat()` changes what every chat on the page uses, from its next reply:

```ts
import { configureChat } from '@civitai/components-chat/civitai-chat';

configureChat({ autoRunLimit: 0 }); // ask before every generation
```

`model` (the chat model's AIR), `orchestrationMcpUrl`, `siteMcpUrl` and `autoRunLimit` (the Buzz a
new viewer's generations may cost before the chat asks) are the settings.

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
