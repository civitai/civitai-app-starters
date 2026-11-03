---
'@civitai/components-chat': patch
---

`<civitai-chat>`'s thread follows a reply as it streams for as long as the viewer stays at the end, and moves nothing once they have scrolled away. Before, a reply that grew fast (words, a run of tool calls) could stop the thread following partway through, leaving the view wherever it was, because the thread read its own jump to the end, arriving a frame later, as the viewer scrolling away. Now only a scroll the thread did not make (a wheel, a touch, the scrollbar, a key, find in page) takes it off the end, and scrolling back to the end follows again.

Scrolled away, the content the viewer is looking at stays where it is on screen while things above it change height (a group of calls opening, a picture sizing itself as it loads, a call row redrawn into a group), and a thread drawn again for the same chat (as it is read again behind the loader) opens where they were instead of at the end. Sending a message, opening another chat, and new page content in `thread-end` still bring the end into view; picking the chat already open from the history no longer does. A call row the viewer was on is kept focused as it joins a group without scrolling the thread to it.
