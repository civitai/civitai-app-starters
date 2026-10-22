---
'@civitai/components-chat': minor
---

An image in an added MCP server's tool result (a JPEG, PNG, WebP or GIF, such as a screenshot of the app) is now shown to the assistant for the rest of that reply, instead of being dropped. It goes to the model as a message right after the step's tool results, and the result itself keeps a one-line note in its place: the saved conversation holds only the note, never the image. A result shows at most 2 images and 512 KiB in all, and a reply the latest 4; anything past that, other image types and other binary content (which was dropped silently) are left out with a note saying why. A server runner on `/core` gets this through `AgentCore` and `extraToolSet` with no change.
