"use strict";

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");

let tmpDir;
let indexer;

/**
 * Clear the indexer module from require cache and re-require it.
 * This is necessary because the module reads CLAUDE_CONFIG_DIR at load time.
 */
function freshRequireIndexer() {
  const modulePath = require.resolve("../src/indexer.js");
  delete require.cache[modulePath];
  return require("../src/indexer.js");
}

/**
 * Create the fake session data structure inside the given base directory.
 */
function createFakeData(baseDir) {
  const projectsDir = path.join(baseDir, "projects");
  const testProjectDir = path.join(projectsDir, "test-project");
  const fallbackProjectDir = path.join(projectsDir, "fallback-project");

  fs.mkdirSync(testProjectDir, { recursive: true });
  fs.mkdirSync(fallbackProjectDir, { recursive: true });

  // sessions-index.json for test-project
  const jsonlPath = path.join(testProjectDir, "test-session-1.jsonl");
  const sessionsIndex = {
    version: 1,
    entries: [
      {
        sessionId: "test-session-1",
        fullPath: jsonlPath,
        fileMtime: Date.now(),
        firstPrompt: "Hello",
        summary: "Test session",
        messageCount: 2,
        created: "2026-01-01T00:00:00.000Z",
        modified: "2026-01-01T01:00:00.000Z",
        gitBranch: "main",
        projectPath: "/tmp/test-project",
      },
    ],
  };
  fs.writeFileSync(
    path.join(testProjectDir, "sessions-index.json"),
    JSON.stringify(sessionsIndex)
  );

  // JSONL file for test-session-1
  const jsonlLines = [
    JSON.stringify({
      type: "user",
      message: { role: "user", content: "Hello world" },
      sessionId: "test-session-1",
      cwd: "/tmp/test-project",
      gitBranch: "main",
      timestamp: "2026-01-01T00:00:00.000Z",
    }),
    JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Hi there!" }],
      },
      sessionId: "test-session-1",
      timestamp: "2026-01-01T00:01:00.000Z",
    }),
    JSON.stringify({
      type: "progress",
      data: { type: "tool_progress" },
      timestamp: "2026-01-01T00:02:00.000Z",
    }),
  ];
  fs.writeFileSync(jsonlPath, jsonlLines.join("\n") + "\n");

  // Orphan JSONL file in fallback-project (no sessions-index.json)
  const orphanJsonl = JSON.stringify({
    type: "user",
    message: { role: "user", content: "Fallback test" },
    sessionId: "orphan-session",
    cwd: "/tmp/fallback",
    gitBranch: "feature-x",
    timestamp: "2026-01-02T00:00:00.000Z",
  });
  fs.writeFileSync(
    path.join(fallbackProjectDir, "orphan-session.jsonl"),
    orphanJsonl + "\n"
  );
}

describe("indexer", () => {
  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-indexer-test-"));
    createFakeData(tmpDir);
    process.env.CLAUDE_CONFIG_DIR = tmpDir;
    indexer = freshRequireIndexer();
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.CLAUDE_CONFIG_DIR;
  });

  it("buildIndex() indexes sessions from sessions-index.json", () => {
    const result = indexer.buildIndex(true);
    assert.ok(result.sessionsIndexed >= 1, "should index at least 1 session");
    assert.ok(
      result.messagesIndexed >= 1,
      "should index at least 1 message"
    );
  });

  it("buildIndex() discovers sessions from orphan JSONL files (fallback)", () => {
    const result = indexer.buildIndex(true);
    // Should find both test-session-1 (from index) and orphan-session (from JSONL scan)
    assert.ok(
      result.sessionsIndexed >= 2,
      `expected at least 2 sessions, got ${result.sessionsIndexed}`
    );
  });

  it("getStats() returns correct counts after indexing", () => {
    indexer.buildIndex(true);
    const stats = indexer.getStats();
    assert.equal(stats.sessionCount, 2);
    // test-session-1 has 2 messages (user + assistant), orphan has 1
    assert.equal(stats.messageCount, 3);
    assert.equal(stats.projectCount, 2);
    assert.ok(stats.dbSizeBytes > 0);
    assert.equal(stats.dbPath, indexer.DB_PATH);
  });

  it("incremental indexing skips unchanged sessions", () => {
    indexer.buildIndex(true);
    const result = indexer.buildIndex(false);
    assert.equal(result.sessionsIndexed, 0, "no sessions should be re-indexed");
    assert.equal(result.sessionsSkipped, 2, "both sessions should be skipped");
  });

  it("buildIndex(true) force reindexes everything", () => {
    indexer.buildIndex(true);
    const result = indexer.buildIndex(true);
    assert.ok(
      result.sessionsIndexed >= 2,
      "force should reindex all sessions"
    );
    assert.equal(result.sessionsSkipped, 0, "force should skip nothing");
  });

  it("malformed JSONL lines are skipped gracefully", () => {
    const malformedPath = path.join(
      tmpDir,
      "projects",
      "test-project",
      "malformed-session.jsonl"
    );
    const lines = [
      "NOT VALID JSON",
      JSON.stringify({
        type: "user",
        message: { role: "user", content: "Valid line" },
        sessionId: "malformed-session",
        timestamp: "2026-01-03T00:00:00.000Z",
      }),
      "{broken json",
    ];
    fs.writeFileSync(malformedPath, lines.join("\n") + "\n");

    // Re-require to pick up the new file
    indexer = freshRequireIndexer();
    const result = indexer.buildIndex(true);
    assert.ok(result.sessionsIndexed >= 3, "should index the valid session too");

    // Clean up the extra file
    fs.unlinkSync(malformedPath);
    indexer = freshRequireIndexer();
  });

  it("content extraction: string content works", () => {
    indexer.buildIndex(true);
    // The user message "Hello world" is a string content.
    // Verify via stats that messages were indexed (string content parsed).
    const stats = indexer.getStats();
    assert.ok(
      stats.messageCount >= 2,
      "string content messages should be indexed"
    );
  });

  it("content extraction: array content blocks (type:text) works", () => {
    indexer.buildIndex(true);
    // The assistant message uses array content [{type:"text",text:"Hi there!"}].
    // If array extraction failed, messageCount would be lower.
    const stats = indexer.getStats();
    assert.ok(
      stats.messageCount >= 3,
      "array content block messages should be indexed"
    );
  });

  it("progress/tool messages are skipped (not indexed)", () => {
    indexer.buildIndex(true);
    const stats = indexer.getStats();
    // test-session-1 has 3 lines but only 2 are user/assistant.
    // orphan-session has 1 user message. Total = 3 messages.
    assert.equal(
      stats.messageCount,
      3,
      "progress messages should not be in the index"
    );
  });
});
