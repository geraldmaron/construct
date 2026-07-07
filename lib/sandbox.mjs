/**
 * lib/sandbox.mjs — Lightweight isolated environment for QA validation.
 *
 * Spins up a fresh tmpdir with a minimal `.construct/` so a specialist (or operator)
 * can run end-to-end checks against a candidate change without touching the
 * working repo. Designed to be the cheapest possible alternative to a full
 * Docker container: when Docker is unavailable, an isolated tmpdir is enough
 * for almost every validation Construct needs.
 *
 * Layout created:
 *   <sandbox>/.construct/
 *     context.md             stub
 *     observations/          empty
 *     intake/pending/        empty
 *   <sandbox>/.git/          empty repo init, so git-aware tools work
 *
 * Tear-down is opt-in via `construct sandbox prune` or by hand. Each sandbox
 * lives under `~/.cx/sandboxes/<id>/` so they survive across CLI sessions.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { doctorRoot } from './config/xdg.mjs';
import { configPath } from './config-dir.mjs';

const ROOT = path.join(doctorRoot(), 'sandboxes');

function ensureRoot() {
  fs.mkdirSync(ROOT, { recursive: true });
}

function newSandboxId() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${stamp}-${rand}`;
}

/**
 * Create a new sandbox. Returns its absolute path.
 *
 * @param {object} [opts]
 * @param {string} [opts.profile] - profile id to write into construct.config.json
 * @param {string} [opts.seedContext] - text to drop into .construct/context.md
 * @returns {{ id: string, path: string }}
 */
export function createSandbox({ profile = null, seedContext = null } = {}) {
  ensureRoot();
  const id = newSandboxId();
  const root = path.join(ROOT, id);
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(configPath(root, 'observations'), { recursive: true });
  fs.mkdirSync(configPath(root, 'intake', 'pending'), { recursive: true });

  const ctx = seedContext || `# Sandbox ${id}\n\nIsolated environment for QA validation. Created ${new Date().toISOString()}.\n`;
  fs.writeFileSync(configPath(root, 'context.md'), ctx);

  const cfg = { version: 1, alias: 'Construct', deployment: { mode: 'solo' } };
  if (profile) cfg.scope = profile;
  fs.writeFileSync(path.join(root, 'construct.config.json'), JSON.stringify(cfg, null, 2) + '\n');

  spawnSync('git', ['init', '--quiet'], { cwd: root, stdio: 'ignore' });

  return { id, path: root };
}

/**
 * List existing sandboxes, newest first.
 */
export function listSandboxes() {
  if (!fs.existsSync(ROOT)) return [];
  const entries = fs.readdirSync(ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const full = path.join(ROOT, d.name);
      const stat = fs.statSync(full);
      return { id: d.name, path: full, createdAt: stat.birthtime.toISOString() };
    });
  return entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Delete a sandbox by id. Returns true if removed, false if not found.
 */
export function deleteSandbox(id) {
  const full = path.join(ROOT, id);
  if (!fs.existsSync(full)) return false;
  fs.rmSync(full, { recursive: true, force: true });
  return true;
}

/**
 * Prune sandboxes older than N days. Returns the count removed.
 */
export function pruneSandboxes({ olderThanDays = 7 } = {}) {
  const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
  let removed = 0;
  for (const s of listSandboxes()) {
    if (Date.parse(s.createdAt) < cutoff) {
      if (deleteSandbox(s.id)) removed++;
    }
  }
  return removed;
}
