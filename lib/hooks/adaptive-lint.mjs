#!/usr/bin/env node
/**
 * lib/hooks/adaptive-lint.mjs — PostToolUse auto-formatter and debug-log detector.
 *
 * Runs after Edit/Write. Attempts the best available formatter for the edited file
 * (eslint --fix, prettier, ruff, gofmt, rustfmt). Also flags console.log/debug
 * statements as lint warnings. Non-blocking — exits 0 regardless of outcome.
 *
 * @p95ms 800
 * @maxBlockingScope none (PostToolUse, non-blocking)
 */
import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { dirname, extname, join } from 'path';

function findUp(startDir, filename) {
  let dir = startDir;
  const root = '/';
  while (dir !== root) {
    const candidate = join(dir, filename);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function hasDep(pkgPath, dep) {
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    return !!(
      pkg.dependencies?.[dep] ||
      pkg.devDependencies?.[dep] ||
      pkg.peerDependencies?.[dep]
    );
  } catch {
    return false;
  }
}

function run(cmd) {
  try {
    execSync(cmd, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function isOnPath(bin) {
  try {
    execSync(`command -v ${bin}`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

const filePath = process.env.TOOL_INPUT_FILE_PATH;

if (!filePath) process.exit(0);

const ext = extname(filePath).toLowerCase();
const fileDir = dirname(filePath);
const quoted = JSON.stringify(filePath);

let acted = false;

const pkgPath = findUp(fileDir, 'package.json');
if (pkgPath) {
  if (hasDep(pkgPath, 'eslint') || hasDep(pkgPath, '@eslint/js')) {
    const ok = run(`npx eslint --fix ${quoted} 2>/dev/null`);
    if (!ok) process.stderr.write(`[adaptive-lint] eslint not available or failed on ${filePath}\n`);
    acted = true;
  }

  if (!acted && hasDep(pkgPath, 'prettier')) {
    const ok = run(`npx prettier --write ${quoted} 2>/dev/null`);
    if (!ok) process.stderr.write(`[adaptive-lint] prettier not available or failed on ${filePath}\n`);
    acted = true;
  }
}

if (!acted) {
  const hasPyproject = !!findUp(fileDir, 'pyproject.toml');
  const hasSetupPy = !!findUp(fileDir, 'setup.py');
  if (hasPyproject || hasSetupPy) {
    if (isOnPath('ruff')) {
      const ok = run(`ruff check --fix ${quoted} 2>/dev/null`);
      if (!ok) process.stderr.write(`[adaptive-lint] ruff failed on ${filePath}\n`);
    } else {
      process.stderr.write(`[adaptive-lint] ruff not on PATH — skipping Python lint for ${filePath}\n`);
    }
    acted = true;
  }
}

if (!acted && ext === '.go') {
  if (isOnPath('gofmt')) {
    const ok = run(`gofmt -w ${quoted}`);
    if (!ok) process.stderr.write(`[adaptive-lint] gofmt failed on ${filePath}\n`);
  } else {
    process.stderr.write(`[adaptive-lint] gofmt not on PATH — skipping Go format for ${filePath}\n`);
  }
}

if (!acted && ext === '.rs') {
  if (isOnPath('rustfmt')) {
    const ok = run(`rustfmt ${quoted}`);
    if (!ok) process.stderr.write(`[adaptive-lint] rustfmt failed on ${filePath}\n`);
  } else {
    process.stderr.write(`[adaptive-lint] rustfmt not on PATH — skipping Rust format for ${filePath}\n`);
  }
}

// Flag debug logging left in source — non-blocking, informational only.
if (['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx'].includes(ext)) {
  try {
    const src = readFileSync(filePath, 'utf8');
    const lines = src.split('\n');
    const hits = lines
      .map((line, i) => ({ line: line.trimStart(), n: i + 1 }))
      .filter(({ line }) =>
        /\bconsole\.(log|debug)\s*\(/.test(line) && !line.startsWith('//')
      );
    if (hits.length > 0) {
      const locs = hits.map(({ n }) => `  line ${n}`).join('\n');
      process.stderr.write(
        `[adaptive-lint] console.log/debug in ${filePath}:\n${locs}\n`
      );
    }
  } catch { /* unreadable — skip */ }
}

process.exit(0);
