"use strict";

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");

let tmpDir;
let search;
let indexer;

/**
 * Clear cached modules and re-require them.
 * Necessary because modules read CLAUDE_CONFIG_DIR at load time.
 */
function freshRequire() {
  for (const key of Object.keys(require.cache)) {
    if (
      key.includes("search.js") ||
      key.includes("indexer.js") ||
      key.includes("better-sqlite3")
    ) {
      delete require.cache[key];
    }
  }
  return {
    indexer: require("../src/indexer.js"),
    search: require("../src/search.js"),
  };
}

/**
 * Create fake session data for search tests.
 */
function createFakeData(baseDir) {
  const projectDir = path.join(baseDir, "projects", "test-project");
  fs.mkdirSync(projectDir, { recursive: true });

  const jsonlPath = path.join(projectDir, "search-test-1.jsonl");

  const sessionsIndex = {
    version: 1,
    entries: [
      {
        sessionId: "search-test-1",
        fullPath: jsonlPath,
        fileMtime: Date.now(),
        firstPrompt: "Working on API-8853 ticket",
        summary: "API ticket work",
        messageCount: 3,
        created: "2026-01-01T00:00:00.000Z",
        modified: "2026-01-01T01:00:00.000Z",
        gitBranch: "feature-api",
        projectPath: "/tmp/test-project",
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
      message: { role: "user", content: "Working on API-8853 ticket" },
      sessionId: "search-test-1",
      cwd: "/tmp/test-project",
      gitBranch: "feature-api",
      timestamp: "2026-01-01T00:00:00.000Z",
    }),
    JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "I'll help with the API-8853 Jira ticket" },
        ],
      },
      sessionId: "search-test-1",
      timestamp: "2026-01-01T00:01:00.000Z",
    }),
    JSON.stringify({
      type: "user",
      message: { role: "user", content: "Also check API-8654" },
      sessionId: "search-test-1",
      cwd: "/tmp/test-project",
      gitBranch: "feature-api",
      timestamp: "2026-01-01T00:02:00.000Z",
    }),
  ];
  fs.writeFileSync(jsonlPath, jsonlLines.join("\n") + "\n");
}

describe("search module", () => {
  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-search-test-"));
    createFakeData(tmpDir);
    process.env.CLAUDE_CONFIG_DIR = tmpDir;

    const mods = freshRequire();
    indexer = mods.indexer;
    search = mods.search;

    indexer.buildIndex(true);
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.CLAUDE_CONFIG_DIR;
  });

  describe("sanitizeFtsQuery", () => {
    it("wraps a simple term with quotes and prefix wildcard", () => {
      assert.equal(search.sanitizeFtsQuery("hello"), '"hello"*');
    });

    it("wraps multiple terms, only last gets prefix wildcard", () => {
      assert.equal(
        search.sanitizeFtsQuery("hello world"),
        '"hello" "world"*'
      );
    });

    it("strips special chars but keeps hyphens", () => {
      // Hyphen is not in the strip regex, so API-8853 stays as one term
      assert.equal(search.sanitizeFtsQuery("API-8853"), '"API-8853"*');
    });

    it("returns empty quotes for empty string", () => {
      assert.equal(search.sanitizeFtsQuery(""), '""');
    });
  });

  describe("search()", () => {
    it("returns results with correct fields for a basic search", () => {
      const result = search.search("API-8853");
      assert.ok(result.total >= 1, `expected total >= 1, got ${result.total}`);
      assert.ok(result.results.length >= 1);

      const first = result.results[0];
      assert.ok("snippet" in first);
      assert.ok("session_id" in first);
      assert.ok("role" in first);
      assert.ok("content" in first);
      assert.ok("timestamp" in first);
      assert.ok("summary" in first);
      assert.ok("project_name" in first);
      assert.ok("project_path" in first);
      assert.ok("git_branch" in first);
    });

    it("returns empty results for empty query", () => {
      const result = search.search("");
      assert.equal(result.total, 0);
      assert.deepEqual(result.results, []);
    });

    it("prefix matching: API-8 matches both API-8853 and API-8654", () => {
      const result = search.search("API-8");
      // Should match all 3 messages (two mention API-8853, one mentions API-8654)
      assert.ok(result.total >= 2, `expected total >= 2, got ${result.total}`);
    });

    it("prefix matching: API-88 matches API-8853 but not API-8654", () => {
      const result = search.search("API-88");
      assert.ok(result.total >= 1, `expected total >= 1, got ${result.total}`);
      // All results should contain API-8853, none should be API-8654 only
      for (const r of result.results) {
        assert.ok(
          r.content.includes("API-8853"),
          `expected content to include API-8853, got: ${r.content}`
        );
      }
    });

    it("role filter returns only matching roles", () => {
      const result = search.search("API-8853", { role: "user" });
      assert.ok(result.total >= 1);
      for (const r of result.results) {
        assert.equal(r.role, "user");
      }
    });

    it("limit and offset pagination works", () => {
      const all = search.search("API-8");
      const page1 = search.search("API-8", { limit: 1, offset: 0 });
      const page2 = search.search("API-8", { limit: 1, offset: 1 });

      assert.equal(page1.total, all.total);
      assert.equal(page1.results.length, 1);
      assert.equal(page2.results.length, 1);
      assert.notEqual(
        page1.results[0].timestamp,
        page2.results[0].timestamp
      );
    });
  });

  describe("listSessions()", () => {
    it("returns all sessions", () => {
      const result = search.listSessions();
      assert.ok(result.total >= 1, `expected total >= 1, got ${result.total}`);
      assert.ok(Array.isArray(result.sessions));
      assert.ok(result.sessions.length >= 1);
    });

    it("filters by project (exact name)", () => {
      const result = search.listSessions({ project: "test-project" });
      assert.ok(result.total >= 1);
      for (const s of result.sessions) {
        assert.equal(s.project_name, "test-project");
      }

      const empty = search.listSessions({ project: "nonexistent-project" });
      assert.equal(empty.total, 0);
      assert.deepEqual(empty.sessions, []);
    });

    it("filters by project (partial name match)", () => {
      const result = search.listSessions({ project: "test" });
      assert.ok(result.total >= 1);
      for (const s of result.sessions) {
        assert.ok(
          s.project_name.includes("test") || (s.project_path && s.project_path.includes("test")),
          `expected project_name or project_path to contain "test"`
        );
      }
    });

    it("filters by project (project_path match)", () => {
      const result = search.listSessions({ project: "/tmp/test-project" });
      assert.ok(result.total >= 1);
      for (const s of result.sessions) {
        assert.equal(s.project_path, "/tmp/test-project");
      }
    });
  });

  describe("getSession()", () => {
    it("returns session with messages for existing session", () => {
      const result = search.getSession("search-test-1");
      assert.ok(result !== null);
      assert.ok(result.session);
      assert.equal(result.session.session_id, "search-test-1");
      assert.ok(Array.isArray(result.messages));
      assert.equal(result.messages.length, 3);
    });

    it("returns null for nonexistent session", () => {
      const result = search.getSession("nonexistent-session-id");
      assert.equal(result, null);
    });
  });
});
