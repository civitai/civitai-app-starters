---
'@civitai/components-chat': patch
---

The Civitai MCP's browse tools (model and image search) are now called as the signed-in viewer, not anonymously, so what they find can follow the viewer's own preferences. If the server refuses the viewer's token, the chat carries on anonymously for the rest of the session.
