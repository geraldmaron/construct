/**
 * lib/reconcile/adapter-prune.mjs — report and remove adapter directories for
 * hosts not installed on this machine (ADR-0027 §1).
 *
 * `construct sync` writes adapter sets for the hosts it detects. A project
 * synced where more hosts were installed, then opened on a leaner machine,
 * carries adapter dirs for hosts absent from the current machine. Each adapter
 * dir is sync-regenerated machine-specific state, so pruning the dirs for
 * undetected hosts is safe — a later sync recreates whatever the current
 * machine actually has.
 *
 * `.claude` stays untouched: it is the baseline set that VS Code reads
 * natively, so its presence carries no implication about Claude Code. `.github`
 * (Copilot prompts / instructions) is out of scope entirely.
 *
 * Safety: `ask`. Deleting generated directories runs only on explicit consent
 * (`construct sync --reconcile=adapter-prune`), and the auto runner skips ask
 * tasks. detect() reads only; apply() is idempotent because a removed dir drops
 * out of the present set.
 */

import fs from 'node:fs';
import path from 'node:path';

import { ADAPTER_DIRS } from '../host-disposition.mjs';
import { detectHostCapabilities } from '../host-capabilities.mjs';

const HOST_TO_DIR = {
  'Claude Code': '.claude',
  OpenCode: '.opencode',
  Codex: '.codex',
  'VS Code': '.vscode',
  Cursor: '.cursor',
};

const PROTECTED_DIRS = new Set(['.claude']);

function isConstructProject(dir) {
  return fs.existsSync(path.join(dir, '.cx')) || fs.existsSync(path.join(dir, '.construct'));
}

function detectedDirSet() {
  const dirs = new Set();
  for (const host of detectHostCapabilities()) {
    if (host.availability !== 'installed') continue;
    const dir = HOST_TO_DIR[host.host];
    if (dir) dirs.add(dir);
  }
  return dirs;
}

// A candidate is a present adapter dir whose host is not installed, excluding
// the protected baseline `.claude` that VS Code consumes natively.

function prunableDirs(projectDir) {
  const detected = detectedDirSet();
  const out = [];
  for (const dir of ADAPTER_DIRS) {
    if (PROTECTED_DIRS.has(dir)) continue;
    if (detected.has(dir)) continue;
    if (fs.existsSync(path.join(projectDir, dir))) out.push(dir);
  }
  return out;
}

async function detect() {
  const dir = process.cwd();
  if (!isConstructProject(dir)) {
    return { needsRepair: false, summary: 'Not a Construct project directory.' };
  }
  const prunable = prunableDirs(dir);
  if (prunable.length === 0) {
    return { needsRepair: false, summary: 'No adapter directories for uninstalled hosts.' };
  }
  return {
    needsRepair: true,
    summary: `${prunable.length} adapter director${prunable.length === 1 ? 'y' : 'ies'} for uninstalled hosts: ${prunable.join(', ')}.`,
    details: { prunable },
  };
}

async function apply() {
  const dir = process.cwd();
  const prunable = prunableDirs(dir);
  const removed = [];
  for (const adapter of prunable) {
    const full = path.join(dir, adapter);
    try {
      fs.rmSync(full, { recursive: true, force: true });
      removed.push(adapter);
    } catch {
      continue;
    }
  }
  if (removed.length === 0) return { summary: 'Nothing to prune.' };
  return { summary: `Removed ${removed.length} adapter director${removed.length === 1 ? 'y' : 'ies'} for uninstalled hosts: ${removed.join(', ')}.` };
}

export default {
  id: 'adapter-prune',
  description: 'Remove adapter directories for hosts not installed on this machine (never .claude or .github).',
  safety: 'ask',
  detect,
  apply,
};
