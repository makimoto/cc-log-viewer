# CLAUDE.md

## Project Overview

`@makimoto/cc-log-viewer` is a local web app for searching and browsing Claude Code session logs. It indexes conversation data from `~/.claude/projects/` into SQLite FTS5 and serves a searchable web UI.

## Tech Stack

- **Runtime**: Node.js (>= 18)
- **Server**: Express
- **Database**: SQLite via better-sqlite3 with FTS5 full-text search
- **Frontend**: Single HTML file with embedded CSS/JS (no build tools)
- **Tests**: Node.js built-in test runner (`node:test` + `node:assert`)

## Project Structure

```
bin/cc-log-viewer.js   # CLI entry point (web server + CLI search mode)
src/search.js          # Search/query logic (shared by server and CLI)
src/indexer.js         # Session data indexer (SQLite FTS5)
src/server.js          # Express API server
src/static/index.html  # Frontend (single file, no framework)
test/indexer.test.js   # Indexer tests
test/search.test.js    # Search module tests
test/server.test.js    # Server API tests
```

## Commands

- `npm test` -- Run all tests
- `node bin/cc-log-viewer.js` -- Start the web server (default: http://127.0.0.1:8899)
- `node bin/cc-log-viewer.js search "query"` -- CLI search (JSON output)
- `node bin/cc-log-viewer.js sessions` -- List sessions (JSON output)
- `node bin/cc-log-viewer.js session <id>` -- Session detail (JSON output)
- `node bin/cc-log-viewer.js --stats` -- Show index stats
- `node bin/cc-log-viewer.js --reindex` -- Reindex and exit
- `node bin/cc-log-viewer.js --reindex-force` -- Force full reindex and exit

## Key Design Decisions

- **SQLite FTS5** over Elasticsearch: Zero external dependencies, sub-second indexing, perfect for local single-user use.
- **Incremental indexing**: Compares file mtime vs indexed_at timestamp to skip unchanged sessions.
- **Fallback discovery**: Projects without `sessions-index.json` are handled by scanning JSONL files directly and extracting metadata.
- **`CLAUDE_CONFIG_DIR`**: Respects this environment variable for non-default Claude Code data directories.
- **DB location**: `<claude-config-dir>/cc-log-viewer.db`
- **Prefix matching**: FTS5 `"term"*` syntax on the last search term for partial matching (e.g., Jira ticket IDs).
- **Shared search module**: `search.js` contains all query logic, used by both the Express server and CLI mode.

## Testing Notes

- Tests use temp directories with `CLAUDE_CONFIG_DIR` to isolate from real data.
- Modules are re-required fresh in tests (cache cleared) since they read env vars at require time.
- All APIs are synchronous (better-sqlite3 is sync by design).
