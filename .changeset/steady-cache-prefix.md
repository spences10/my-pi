---
'@spences10/pi-redact': patch
---

Stop forcing Pi to collapse system messages when a request has nothing
to redact, so tools loaded by `tool_search` no longer rewrite the
cached prompt prefix.
