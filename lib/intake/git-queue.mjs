/**
 * lib/intake/git-queue.mjs — Git-backed adapter for the IntakeQueue interface.
 *
 * Backs team/enterprise modes with the filesystem and Git for state
 * synchronization and conflict resolution, with no central database server.
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
  constructor({ project, rootDir = process.cwd() } = {}) {
    this.project = project;
    this.inboxRoot = path.join(rootDir, '.cx', 'team-inbox');
    this._ensureDirs();
  }

  _ensureDirs() {
    ['pending', 'claimed', 'processed', 'skipped', 'quarantine'].forEach(dir => {
      fs.mkdirSync(path.join(this.inboxRoot, dir), { recursive: true });
    });
  }

  _gitAddAndCommit(filePath, message) {
    try {
      execSync(`git add "${filePath}"`, { stdio: 'ignore' });
      execSync(`git commit -m "${message}"`, { stdio: 'ignore' });
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
    for (const dir of ['pending', 'claimed', 'processed', 'skipped', 'quarantine']) {
      // Note: 'claimed' has subdirs, we'd need to search recursively for claimed.
      // For simplicity in this implementation, we assume we know where it is or search pending first.
      const searchPath = dir === 'claimed' 
        ? path.join(this.inboxRoot, dir) // needs recursive search
        : path.join(this.inboxRoot, dir, `${id}.json`);
      
      if (dir !== 'claimed' && fs.existsSync(searchPath)) {
        return JSON.parse(fs.readFileSync(searchPath, 'utf8'));
      }
    }
    return null;
  }

  async claim({ claimedBy }) {
    if (!claimedBy) throw new Error('claim: claimedBy is required');
    
    // Pull latest to minimize conflicts

    try { execSync('git pull --rebase', { stdio: 'ignore' }); } catch (e) {}

    const pendingDir = path.join(this.inboxRoot, 'pending');
    const files = fs.readdirSync(pendingDir).filter(f => f.endsWith('.json')).sort();
    
    if (files.length === 0) return null;

    const fileName = files[0];
    const pendingPath = path.join(pendingDir, fileName);
    const workerDir = path.join(this.inboxRoot, 'claimed', claimedBy);
    fs.mkdirSync(workerDir, { recursive: true });
    const claimedPath = path.join(workerDir, fileName);

    try {
      // Atomic move on filesystem
      fs.renameSync(pendingPath, claimedPath);
      
      // Update metadata
      const data = JSON.parse(fs.readFileSync(claimedPath, 'utf8'));
      data.status = 'claimed';
      data.claimedBy = claimedBy;
      data.claimedAt = new Date().toISOString();
      fs.writeFileSync(claimedPath, JSON.stringify(data, null, 2));

      // Commit and push the claim so peers see it

      execSync(`git add .cx/team-inbox/pending/${fileName} .cx/team-inbox/claimed/${claimedBy}/${fileName}`, { stdio: 'ignore' });
      execSync(`git commit -m "Claim task ${data.id} by ${claimedBy}"`, { stdio: 'ignore' });
      execSync('git push', { stdio: 'ignore' });

      return data;
    } catch (err) {
      // A push failure means another worker claimed it first or Git is out of
      // sync; the local move is left for the next 'git pull --rebase' to reconcile.

      console.error(`Failed to claim ${fileName}: ${err.message}`);
      return null;
    }
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
    try { execSync('git push', { stdio: 'ignore' }); } catch (e) {}

    return { id };
  }

  // markSkipped and reopen would follow similar logic...
}
