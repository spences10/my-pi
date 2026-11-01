---
name: my-pi-sqlite
# prettier-ignore
description: Use when inspecting, querying, or modifying SQLite databases through a configured SQLite MCP server.
compatibility: Requires Pi with a configured SQLite MCP server.
---

# SQLite workflow

This skill does not install an MCP server, open databases
automatically, or authorize writes. Keep the user's server
configuration and permissions.

1. Discover actual tool names with codemode `searchTools("SQLite")`,
   `describeNamespace(namespace)`, and `describeTool(name)`, or tool
   search.
2. Use `open_database` for existing files. Use `create_database` only
   when creating a database is explicitly intended.
3. Inspect with `database_info`, `list_tables`, `describe_table`, or
   `export_schema` before constructing queries.
4. Use `execute_read_query` for SELECT, PRAGMA, and EXPLAIN. Keep
   limits small, avoid selecting credential columns, and bound
   model-visible output.
5. Before authorized writes or schema changes, prefer
   `backup_database` and an explicit transaction. Use
   `execute_write_query` or `execute_schema_query` only when the
   intent and affected data are clear.
6. Commit only on success; roll back failed transactions. Close
   databases with `close_database` when finished.
7. In codemode inspect MCP `isError` results before continuing.

Prefer MCP over raw sqlite3 or one-off Python SQL scripts. Use a shell
fallback only when MCP is unavailable or the user explicitly requests
it, and retain the same backup, transaction, and approval precautions.
Never bypass MCP safety gates merely to make destructive SQL easier.
