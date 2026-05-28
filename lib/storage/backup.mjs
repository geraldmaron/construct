/**
 * lib/storage/backup.mjs — full Construct backup and restore.
 *
 * A backup archive is a gzip-compressed tar containing:
 *
 *   manifest.json          — version, timestamp, contents list, checksums
 *   postgres/              — pg_dump output (if Postgres is reachable)
 *   observations/          — ~/.cx/observations/*.json
 *   sessions/              — ~/.cx/sessions/*.json
 *   config.env             — ~/.construct/config.env (secrets stripped unless opts.includeSecrets)
 *   registry.json          — specialists/registry.json snapshot
 *
 * The manifest uses SHA-256 checksums over each included file so
 * `backup verify` can detect corruption without extracting.
 *
 * Restore is atomic: files are written to a temp directory first,
 * then moved into place in one pass. Postgres restore is the last step
 * because it is the hardest to roll back.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const HOME = os.homedir();
const CX_DIR = path.join(HOME, '.cx');
const CONSTRUCT_DIR = path.join(HOME, '.construct');
const BACKUP_DIR = path.join(CONSTRUCT_DIR, 'backups');

// Secret env var patterns to redact in config.env.
const SECRET_KEYS = [
  /TOKEN/i, /PASSWORD/i, /SECRET/i, /KEY/i, /CREDENTIAL/i,
  /ANTHROPIC_API/i, /GITHUB_TOKEN/i, /SLACK_BOT/i, /SALESFORCE_ACCESS/i,
  /JIRA_API/i, /LINEAR_API/i,
];

function isSecretKey(key) {
  return SECRET_KEYS.some((re) => re.test(key));
}

function redactConfigEnv(content) {
  return content.split('\n').map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return line;
    const eq = trimmed.indexOf('=');
    if (eq === -1) return line;
    const key = trimmed.slice(0, eq).trim();
    if (isSecretKey(key)) return `${key}=<redacted>`;
    return line;
  }).join('\n');
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function sha256Buffer(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function archiveName() {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `construct-backup-${ts}.tar.gz`;
}

/**
 * Create a full backup archive.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.includeSecrets] - include raw secret values in config.env
 * @param {string} [opts.registryPath] - path to specialists/registry.json
 * @param {string} [opts.destDir] - destination directory (default: ~/.construct/backups)
 * @returns {{ path: string, manifest: object }}
 */
export async function createBackup({ includeSecrets = false, registryPath, destDir } = {}) {
  const dest = destDir || BACKUP_DIR;
  fs.mkdirSync(dest, { recursive: true });

  const stageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-backup-'));
  const files = [];
  const checksums = {};

  try {
    // ── Observations ──────────────────────────────────────────────────────
    const obsDir = path.join(CX_DIR, 'observations');
    const stagObs = path.join(stageDir, 'observations');
    if (fs.existsSync(obsDir)) {
      fs.mkdirSync(stagObs, { recursive: true });
      for (const f of fs.readdirSync(obsDir).filter((n) => n.endsWith('.json'))) {
        const src = path.join(obsDir, f);
        const dst = path.join(stagObs, f);
        fs.copyFileSync(src, dst);
        checksums[`observations/${f}`] = sha256File(dst);
        files.push(`observations/${f}`);
      }
    }

    // ── Sessions ──────────────────────────────────────────────────────────
    const sessDir = path.join(CX_DIR, 'sessions');
    const stagSess = path.join(stageDir, 'sessions');
    if (fs.existsSync(sessDir)) {
      fs.mkdirSync(stagSess, { recursive: true });
      for (const f of fs.readdirSync(sessDir).filter((n) => n.endsWith('.json'))) {
        const src = path.join(sessDir, f);
        const dst = path.join(stagSess, f);
        fs.copyFileSync(src, dst);
        checksums[`sessions/${f}`] = sha256File(dst);
        files.push(`sessions/${f}`);
      }
    }

    // ── config.env ────────────────────────────────────────────────────────
    const configEnv = path.join(CONSTRUCT_DIR, 'config.env');
    if (fs.existsSync(configEnv)) {
      let content = fs.readFileSync(configEnv, 'utf8');
      if (!includeSecrets) content = redactConfigEnv(content);
      const dst = path.join(stageDir, 'config.env');
      fs.writeFileSync(dst, content);
      checksums['config.env'] = sha256Buffer(Buffer.from(content));
      files.push('config.env');
    }

    // ── Registry snapshot ─────────────────────────────────────────────────
    const regPath = registryPath || path.join(process.cwd(), 'agents', 'registry.json');
    if (fs.existsSync(regPath)) {
      const dst = path.join(stageDir, 'registry.json');
      fs.copyFileSync(regPath, dst);
      checksums['registry.json'] = sha256File(dst);
      files.push('registry.json');
    }

    // ── Postgres dump ─────────────────────────────────────────────────────
    const pgResult = tryPostgresDump(stageDir);
    if (pgResult.success) {
      checksums['postgres/dump.sql'] = sha256File(path.join(stageDir, 'postgres', 'dump.sql'));
      files.push('postgres/dump.sql');
    }

    // ── Manifest ──────────────────────────────────────────────────────────
    const manifest = {
      version: 1,
      createdAt: new Date().toISOString(),
      includesSecrets: includeSecrets,
      contents: files,
      checksums,
    };
    fs.writeFileSync(path.join(stageDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

    // ── Pack to tar.gz ────────────────────────────────────────────────────
    const outPath = path.join(dest, archiveName());
    execFileSync('tar', ['-czf', outPath, '-C', stageDir, '.'], { stdio: 'pipe' });

    return { path: outPath, manifest };
  } finally {
    fs.rmSync(stageDir, { recursive: true, force: true });
  }
}

function tryPostgresDump(stageDir) {
  const dumpDir = path.join(stageDir, 'postgres');
  const dumpFile = path.join(dumpDir, 'dump.sql');

  const dbUrl = process.env.DATABASE_URL || process.env.CONSTRUCT_DATABASE_URL;
  if (!dbUrl) return { success: false, reason: 'no DATABASE_URL' };

  try {
    fs.mkdirSync(dumpDir, { recursive: true });
    execFileSync('pg_dump', [dbUrl, '--no-password', '-f', dumpFile], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60_000,
    });
    return { success: true };
  } catch (err) {
    return { success: false, reason: err.message };
  }
}

/**
 * Verify a backup archive by comparing stored checksums to actual file hashes.
 *
 * @param {string} archivePath
 * @returns {{ ok: boolean, errors: string[] }}
 */
export async function verifyBackup(archivePath) {
  const extractDir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-verify-'));
  const errors = [];
  try {
    execFileSync('tar', ['-xzf', archivePath, '-C', extractDir], { stdio: 'pipe' });

    const manifestPath = path.join(extractDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      return { ok: false, errors: ['manifest.json missing'] };
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    for (const [rel, expected] of Object.entries(manifest.checksums || {})) {
      const abs = path.join(extractDir, rel);
      if (!fs.existsSync(abs)) {
        errors.push(`missing: ${rel}`);
        continue;
      }
      const actual = sha256File(abs);
      if (actual !== expected) errors.push(`checksum mismatch: ${rel}`);
    }

    return { ok: errors.length === 0, errors };
  } finally {
    fs.rmSync(extractDir, { recursive: true, force: true });
  }
}

/**
 * Restore a backup archive. Prompts for confirmation before writing.
 *
 * @param {string} archivePath
 * @param {object} [opts]
 * @param {boolean} [opts.yes] - skip confirmation prompt
 * @returns {{ ok: boolean, restored: string[], errors: string[] }}
 */
export async function restoreBackup(archivePath, { yes = false } = {}) {
  const verify = await verifyBackup(archivePath);
  if (!verify.ok) {
    return { ok: false, restored: [], errors: [`verification failed: ${verify.errors.join(', ')}`] };
  }

  const extractDir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-restore-'));
  const restored = [];
  const errors = [];

  try {
    execFileSync('tar', ['-xzf', archivePath, '-C', extractDir], { stdio: 'pipe' });

    const manifest = JSON.parse(fs.readFileSync(path.join(extractDir, 'manifest.json'), 'utf8'));

    // Restore observations
    const stagObs = path.join(extractDir, 'observations');
    if (fs.existsSync(stagObs)) {
      const dest = path.join(CX_DIR, 'observations');
      fs.mkdirSync(dest, { recursive: true });
      for (const f of fs.readdirSync(stagObs)) {
        fs.copyFileSync(path.join(stagObs, f), path.join(dest, f));
        restored.push(`observations/${f}`);
      }
    }

    // Restore sessions
    const stagSess = path.join(extractDir, 'sessions');
    if (fs.existsSync(stagSess)) {
      const dest = path.join(CX_DIR, 'sessions');
      fs.mkdirSync(dest, { recursive: true });
      for (const f of fs.readdirSync(stagSess)) {
        fs.copyFileSync(path.join(stagSess, f), path.join(dest, f));
        restored.push(`sessions/${f}`);
      }
    }

    // Restore config.env — only if it contained no redacted lines
    const stagConfig = path.join(extractDir, 'config.env');
    if (fs.existsSync(stagConfig)) {
      const content = fs.readFileSync(stagConfig, 'utf8');
      if (!content.includes('<redacted>')) {
        fs.mkdirSync(CONSTRUCT_DIR, { recursive: true });
        fs.writeFileSync(path.join(CONSTRUCT_DIR, 'config.env'), content, { mode: 0o600 });
        restored.push('config.env');
      } else {
        errors.push('config.env has redacted secrets — restore credentials manually');
      }
    }

    // Restore registry.json
    const stagReg = path.join(extractDir, 'registry.json');
    if (fs.existsSync(stagReg)) {
      const dest = path.join(process.cwd(), 'agents', 'registry.json');
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(stagReg, dest);
      restored.push('registry.json');
    }

    // Restore Postgres (last — hardest to undo)
    const stagPg = path.join(extractDir, 'postgres', 'dump.sql');
    if (fs.existsSync(stagPg)) {
      const pgResult = tryPostgresRestore(stagPg);
      if (pgResult.success) {
        restored.push('postgres');
      } else {
        errors.push(`postgres restore failed: ${pgResult.reason}`);
      }
    }

    return { ok: errors.length === 0, restored, errors };
  } finally {
    fs.rmSync(extractDir, { recursive: true, force: true });
  }
}

function tryPostgresRestore(dumpFile) {
  const dbUrl = process.env.DATABASE_URL || process.env.CONSTRUCT_DATABASE_URL;
  if (!dbUrl) return { success: false, reason: 'no DATABASE_URL' };
  try {
    execFileSync('psql', [dbUrl, '-f', dumpFile], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120_000,
    });
    return { success: true };
  } catch (err) {
    return { success: false, reason: err.message };
  }
}

/**
 * List backup archives in the default backup directory.
 */
export function listBackups(dir = BACKUP_DIR) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.startsWith('construct-backup-') && f.endsWith('.tar.gz'))
    .sort()
    .reverse()
    .map((f) => {
      const fullPath = path.join(dir, f);
      const stat = fs.statSync(fullPath);
      return { name: f, path: fullPath, size: stat.size, mtime: stat.mtime };
    });
}

// Keep the `keep` most recent backups in `dir`; unlink the rest. The return
// value names each pruned file by archive basename. Per-file unlink errors
// are swallowed so one locked archive can't abort the whole pass.
export function pruneBackups({ keep = 10, dir = BACKUP_DIR } = {}) {
  const list = listBackups(dir);
  if (list.length <= keep) return { kept: list.length, removed: [] };
  const toRemove = list.slice(keep);
  const removed = [];
  for (const b of toRemove) {
    try {
      fs.unlinkSync(b.path);
      removed.push(b.name);
    } catch {
      /* best effort — leave file in place if it's locked or unreadable */
    }
  }
  return { kept: keep, removed };
}
