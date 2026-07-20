/**
 * lib/certification/protocol-surface-rollup.mjs — packed-artifact protocol surface rollup.
 *
 * After the construct-tsyfe.9 sibling beads certify individual surfaces (MCP,
 * ACP, host adapters, CLI catalog, ECL exports), this module inspects a real
 * npm pack file list and asserts the union: no deprecated CLI aliases in the
 * public help corpus, MCP tool-surface parity holds, required protocol modules
 * ship, and the exports map exposes only the ECL entrypoints (no ./lib/* wildcard).
 *
 * Release-blocking: wired into release:check and pre-release preflight.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildCliCommandCatalog, collectPublicHelpCorpus, findHelpHiddenViolations } from '../cli-compat-catalog.mjs';
import { assertToolSurfacePartition, assertCoreSubsetOfCatalog } from '../mcp/tool-surface-parity.mjs';
import { ALL_TOOL_DEFS, exposedTools } from '../mcp/server.mjs';
import { isMainModule } from '../roots.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..');

export const ROLLUP_SIBLINGS = Object.freeze([
  { id: 'mcp-schema-and-discovery', beads: ['construct-tsyfe.9.1', 'construct-tsyfe.9.2'] },
  { id: 'acp-conformance', beads: ['construct-tsyfe.9.3'] },
  { id: 'host-adapter-certification', beads: ['construct-tsyfe.9.4'] },
  { id: 'cli-public-api-audit', beads: ['construct-tsyfe.9.5'] },
  { id: 'embedded-api-surface-contract', beads: ['construct-tsyfe.9.6'] },
]);

const REQUIRED_PACKED_PATHS = Object.freeze([
  'lib/mcp/server.mjs',
  'lib/mcp/tool-surface-parity.mjs',
  'lib/acp/server.mjs',
  'lib/host-capabilities.mjs',
  'lib/host/readiness.mjs',
  'lib/certification/host-adapter-certification.mjs',
  'lib/embedded-contract/index.mjs',
  'lib/embedded-contract/contract-version.mjs',
  'bin/construct',
]);

/** Repo-relative packed file paths via npm pack --json --dry-run. */
export function packedFileSet({ cwd = REPO_ROOT, execFile = execFileSync } = {}) {
  const out = execFile('npm', ['pack', '--json', '--dry-run'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const parsed = JSON.parse(out);
  const files = parsed[0]?.files ?? [];
  return new Set(files.map((f) => f.path));
}

function loadPackageExports({ rootDir = REPO_ROOT } = {}) {
  const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  return pkg.exports ?? {};
}

function checkEmbeddedExports(exportsMap) {
  const keys = Object.keys(exportsMap);
  if (keys.includes('./lib/*')) {
    return { ok: false, detail: 'exports map still contains ./lib/* wildcard (construct-tsyfe.9.6)' };
  }
  if (exportsMap['.'] !== './lib/embedded-contract/index.mjs') {
    return { ok: false, detail: 'exports "." must resolve to lib/embedded-contract/index.mjs' };
  }
  return { ok: true, detail: 'ECL-only exports map' };
}

function checkMcpToolSurface() {
  const catalog = new Set(ALL_TOOL_DEFS.map((t) => t.name));
  const exposed = exposedTools();
  const flatCore = exposed.filter((t) => t.name !== 'call').map((t) => t.name);
  const callTool = exposed.find((t) => t.name === 'call');
  const enumNames = callTool?.inputSchema?.properties?.tool?.enum ?? [];
  assertCoreSubsetOfCatalog(new Set(flatCore), catalog);
  assertToolSurfacePartition({ catalog, flat: flatCore, enumNames });
  return { ok: true, detail: `${catalog.size} catalog tools; core/long-tail partition holds` };
}

function checkCliPublicSurface({ rootDir = REPO_ROOT, helpCorpus = null } = {}) {
  const corpus = helpCorpus ?? collectPublicHelpCorpus({ rootDir });
  const violations = findHelpHiddenViolations(corpus);
  if (violations.length) {
    return { ok: false, detail: `retired CLI surfaces in help corpus: ${violations.map((v) => v.id).join(', ')}` };
  }
  const catalog = buildCliCommandCatalog({ rootDir });
  const removed = catalog.commands.filter((row) => row.name === 'matrix' && row.status === 'current');
  if (removed.length) {
    return { ok: false, detail: 'removed matrix alias still classified current in CLI catalog' };
  }
  return { ok: true, detail: `${catalog.commands.length} CLI rows reconciled; help corpus clean` };
}

function checkRequiredPackedPaths(packedFiles, { injectMissingPath = null } = {}) {
  const missing = REQUIRED_PACKED_PATHS.filter((p) => !packedFiles.has(p));
  if (injectMissingPath) missing.push(injectMissingPath);
  if (missing.length) {
    return { ok: false, detail: `missing from packed artifact: ${missing.join(', ')}` };
  }
  return { ok: true, detail: `${REQUIRED_PACKED_PATHS.length} required protocol modules present` };
}

/**
 * @returns {{ ok: boolean, checks: object[], errors: string[] }}
 */
export function runProtocolSurfaceRollup({
  rootDir = REPO_ROOT,
  packedFiles = null,
  exportsMap = null,
  helpCorpus = null,
  skipPackedPaths = false,
  injectMissingPath = null,
  skipMcpPartition = false,
  injectWildcardExport = false,
} = {}) {
  const files = packedFiles ?? packedFileSet({ cwd: rootDir });
  const exports = exportsMap ?? loadPackageExports({ rootDir });
  if (injectWildcardExport) exports['./lib/*'] = './lib/*';

  const checks = [];
  const errors = [];

  const mcp = skipMcpPartition
    ? { ok: false, detail: 'MCP tool-surface partition check skipped (injected failure)' }
    : checkMcpToolSurface();
  checks.push({ sibling: 'mcp-schema-and-discovery', ...mcp });
  if (!mcp.ok) errors.push(mcp.detail);

  const embedded = checkEmbeddedExports(exports);
  checks.push({ sibling: 'embedded-api-surface-contract', ...embedded });
  if (!embedded.ok) errors.push(embedded.detail);

  const cli = checkCliPublicSurface({ rootDir, helpCorpus });
  checks.push({ sibling: 'cli-public-api-audit', ...cli });
  if (!cli.ok) errors.push(cli.detail);

  if (!skipPackedPaths) {
    const packed = checkRequiredPackedPaths(files, { injectMissingPath });
    checks.push({ sibling: 'acp-conformance+host-adapter-certification', ...packed });
    if (!packed.ok) errors.push(packed.detail);
  }

  return { ok: errors.length === 0, checks, errors, packedFileCount: files.size };
}

export function formatProtocolSurfaceRollup(report) {
  const lines = [`Protocol surface rollup: ${report.ok ? 'PASS' : 'FAIL'}`];
  for (const check of report.checks) {
    lines.push(`  ${check.ok ? '✓' : '✗'} ${check.sibling}: ${check.detail}`);
  }
  if (report.errors.length) {
    lines.push('Failures:');
    for (const err of report.errors) lines.push(`  - ${err}`);
  }
  return `${lines.join('\n')}\n`;
}

if (isMainModule(import.meta.url)) {
  const json = process.argv.includes('--json');
  const report = runProtocolSurfaceRollup();
  if (json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else process.stdout.write(formatProtocolSurfaceRollup(report));
  process.exit(report.ok ? 0 : 1);
}
