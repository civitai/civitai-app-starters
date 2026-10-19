---
'@civitai/components-chat': minor
---

A reply is saved after each step that runs a tool, so a page that sleeps, closes or is unloaded mid-reply loses at most the step it was on.

- **Per-step checkpoints.** While a reply runs, the conversation head is saved as v3, with the reply `running`, every step that finished so far, and the time of that save. Its end is saved as before, as v2 again. Each save is a free metadata update of the turn's own head. At most one waits at a time, and steps that finish while it waits go with it.
- **Single writer in a tab.** Every save of the chat (title, model, post, panel, step) is built from everything the tab holds when it goes, one at a time, so none of them drops another's change. A post saved mid-reply keeps the reply running instead of dropping its steps.
- **A reply still running elsewhere reads live as long as its steps keep landing**, however long it runs. Before, it read live only for 5 minutes from its start.
- **A tab that reloads its own dead reply** (for example after the browser unloads it to save memory) notes that reply in its `sessionStorage`, so it reads it as gone at once, with Continue where it can, instead of "Still replying…" for 5 minutes.

Pages showing these chats need 0.17.0 or later first: older versions leave a v3 head out of their list.
