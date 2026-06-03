#!/usr/bin/env node
/**
 * scripts/pre-release-check.mjs — local preflight for releases.
 *
 * Run this before tagging a release to catch failures that would otherwise
 * surface in CI. All checks that CI runs are replicated here so the tag push
 * is the last step, not a debugging session.
 *
 * Usage:
 *   npm run release:check              — full preflight
 *   npm run release:check -- --skip-auth  — skip npm auth (no token locally)
 *   node scripts/pre-release-check.mjs v1.2.3  — verify specific tag matches package.json
 *
 * Exit code 0 = all checks passed. Non-zero = at least one check failed.
 */

import { execSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const skipAuth = args.includes('--skip-auth');
const targetTag = args.find((a) => a.startsWith('v'));

const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const version = pkg.version;

let passed = 0;
let failed = 0;

function ok(label) {
  console.log(`  ✓  ${label}`);
  passed++;
}

function fail(label, detail) {
  console.error(`  ✗  ${label}`);
  if (detail) console.error(`     ${detail}`);
  failed++;
}

function run(cmd, opts = {}) {
  const result = spawnSync(cmd, { shell: true, cwd: root, ...opts });
  return { ok: result.status === 0, stdout: result.stdout?.toString().trim(), stderr: result.stderr?.toString().trim() };
}

console.log(`\nRelease preflight — @geraldmaron/construct v${version}\n`);

// ── 1. Git working tree ──────────────────────────────────────────────────────
{
  const r = run('git status --porcelain');
  if (r.stdout) {
    fail('Git working tree clean', `Uncommitted changes:\n     ${r.stdout.split('\n').join('\n     ')}`);
  } else {
    ok('Git working tree clean');
  }
}

// ── 2. On main (or tag target branch) ────────────────────────────────────────
{
  const r = run('git rev-parse --abbrev-ref HEAD');
  const branch = r.stdout;
  if (branch === 'main') {
    ok(`On main branch`);
  } else {
    fail(`On main branch`, `Currently on '${branch}' — releases must tag from main`);
  }
}

// ── 3. Tag / version alignment ────────────────────────────────────────────────
if (targetTag) {
  const tagVersion = targetTag.replace(/^v/, '');
  if (tagVersion === version) {
    ok(`Tag ${targetTag} matches package.json version ${version}`);
  } else {
    fail(`Tag version alignment`, `Tag ${targetTag} ≠ package.json ${version} — bump package.json first`);
  }
}

// ── 4. CHANGELOG has entry for this version ──────────────────────────────────
{
  const changelog = readFileSync(resolve(root, 'CHANGELOG.md'), 'utf8');
  if (changelog.includes(`## [${version}]`)) {
    ok(`CHANGELOG has entry for [${version}]`);
  } else {
    fail(`CHANGELOG entry for [${version}]`, `Add ## [${version}] - YYYY-MM-DD section before tagging`);
  }
}

// ── 5. Tests pass ─────────────────────────────────────────────────────────────
{
  console.log(`  ⋯  npm test (this takes a moment)…`);
  const r = run('npm test 2>&1 | tail -6', { stdio: 'pipe' });
  const summary = r.stdout || '';
  const failCount = summary.match(/fail\s+(\d+)/)?.[1];
  if (!r.ok || (failCount && failCount !== '0')) {
    fail('npm test — 0 failed', summary.split('\n').slice(-3).join('\n     '));
  } else {
    ok('npm test — 0 failed');
  }
}

// ── 6. Comment policy ────────────────────────────────────────────────────────
{
  const r = run('node bin/construct lint:comments 2>&1');
  if (r.ok) {
    ok('lint:comments — no violations');
  } else {
    fail('lint:comments', r.stdout.split('\n').slice(0, 5).join('\n     '));
  }
}

// ── 7. Docs verify ───────────────────────────────────────────────────────────
{
  const r = run('node bin/construct docs:verify 2>&1');
  if (r.ok) {
    ok('docs:verify — all regions intact');
  } else {
    fail('docs:verify', r.stdout.split('\n').slice(0, 5).join('\n     '));
  }
}

// ── 8. npm audit ─────────────────────────────────────────────────────────────
{
  const r = run('npm audit --audit-level=high 2>&1');
  if (r.ok) {
    ok('npm audit — no high/critical vulnerabilities');
  } else {
    fail('npm audit', r.stdout.split('\n').slice(0, 5).join('\n     '));
  }
}

// ── 9. consumer-perspective audit ────────────────────────────────────────────
// The audit above applies this repo's `overrides`, which consumers never get.
// Packing the artifact and auditing the resolved tree catches what a downstream
// install would surface.
{
  const r = run('node scripts/audit-published-artifact.mjs 2>&1');
  if (r.ok) {
    ok('consumer audit — packed artifact clean (no overrides relied upon)');
  } else {
    fail('consumer audit', r.stdout.split('\n').slice(-5).join('\n     '));
  }
}

// ── 10. npm pack dry-run ─────────────────────────────────────────────────────
{
  const r = run('npm pack --dry-run 2>&1');
  if (r.ok) {
    const lines = r.stdout.split('\n');
    const size = lines.find((l) => l.includes('package size'));
    const files = lines.find((l) => l.includes('total files'));
    ok(`npm pack --dry-run${size ? ` — ${size.replace(/.*package size:\s*/, '')}` : ''}${files ? `, ${files.replace(/.*total files:\s*/, '')} files` : ''}`);
  } else {
    fail('npm pack --dry-run', r.stdout.split('\n').slice(0, 5).join('\n     '));
  }
}

// ── 11. npm auth ─────────────────────────────────────────────────────────────
// In CI, npm uses OIDC Trusted Publishers (no stored secret). Locally, you
// need to be logged in via `npm login` or have NODE_AUTH_TOKEN set.
// Use --skip-auth if running without npm credentials.
if (skipAuth) {
  console.log(`  -  npm auth check skipped (--skip-auth)`);
} else {
  const r = run('npm whoami 2>&1');
  if (r.ok && r.stdout && !r.stdout.includes('ENEEDAUTH') && !r.stdout.includes('E401')) {
    ok(`npm auth — logged in as ${r.stdout}`);
  } else {
    fail(
      'npm auth — npm whoami failed',
      `Locally: run \`npm login\` or set NODE_AUTH_TOKEN.\n     In CI: Trusted Publishers handles auth automatically (no secret needed).\n     Run with --skip-auth to bypass this check.\n     Error: ${r.stdout || r.stderr}`,
    );
  }
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${passed + failed} checks — ${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  console.error(`Fix the above before running: git tag v${version} && git push origin v${version}\n`);
  process.exit(1);
} else {
  console.log(`All checks passed. Safe to tag:\n\n  git tag v${version} && git push origin v${version}\n`);
}
