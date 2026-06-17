---
'@spences10/pi-context': minor
---

Add `context_export` to write sidecar chunks directly to files without loading content into model context.

Stored chunks now reconstruct losslessly for full-source exports, which verify against the stored content hash. Exact chunk retrieval/export now honors project/session scope unless `global: true` is passed.
