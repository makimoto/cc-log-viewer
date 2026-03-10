/**
 * Index Claude Code session data into SQLite FTS5 for full-text search.
 *
 * Reads session metadata and conversation messages from ~/.claude/projects/
 * and stores them in a SQLite database with FTS5 virtual tables.
 */

"use strict";

const os = require("os");
const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
const PROJECTS_DIR = path.join(CLAUDE_DIR, "projects");
const DB_PATH = path.join(CLAUDE_DIR, "cc-log-viewer.db");

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sessions (
    session_id TEXT PRIMARY KEY,
    project_path TEXT,
    project_name TEXT,
    git_branch TEXT,
    summary TEXT,
    first_prompt TEXT,
    message_count INTEGER,
    created TEXT,
    modified TEXT,
    indexed_at REAL
);

CREATE VIRTUAL TABLE IF NOT EXISTS messages USING fts5(
    session_id,
    role,
    content,
    timestamp,
    message_type,
    tokenize='unicode61'
);

CREATE TABLE IF NOT EXISTS index_meta (
    key TEXT PRIMARY KEY,
    value TEXT
);
`;

function getDbPath() {
  return DB_PATH;
}

function _connect() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  return db;
}

function _initDb(db) {
  db.exec(SCHEMA_SQL);
}

/**
 * Extract plain text from a message content field.
 *
 * Content can be either a string or a list of content blocks.
 * For content block arrays, only "text" type blocks are extracted.
 */
function _extractTextFromContent(content) {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    const parts = [];
    for (const block of content) {
      if (
        block !== null &&
        typeof block === "object" &&
        block.type === "text"
      ) {
        const text = block.text || "";
        if (text) {
          parts.push(text);
        }
      }
    }
    return parts.join("\n");
  }
  return "";
}

/**
 * Parse a session JSONL file and return an array of
 * { role, content, timestamp, messageType } objects.
 *
 * Only user and assistant messages with actual text content are included.
 */
function _parseJsonlMessages(jsonlPath) {
  const results = [];
  let data;
  try {
    data = fs.readFileSync(jsonlPath, "utf-8");
  } catch (e) {
    console.warn(`Cannot read ${jsonlPath}: ${e.message}`);
    return results;
  }

  const lines = data.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }

    const msgType = obj.type;
    if (msgType !== "user" && msgType !== "assistant") continue;

    const message = obj.message;
    if (message === null || typeof message !== "object") continue;

    const role = message.role || "";
    if (role !== "user" && role !== "assistant") continue;

    const rawContent = message.content;
    if (rawContent === undefined || rawContent === null) continue;

    const text = _extractTextFromContent(rawContent);
    if (!text.trim()) continue;

    const timestamp = obj.timestamp || "";
    results.push({ role, content: text, timestamp, messageType: msgType });
  }

  return results;
}

/**
 * Extract session metadata by reading the entire JSONL file.
 *
 * Used as a fallback when sessions-index.json is not available.
 */
function _extractMetadataFromJsonl(jsonlPath) {
  const sessionId = path.basename(jsonlPath, ".jsonl");
  const stat = fs.statSync(jsonlPath);
  const meta = {
    sessionId,
    fullPath: jsonlPath,
    fileMtime: Math.floor(stat.mtimeMs),
    firstPrompt: "",
    summary: "",
    messageCount: 0,
    created: "",
    modified: "",
    gitBranch: "",
    projectPath: "",
  };

  let msgCount = 0;
  let firstTimestamp = null;
  let lastTimestamp = null;

  let data;
  try {
    data = fs.readFileSync(jsonlPath, "utf-8");
  } catch (e) {
    console.warn(`Cannot read ${jsonlPath}: ${e.message}`);
    return meta;
  }

  const lines = data.split("\n");
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }

    const msgType = obj.type;
    const ts = obj.timestamp || "";

    if (typeof ts === "string" && ts) {
      if (firstTimestamp === null) {
        firstTimestamp = ts;
      }
      lastTimestamp = ts;
    }

    if (!meta.gitBranch && obj.gitBranch) {
      meta.gitBranch = obj.gitBranch;
    }
    if (!meta.projectPath && obj.cwd) {
      meta.projectPath = obj.cwd;
    }
    if (!meta.sessionId && obj.sessionId) {
      meta.sessionId = obj.sessionId;
    }

    if (msgType === "user" || msgType === "assistant") {
      msgCount++;
      const message = obj.message || {};
      if (msgType === "user" && !meta.firstPrompt) {
        const content = message.content || "";
        if (typeof content === "string") {
          meta.firstPrompt = content.slice(0, 200);
        }
      }
    }
  }

  meta.messageCount = msgCount;
  if (firstTimestamp) {
    meta.created = firstTimestamp;
  }
  if (lastTimestamp) {
    meta.modified = lastTimestamp;
  }

  return meta;
}

/**
 * Discover all sessions from ~/.claude/projects/.
 *
 * First reads sessions-index.json if available, then falls back to
 * scanning JSONL files directly for projects without an index.
 * Returns an array of [projectDirName, entryDict] tuples.
 */
function _discoverSessions() {
  const results = [];

  if (!fs.existsSync(PROJECTS_DIR) || !fs.statSync(PROJECTS_DIR).isDirectory()) {
    console.warn(`Projects directory not found: ${PROJECTS_DIR}`);
    return results;
  }

  const projectDirs = fs.readdirSync(PROJECTS_DIR).sort();

  for (const dirName of projectDirs) {
    const projectDir = path.join(PROJECTS_DIR, dirName);
    let dirStat;
    try {
      dirStat = fs.statSync(projectDir);
    } catch {
      continue;
    }
    if (!dirStat.isDirectory()) continue;

    const indexFile = path.join(projectDir, "sessions-index.json");
    const indexedSessionIds = new Set();

    if (fs.existsSync(indexFile)) {
      let data = {};
      try {
        data = JSON.parse(fs.readFileSync(indexFile, "utf-8"));
      } catch (e) {
        console.warn(`Cannot read ${indexFile}: ${e.message}`);
      }

      const entries = data.entries || [];
      for (const entry of entries) {
        const sid = entry.sessionId || "";
        if (sid) {
          indexedSessionIds.add(sid);
        }
        results.push([dirName, entry]);
      }
    }

    // Scan for JSONL files not covered by sessions-index.json
    let files;
    try {
      files = fs.readdirSync(projectDir).sort();
    } catch {
      continue;
    }

    for (const fileName of files) {
      if (!fileName.endsWith(".jsonl")) continue;
      const sessionId = path.basename(fileName, ".jsonl");
      if (indexedSessionIds.has(sessionId)) continue;

      const jsonlFile = path.join(projectDir, fileName);
      const entry = _extractMetadataFromJsonl(jsonlFile, dirName);
      results.push([dirName, entry]);
    }
  }

  return results;
}

/**
 * Build the search index from Claude Code session data.
 *
 * @param {boolean} force - If true, drop and rebuild everything.
 *   If false, only index sessions whose modified time is newer than
 *   the last indexed time.
 * @returns {{ sessionsIndexed: number, messagesIndexed: number, sessionsSkipped: number }}
 */
function buildIndex(force = false) {
  const db = _connect();
  _initDb(db);

  if (force) {
    db.exec("DELETE FROM sessions");
    db.exec("DELETE FROM messages");
  }

  const stats = { sessionsIndexed: 0, messagesIndexed: 0, sessionsSkipped: 0 };

  const existing = {};
  if (!force) {
    const rows = db.prepare("SELECT session_id, indexed_at FROM sessions").all();
    for (const row of rows) {
      existing[row.session_id] = row.indexed_at;
    }
  }

  const insertSession = db.prepare(
    `INSERT INTO sessions
     (session_id, project_path, project_name, git_branch, summary,
      first_prompt, message_count, created, modified, indexed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const insertMessages = db.prepare(
    `INSERT INTO messages (session_id, role, content, timestamp, message_type)
     VALUES (?, ?, ?, ?, ?)`
  );

  const deleteSession = db.prepare("DELETE FROM sessions WHERE session_id = ?");
  const deleteMessages = db.prepare("DELETE FROM messages WHERE session_id = ?");

  const sessions = _discoverSessions();

  const insertBatch = db.transaction((batch) => {
    for (const row of batch) {
      insertMessages.run(row[0], row[1], row[2], row[3], row[4]);
    }
  });

  for (const [projectDirName, entry] of sessions) {
    const sessionId = entry.sessionId || "";
    if (!sessionId) continue;

    const modified = entry.modified || "";
    const fileMtime = entry.fileMtime || 0;

    if (!force && sessionId in existing) {
      const indexedAt = existing[sessionId];
      if (indexedAt && fileMtime && indexedAt >= fileMtime / 1000.0) {
        stats.sessionsSkipped++;
        continue;
      }
    }

    const projectPath = entry.projectPath || "";
    const projectName = projectDirName;
    const gitBranch = entry.gitBranch || "";
    const summary = entry.summary || "";
    const firstPrompt = entry.firstPrompt || "";
    const messageCount = entry.messageCount || 0;
    const created = entry.created || "";
    const now = Date.now() / 1000.0;

    let jsonlPath = entry.fullPath || "";
    if (!jsonlPath || !fs.existsSync(jsonlPath)) {
      jsonlPath = path.join(PROJECTS_DIR, projectDirName, `${sessionId}.jsonl`);
    }

    if (sessionId in existing) {
      deleteSession.run(sessionId);
      deleteMessages.run(sessionId);
    }

    insertSession.run(
      sessionId,
      projectPath,
      projectName,
      gitBranch,
      summary,
      firstPrompt,
      messageCount,
      created,
      modified,
      now
    );

    let msgCount = 0;
    if (fs.existsSync(jsonlPath)) {
      const messages = _parseJsonlMessages(jsonlPath);
      const batch = [];
      for (const msg of messages) {
        batch.push([sessionId, msg.role, msg.content, msg.timestamp, msg.messageType]);
        msgCount++;
        if (batch.length >= 500) {
          insertBatch(batch);
          batch.length = 0;
        }
      }
      if (batch.length > 0) {
        insertBatch(batch);
      }
    }

    stats.sessionsIndexed++;
    stats.messagesIndexed += msgCount;

    if (stats.sessionsIndexed % 50 === 0) {
      // Periodic implicit checkpoint via WAL
    }
  }

  db.close();
  return stats;
}

/**
 * Return index statistics.
 *
 * @returns {{ sessionCount: number, messageCount: number, dbSizeBytes: number, projectCount: number, dbPath: string }}
 */
function getStats() {
  if (!fs.existsSync(DB_PATH)) {
    return {
      sessionCount: 0,
      messageCount: 0,
      dbSizeBytes: 0,
      projectCount: 0,
      dbPath: DB_PATH,
    };
  }

  const db = _connect();
  try {
    const sessionCount = db.prepare("SELECT COUNT(*) AS c FROM sessions").get().c;
    const messageCount = db.prepare("SELECT COUNT(*) AS c FROM messages").get().c;
    const projectCount = db
      .prepare("SELECT COUNT(DISTINCT project_name) AS c FROM sessions")
      .get().c;

    const dbSizeBytes = fs.statSync(DB_PATH).size;

    return {
      sessionCount,
      messageCount,
      dbSizeBytes,
      projectCount,
      dbPath: DB_PATH,
    };
  } catch {
    return {
      sessionCount: 0,
      messageCount: 0,
      dbSizeBytes: 0,
      projectCount: 0,
      dbPath: DB_PATH,
    };
  } finally {
    db.close();
  }
}

module.exports = {
  buildIndex,
  getStats,
  getDbPath,
  DB_PATH,
};

// CLI entry point
if (require.main === module) {
  const args = process.argv.slice(2);
  const forceFlag = args.includes("--force");
  const statsFlag = args.includes("--stats");

  if (statsFlag) {
    const s = getStats();
    for (const [k, v] of Object.entries(s)) {
      console.log(`  ${k}: ${v}`);
    }
  } else {
    const result = buildIndex(forceFlag);
    console.log("Indexing complete:");
    for (const [k, v] of Object.entries(result)) {
      console.log(`  ${k}: ${v}`);
    }
    console.log();
    console.log("Stats:");
    const s = getStats();
    for (const [k, v] of Object.entries(s)) {
      console.log(`  ${k}: ${v}`);
    }
  }
}
