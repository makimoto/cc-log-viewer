const path = require("path");
const express = require("express");
const { search, listSessions, getSession, getDbStats } = require("./search.js");

const STATIC_DIR = path.join(__dirname, "static");

const app = express();
app.use(express.json());
app.use(express.static(STATIC_DIR));

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

  const result = search(q, { project, branch, role, limit: perPage, offset });
  res.json({ total: result.total, page, per_page: perPage, results: result.results });
});

// List sessions
app.get("/api/sessions", (req, res) => {
  const project = req.query.project || null;
  const branch = req.query.branch || null;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const perPage = Math.min(500, Math.max(1, parseInt(req.query.per_page, 10) || 50));
  const offset = (page - 1) * perPage;

  const result = listSessions({ project, branch, limit: perPage, offset });
  res.json({ total: result.total, page, per_page: perPage, sessions: result.sessions });
});

// Get single session with messages
app.get("/api/sessions/:sessionId", (req, res) => {
  const data = getSession(req.params.sessionId);
  if (!data) {
    return res.status(404).json({ detail: "Session not found" });
  }
  res.json(data);
});

// Stats
app.get("/api/stats", (_req, res) => {
  res.json(getDbStats());
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
