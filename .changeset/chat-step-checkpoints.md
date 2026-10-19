---
'@civitai/components-chat': minor
---

A reply is saved as it runs, call by call, so a page that sleeps, closes or is unloaded mid-reply loses at most the words of the step it was on, and Continue never runs a call again.

- **Checkpoints as it runs.** While a reply runs, the conversation head is saved as v3 as each tool call starts, as each result comes in and as each step finishes, with the reply `running`, every step so far and the time of that save. Continue sends a call that finished with its own result, and one that started and did not finish as `interrupted: this call did not finish and was not re-run`. Neither runs again. Its end is saved as before, as v2 again. Each save is a free metadata update of the turn's own head. At most one waits at a time, and steps that finish while it waits go with it.
- **Single writer in a tab.** Every save of the chat (title, model, post, panel, step) is built from everything the tab holds when it goes, one at a time, so none of them drops another's change. A post saved mid-reply keeps the reply running instead of dropping its steps.
- **A reply still running elsewhere reads live as long as its steps keep landing**, however long it runs. Before, it read live only for 5 minutes from its start.
- **Which tab runs it.** A tab running a reply holds a Web Lock for it. Another tab of the browser reads the reply as still replying while the lock is held, however old its last save. The tab also notes the reply in its `sessionStorage`, so the tab reloaded (for example after the browser unloads it to save memory) reads its own reply as gone at once once the lock is free, with Continue where it can, instead of "Still replying…" for 5 minutes. A copy of the tab does not take the original's running reply as its own.

Pages showing these chats need 0.17.0 or later first: older versions leave a v3 head out of their list, and show it as an empty chat when opened.
