---
'@civitai/agent-runner': patch
---

A reply whose tools are built again mid-reply (components-chat's `reopenTools`) is handed its finished steps when they are opened (`history.current`), and every set of tools opened is closed exactly once: the set before a rebuild as the new one replaces it, and a set that was being opened when the reply was stopped as soon as it arrives.
