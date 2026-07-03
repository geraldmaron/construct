/**
 * lib/intake/git-queue.mjs — Git-backed adapter for the IntakeQueue interface.
 *
 * Backs team/enterprise modes with the filesystem and Git for state
 * synchronization and conflict resolution, with no central database server.
 *
 * Correctness envelope: single-writer-preferred, eventual consistency.
 * Concurrent claims from multiple agents may result in duplicate claim
 * attempts; the dolt commit history provides reconciliation. Push failures
 * are logged but do not abort the claim — callers should treat claims as
 * advisory until the push is confirmed in the dolt remote.
 *
 * Structure:
 * .cx/team-inbox/
 *   pending/    - JSON files for unclaimed tasks
 *   claimed/    - Subdirectories per worker containing claimed task files
 *   processed/  - Completed tasks
 *   skipped/    - Skipped tasks
 *   quarantine/ - Tasks needing human review
 */

import path from 'node:path';
import fs from 'fs';
import { execSync } from 'node:child_process';
import { shouldQuarantine } from './quarantine.mjs';

function slugify(value) {
  return String(value || 'untitled')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'untitled';
}

let counter = 0;
function timestamp() {
  counter = (counter + 1) % 1000;
  const c = String(counter).padStart(3, '0');
  return `${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 23)}-${c}`;
}

export class GitIntakeQueue {
  constructor({ project, rootDir = process.cwd(), _exec } = {}) {
    this.project = project;
    this.inboxRoot = path.join(rootDir, '.cx', 'team-inbox');
    // Allow tests to inject a fake exec without monkey-patching the module.
    this._exec = _exec || execSync;
    this._ensureDirs();
  }

  _ensureDirs() {
    ['pending', 'claimed', 'processed', 'skipped', 'quarantine'].forEach(dir => {
      fs.mkdirSync(path.join(this.inboxRoot, dir), { recursive: true });
    });
  }

  _gitAddAndCommit(filePath, message) {
    try {
      this._exec(`git add "${filePath}"`, { stdio: 'ignore' });
      this._exec(`git commit -m "${message}"`, { stdio: 'ignore' });
    } catch (err) {
      // It's okay if commit fails because of no changes
    }
  }

  async enqueue(entry) {
    const ts = timestamp();
    const slug = slugify(path.basename(entry.intake.sourcePath, path.extname(entry.intake.sourcePath)));
    const id = `${ts}-${slug}`;
    const triage = entry.triage || {};

    const quarantineDecision = shouldQuarantine(triage);
    const subDir = quarantineDecision.quarantine ? 'quarantine' : 'pending';
    const filePath = path.join(this.inboxRoot, subDir, `${id}.json`);

    const data = {
      id,
      project: this.project,
      status: subDir === 'quarantine' ? 'quarantined' : 'pending',
      createdAt: new Date().toISOString(),
      ...entry
    };

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    this._gitAddAndCommit(filePath, `Enqueue task ${id}`);

    return { id, route: subDir === 'quarantine' ? 'quarantine' : 'pending', reason: quarantineDecision.reason };
  }

  async listPending({ limit = 100 } = {}) {
    const pendingDir = path.join(this.inboxRoot, 'pending');
    return fs.readdirSync(pendingDir)
      .filter(f => f.endsWith('.json'))
      .slice(0, limit)
      .map(f => JSON.parse(fs.readFileSync(path.join(pendingDir, f), 'utf8')));
  }

  async count() {
    const pendingDir = path.join(this.inboxRoot, 'pending');
    return fs.readdirSync(pendingDir).filter(f => f.endsWith('.json')).length;
  }

  async read(id) {
    for (const dir of ['pending', 'processed', 'skipped', 'quarantine']) {
      const searchPath = path.join(this.inboxRoot, dir, `${id}.json`);
      if (fs.existsSync(searchPath)) {
        return JSON.parse(fs.readFileSync(searchPath, 'utf8'));
      }
    }

    // 'claimed' uses per-worker subdirectories — search recursively.
    const claimedBase = path.join(this.inboxRoot, 'claimed');
    if (fs.existsSync(claimedBase)) {
      for (const worker of fs.readdirSync(claimedBase)) {
        const candidate = path.join(claimedBase, worker, `${id}.json`);
        if (fs.existsSync(candidate)) {
          return JSON.parse(fs.readFileSync(candidate, 'utf8'));
        }
      }
    }

    return null;
  }

  async claim({ claimedBy }) {
    if (!claimedBy) throw new Error('claim: claimedBy is required');
    
    // Pull latest to minimize conflicts
    try {
      this._exec('git pull --rebase', { stdio: 'ignore' });
    } catch (pullErr) {
      // Pull failure is non-fatal — we proceed with local state.
      // Log a reconciliation record so operators can detect divergence.
      console.warn(`[git-queue] pull failed before claim (proceeding with local state): ${pullErr.message}`);
    }

    const pendingDir = path.join(this.inboxRoot, 'pending');
    const files = fs.readdirSync(pendingDir).filter(f => f.endsWith('.json')).sort();
    
    if (files.length === 0) return null;

    const fileName = files[0];
    const pendingPath = path.join(pendingDir, fileName);
    const workerDir = path.join(this.inboxRoot, 'claimed', claimedBy);
    fs.mkdirSync(workerDir, { recursive: true });
    const claimedPath = path.join(workerDir, fileName);

    // Atomic move on filesystem
    fs.renameSync(pendingPath, claimedPath);

    // Update metadata
    const data = JSON.parse(fs.readFileSync(claimedPath, 'utf8'));
    data.status = 'claimed';
    data.claimedBy = claimedBy;
    data.claimedAt = new Date().toISOString();
    fs.writeFileSync(claimedPath, JSON.stringify(data, null, 2));

    // Commit and push the claim so peers see it.
    // Push failure is best-effort — log a warning reconciliation record but do not throw.
    try {
      this._exec(`git add .cx/team-inbox/pending/${fileName} .cx/team-inbox/claimed/${claimedBy}/${fileName}`, { stdio: 'ignore' });
      this._exec(`git commit -m "Claim task ${data.id} by ${claimedBy}"`, { stdio: 'ignore' });
      this._exec('git push', { stdio: 'ignore' });
    } catch (pushErr) {
      // A push failure means another worker may have claimed it first or Git is
      // out of sync.  The local move is left for the next 'git pull --rebase'
      // to reconcile.  We log a warning reconciliation record so this is not
      // silent, but we do NOT abort — callers treat claims as advisory until
      // the push is confirmed in the remote.
      console.warn(`[git-queue] push failed after claim of ${data.id} by ${claimedBy} (claim is local-only until reconciled): ${pushErr.message}`);
    }

    return data;
  }

  async markProcessed(id, { processedBy = 'unknown', notes = '' } = {}) {
    // Locate the file (might be in claimed/<worker>/<id>.json or pending/<id>.json)
    // For simplicity, search all subdirs.
    let foundPath = null;
    let currentDir = null;

    const dirs = ['pending', 'claimed']; // only mark as processed if pending or claimed
    for (const d of dirs) {
      const dirPath = path.join(this.inboxRoot, d);
      if (d === 'claimed') {
        const workers = fs.readdirSync(dirPath);
        for (const w of workers) {
          const p = path.join(dirPath, w, `${id}.json`);
          if (fs.existsSync(p)) { foundPath = p; currentDir = path.join(d, w); break; }
        }
      } else {
        const p = path.join(dirPath, `${id}.json`);
        if (fs.existsSync(p)) { foundPath = p; currentDir = d; break; }
      }
      if (foundPath) break;
    }

    if (!foundPath) throw new Error(`markProcessed: no entry ${id} found`);

    const data = JSON.parse(fs.readFileSync(foundPath, 'utf8'));
    data.status = 'processed';
    data.processedBy = processedBy;
    data.processedAt = new Date().toISOString();
    data.notes = notes;

    const processedPath = path.join(this.inboxRoot, 'processed', `${id}.json`);
    fs.renameSync(foundPath, processedPath);
    fs.writeFileSync(processedPath, JSON.stringify(data, null, 2));

    this._gitAddAndCommit(this.inboxRoot, `Mark task ${id} as processed`);
    try { this._exec('git push', { stdio: 'ignore' }); } catch (e) {}

    return { id };
  }

  /**
   * Mark an issue as skipped in local state WITHOUT a push.
   *
   * Used for graceful degradation when a push fails or when the caller wants
   * to skip without touching the remote.  The skip is advisory — it survives
   * only as a local file move until the next reconciliation pull.
   *
   * @param {string} issueId
   * @returns {{ id: string, skippedAt: string }}
   */
  async markSkipped(issueId) {
    if (!issueId) throw new Error('markSkipped: issueId is required');

    // Locate the file across pending and claimed directories.
    let foundPath = null;

    const pendingCandidate = path.join(this.inboxRoot, 'pending', `${issueId}.json`);
    if (fs.existsSync(pendingCandidate)) {
      foundPath = pendingCandidate;
    } else {
      const claimedBase = path.join(this.inboxRoot, 'claimed');
      if (fs.existsSync(claimedBase)) {
        for (const worker of fs.readdirSync(claimedBase)) {
          const candidate = path.join(claimedBase, worker, `${issueId}.json`);
          if (fs.existsSync(candidate)) { foundPath = candidate; break; }
        }
      }
    }

    if (!foundPath) throw new Error(`markSkipped: no entry ${issueId} found`);

    const data = JSON.parse(fs.readFileSync(foundPath, 'utf8'));
    data.status = 'skipped';
    data.skippedAt = new Date().toISOString();

    const skippedPath = path.join(this.inboxRoot, 'skipped', `${issueId}.json`);
    fs.renameSync(foundPath, skippedPath);
    fs.writeFileSync(skippedPath, JSON.stringify(data, null, 2));

    // No push — this is a local-only operation (graceful degradation).
    return { id: issueId, skippedAt: data.skippedAt };
  }

  // reopen would follow similar logic...
}
