# Changelog

## [0.2.1] - 2026-03-31

### Changed

- `--project` filter now uses partial matching (LIKE) instead of exact match.
- `--project` matches against both `project_name` and `project_path`, so you can use human-readable names like `cc_searcher` instead of the full directory name like `-Users-makimoto-misc-cc-searcher`.

## [0.2.0] - 2026-03-25

### Added

- CLI search mode: `cc-log-viewer search "query"` outputs JSON to stdout.
- CLI session commands: `sessions` (list) and `session <id>` (detail).
- CLI flags: `--project`, `--branch`, `--role`, `--limit` for filtering.
- Shared search module (`src/search.js`) used by both the web server and CLI.

### Changed

- Extracted query logic from `server.js` into `search.js`.

## [0.1.0] - 2026-03-10

### Added

- Initial release.
- Web UI for searching and browsing Claude Code session logs.
- SQLite FTS5 full-text search with incremental indexing.
- Prefix matching for partial search terms (e.g., `API-8` matches `API-8853`).
- Session discovery from `~/.claude/projects/` with fallback for missing `sessions-index.json`.
- Express API server with endpoints: `/api/search`, `/api/sessions`, `/api/stats`, `/api/reindex`.
- Single-file frontend (`src/static/index.html`) with no build tools.
- `CLAUDE_CONFIG_DIR` environment variable support.
- `--reindex`, `--reindex-force`, `--stats` CLI flags.
