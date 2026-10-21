/** Deterministic validation of external delivery evidence; no model or private corpus is invoked. */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, lstatSync } from 'node:fs';
import { join } from 'node:path';

export const DELIVERY_CHECKS = ['lint', 'typecheck', 'test', 'smoke', 'conformance', 'cleanCheckout'];
export const DELIVERY_SCENARIOS = ['ordinary', 'local-task', 'managed', 'recovery', 'assurance'];
export const DELIVERY_HOSTS = ['claude-code', 'codex'];
export const digestBytes = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** Source identity includes product, verifier and installation bytes, excluding local evidence and handoff prose. */
export function sourceDigest(root) {
  const files = [];
  function walk(name) {
    if (name === 'docs/internal') return;
    const path = join(root, name),
      stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw Error(`source identity refuses symlink ${name}`);
    if (stat.isDirectory()) for (const child of readdirSync(path).sort()) walk(`${name}/${child}`);
    else if (stat.isFile()) files.push([name, digestBytes(readFileSync(path))]);
  }
  for (const dir of ['bin', 'src', 'skills', 'workflows', 'registry', 'scripts', 'tests', 'docs', '.github']) walk(dir);
  for (const name of [
    'package.json',
    'package-lock.json',
    'README.md',
    'AGENTS.md',
    'STRATEGY.md',
    'CONTRIBUTING.md',
    'CHANGELOG.md',
    'LICENSE',
    'biome.json',
    '.gitignore',
    '.mcp.json',
    '.claude/settings.json',
    '.codex/config.toml',
    'tsconfig.json',
    'tsconfig.build.json',
  ])
    walk(name);
  return digestBytes(JSON.stringify(files.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))));
}
const hex = (s) => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s);
const text = (s) => typeof s === 'string' && s.trim().length > 0;
export function checkDelivery({ manifest, version, source, surface, tarballSha256, read }) {
  const problems = [];
  const fail = (s) => problems.push(s);
  const identity = (r) =>
    r?.version === version && r?.sourceDigest === source && r?.surfaceDigest === surface && r?.tarballSha256 === tarballSha256;
  if (
    manifest?.format !== 'construct-delivery-v1' ||
    manifest.tier !== 'delivery' ||
    !identity(manifest) ||
    manifest.broadQualification !== false ||
    !hex(source) ||
    !hex(surface) ||
    !hex(tarballSha256) ||
    !/^\d+\.\d+\.\d+-alpha\.\d+$/.test(version)
  )
    fail('delivery manifest identity, alpha version or bounded assurance mismatch');
  if (!text(manifest?.limitations) || manifest.limitations.length < 80)
    fail('delivery needs substantive assurance and unmeasured-host limits');
  function evidence(entry, label) {
    try {
      if (!entry || !hex(entry.sha256)) throw Error('missing evidence hash');
      const bytes = read(entry.path);
      if (digestBytes(bytes) !== entry.sha256) throw Error('evidence hash mismatch');
      if (!bytes.length) throw Error('empty evidence');
      return bytes;
    } catch (e) {
      fail(`${label}: ${e.message}`);
      return null;
    }
  }
  const commands = {
    lint: 'npm run lint',
    typecheck: 'npm run typecheck',
    test: 'npm test',
    conformance: 'npm run conformance',
    cleanCheckout: 'npm ci',
  };
  for (const name of DELIVERY_CHECKS) {
    const check = manifest?.checks?.[name];
    if (check?.result !== 'pass' || !text(check.command) || !text(check.observed)) fail(`${name}: missing passing observed command`);
    if (name === 'smoke' ? !check?.command?.startsWith('npm run smoke -- --tarball ') : check?.command !== commands[name])
      fail(`${name}: unexpected verification command`);
    evidence(check?.evidence, name);
  }
  const entries = manifest?.hosts;
  if (
    !Array.isArray(entries) ||
    entries.length !== DELIVERY_HOSTS.length ||
    new Set(entries.map((h) => h?.host)).size !== DELIVERY_HOSTS.length
  )
    fail('exactly one receipt for Claude Code and one for Codex is required');
  const sessions = new Set();
  for (const host of DELIVERY_HOSTS) {
    const entry = Array.isArray(entries) ? entries.find((h) => h?.host === host) : null;
    const bytes = evidence(entry, host);
    if (!bytes) continue;
    let r;
    try {
      r = JSON.parse(bytes);
    } catch {
      fail(`${host}: receipt is not JSON`);
      continue;
    }
    if (!r || typeof r !== 'object' || Array.isArray(r)) {
      fail(`${host}: receipt must be an object`);
      continue;
    }
    if (
      r.format !== 'construct-delivery-host-v1' ||
      r.host !== host ||
      !identity(r) ||
      r.status !== 'passed' ||
      r.broadQualification !== false ||
      r.attestation !== 'maintainer-observed'
    )
      fail(`${host}: invalid receipt identity or completion`);
    if (!text(r.hostVersion) || !text(r.sessionId) || !text(r.model?.id) || !['reported', 'configured'].includes(r.model?.source))
      fail(`${host}: host, session and model provenance are required`);
    if (sessions.has(r.sessionId)) fail(`${host}: host sessions must be distinct`);
    sessions.add(r.sessionId);
    if (
      !Number.isFinite(Date.parse(r.startedAt)) ||
      !Number.isFinite(Date.parse(r.finishedAt)) ||
      Date.parse(r.finishedAt) < Date.parse(r.startedAt)
    )
      fail(`${host}: invalid observation timestamps`);
    evidence(r.trace, `${host} native trace`);
    if (
      !Array.isArray(r.scenarios) ||
      r.scenarios.length !== DELIVERY_SCENARIOS.length ||
      new Set(r.scenarios.map((s) => s?.id)).size !== DELIVERY_SCENARIOS.length
    )
      fail(`${host}: exactly the five delivery scenarios are required`);
    const scenarios = Array.isArray(r.scenarios) ? r.scenarios : [];
    for (const id of DELIVERY_SCENARIOS) {
      const scenario = scenarios.find((s) => s?.id === id);
      if (scenario?.result !== 'pass' || !text(scenario.observed)) fail(`${host}/${id}: observed pass missing`);
      evidence(scenario?.evidence, `${host}/${id}`);
    }
  }
  return { ok: !problems.length, problems, tier: 'delivery', broadQualification: false };
}
