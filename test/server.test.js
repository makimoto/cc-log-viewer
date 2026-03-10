"use strict";

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const os = require("os");

function request(server, method, urlPath) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, `http://127.0.0.1:${server.address().port}`);
    const req = http.request(url, { method }, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(body) });
        } catch {
          resolve({ status: res.statusCode, body });
        }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

describe("Express server", () => {
  let server;
  let tmpDir;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-server-test-"));

    // Create fake session data
    const projectDir = path.join(tmpDir, "projects", "test-project");
    fs.mkdirSync(projectDir, { recursive: true });

    const sessionsIndex = {
      entries: [
        {
          sessionId: "srv-test-1",
          projectPath: "/tmp/test-project",
          gitBranch: "main",
          summary: "Test session",
          firstPrompt: "hello world",
          messageCount: 2,
          created: "2025-01-01T00:00:00Z",
          modified: "2025-01-01T00:01:00Z",
        },
      ],
    };
    fs.writeFileSync(
      path.join(projectDir, "sessions-index.json"),
      JSON.stringify(sessionsIndex)
    );

    const jsonlLines = [
      JSON.stringify({
        type: "user",
        timestamp: "2025-01-01T00:00:00Z",
        message: { role: "user", content: "hello world" },
      }),
      JSON.stringify({
        type: "assistant",
        timestamp: "2025-01-01T00:00:30Z",
        message: { role: "assistant", content: "Hi there, how can I help?" },
      }),
    ];
    fs.writeFileSync(
      path.join(projectDir, "srv-test-1.jsonl"),
      jsonlLines.join("\n") + "\n"
    );

    // Set env BEFORE requiring modules
    process.env.CLAUDE_CONFIG_DIR = tmpDir;

    // Clear require cache so modules pick up the new env
    for (const key of Object.keys(require.cache)) {
      if (key.includes("server.js") || key.includes("indexer.js")) {
        delete require.cache[key];
      }
    }

    const { buildIndex } = require("../src/indexer.js");
    buildIndex(true);

    const { app } = require("../src/server.js");

    // Start on random port
    await new Promise((resolve) => {
      server = app.listen(0, "127.0.0.1", resolve);
    });
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    delete process.env.CLAUDE_CONFIG_DIR;
  });

  it("GET /api/stats returns correct counts", async () => {
    const res = await request(server, "GET", "/api/stats");
    assert.equal(res.status, 200);
    assert.equal(res.body.session_count, 1);
    assert.equal(res.body.message_count, 2);
    assert.ok(Array.isArray(res.body.projects));
    assert.ok(res.body.projects.includes("test-project"));
  });

  it("GET /api/search?q=hello returns results with snippets", async () => {
    const res = await request(server, "GET", "/api/search?q=hello");
    assert.equal(res.status, 200);
    assert.ok(res.body.total >= 1);
    assert.ok(res.body.results.length >= 1);
    assert.ok(res.body.results[0].snippet);
  });

  it("GET /api/search without query returns empty results", async () => {
    const res = await request(server, "GET", "/api/search");
    assert.equal(res.status, 200);
    assert.equal(res.body.total, 0);
    assert.deepEqual(res.body.results, []);
  });

  it("GET /api/search?q=hello&role=user filters by role", async () => {
    const res = await request(server, "GET", "/api/search?q=hello&role=user");
    assert.equal(res.status, 200);
    assert.ok(res.body.total >= 1);
    for (const r of res.body.results) {
      assert.equal(r.role, "user");
    }
  });

  it("GET /api/sessions returns session list", async () => {
    const res = await request(server, "GET", "/api/sessions");
    assert.equal(res.status, 200);
    assert.ok(res.body.total >= 1);
    assert.ok(Array.isArray(res.body.sessions));
    assert.ok(res.body.sessions.length >= 1);
  });

  it("GET /api/sessions/srv-test-1 returns session detail with messages", async () => {
    const res = await request(server, "GET", "/api/sessions/srv-test-1");
    assert.equal(res.status, 200);
    assert.ok(res.body.session);
    assert.equal(res.body.session.session_id, "srv-test-1");
    assert.ok(Array.isArray(res.body.messages));
    assert.equal(res.body.messages.length, 2);
  });

  it("GET /api/sessions/nonexistent returns 404", async () => {
    const res = await request(server, "GET", "/api/sessions/nonexistent");
    assert.equal(res.status, 404);
    assert.ok(res.body.detail);
  });

  it("POST /api/reindex returns {status: 'ok'}", async () => {
    const res = await request(server, "POST", "/api/reindex");
    assert.equal(res.status, 200);
    assert.equal(res.body.status, "ok");
  });

  it("GET / returns 200 (HTML)", async () => {
    const res = await request(server, "GET", "/");
    assert.equal(res.status, 200);
    assert.ok(typeof res.body === "string");
    assert.ok(res.body.includes("<html") || res.body.includes("<!DOCTYPE") || res.body.includes("<!doctype"));
  });
});
