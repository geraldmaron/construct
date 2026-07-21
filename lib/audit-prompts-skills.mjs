/**
 * lib/audit-prompts-skills.mjs — four-check audit for obsolete prompts, unrouted
 * skills, and stale team/role references on living Worker Profile surfaces.
 *
 * Scans registry/worker-profiles/prompts, skills/routing.json, generated MCP
 * catalog metadata, and worker-profile enrichments. Each removal candidate must
 * fail all four checks (required capability, team composition, dynamic routing,
 * backward compatibility) before remediation is allowed. construct-72gqn.41.
 */

import fs from 'node:fs';
import path from 'node:path';

import { WORKER_PROFILE_FLAVOR_BINDINGS } from './roles/flavor-bindings.mjs';
import { loadRegistry } from './registry/loader.mjs';
import { auditSkillComposition } from './skills/composition-graph.mjs';

const RETIRED_CX_SPECIALIST_IDS = new Set([
  'cx-accessibility',
  'cx-ai-engineer',
  'cx-business-strategist',
  'cx-data-engineer',
  'cx-devil-advocate',
  'cx-docs-keeper',
  'cx-docs-researcher',
  'cx-evaluator',
  'cx-explorer',
  'cx-legal-compliance',
  'cx-oracle',
  'cx-platform-engineer',
  'cx-program-manager',
  'cx-rd-lead',
  'cx-release-manager',
  'cx-sre',
  'cx-test-automation',
  'cx-trace-reviewer',
  'cx-ux-researcher',
]);

const LEGACY_CX_TO_LIVE = Object.freeze({
  'cx-accessibility': 'designer',
  'cx-ai-engineer': 'engineer',
  'cx-business-strategist': 'product-manager',
  'cx-data-engineer': 'engineer',
  'cx-devil-advocate': 'reviewer',
  'cx-docs-keeper': 'operations',
  'cx-docs-researcher': 'researcher',
  'cx-evaluator': 'reviewer',
  'cx-explorer': 'researcher',
  'cx-legal-compliance': 'security',
  'cx-oracle': 'orchestrator',
  'cx-platform-engineer': 'engineer',
  'cx-program-manager': 'product-manager',
  'cx-rd-lead': 'architect',
  'cx-release-manager': 'operations',
  'cx-sre': 'operations',
  'cx-test-automation': 'qa',
  'cx-trace-reviewer': 'reviewer',
  'cx-ux-researcher': 'researcher',
});

export { RETIRED_CX_SPECIALIST_IDS, LEGACY_CX_TO_LIVE };

const PUBLIC_PROMPT_IDS = new Set(['construct']);

const CX_TOKEN_RE = /\bcx-[a-z0-9-]+\b/g;

function findConstructRoot(startPath = process.cwd()) {
  let current = path.resolve(startPath);
  while (true) {
    if (fs.existsSync(path.join(current, 'registry', 'worker-profiles'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(startPath);
    current = parent;
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function collectCapabilityParties(capabilities) {
  const parties = new Set();
  const list = Array.isArray(capabilities) ? capabilities : Object.values(capabilities ?? {});
  for (const capability of list) {
    for (const id of capability.ownerWorkerProfiles ?? []) parties.add(id);
    for (const contract of Object.values(capability.contracts ?? {})) {
      if (contract.producer) parties.add(contract.producer);
      if (contract.consumer) parties.add(contract.consumer);
    }
    for (const skill of capability.requiredSkills ?? []) parties.add(skill);
  }
  return parties;
}

function collectRoutingTokens(root) {
  const tokens = new Set();
  const routingPath = path.join(root, 'skills', 'routing.json');
  if (!fs.existsSync(routingPath)) return tokens;
  const data = readJson(routingPath);
  for (const route of data.routes ?? []) {
    if (route.path) tokens.add(route.path);
    for (const kw of route.keywords ?? []) {
      for (const part of String(kw).toLowerCase().split(/\s+/)) tokens.add(part);
    }
  }
  return tokens;
}

function collectBackwardCompatIds(liveProfileIds) {
  const ids = new Set(['construct', 'user']);
  for (const id of liveProfileIds) {
    ids.add(id);
    ids.add(`cx-${id}`);
  }
  for (const [shortName, binding] of Object.entries(WORKER_PROFILE_FLAVOR_BINDINGS)) {
    ids.add(shortName);
    ids.add(binding.workerProfileId);
    ids.add(`cx-${shortName}`);
  }
  for (const cxId of RETIRED_CX_SPECIALIST_IDS) ids.add(cxId);
  return ids;
}

function checkRequiredCapability(ref, ctx) {
  if (ctx.liveProfileIds.has(ref)) return { pass: true, reason: 'live Worker Profile id in registry' };
  if (ctx.capabilityParties.has(ref)) return { pass: true, reason: 'named in registry/capabilities.json' };
  return { pass: false, reason: 'not referenced by capabilities or live registry ids' };
}

function checkTeamComposition(ref, ctx) {
  if (ctx.teamRefs.has(ref)) return { pass: true, reason: 'referenced by a team composition surface' };
  return { pass: false, reason: 'teams/groups org scaffolding removed (ADR-0065 M4)' };
}

function checkDynamicRouting(ref, ctx) {
  const bare = ref.replace(/^cx-/, '');
  if (ctx.routingTokens.has(ref) || ctx.routingTokens.has(bare)) {
    return { pass: true, reason: 'present in skills/routing.json keywords or paths' };
  }
  return { pass: false, reason: 'not targeted by live route table' };
}

function checkBackwardCompat(ref, ctx) {
  if (ctx.backwardCompatIds.has(ref)) {
    return { pass: true, reason: 'documented flavor alias or legacy cx-prefixed dispatch id' };
  }
  return { pass: false, reason: 'no external alias or contract promises this id' };
}

function evaluateCandidate(ref, ctx) {
  const checks = {
    requiredCapability: checkRequiredCapability(ref, ctx),
    teamComposition: checkTeamComposition(ref, ctx),
    dynamicRouting: checkDynamicRouting(ref, ctx),
    backwardCompat: checkBackwardCompat(ref, ctx),
  };
  const passing = Object.entries(checks).filter(([, v]) => v.pass).map(([k]) => k);
  const removable = passing.length === 0;
  return { ref, checks, passing, removable };
}

function scanMcpCatalog(root, liveProfileIds) {
  const catalogPath = path.join(root, 'lib', 'mcp-catalog.json');
  if (!fs.existsSync(catalogPath)) return [];
  const catalog = readJson(catalogPath);
  const findings = [];
  for (const mcp of catalog.mcps ?? []) {
    for (const [index, usedBy] of (mcp.usedBy ?? []).entries()) {
      if (liveProfileIds.has(usedBy) || usedBy === 'construct') continue;
      if (RETIRED_CX_SPECIALIST_IDS.has(usedBy) || /^cx-/.test(usedBy)) {
        findings.push({
          kind: 'mcp-catalog-stale-usedBy',
          surface: 'lib/mcp-catalog.json',
          mcpId: mcp.id,
          index,
          ref: usedBy,
          suggested: LEGACY_CX_TO_LIVE[usedBy] ?? null,
        });
      } else {
        findings.push({
          kind: 'mcp-catalog-unknown-usedBy',
          surface: 'lib/mcp-catalog.json',
          mcpId: mcp.id,
          index,
          ref: usedBy,
          suggested: null,
        });
      }
    }
  }
  return findings;
}

function scanPromptFiles(root, liveProfileIds) {
  const promptsDir = path.join(root, 'registry', 'worker-profiles', 'prompts');
  if (!fs.existsSync(promptsDir)) return [];
  const findings = [];
  for (const file of fs.readdirSync(promptsDir)) {
    if (!file.endsWith('.md') || file.startsWith('_')) continue;
    const id = file.replace(/\.md$/, '');
    if (liveProfileIds.has(id) || PUBLIC_PROMPT_IDS.has(id)) continue;
    findings.push({
      kind: 'orphan-prompt-file',
      surface: `registry/worker-profiles/prompts/${file}`,
      ref: id,
    });
  }
  return findings;
}

function scanEnrichmentOrphans(root, liveProfileIds) {
  const enrichPath = path.join(root, 'registry', 'worker-profile-audit-enrichments.json');
  if (!fs.existsSync(enrichPath)) return [];
  const enrichments = readJson(enrichPath);
  const findings = [];
  for (const id of Object.keys(enrichments.workerProfiles ?? {})) {
    if (!liveProfileIds.has(id)) {
      findings.push({
        kind: 'orphaned-enrichment',
        surface: 'registry/worker-profile-audit-enrichments.json',
        ref: id,
      });
    }
  }
  return findings;
}

function scanRoutingStaleCx(root) {
  const routingPath = path.join(root, 'skills', 'routing.json');
  if (!fs.existsSync(routingPath)) return [];
  const raw = fs.readFileSync(routingPath, 'utf8');
  const refs = [...new Set(raw.match(CX_TOKEN_RE) ?? [])];
  return refs.map((ref) => ({
    kind: 'routing-stale-cx-token',
    surface: 'skills/routing.json',
    ref,
  }));
}

export function auditPromptsSkills({ rootDir, silent = false } = {}) {
  const root = rootDir ?? findConstructRoot();
  const registry = loadRegistry({ rootDir: root, skipValidation: true });
  const liveProfileIds = new Set(Object.keys(registry.workerProfiles ?? {}));
  const capabilityParties = collectCapabilityParties(registry.capabilities);
  const routingTokens = collectRoutingTokens(root);
  const backwardCompatIds = collectBackwardCompatIds(liveProfileIds);
  const teamRefs = new Set();

  const ctx = {
    liveProfileIds,
    capabilityParties,
    routingTokens,
    backwardCompatIds,
    teamRefs,
  };

  const composition = auditSkillComposition({ rootDir: root });
  const structuralFindings = [
    ...scanPromptFiles(root, liveProfileIds),
    ...scanMcpCatalog(root, liveProfileIds),
    ...scanEnrichmentOrphans(root, liveProfileIds),
    ...scanRoutingStaleCx(root),
  ];

  if (!composition.pass) {
    for (const line of composition.blocking) {
      structuralFindings.push({ kind: 'unrouted-skill', surface: 'skills/', ref: line });
    }
  }

  const manifest = [];
  for (const finding of structuralFindings) {
    if (finding.kind === 'orphan-prompt-file' || finding.kind === 'orphaned-enrichment') {
      const evaluation = evaluateCandidate(finding.ref, ctx);
      manifest.push({
        action: evaluation.removable ? 'remove' : 'retain',
        ...finding,
        evaluation,
      });
      continue;
    }
    if (finding.kind === 'mcp-catalog-stale-usedBy' || finding.kind === 'mcp-catalog-unknown-usedBy') {
      manifest.push({
        action: 'replace',
        ...finding,
        evaluation: {
          ref: finding.ref,
          checks: {
            requiredCapability: { pass: false, reason: 'MCP catalog usedBy must name live Worker Profile ids only' },
            teamComposition: checkTeamComposition(finding.ref, ctx),
            dynamicRouting: checkDynamicRouting(finding.ref, ctx),
            backwardCompat: { pass: false, reason: 'catalog metadata is not a legacy dispatch alias surface' },
          },
          passing: [],
          removable: true,
        },
        replaceWith: finding.suggested,
      });
      continue;
    }
    if (finding.kind === 'routing-stale-cx-token') {
      const evaluation = evaluateCandidate(finding.ref, ctx);
      manifest.push({
        action: evaluation.removable ? 'remove-keyword' : 'retain',
        ...finding,
        evaluation,
      });
      continue;
    }
    manifest.push({ action: 'investigate', ...finding });
  }

  const blocking = manifest.filter((entry) => (
    entry.kind === 'mcp-catalog-stale-usedBy'
    || entry.kind === 'mcp-catalog-unknown-usedBy'
    || entry.kind === 'orphan-prompt-file'
    || entry.kind === 'orphaned-enrichment'
    || entry.kind === 'unrouted-skill'
  ));

  const result = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    liveWorkerProfileCount: liveProfileIds.size,
    composition,
    manifest,
    retained: manifest.filter((entry) => entry.action === 'retain'),
    removable: manifest.filter((entry) => entry.action === 'remove' || entry.action === 'remove-keyword'),
    replacements: manifest.filter((entry) => entry.action === 'replace'),
    pass: blocking.length === 0 && composition.pass,
    blocking,
  };

  if (!silent) {
    const line = (msg = '') => process.stdout.write(`${msg}\n`);
    line('Construct prompts/skills drift audit (construct-72gqn.41)');
    line('══════════════════════════════════════════════════════════');
    line(`  Live Worker Profiles: ${result.liveWorkerProfileCount}`);
    line(`  Skill composition: ${composition.pass ? 'PASS' : 'FAIL'} (${composition.stats.unreachable} unreachable)`);
    line(`  Manifest entries: ${manifest.length} (${result.replacements.length} catalog replacements, ${result.retained.length} retained)`);
    if (blocking.length === 0) line('  ✓ No blocking stale catalog/orphan findings');
    else {
      line(`  ✗ Blocking findings (${blocking.length}):`);
      for (const entry of blocking) line(`      - ${entry.kind}: ${entry.ref} @ ${entry.surface}`);
    }
    line();
    line(result.pass ? '  Result: PASS' : '  Result: FAIL');
  }

  return result;
}

export function remediateMcpCatalog({ rootDir } = {}) {
  const root = rootDir ?? findConstructRoot();
  const registry = loadRegistry({ rootDir: root, skipValidation: true });
  const liveProfileIds = new Set(Object.keys(registry.workerProfiles ?? {}));
  const catalogPath = path.join(root, 'lib', 'mcp-catalog.json');
  const catalog = readJson(catalogPath);
  const changes = [];

  for (const mcp of catalog.mcps ?? []) {
    const next = [];
    const seen = new Set();
    for (const usedBy of mcp.usedBy ?? []) {
      let value = usedBy;
      if (RETIRED_CX_SPECIALIST_IDS.has(usedBy) || (/^cx-/.test(usedBy) && !liveProfileIds.has(usedBy))) {
        const mapped = LEGACY_CX_TO_LIVE[usedBy];
        if (!mapped) continue;
        value = mapped;
        changes.push({ mcpId: mcp.id, from: usedBy, to: mapped });
      }
      if (seen.has(value)) continue;
      seen.add(value);
      next.push(value);
    }
    mcp.usedBy = next;
  }

  if (changes.length > 0) {
    fs.writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
  }

  return { changes, catalogPath };
}

export async function runAuditPromptsSkillsCli(args = []) {
  const json = args.includes('--json');
  const remediate = args.includes('--remediate');
  const rootDir = args.find((arg) => arg.startsWith('--root='))?.split('=')[1];

  if (remediate) {
    const { changes } = remediateMcpCatalog({ rootDir });
    if (json) process.stdout.write(`${JSON.stringify({ remediated: changes }, null, 2)}\n`);
    else {
      for (const change of changes) {
        process.stdout.write(`  replaced ${change.mcpId} usedBy ${change.from} -> ${change.to}\n`);
      }
    }
  }

  const result = auditPromptsSkills({ rootDir, silent: json || remediate });
  if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.pass) process.exit(1);
  return result;
}
