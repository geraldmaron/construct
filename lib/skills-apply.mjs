/**
 * lib/skills-apply.mjs — writes per-host skill filter configs from the
 * project profile.
 *
 * The detection layer (lib/project-profile.mjs) is host-agnostic. This layer
 * consumes a profile and writes host-specific configuration that scopes which
 * skills/plugins auto-inject in the current project.
 *
 * Safety guarantees (org-in-a-box):
 *   1. isProtectedSkill() from project-profile.mjs defines a NEVER-FILTER set
 *      covering construct personas, cx-* specialists, cross-cutting skills,
 *      role-domain namespaces (engineering:, product-management:, etc.), and
 *      Claude Code dev infrastructure. These are always kept enabled.
 *   2. The filter is *additive recommendation* — disabled plugins remain on
 *      disk and can be called explicitly. We only remove them from automatic
 *      per-turn injection.
 *   3. A construct-native manifest (.cx/skills-profile.json) records the
 *      decision so construct-mcp can read it at session start and surface
 *      what was filtered.
 *   4. Never overwrite an existing `.claude/settings.json` key the user set
 *      manually — merge into disabledPlugins with de-dup.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import {
  classifySkillRelevance,
  detectProjectProfile,
  enumerateInstalledSkills,
  writeProfile,
} from './project-profile.mjs';

const SUPPORTED_HOSTS = new Set(['claude', 'opencode', 'codex', 'all']);

function readJsonSafe(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

function writeJsonPretty(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function unionArrays(existing, incoming) {
  const seen = new Set();
  const result = [];
  for (const arr of [existing, incoming]) {
    for (const item of arr || []) {
      if (seen.has(item)) continue;
      seen.add(item);
      result.push(item);
    }
  }
  return result.sort();
}

/**
 * Writes the construct-native project manifest to `<cwd>/.cx/skills-profile.json`.
 * This is the authoritative record consumed by construct-mcp and any future
 * per-host writers that want to re-derive the decision.
 */
export function writeConstructManifest(cwd, profile, classification) {
  const path = join(cwd, '.cx', 'skills-profile.json');
  const payload = {
    version: 1,
    generatedAt: new Date().toISOString(),
    profile: {
      tags: profile.tags,
      signals: profile.signals,
    },
    decision: {
      relevant: classification.relevant,
      irrelevant: classification.irrelevant,
      unknown: classification.unknown,
      protected: classification.protected || [],
    },
    // The "recommended disabled" list. Never includes protected skills.
    // Hosts are expected to honor this as a scoping recommendation.
    recommendedDisable: classification.irrelevant,
  };
  writeJsonPretty(path, payload);
  return path;
}

/**
 * Writes `<cwd>/.claude/construct-skills.json` — a construct-owned sidecar
 * that records the recommended per-project scoping for Claude Code.
 *
 * Why a sidecar and not `settings.json`? Claude Code today only reads
 * `permissions`, `hooks`, and `mcpServers` from settings.json. A
 * `disabledPlugins` key would be ignored silently. Writing a sidecar is
 * honest — it documents the recommendation without pretending the harness
 * enforces it. The construct-mcp session-start path can read this sidecar
 * and inject a "skills out of scope for this project" note.
 *
 * If Claude Code adds per-project plugin scoping in the future, the
 * adapter will flip to writing the supported key(s) directly.
 */
export function writeClaudeHostConfig(cwd, classification) {
  const path = join(cwd, '.claude', 'construct-skills.json');
  writeJsonPretty(path, {
    $comment: 'Construct-owned sidecar. Claude Code does not currently honor project-level skill scoping; this is advisory. construct-mcp can read this to surface out-of-scope skills at session start.',
    version: 1,
    generatedAt: new Date().toISOString(),
    source: '.cx/skills-profile.json',
    recommendedDisable: classification.irrelevant,
    protected: classification.protected || [],
  });
  return path;
}

/**
 * Writes per-project OpenCode config hints. OpenCode's per-project config
 * lives in `<cwd>/opencode.json`. We merge disabled agents/skills there.
 */
export function writeOpenCodeHostConfig(cwd, classification) {
  const path = join(cwd, 'opencode.json');
  const existing = readJsonSafe(path) || { $schema: 'https://opencode.ai/config.json' };
  const currentDisabled = existing?.construct?.disabledSkills || [];
  const merged = {
    ...existing,
    construct: {
      ...(existing.construct || {}),
      disabledSkills: unionArrays(currentDisabled, classification.irrelevant),
      lastAppliedAt: new Date().toISOString(),
    },
  };
  writeJsonPretty(path, merged);
  return path;
}

/**
 * Writes per-project Codex config hints. Codex config is TOML; to avoid a TOML
 * dependency we write a sidecar JSON file instead — `.codex/skills-profile.json` —
 * that the Codex adapter can read at session start. Users who want the filter
 * baked into codex config itself can run `construct sync` after this.
 */
export function writeCodexHostConfig(cwd, classification) {
  const path = join(cwd, '.codex', 'skills-profile.json');
  writeJsonPretty(path, {
    version: 1,
    generatedAt: new Date().toISOString(),
    disabledSkills: classification.irrelevant,
  });
  return path;
}

const HOST_WRITERS = {
  claude: writeClaudeHostConfig,
  opencode: writeOpenCodeHostConfig,
  codex: writeCodexHostConfig,
};

function parseArgs(args) {
  const options = { host: null, dryRun: false, cwd: process.cwd(), yes: false };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--dry-run' || arg === '-n') options.dryRun = true;
    else if (arg === '--yes' || arg === '-y') options.yes = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--host') options.host = args[++i];
    else if (arg.startsWith('--host=')) options.host = arg.slice(7);
    else if (arg === '--cwd') options.cwd = args[++i];
    else if (arg.startsWith('--cwd=')) options.cwd = arg.slice(6);
  }
  return options;
}

export async function runSkillsApplyCli(args = []) {
  const options = parseArgs(args);

  if (options.help) {
    console.log(`Usage: construct skills apply --host <name> [options]

Applies a per-project skill filter based on the detected project profile.
Writes host-specific config that scopes which skills auto-inject for this
project, reducing per-turn context bloat without affecting other repos.

Options:
  --host <name>    claude | opencode | codex | all  (required)
  --cwd <path>     Target directory (default: CWD)
  --dry-run, -n    Preview the filter without writing any files
  --yes, -y        Skip confirmation prompt
  -h, --help       Show this message

Safety: skills protected by rules/common/doc-ownership.md and Construct's
cx-* specialist infrastructure are NEVER filtered. The filter is an
auto-injection scope — disabled skills remain callable via get_skill.

The .cx/skills-profile.json manifest records the decision for audit.
`);
    return;
  }

  if (!options.host) {
    console.error('Error: --host <claude|opencode|codex|all> is required.');
    console.error('Run with --help for usage.');
    process.exit(1);
  }
  if (!SUPPORTED_HOSTS.has(options.host)) {
    console.error(`Error: unknown host "${options.host}". Supported: claude, opencode, codex, all.`);
    process.exit(1);
  }

  const cwd = resolve(options.cwd);
  const profile = detectProjectProfile(cwd);

  if (profile.tags.length === 0) {
    console.log('No tech-stack signals detected in this directory.');
    console.log('Skipping filter generation — an empty profile would disable nothing useful.');
    return;
  }

  const installed = enumerateInstalledSkills(homedir());
  const classification = classifySkillRelevance(profile, installed);

  console.log('Project profile');
  console.log('═══════════════');
  console.log(`  Detected: ${profile.tags.join(', ')}`);
  console.log(`  Host:     ${options.host}`);
  console.log('');
  console.log(`  Installed skills: ${installed.length}`);
  console.log(`  Protected:        ${classification.protected.length} (never filtered)`);
  console.log(`  Relevant:         ${classification.relevant.length}`);
  console.log(`  Unmapped:         ${classification.unknown.length}`);
  console.log(`  Will be disabled: ${classification.irrelevant.length}`);
  console.log('');

  if (classification.irrelevant.length === 0) {
    console.log('Nothing to disable — exiting.');
    return;
  }

  console.log('Skills that will be disabled for this project:');
  console.log(classification.irrelevant.map((s) => `  - ${s}`).join('\n'));
  console.log('');
  console.log('Safeguards applied:');
  console.log(`  - ${classification.protected.length} skills protected by construct safeguards`);
  console.log(`  - ${classification.unknown.length} unmapped skills kept as relevant by default`);
  console.log(`  - Disabled skills remain on disk; callable via get_skill on demand`);
  console.log(`  - cx-* specialists use construct-mcp get_skill (never host injection)`);
  console.log('');

  if (options.dryRun) {
    console.log('Dry run — no files written. Use without --dry-run to apply.');
    return;
  }

  // Always write the construct manifest first — it's the authoritative record.
  const manifestPath = writeConstructManifest(cwd, profile, classification);
  writeProfile(profile, cwd);
  console.log(`✓ Manifest: ${manifestPath}`);

  const hostsToWrite = options.host === 'all' ? ['claude', 'opencode', 'codex'] : [options.host];
  for (const host of hostsToWrite) {
    const writer = HOST_WRITERS[host];
    if (!writer) continue;
    try {
      const path = writer(cwd, classification);
      console.log(`✓ ${host.padEnd(8)}: ${path}`);
    } catch (err) {
      console.error(`✗ ${host.padEnd(8)}: ${err?.message || 'write failed'}`);
    }
  }
  console.log('');
  console.log('Manifest + per-host sidecars written. Host support varies:');
  console.log('  - Claude Code:  sidecar at .claude/construct-skills.json (advisory today;');
  console.log('                  construct-mcp can read it at session start).');
  console.log('  - OpenCode:     agent filter honored at next session.');
  console.log('  - Codex:        sidecar at .codex/skills-profile.json (adapter reads at startup).');
  console.log('');
  console.log('The authoritative record is .cx/skills-profile.json (version-controllable).');
  console.log('To revert: delete the files under .claude/, opencode.json, or .codex/ as appropriate.');
}
