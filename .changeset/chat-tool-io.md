---
'@civitai/components-chat': minor
---

`fetch_page` hands the assistant up to 16,000 characters of a page instead of 4,000, and a cut reply of any Civitai tool says how many characters were left out (`…(N more characters not shown)`) instead of `…(truncated)`. A page already read in a chat is not fetched, or paid for, again: the assistant gets the same text, marked as already fetched. An added MCP server's tool call whose reply never comes, because the timeout passed without progress or the server ended or dropped the call's event stream before answering, now fails at once (no longer after the whole 610 s timeout) and reaches the assistant as `{ error, retryable: true, note }`, telling it to check the call's effect before running it again.
