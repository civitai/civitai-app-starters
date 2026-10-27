---
'@civitai/components-chat': patch
---

A reply step that carried a tool's image and was refused inside the stream (a status 200 answer whose stream holds one error event with `code: "upstream_rejected"`, as Civitai's orchestration sends when the upstream model refuses a streamed request) is now asked once more without the image, as a refusal by status (400, 404, 413, 415, 422) already was. At most once per reply; no image is sent for the rest of that reply. Other errors inside the stream, such as a failed job or a timeout, still end the reply as before.
