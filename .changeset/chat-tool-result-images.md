---
'@civitai/components-chat': minor
---

An image in an added MCP server's tool result (a JPEG, PNG, WebP or GIF, such as a screenshot of the app) is now shown to the assistant once, in the next step, instead of being dropped. It goes to the model as a message right after that step's tool results, and the result itself keeps a one-line note in its place: the saved conversation holds only the note, never the image. A result shows at most 2 images and 512 KiB in all; anything past that, other image types and other binary content (which was dropped silently) are left out with a note saying why. A model that takes no images refuses that request; the step is then asked for again without the image, and no image is sent for the rest of the reply. A server runner on `/core` gets this through `AgentCore` and `extraToolSet` with no change.
