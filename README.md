# @makimoto/cc-log-viewer

A local web app for searching and browsing [Claude Code](https://docs.anthropic.com/en/docs/claude-code) session logs with full-text search.

Indexes all conversation data stored under `~/.claude/projects/` into SQLite FTS5 and serves a searchable web interface.

## Quick Start

```bash
npx @makimoto/cc-log-viewer
```

Opens at http://127.0.0.1:8899

## Features

- CLI search mode with JSON output for AI agents and scripting
- Full-text search across all Claude Code sessions using SQLite FTS5
- Prefix matching for partial search terms (e.g., "API-8" matches "API-8853")
- Filter by project, git branch, and role (user/assistant)
- Session list view with metadata (summary, branch, timestamps)
- Session detail view with full conversation history
- Copy `claude --resume <session-id>` command to resume sessions from terminal
- Auto-reindex every 3 minutes while the browser tab is open
- Incremental indexing (only processes new/changed sessions)
- Keyboard shortcut: `/` to focus search

## Installation

```bash
# Run directly (no install needed)
npx @makimoto/cc-log-viewer

# Or install globally
npm install -g @makimoto/cc-log-viewer
cc-log-viewer
```

## CLI Options

### Web server (default)

```
cc-log-viewer [--port <number>] [--host <string>]
```

### CLI search mode

Search and retrieve session data as JSON, suitable for AI agents and scripting.

```bash
# Search messages (outputs JSON)
cc-log-viewer search "API-8853"
cc-log-viewer search "API-8" --project td-api --role assistant --limit 10

# List sessions
cc-log-viewer sessions [--project <name>] [--branch <name>] [--limit <n>]

# Get full session detail
cc-log-viewer session <session-id>
```

Prefix matching is supported: `"API-8"` matches `API-8853`, `API-8654`, etc.

### Other options

```
cc-log-viewer --reindex          Reindex sessions and exit
cc-log-viewer --reindex-force    Force full reindex and exit
cc-log-viewer --stats            Show index stats and exit
```

## How It Works

Claude Code stores session data as JSONL files under `~/.claude/projects/`. This tool:

1. Scans all project directories for session metadata (`sessions-index.json`) and raw JSONL files
2. Extracts user and assistant messages, ignoring tool calls and system data
3. Stores everything in a SQLite database with FTS5 at `~/.claude/cc-log-viewer.db`
4. Serves a web UI for searching and browsing

## Configuration

If you use a custom Claude Code config directory via the `CLAUDE_CONFIG_DIR` environment variable, this tool respects it automatically:

```bash
CLAUDE_CONFIG_DIR=/custom/path/to/claude npx @makimoto/cc-log-viewer
```

By default, `~/.claude/` is used.

## Requirements

- Node.js >= 18
- Claude Code (session data must exist under the Claude config directory)

## License

MIT
