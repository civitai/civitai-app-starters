---
'@civitai/components-chat': minor
---

The chat can tell the assistant the viewer's date in their own time zone. `<civitai-chat>` takes a `time-zone` attribute (also `timeZone`), an IANA name such as `America/Chicago`: the system prompt's date line then gives that zone's calendar day, weekday and name ("Today is Thursday 2026-10-22 (America/Chicago).") instead of UTC's date, so late in the evening west of UTC "today" is still the viewer's today. Subagents get the same line. Unset, or a name the runtime does not know, the line is UTC's date exactly as before. A server runner on `/core` passes the same zone as `buildSystemPrompt({ timeZone })`; `dateLine(now, timeZone)` is that one line.
