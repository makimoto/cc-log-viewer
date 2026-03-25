"use strict";

const path = require("path");
const os = require("os");
const Database = require("better-sqlite3");

const CLAUDE_DIR =
  process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
const DB_PATH = path.join(CLAUDE_DIR, "cc-log-viewer.db");

function getDb() {
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  return db;
}

function sanitizeFtsQuery(q) {
  const terms = q.trim().split(/\s+/);
  if (!terms.length || (terms.length === 1 && terms[0] === "")) {
    return '""';
  }
  const cleaned = [];
  for (const term of terms) {
    const clean = term.replace(/["\x00*(){}^~:]/g, "");
    if (clean) {
      cleaned.push(clean);
    }
  }
  if (!cleaned.length) return '""';
  const parts = cleaned.slice(0, -1).map((t) => `"${t}"`);
  const last = cleaned[cleaned.length - 1];
  parts.push(`"${last}"*`);
  return parts.join(" ");
}

function search(q, { project, branch, role, limit = 100, offset = 0 } = {}) {
  if (!q || !q.trim()) {
    return { total: 0, results: [] };
  }

  const safeQ = sanitizeFtsQuery(q);
  let filters = "";
  const params = { q: safeQ };

  if (project) {
    filters += " AND s.project_name = $project";
    params.project = project;
  }
  if (branch) {
    filters += " AND s.git_branch = $branch";
    params.branch = branch;
  }
  if (role) {
    filters += " AND m.role = $role";
    params.role = role;
  }

  const baseFrom = `
    FROM messages AS m
    JOIN sessions AS s ON m.session_id = s.session_id
    WHERE messages MATCH $q
  `;

  const db = getDb();
  try {
    const total = db
      .prepare(`SELECT COUNT(*) AS total ${baseFrom}${filters}`)
      .get(params).total;

    params.limit = limit;
    params.offset = offset;

    const results = db
      .prepare(
        `SELECT
          snippet(messages, 2, '', '', '...', 64) AS snippet,
          m.session_id,
          m.role,
          m.content,
          m.timestamp,
          m.message_type,
          s.summary,
          s.project_name,
          s.project_path,
          s.git_branch
        ${baseFrom}${filters}
        ORDER BY m.timestamp DESC
        LIMIT $limit OFFSET $offset`
      )
      .all(params);

    return { total, results };
  } finally {
    db.close();
  }
}

function listSessions({ project, branch, limit = 100, offset = 0 } = {}) {
  let filters = "";
  const params = {};

  if (project) {
    filters += " AND project_name = $project";
    params.project = project;
  }
  if (branch) {
    filters += " AND git_branch = $branch";
    params.branch = branch;
  }

  const where = "WHERE 1=1" + filters;

  const db = getDb();
  try {
    const total = db
      .prepare(`SELECT COUNT(*) AS total FROM sessions ${where}`)
      .get(params).total;

    params.limit = limit;
    params.offset = offset;

    const sessions = db
      .prepare(
        `SELECT * FROM sessions ${where} ORDER BY modified DESC LIMIT $limit OFFSET $offset`
      )
      .all(params);

    return { total, sessions };
  } finally {
    db.close();
  }
}

function getSession(sessionId) {
  const db = getDb();
  try {
    const session = db
      .prepare("SELECT * FROM sessions WHERE session_id = $sid")
      .get({ sid: sessionId });

    if (!session) return null;

    const messages = db
      .prepare(
        `SELECT role, content, timestamp, message_type
         FROM messages WHERE session_id = $sid ORDER BY timestamp ASC`
      )
      .all({ sid: sessionId });

    return { session, messages };
  } finally {
    db.close();
  }
}

function getDbStats() {
  const db = getDb();
  try {
    const sessionCount = db.prepare("SELECT COUNT(*) AS c FROM sessions").get().c;
    const messageCount = db.prepare("SELECT COUNT(*) AS c FROM messages").get().c;
    const projects = db
      .prepare("SELECT DISTINCT project_name FROM sessions ORDER BY project_name")
      .all()
      .map((r) => r.project_name);
    const lastIndexed = db
      .prepare("SELECT value FROM index_meta WHERE key = 'last_indexed_at'")
      .get();
    return {
      session_count: sessionCount,
      message_count: messageCount,
      projects,
      last_indexed_at: lastIndexed ? lastIndexed.value : null,
    };
  } finally {
    db.close();
  }
}

module.exports = { search, listSessions, getSession, getDbStats, sanitizeFtsQuery, DB_PATH };
