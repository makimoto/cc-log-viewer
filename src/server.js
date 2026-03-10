const path = require("path");
const os = require("os");
const express = require("express");
const Database = require("better-sqlite3");

const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
const DB_PATH = path.join(CLAUDE_DIR, "cc-log-viewer.db");
const STATIC_DIR = path.join(__dirname, "static");

const app = express();
app.use(express.json());
app.use(express.static(STATIC_DIR));

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
    // Strip FTS5 special chars
    const clean = term.replace(/["\x00*(){}^~:]/g, "");
    if (clean) {
      cleaned.push(clean);
    }
  }
  if (!cleaned.length) return '""';
  // Quote all terms except the last; last term uses prefix matching (*)
  const parts = cleaned.slice(0, -1).map((t) => `"${t}"`);
  const last = cleaned[cleaned.length - 1];
  parts.push(`"${last}"*`);
  return parts.join(" ");
}

// SPA routing
app.get("/", (_req, res) => {
  res.sendFile(path.join(STATIC_DIR, "index.html"));
});

app.get("/sessions/:sessionId", (_req, res) => {
  res.sendFile(path.join(STATIC_DIR, "index.html"));
});

// Search messages
app.get("/api/search", (req, res) => {
  const q = req.query.q || "";
  const project = req.query.project || null;
  const branch = req.query.branch || null;
  const role = req.query.role || null;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const perPage = Math.min(500, Math.max(1, parseInt(req.query.per_page, 10) || 20));
  const offset = (page - 1) * perPage;

  if (!q.trim()) {
    return res.json({ total: 0, page, per_page: perPage, results: [] });
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
    const countSql = `SELECT COUNT(*) AS total ${baseFrom}${filters}`;
    const totalRow = db.prepare(countSql).get(params);
    const total = totalRow.total;

    const resultsSql = `
      SELECT
        snippet(messages, 2, '<mark>', '</mark>', '...', 64) AS snippet,
        m.session_id,
        m.role,
        m.timestamp,
        m.message_type,
        s.summary,
        s.project_name,
        s.git_branch
      ${baseFrom}${filters}
      ORDER BY m.timestamp DESC
      LIMIT $limit OFFSET $offset
    `;
    params.limit = perPage;
    params.offset = offset;

    const rows = db.prepare(resultsSql).all(params);

    res.json({ total, page, per_page: perPage, results: rows });
  } finally {
    db.close();
  }
});

// List sessions
app.get("/api/sessions", (req, res) => {
  const project = req.query.project || null;
  const branch = req.query.branch || null;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const perPage = Math.min(500, Math.max(1, parseInt(req.query.per_page, 10) || 50));
  const offset = (page - 1) * perPage;

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
    const countSql = `SELECT COUNT(*) AS total FROM sessions ${where}`;
    const totalRow = db.prepare(countSql).get(params);
    const total = totalRow.total;

    const resultsSql = `
      SELECT *
      FROM sessions
      ${where}
      ORDER BY modified DESC
      LIMIT $limit OFFSET $offset
    `;
    params.limit = perPage;
    params.offset = offset;

    const rows = db.prepare(resultsSql).all(params);

    res.json({ total, page, per_page: perPage, sessions: rows });
  } finally {
    db.close();
  }
});

// Get single session with messages
app.get("/api/sessions/:sessionId", (req, res) => {
  const sessionId = req.params.sessionId;

  const db = getDb();
  try {
    const session = db.prepare(
      "SELECT * FROM sessions WHERE session_id = $sid"
    ).get({ sid: sessionId });

    if (!session) {
      return res.status(404).json({ detail: "Session not found" });
    }

    const messages = db.prepare(`
      SELECT role, content, timestamp, message_type
      FROM messages
      WHERE session_id = $sid
      ORDER BY timestamp ASC
    `).all({ sid: sessionId });

    res.json({ session, messages });
  } finally {
    db.close();
  }
});

// Stats
app.get("/api/stats", (_req, res) => {
  const db = getDb();
  try {
    const sessionCount = db.prepare("SELECT COUNT(*) AS c FROM sessions").get().c;
    const messageCount = db.prepare("SELECT COUNT(*) AS c FROM messages").get().c;
    const projects = db.prepare(
      "SELECT DISTINCT project_name FROM sessions ORDER BY project_name"
    ).all().map((r) => r.project_name);
    const lastIndexed = db.prepare(
      "SELECT value FROM index_meta WHERE key = 'last_indexed_at'"
    ).get();

    res.json({
      session_count: sessionCount,
      message_count: messageCount,
      projects,
      last_indexed_at: lastIndexed ? lastIndexed.value : null,
    });
  } finally {
    db.close();
  }
});

// Reindex
app.post("/api/reindex", async (_req, res) => {
  try {
    const { buildIndex } = require("./indexer.js");
    await buildIndex();
    res.json({ status: "ok" });
  } catch (err) {
    res.status(500).json({ detail: err.message });
  }
});

function start(host, port) {
  app.listen(port, host, () => {
    console.log(`Starting cc-log-viewer at http://${host}:${port}`);
  });
}

module.exports = { app, start };
