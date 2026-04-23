/**
 * lib/session-store.mjs — Durable session index for construct.
 *
 * Stores *distilled* session metadata — not raw transcripts. Each session
 * captures only what is needed to resume effectively:
 *   - summary (2-3 sentences of what happened)
 *   - decisions made
 *   - files touched with reason
 *   - open questions / blockers
 *   - task snapshot (IDs + status, not full descriptions)
 *
 * Storage layout:
 *   .cx/sessions/index.json          — lightweight array for fast listing
 *   .cx/sessions/<id>.json           — distilled session record
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { embedText, cosineSimilarity, rankByBm25 } from "./storage/embeddings.mjs";

const SESSIONS_DIR = ".cx/sessions";
const INDEX_FILE = "index.json";
const VECTORS_FILE = "vectors.json";
const MAX_INDEX_ENTRIES = 200;
const MAX_SUMMARY_LENGTH = 500;
const MAX_DECISIONS = 20;
const MAX_FILES = 50;
const MAX_OPEN_QUESTIONS = 10;

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function sessionsDir(rootDir) {
  return path.join(rootDir, SESSIONS_DIR);
}

function indexPath(rootDir) {
  return path.join(sessionsDir(rootDir), INDEX_FILE);
}

function vectorsPath(rootDir) {
  return path.join(sessionsDir(rootDir), VECTORS_FILE);
}

function readVectors(rootDir) {
  const p = vectorsPath(rootDir);
  if (!fs.existsSync(p)) return [];
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return []; }
}

function writeVectors(rootDir, records) {
  ensureDir(sessionsDir(rootDir));
  fs.writeFileSync(vectorsPath(rootDir), JSON.stringify(records.slice(0, MAX_INDEX_ENTRIES), null, 2) + "\n");
}

function buildSessionSearchText(entry) {
  return [entry.summary, entry.project, entry.platform].filter(Boolean).join(" ");
}

function upsertSessionVector(rootDir, id, entry) {
  const text = buildSessionSearchText(entry);
  if (!text) return;
  const embedding = embedText(text);
  const vectors = readVectors(rootDir);
  const idx = vectors.findIndex((v) => v.id === id);
  const record = { id, embedding, project: entry.project || null, status: entry.status || null };
  if (idx >= 0) vectors[idx] = record;
  else vectors.unshift(record);
  writeVectors(rootDir, vectors);
}

function readIndex(rootDir) {
  const p = indexPath(rootDir);
  if (!fs.existsSync(p)) return [];
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return [];
  }
}

function writeIndex(rootDir, entries) {
  ensureDir(sessionsDir(rootDir));
  const trimmed = entries.slice(0, MAX_INDEX_ENTRIES);
  fs.writeFileSync(indexPath(rootDir), JSON.stringify(trimmed, null, 2) + "\n");
}

/**
 * Generate a short session ID: timestamp prefix + random suffix.
 */
function generateId() {
  const ts = Date.now().toString(36);
  const rand = crypto.randomBytes(4).toString("hex");
  return `${ts}-${rand}`;
}

/**
 * Clamp a string to a max length, adding ellipsis if truncated.
 */
function clamp(str, max) {
  if (!str || str.length <= max) return str || null;
  return str.slice(0, max - 1) + "\u2026";
}

/**
 * Create a new session record and add it to the index.
 * @param {string} rootDir — project root (where .cx/ lives).
 * @param {object} opts — session metadata.
 * @returns {object} — the created session record.
 */
export function createSession(rootDir, {
  project = path.basename(rootDir),
  platform = "unknown",
} = {}) {
  const id = generateId();
  const now = new Date().toISOString();
  const record = {
    id,
    project,
    platform,
    startedAt: now,
    lastActive: now,
    status: "active",
    summary: null,
    decisions: [],
    filesChanged: [],
    openQuestions: [],
    taskSnapshot: [],
  };

  ensureDir(sessionsDir(rootDir));
  fs.writeFileSync(
    path.join(sessionsDir(rootDir), `${id}.json`),
    JSON.stringify(record, null, 2) + "\n"
  );

  const index = readIndex(rootDir);
  const indexEntry = {
    id,
    project,
    platform,
    startedAt: now,
    lastActive: now,
    status: "active",
    summary: null,
  };
  index.unshift(indexEntry);
  writeIndex(rootDir, index);
  upsertSessionVector(rootDir, id, indexEntry);

  return record;
}

/**
 * Update an existing session with distilled data.
 *
 * Accepts structured updates:
 *   summary     — string (clamped to MAX_SUMMARY_LENGTH)
 *   decisions   — array of strings (capped at MAX_DECISIONS)
 *   filesChanged — array of {path, reason} (capped at MAX_FILES)
 *   openQuestions — array of strings (capped at MAX_OPEN_QUESTIONS)
 *   taskSnapshot — array of {id, subject, status}
 *   status      — "active" | "completed" | "closed"
 */
export function updateSession(rootDir, id, updates = {}) {
  const filePath = path.join(sessionsDir(rootDir), `${id}.json`);
  if (!fs.existsSync(filePath)) return null;

  const record = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const now = new Date().toISOString();

  // Apply distilled fields with caps.
  if (updates.summary != null) {
    record.summary = clamp(String(updates.summary), MAX_SUMMARY_LENGTH);
  }
  if (Array.isArray(updates.decisions)) {
    record.decisions = updates.decisions.slice(0, MAX_DECISIONS);
  }
  if (Array.isArray(updates.filesChanged)) {
    record.filesChanged = updates.filesChanged.slice(0, MAX_FILES);
  }
  if (Array.isArray(updates.openQuestions)) {
    record.openQuestions = updates.openQuestions.slice(0, MAX_OPEN_QUESTIONS);
  }
  if (Array.isArray(updates.taskSnapshot)) {
    record.taskSnapshot = updates.taskSnapshot;
  }
  if (updates.status) {
    record.status = updates.status;
  }

  record.lastActive = now;
  fs.writeFileSync(filePath, JSON.stringify(record, null, 2) + "\n");

  // Update index entry (lightweight fields only).
  const index = readIndex(rootDir);
  const entry = index.find((e) => e.id === id);
  if (entry) {
    entry.lastActive = now;
    if (updates.status) entry.status = updates.status;
    if (updates.summary != null) entry.summary = clamp(String(updates.summary), MAX_SUMMARY_LENGTH);
    writeIndex(rootDir, index);
    upsertSessionVector(rootDir, id, entry);
  }

  return record;
}

/**
 * Load a full session record by ID.
 */
export function loadSession(rootDir, id) {
  const filePath = path.join(sessionsDir(rootDir), `${id}.json`);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

/**
 * List sessions from the index.
 * @param {string} rootDir
 * @param {object} opts — filters: status, limit, project.
 */
export function listSessions(rootDir, { status = null, limit = 20, project = null } = {}) {
  let entries = readIndex(rootDir);
  if (status) entries = entries.filter((e) => e.status === status);
  if (project) entries = entries.filter((e) => e.project === project);
  return entries.slice(0, limit);
}

/**
 * Search sessions using a hybrid cosine + BM25 scorer.
 * Falls back to substring matching when no embeddings exist.
 */
export function searchSessions(rootDir, query) {
  if (!query) return [];
  const lower = String(query).toLowerCase();

  const vectors = readVectors(rootDir);
  if (vectors.length === 0) {
    // No vectors yet — plain substring fallback
    return readIndex(rootDir).filter((e) =>
      (e.summary && e.summary.toLowerCase().includes(lower)) ||
      (e.project && e.project.toLowerCase().includes(lower))
    );
  }

  const queryEmbedding = embedText(String(query));
  const cosineScored = vectors
    .map((v) => ({ id: v.id, score: cosineSimilarity(queryEmbedding, v.embedding || []) }))
    .filter(({ score }) => score > 0.05);

  const index = readIndex(rootDir);
  const candidateIds = new Set(cosineScored.map((v) => v.id));
  // Also include substring matches as BM25 candidates
  for (const entry of index) {
    if ((entry.summary && entry.summary.toLowerCase().includes(lower)) ||
        (entry.project && entry.project.toLowerCase().includes(lower))) {
      candidateIds.add(entry.id);
    }
  }

  const candidates = [...candidateIds]
    .map((id) => index.find((e) => e.id === id))
    .filter(Boolean)
    .map((e) => ({ ...e, text: buildSessionSearchText(e) }));

  const bm25Scored = rankByBm25(candidates, query, { limit: 20 });

  const scoreMap = new Map();
  for (const { id, score } of cosineScored) scoreMap.set(id, score);
  for (const item of bm25Scored) {
    const prev = scoreMap.get(item.id) || 0;
    const bm25Max = bm25Scored[0]?.score || 1;
    scoreMap.set(item.id, Math.max(prev, Math.min(item.score / bm25Max, 1)));
  }

  return [...scoreMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => index.find((e) => e.id === id))
    .filter(Boolean);
}

/**
 * Get the most recent active or completed session for a project.
 * Returns the full distilled record for resume context.
 */
export function lastSession(rootDir, project = null) {
  const entries = readIndex(rootDir);
  const match = project
    ? entries.find((e) => e.project === project)
    : entries[0];
  if (!match) return null;
  return loadSession(rootDir, match.id);
}

/**
 * Build a compact resume prompt from a session record.
 * Returns a string suitable for injection into a session-start hook.
 */
export function buildResumeContext(session) {
  if (!session) return "";
  const parts = [];

  if (session.summary) {
    parts.push(`## What was in progress\n${session.summary}`);
  }

  if (session.decisions?.length) {
    parts.push(`## Key decisions\n${session.decisions.map((d) => `- ${d}`).join("\n")}`);
  }

  if (session.filesChanged?.length) {
    const fileList = session.filesChanged
      .slice(0, 15)
      .map((f) => `- \`${f.path}\` — ${f.reason || "modified"}`)
      .join("\n");
    const extra = session.filesChanged.length > 15
      ? `\n- ...and ${session.filesChanged.length - 15} more`
      : "";
    parts.push(`## Files changed\n${fileList}${extra}`);
  }

  if (session.openQuestions?.length) {
    parts.push(`## Open questions\n${session.openQuestions.map((q) => `- ${q}`).join("\n")}`);
  }

  if (session.taskSnapshot?.length) {
    const tasks = session.taskSnapshot
      .map((t) => `- [${t.status}] ${t.subject}`)
      .join("\n");
    parts.push(`## Task state\n${tasks}`);
  }

  return parts.join("\n\n");
}

/**
 * Close all active sessions (called on construct down).
 */
export function closeAllSessions(rootDir) {
  const index = readIndex(rootDir);
  let closed = 0;
  for (const entry of index) {
    if (entry.status === "active") {
      entry.status = "closed";
      entry.lastActive = new Date().toISOString();
      const filePath = path.join(sessionsDir(rootDir), `${entry.id}.json`);
      if (fs.existsSync(filePath)) {
        try {
          const record = JSON.parse(fs.readFileSync(filePath, "utf8"));
          record.status = "closed";
          record.lastActive = entry.lastActive;
          fs.writeFileSync(filePath, JSON.stringify(record, null, 2) + "\n");
        } catch { /* best effort */ }
      }
      closed++;
    }
  }
  if (closed > 0) writeIndex(rootDir, index);
  return closed;
}
