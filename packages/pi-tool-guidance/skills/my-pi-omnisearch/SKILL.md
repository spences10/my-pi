---
name: my-pi-omnisearch
# prettier-ignore
description: Use when researching current facts, verifying documentation, or finding sources with a configured Omnisearch MCP server.
compatibility: Requires Pi with a configured Omnisearch MCP server.
---

# Verified web research

This skill supplies guidance, not an MCP server or provider
credentials. Use the user's configured integration; do not install or
configure one without authorization.

1. Discover the actual namespace and tool names. In codemode use
   `searchTools("web search")`, `describeNamespace(namespace)`, and
   `describeTool(name)`; use tool search when that is the available
   route. Never assume hyphenated server names are valid JavaScript
   identifiers.
2. Use `web_search` for discovery. Choose providers deliberately:
   Tavily for factual/cited searches, Brave or Kagi for operators, and
   Exa for semantic discovery, when those providers are available.
3. Use `web_extract` to read actual source content before making
   claims. Search snippets alone are not verified evidence.
4. Use `ai_search` when a synthesis with sources helps; verify
   important claims against those sources.
5. Prefer official documentation, repositories, release notes, and
   source. State source conflicts, uncertainty, and partial tool
   failures.
6. In codemode inspect MCP `isError` results, not just promise
   resolution.

If the server is unavailable, say so and use an available research
tool without claiming Omnisearch verified the result. Never invent
sources.
