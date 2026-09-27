import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync, chmodSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import type { Artifact, Execution, Snapshot } from '../../kernel/delegation/types.ts';
import { normalizeLeasePath, pathsOverlap } from '../../kernel/work/leases.ts';
import { hasKnownSecret } from '../../kernel/render/redact.ts';

const MAX_BYTES = 16 * 1024 * 1024;
const MAX_FILES = 10_000;
const PRIVATE_PATH = /(^|\/)(?:\.git|\.construct|\.agents|\.claude|\.codex|\.cursor|\.mcp\.json|\.env(?:\..*)?|\.npmrc|\.netrc|credentials(?:\..*)?|id_rsa|id_ed25519)(?:\/|$)|\.(?:pem|key|p12|pfx)$/i;

interface FileData { readonly path: string; readonly mode: string; readonly bytes: Buffer }

export function safeEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const clean: NodeJS.ProcessEnv = {};
  for (const key of ['HOME', 'PATH', 'LANG', 'LC_ALL', 'TMPDIR', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME', 'XDG_CACHE_HOME', 'CLAUDE_CONFIG_DIR', 'CODEX_HOME']) {
    if (env[key]) clean[key] = env[key];
  }
  return clean;
}

export class DelegationWorkspace {
  private readonly env: NodeJS.ProcessEnv;
  private readonly artifactsDir: string;
  constructor(artifactsDir: string, env: NodeJS.ProcessEnv) {
    this.artifactsDir = artifactsDir;
    this.env = { ...safeEnvironment(env), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0', GIT_LITERAL_PATHSPECS: '1' };
  }

  private git(root: string, args: readonly string[], input?: Buffer | string, index?: string): Buffer {
    try {
      return execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'diff.external=', ...args], {
        cwd: root, env: { ...this.env, ...(index ? { GIT_INDEX_FILE: index } : {}) }, input, maxBuffer: MAX_BYTES, timeout: 30_000, stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch {
      throw new Error(`git ${args[0]} failed; checkout and artifacts retained`);
    }
  }

  private head(root: string): string { return this.git(root, ['rev-parse', 'HEAD']).toString().trim(); }

  private checkFile(path: string, bytes: Buffer): void {
    normalizeLeasePath(path);
    if (path.startsWith('-') || PRIVATE_PATH.test(path)) throw new Error('private or host-control files cannot enter a worker snapshot');
    if (bytes.length > MAX_BYTES || hasKnownSecret(bytes.toString('utf8'))) throw new Error('oversized or credential-shaped file cannot enter a worker snapshot');
  }

  private treeFiles(root: string, tree: string): FileData[] {
    const entries = this.git(root, ['ls-tree', '-rz', tree]).toString().split('\0').filter(Boolean);
    if (entries.length > MAX_FILES) throw new Error('snapshot file limit exceeded');
    let total = 0;
    const files: FileData[] = [];
    for (const entry of entries) {
      const matched = /^(\d+) blob ([0-9a-f]+)\t(.+)$/.exec(entry);
      if (!matched) throw new Error('submodules and non-file tree entries need an explicit snapshot strategy');
      const [, mode, hash, path] = matched as unknown as [string, string, string, string];
      if (PRIVATE_PATH.test(path)) continue;
      if (!['100644', '100755'].includes(mode)) throw new Error('symlinks are not admitted to worker snapshots');
      const bytes = this.git(root, ['cat-file', 'blob', hash]);
      this.checkFile(path, bytes);
      total += bytes.length;
      if (total > MAX_BYTES) throw new Error('snapshot byte limit exceeded');
      files.push({ path, mode, bytes });
    }
    return files;
  }

  private diskFile(root: string, path: string): FileData | null {
    let current = root;
    for (const part of path.split('/')) {
      current = join(current, part);
      if (!existsSync(current)) return null;
      if (lstatSync(current).isSymbolicLink()) throw new Error('symlinks are not admitted to worker snapshots');
    }
    const stat = lstatSync(current);
    if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error('snapshot contains a non-file or oversized file');
    const bytes = readFileSync(current);
    this.checkFile(path, bytes);
    return { path, bytes, mode: stat.mode & 0o111 ? '100755' : '100644' };
  }

  private targetFiles(execution: Execution): FileData[] {
    const dirty = this.git(execution.target, ['diff', '--no-ext-diff', '--no-textconv', '--name-only', '-z', 'HEAD']).toString().split('\0').filter(Boolean);
    if (dirty.some(path => PRIVATE_PATH.test(path) && execution.assignment.paths.some(allowed => pathsOverlap(allowed, path)))) throw new Error('dirty private files inside the scope cannot be silently omitted');
    const files = this.treeFiles(execution.target, this.head(execution.target));
    const known = new Set(files.map(file => file.path));
    const untracked = this.git(execution.target, ['ls-files', '--others', '--exclude-standard', '-z']).toString().split('\0').filter(Boolean);
    for (const path of untracked) if (execution.assignment.paths.some(allowed => pathsOverlap(allowed, path))) known.add(path);
    for (const path of execution.assignment.paths) {
      if (PRIVATE_PATH.test(path)) throw new Error('private or host-control paths are not delegatable');
      if (!path.endsWith('/') && existsSync(join(execution.target, path)) && !known.has(path)) throw new Error('explicit path is ignored or excluded; snapshot would omit it');
    }
    if (known.size > MAX_FILES) throw new Error('snapshot file limit exceeded');
    return [...known].sort().map(path => this.diskFile(execution.target, path)).filter((file): file is FileData => file !== null);
  }

  fingerprint(execution: Execution): string {
    const digest = createHash('sha256').update(this.head(execution.target));
    const inScope = (path: string) => execution.assignment.paths.some(allowed => pathsOverlap(allowed, path));
    const index = this.git(execution.target, ['ls-files', '--stage', '-z']).toString().split('\0').filter(entry => inScope(entry.split('\t')[1] ?? ''));
    digest.update(index.join('\0'));
    for (const file of this.targetFiles(execution).filter(file => inScope(file.path))) digest.update(file.path).update('\0').update(file.mode).update('\0').update(file.bytes).update('\0');
    return digest.digest('hex');
  }

  private tree(root: string, files: readonly FileData[], index: string): string {
    this.git(root, ['read-tree', '--empty'], undefined, index);
    let total = 0;
    const entries: string[] = [];
    for (const file of files) {
      total += file.bytes.length;
      if (total > MAX_BYTES) throw new Error('snapshot byte limit exceeded');
      const hash = this.git(root, ['hash-object', '-w', '--stdin', '--no-filters'], file.bytes).toString().trim();
      entries.push(`${file.mode} ${hash}\t${file.path}\0`);
    }
    this.git(root, ['update-index', '-z', '--index-info'], entries.join(''), index);
    return this.git(root, ['write-tree'], undefined, index).toString().trim();
  }

  prepare(execution: Execution, subject: Execution | null): Snapshot {
    const container = join(this.artifactsDir, execution.id);
    mkdirSync(container, { recursive: true, mode: 0o700 });
    const directory = join(container, 'checkout');
    const baseRevision = this.head(execution.target);
    const targetFingerprint = this.fingerprint(execution);
    let files: FileData[];
    if (subject) {
      if (subject.snapshot?.targetFingerprint !== targetFingerprint || !subject.artifact) throw new Error('target changed since the subject snapshot; reconcile before review or repair');
      files = this.treeFiles(execution.target, subject.artifact.tree);
    } else {
      const tracked = new Map(this.treeFiles(execution.target, baseRevision).map(file => [file.path, file]));
      const current = new Map(this.targetFiles(execution).map(file => [file.path, file]));
      for (const path of new Set([...tracked.keys(), ...current.keys()])) {
        if (!execution.assignment.paths.some(allowed => pathsOverlap(allowed, path))) continue;
        const file = current.get(path);
        if (file) tracked.set(path, file); else tracked.delete(path);
      }
      files = [...tracked.values()];
    }
    const baselineTree = this.tree(execution.target, files, join(container, 'snapshot-index'));
    this.git(execution.target, ['worktree', 'add', '--detach', '--no-checkout', directory, baseRevision]);
    for (const file of files) {
      const destination = join(directory, file.path);
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, file.bytes, { mode: file.mode === '100755' ? 0o700 : 0o600 });
      chmodSync(destination, file.mode === '100755' ? 0o700 : 0o600);
    }
    this.git(directory, ['read-tree', baselineTree]);
    if (this.fingerprint(execution) !== targetFingerprint) throw new Error('target changed while snapshotting; no worker launched');
    return { directory, baseRevision, baselineTree, targetFingerprint, gitMarker: readFileSync(join(directory, '.git'), 'utf8') };
  }

  collect(execution: Execution): Artifact {
    const snapshot = execution.snapshot;
    if (!snapshot) throw new Error('execution has no snapshot');
    if (lstatSync(snapshot.directory).isSymbolicLink() || lstatSync(join(snapshot.directory, '.git')).isSymbolicLink() || readFileSync(join(snapshot.directory, '.git'), 'utf8') !== snapshot.gitMarker) throw new Error('worker changed its worktree identity');
    const files: FileData[] = [];
    const walk = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = relative(snapshot.directory, join(directory, entry.name)).split('\\').join('/');
        if (path === '.git') continue;
        if (entry.isSymbolicLink()) throw new Error('worker produced a symlink');
        if (PRIVATE_PATH.test(path)) throw new Error('worker wrote private or host-control files');
        if (entry.isDirectory()) walk(join(directory, entry.name));
        else {
          const file = this.diskFile(snapshot.directory, path);
          if (file) files.push(file);
          if (files.length > MAX_FILES) throw new Error('worker artifact file limit exceeded');
        }
      }
    };
    walk(snapshot.directory);
    const tree = this.tree(execution.target, files, join(this.artifactsDir, execution.id, 'result-index'));
    const changed = this.git(execution.target, ['diff-tree', '--no-renames', '--name-only', '-r', '-z', snapshot.baselineTree, tree]).toString().split('\0').filter(Boolean);
    if (changed.some(path => !execution.assignment.paths.some(allowed => pathsOverlap(allowed, path)))) throw new Error('worker made out-of-scope changes; patch is quarantined');
    if (execution.assignment.role === 'review' && changed.length) throw new Error('reviewer changed its fixed snapshot');
    const base = execution.assignment.repairOf ? this.originalBaseline(execution) : snapshot.baselineTree;
    const patch = this.git(execution.target, ['diff', '--no-ext-diff', '--no-textconv', '--binary', '--no-renames', base, tree, '--']).toString();
    if (hasKnownSecret(patch)) throw new Error('patch contains credential-shaped text');
    const path = join(this.artifactsDir, execution.id, 'changes.patch');
    writeFileSync(path, patch, { mode: 0o600 });
    return { tree, patch: path, digest: createHash('sha256').update(patch).digest('hex'), paths: changed };
  }

  private originalBaseline(execution: Execution): string {
    const path = join(this.artifactsDir, execution.id, 'original-baseline');
    if (!existsSync(path)) throw new Error('repair baseline missing');
    return readFileSync(path, 'utf8');
  }

  recordRepairBaseline(execution: Execution, subject: Execution): void {
    const base = subject.assignment.repairOf ? this.originalBaseline(subject) : subject.snapshot!.baselineTree;
    writeFileSync(join(this.artifactsDir, execution.id, 'original-baseline'), base, { mode: 0o600 });
  }

  applyProposal(execution: Execution, patch: string): void {
    const snapshot = execution.snapshot;
    if (!snapshot) throw new Error('execution has no snapshot');
    const before = this.collect({ ...execution, assignment: { ...execution.assignment, role: 'review', repairOf: undefined } });
    if (before.paths.length) throw new Error('worker modified its read-only snapshot');
    if (!patch) return;
    if (patch.length > 512 * 1024 || hasKnownSecret(patch)) throw new Error('unsafe or oversized patch');
    for (const mode of patch.matchAll(/^(?:new file mode|old mode|new mode) (\d+)$/gm)) {
      if (!['100644', '100755'].includes(mode[1]!)) throw new Error('patch may create only regular files');
    }
    const names = this.git(snapshot.directory, ['apply', '--numstat', '-z', '-'], patch).toString().split('\0').filter(Boolean).map(line => line.split('\t').slice(2).join('\t'));
    if (!names.length || names.some(path => !path || PRIVATE_PATH.test(path) || !execution.assignment.paths.some(allowed => pathsOverlap(allowed, normalizeLeasePath(path))))) throw new Error('proposed patch exceeds allowed paths');
    this.git(snapshot.directory, ['apply', '--check', '--binary', '-'], patch);
    this.git(snapshot.directory, ['apply', '--binary', '-'], patch);
  }

  integrate(execution: Execution): void {
    if (!execution.snapshot || !execution.artifact) throw new Error('execution artifacts missing');
    if (this.fingerprint(execution) !== execution.snapshot.targetFingerprint) throw new Error('target changed incompatibly; reconcile instead of overwriting');
    const patch = readFileSync(execution.artifact.patch);
    if (createHash('sha256').update(patch).digest('hex') !== execution.artifact.digest) throw new Error('patch digest changed since review');
    if (!patch.length) return;
    this.git(execution.target, ['apply', '--check', '--binary', '-'], patch);
    this.git(execution.target, ['apply', '--binary', '-'], patch);
  }
}
