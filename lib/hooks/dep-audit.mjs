#!/usr/bin/env node
/**
 * dep-audit.mjs — PostToolUse / Write|Edit (async)
 *
 * After editing a dependency manifest, runs the appropriate audit tool and
 * appends critical/high vulnerabilities to ~/.cx/warn-flags.txt.
 * Silent when nothing is wrong. Runs async so it never blocks editing.
 *
 * @p95ms 5000
 * @maxBlockingScope none (PostToolUse, async, non-blocking)
 */
import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'fs';
import { execSync } from 'child_process';
import { homedir } from 'os';
import { join, dirname, basename } from 'path';

const filePath = process.env.TOOL_INPUT_FILE_PATH || '';
if (!filePath) process.exit(0);

const file = basename(filePath);
const MANIFESTS = new Set(['package.json', 'Cargo.toml', 'pyproject.toml', 'requirements.txt', 'go.mod', 'go.sum']);
if (!MANIFESTS.has(file)) process.exit(0);

// Skip node_modules, dist, build, .git
if (/node_modules|\/dist\/|\/build\/|\/\.git\//.test(filePath)) process.exit(0);

const projectDir = dirname(filePath);
const warnFlagsPath = join(homedir(), '.cx', 'warn-flags.txt');

function appendWarn(msg) {
  try { appendFileSync(warnFlagsPath, msg + '\n'); } catch { /* best effort */ }
  process.stderr.write(`[dep-audit] ${msg}\n`);
}

// ── npm / yarn / pnpm ─────────────────────────────────────────────────────────
if (file === 'package.json') {
  // Skip if this is a workspace root with no dependencies of its own
  let pkg;
  try { pkg = JSON.parse(readFileSync(filePath, 'utf8')); } catch { process.exit(0); }
  const hasDeps = !!(pkg.dependencies || pkg.devDependencies);
  if (!hasDeps) process.exit(0);

  const runner = existsSync(join(projectDir, 'pnpm-lock.yaml')) ? 'pnpm'
               : existsSync(join(projectDir, 'yarn.lock'))      ? 'yarn'
               : 'npm';

  try {
    // npm/pnpm: --audit-level=high exits non-zero if high/critical found
    // yarn: audit --level high
    const auditCmd = runner === 'yarn'
      ? 'yarn audit --level high --json'
      : `${runner} audit --audit-level=high --json`;

    const output = execSync(auditCmd, {
      cwd: projectDir,
      stdio: 'pipe',
      timeout: 30_000,
      env: { ...process.env },
    }).toString();

    // Parse npm/pnpm JSON output for vuln count
    const lines = output.split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        const vulns = obj?.metadata?.vulnerabilities;
        if (vulns) {
          const critical = vulns.critical || 0;
          const high = vulns.high || 0;
          if (critical > 0 || high > 0) {
            appendWarn(`Dependency vulnerabilities: ${critical} critical, ${high} high — run \`${runner} audit\` to review`);
          }
        }
      } catch { /* non-JSON line */ }
    }
  } catch (e) {
    // Non-zero exit = vulnerabilities found (for npm/pnpm without --json)
    const stderr = (e.stderr?.toString() || '').trim();
    const stdout = (e.stdout?.toString() || '').trim();
    // Extract vuln summary line
    const summary = (stdout + '\n' + stderr)
      .split('\n')
      .find(l => /vulnerabilit/i.test(l) || /critical|high/i.test(l));
    if (summary) {
      appendWarn(`Dependency vulnerabilities found — ${summary.trim()}`);
    }
  }
  process.exit(0);
}

// ── Rust / Cargo ──────────────────────────────────────────────────────────────
if (file === 'Cargo.toml') {
  try {
    execSync('cargo audit --version', { stdio: 'pipe', timeout: 3000 });
  } catch {
    process.exit(0); // cargo-audit not installed, skip silently
  }

  try {
    execSync('cargo audit --deny warnings', {
      cwd: projectDir,
      stdio: 'pipe',
      timeout: 30_000,
    });
  } catch (e) {
    const output = (e.stdout?.toString() || '') + (e.stderr?.toString() || '');
    const vulnLine = output.split('\n').find(l => /error|warning/i.test(l) && /vuln|advisory/i.test(l));
    appendWarn(`Cargo vulnerabilities found — ${vulnLine?.trim() || 'run `cargo audit` to review'}`);
  }
  process.exit(0);
}

// ── Python ────────────────────────────────────────────────────────────────────
if (file === 'pyproject.toml' || file === 'requirements.txt') {
  try {
    execSync('pip-audit --version', { stdio: 'pipe', timeout: 3000 });
  } catch {
    process.exit(0); // pip-audit not installed
  }

  const target = file === 'requirements.txt'
    ? `pip-audit -r "${filePath}" --format json`
    : `pip-audit --format json`;

  try {
    execSync(target, { cwd: projectDir, stdio: 'pipe', timeout: 30_000 });
  } catch (e) {
    const output = (e.stdout?.toString() || '');
    try {
      const result = JSON.parse(output);
      const count = Array.isArray(result) ? result.length : (result.dependencies?.filter(d => d.vulns?.length)?.length || 0);
      if (count > 0) appendWarn(`Python dependency vulnerabilities: ${count} package${count !== 1 ? 's' : ''} affected — run \`pip-audit\` to review`);
    } catch {
      appendWarn('Python dependency vulnerabilities found — run `pip-audit` to review');
    }
  }
  process.exit(0);
}

// ── Go ────────────────────────────────────────────────────────────────────────
if (file === 'go.mod' || file === 'go.sum') {
  try {
    execSync('govulncheck -version', { stdio: 'pipe', timeout: 3000 });
  } catch {
    process.exit(0); // govulncheck not installed
  }

  try {
    execSync('govulncheck ./...', { cwd: projectDir, stdio: 'pipe', timeout: 30_000 });
  } catch (e) {
    const output = (e.stdout?.toString() || '') + (e.stderr?.toString() || '');
    const vulnLine = output.split('\n').find(l => /Vulnerability|vuln/i.test(l));
    appendWarn(`Go dependency vulnerabilities found — ${vulnLine?.trim() || 'run `govulncheck ./...` to review'}`);
  }
  process.exit(0);
}

process.exit(0);
