/**
 * providers/git/index.mjs — git repo provider.
 *
 * Transport: git CLI (via child_process). No external deps.
 *
 * Capabilities: read, search
 *
 * read refs:
 *   "commits"              → recent commits (default 20)
 *   "commits:<n>"          → last n commits
 *   "branches"             → all branch names
 *   "file:<path>"          → file contents at HEAD
 *   "status"               → working tree status
 *   "log:<path>"           → commit log for a specific path
 *
 * search: grep across tracked files (git grep)
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { AuthError, NotFoundError } from '../lib/errors.mjs';

function git(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.error) throw new Error(`git spawn error: ${result.error.message}`);
  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '', status: result.status };
}

export default {
  name: 'git',
  capabilities: ['read', 'search'],

  _cwd: null,

  async init(config = {}) {
    const cwd = config.cwd ?? process.cwd();
    // Verify this is actually a git repo
    const check = git(['rev-parse', '--git-dir'], cwd);
    if (check.status !== 0) {
      throw new AuthError(`Not a git repository: ${cwd}`, { provider: 'git' });
    }
    this._cwd = cwd;
  },

  async read(ref, _opts = {}) {
    const cwd = this._cwd ?? process.cwd();

    if (ref === 'branches') {
      const r = git(['branch', '-a', '--format=%(refname:short)'], cwd);
      return r.stdout.trim().split('\n').filter(Boolean).map((name) => ({ type: 'branch', name }));
    }

    if (ref === 'status') {
      const r = git(['status', '--porcelain=v1'], cwd);
      return r.stdout.trim().split('\n').filter(Boolean).map((line) => ({
        type: 'status-entry',
        code: line.slice(0, 2).trim(),
        path: line.slice(3),
      }));
    }

    if (ref.startsWith('commits') || ref === 'commits') {
      const n = ref.includes(':') ? parseInt(ref.split(':')[1], 10) : 20;
      const r = git(['log', `--max-count=${n}`, '--pretty=format:%H\t%an\t%ae\t%ai\t%s'], cwd);
      return r.stdout.trim().split('\n').filter(Boolean).map((line) => {
        const [hash, author, email, date, ...subjectParts] = line.split('\t');
        return { type: 'commit', hash, author, email, date, subject: subjectParts.join('\t') };
      });
    }

    if (ref.startsWith('file:')) {
      const filePath = ref.slice(5);
      const r = git(['show', `HEAD:${filePath}`], cwd);
      if (r.status !== 0) {
        throw new NotFoundError(`File not found in HEAD: ${filePath}`, { provider: 'git' });
      }
      return [{ type: 'file', path: filePath, content: r.stdout }];
    }

    if (ref.startsWith('log:')) {
      const filePath = ref.slice(4);
      const r = git(['log', '--follow', '--pretty=format:%H\t%an\t%ai\t%s', '--', filePath], cwd);
      return r.stdout.trim().split('\n').filter(Boolean).map((line) => {
        const [hash, author, date, ...subjectParts] = line.split('\t');
        return { type: 'commit', hash, author, date, subject: subjectParts.join('\t'), path: filePath };
      });
    }

    throw new NotFoundError(`Unknown git read ref: "${ref}"`, { provider: 'git' });
  },

  async search(query, opts = {}) {
    const cwd = this._cwd ?? process.cwd();
    const args = ['grep', '--line-number', '-I'];
    if (opts.ignoreCase) args.push('-i');
    args.push(query);
    if (opts.paths) args.push('--', ...opts.paths);
    const r = git(args, cwd);
    if (r.status === 1 && r.stdout === '') return []; // no matches
    if (r.status !== 0 && r.status !== 1) {
      throw new Error(`git grep failed: ${r.stderr}`);
    }
    return r.stdout.trim().split('\n').filter(Boolean).map((line) => {
      const colonIdx = line.indexOf(':');
      const rest = line.slice(colonIdx + 1);
      const lineNumIdx = rest.indexOf(':');
      return {
        type: 'grep-match',
        file: line.slice(0, colonIdx),
        lineNumber: parseInt(rest.slice(0, lineNumIdx), 10),
        text: rest.slice(lineNumIdx + 1),
      };
    });
  },
};
