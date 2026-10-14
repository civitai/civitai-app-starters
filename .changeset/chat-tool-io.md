---
'@civitai/components-chat': minor
---

`fetch_page` hands the assistant up to 16,000 characters of a page instead of 4,000, and a cut reply of any Civitai tool says how many characters were left out (`…(N more characters not shown)`) instead of `…(truncated)`. A page already read in a chat is not fetched, or paid for, again: the assistant gets the same text, marked as already fetched. An added MCP server's tool call whose reply never comes now reaches the assistant as `{ error, retryable: true, note }`, telling it to check the call's effect before running it again, instead of failing as an ordinary tool error: when the timeout passes without progress (still after 610 s), and when the server ends or drops the call's event stream before answering, which now fails at once instead of waiting out that timeout.
