import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  createSession,
  updateSession,
  loadSession,
  listSessions,
  searchSessions,
  lastSession,
  buildResumeContext,
  closeAllSessions,
} from "../lib/session-store.mjs";

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "session-store-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("createSession", () => {
  test("creates a session file and index entry", () => {
    const session = createSession(tmpDir, { project: "test-proj" });
    assert.ok(session.id, "session should have an id");
    assert.equal(session.project, "test-proj");
    assert.equal(session.status, "active");
    assert.deepEqual(session.decisions, []);
    assert.deepEqual(session.filesChanged, []);
    assert.deepEqual(session.openQuestions, []);
    assert.deepEqual(session.taskSnapshot, []);

    // Verify file exists.
    const filePath = path.join(tmpDir, ".cx", "sessions", `${session.id}.json`);
    assert.ok(fs.existsSync(filePath), "session file should exist");

    // Verify index.
    const index = JSON.parse(
      fs.readFileSync(path.join(tmpDir, ".cx", "sessions", "index.json"), "utf8")
    );
    assert.equal(index.length, 1);
    assert.equal(index[0].id, session.id);
  });

  test("defaults project to directory basename", () => {
    const session = createSession(tmpDir);
    assert.equal(session.project, path.basename(tmpDir));
  });
});

describe("updateSession", () => {
  test("updates distilled fields with caps", () => {
    const session = createSession(tmpDir, { project: "proj" });
    const updated = updateSession(tmpDir, session.id, {
      summary: "Implemented auth flow and wired tests",
      decisions: ["Use JWT tokens", "Store refresh tokens in httpOnly cookies"],
      filesChanged: [
        { path: "src/auth.ts", reason: "new auth module" },
        { path: "tests/auth.test.ts", reason: "auth tests" },
      ],
      openQuestions: ["Should we add rate limiting?"],
      taskSnapshot: [
        { id: "1", subject: "Implement auth", status: "completed" },
        { id: "2", subject: "Add rate limiting", status: "pending" },
      ],
      status: "completed",
    });

    assert.equal(updated.summary, "Implemented auth flow and wired tests");
    assert.equal(updated.decisions.length, 2);
    assert.equal(updated.filesChanged.length, 2);
    assert.equal(updated.openQuestions.length, 1);
    assert.equal(updated.taskSnapshot.length, 2);
    assert.equal(updated.status, "completed");

    // Verify index was updated.
    const index = JSON.parse(
      fs.readFileSync(path.join(tmpDir, ".cx", "sessions", "index.json"), "utf8")
    );
    assert.equal(index[0].status, "completed");
    assert.equal(index[0].summary, "Implemented auth flow and wired tests");
  });

  test("clamps summary to max length", () => {
    const session = createSession(tmpDir);
    const longSummary = "x".repeat(600);
    const updated = updateSession(tmpDir, session.id, { summary: longSummary });
    assert.ok(updated.summary.length <= 500);
    assert.ok(updated.summary.endsWith("\u2026"));
  });

  test("returns null for nonexistent session", () => {
    const result = updateSession(tmpDir, "nonexistent-id", { summary: "test" });
    assert.equal(result, null);
  });
});

describe("loadSession", () => {
  test("loads a full session record", () => {
    const session = createSession(tmpDir, { project: "proj" });
    updateSession(tmpDir, session.id, { summary: "test summary" });
    const loaded = loadSession(tmpDir, session.id);
    assert.equal(loaded.summary, "test summary");
    assert.equal(loaded.project, "proj");
  });

  test("returns null for nonexistent session", () => {
    assert.equal(loadSession(tmpDir, "does-not-exist"), null);
  });
});

describe("listSessions", () => {
  test("lists sessions with filters", () => {
    createSession(tmpDir, { project: "alpha" });
    createSession(tmpDir, { project: "beta" });
    const s3 = createSession(tmpDir, { project: "alpha" });
    updateSession(tmpDir, s3.id, { status: "completed" });

    // All sessions.
    assert.equal(listSessions(tmpDir).length, 3);

    // Filter by project.
    assert.equal(listSessions(tmpDir, { project: "alpha" }).length, 2);

    // Filter by status.
    assert.equal(listSessions(tmpDir, { status: "active" }).length, 2);
    assert.equal(listSessions(tmpDir, { status: "completed" }).length, 1);

    // Limit.
    assert.equal(listSessions(tmpDir, { limit: 1 }).length, 1);
  });
});

describe("searchSessions", () => {
  test("searches by summary keyword", () => {
    const s1 = createSession(tmpDir, { project: "myapp" });
    updateSession(tmpDir, s1.id, { summary: "Implemented authentication module" });
    const s2 = createSession(tmpDir, { project: "myapp" });
    updateSession(tmpDir, s2.id, { summary: "Fixed database migration" });

    const results = searchSessions(tmpDir, "authentication");
    assert.equal(results.length, 1);
    assert.equal(results[0].id, s1.id);
  });

  test("searches by project name", () => {
    createSession(tmpDir, { project: "frontend-app" });
    createSession(tmpDir, { project: "backend-api" });

    const results = searchSessions(tmpDir, "frontend");
    assert.equal(results.length, 1);
  });

  test("returns empty for no query", () => {
    assert.deepEqual(searchSessions(tmpDir, ""), []);
    assert.deepEqual(searchSessions(tmpDir, null), []);
  });
});

describe("lastSession", () => {
  test("returns most recent session", () => {
    createSession(tmpDir, { project: "proj" });
    const s2 = createSession(tmpDir, { project: "proj" });
    updateSession(tmpDir, s2.id, { summary: "latest work" });

    const last = lastSession(tmpDir);
    assert.equal(last.id, s2.id);
    assert.equal(last.summary, "latest work");
  });

  test("filters by project", () => {
    createSession(tmpDir, { project: "alpha" });
    createSession(tmpDir, { project: "beta" });

    const last = lastSession(tmpDir, "alpha");
    assert.equal(last.project, "alpha");
  });

  test("returns null when no sessions exist", () => {
    assert.equal(lastSession(tmpDir), null);
  });
});

describe("buildResumeContext", () => {
  test("builds markdown resume from distilled session", () => {
    const session = createSession(tmpDir, { project: "proj" });
    const updated = updateSession(tmpDir, session.id, {
      summary: "Refactored auth module and added JWT support",
      decisions: ["Use RS256 for JWT signing", "Store tokens in httpOnly cookies"],
      filesChanged: [
        { path: "src/auth.ts", reason: "JWT implementation" },
        { path: "src/middleware.ts", reason: "auth middleware" },
      ],
      openQuestions: ["Need to decide on refresh token rotation strategy"],
      taskSnapshot: [
        { id: "1", subject: "Implement JWT auth", status: "completed" },
        { id: "2", subject: "Add refresh token rotation", status: "pending" },
      ],
    });

    const resume = buildResumeContext(updated);
    assert.ok(resume.includes("What was in progress"));
    assert.ok(resume.includes("Refactored auth module"));
    assert.ok(resume.includes("Key decisions"));
    assert.ok(resume.includes("RS256"));
    assert.ok(resume.includes("Files changed"));
    assert.ok(resume.includes("src/auth.ts"));
    assert.ok(resume.includes("Open questions"));
    assert.ok(resume.includes("refresh token rotation"));
    assert.ok(resume.includes("Task state"));
    assert.ok(resume.includes("[completed] Implement JWT auth"));
  });

  test("returns empty string for null session", () => {
    assert.equal(buildResumeContext(null), "");
  });

  test("omits empty sections", () => {
    const session = createSession(tmpDir, { project: "proj" });
    updateSession(tmpDir, session.id, { summary: "Quick fix" });
    const loaded = loadSession(tmpDir, session.id);
    const resume = buildResumeContext(loaded);
    assert.ok(resume.includes("What was in progress"));
    assert.ok(!resume.includes("Key decisions"));
    assert.ok(!resume.includes("Files changed"));
  });
});

describe("closeAllSessions", () => {
  test("closes all active sessions", () => {
    const s1 = createSession(tmpDir, { project: "a" });
    const s2 = createSession(tmpDir, { project: "b" });
    updateSession(tmpDir, s2.id, { status: "completed" });

    const closed = closeAllSessions(tmpDir);
    assert.equal(closed, 1);

    // Verify s1 is closed.
    const loaded = loadSession(tmpDir, s1.id);
    assert.equal(loaded.status, "closed");

    // Verify s2 stays completed.
    const loaded2 = loadSession(tmpDir, s2.id);
    assert.equal(loaded2.status, "completed");
  });

  test("returns 0 when no active sessions", () => {
    assert.equal(closeAllSessions(tmpDir), 0);
  });
});
