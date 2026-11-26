---
'@spences10/pi-redact': patch
---

Keep Pi's system messages in place when redacting request messages, so
tools loaded by `tool_search` no longer rewrite the cached prompt
prefix. Redaction now runs only in `context_with_system`, and returns
nothing when no message changed. A `context` handler that changes any
message makes Pi collapse its system messages into one leading
message.
