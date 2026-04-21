/**
 * lib/skills-scope.mjs — CLI surface for project-profile-driven skill scoping.
 *
 * Powers `construct skills scope` (and, later, auto-generation of per-host
 * skill filters). The detection layer is in lib/project-profile.mjs and is
 * host-agnostic by design — this file composes it into a reportable workflow
 * and will later wire per-host filter writers.
 */
import { homedir } from 'node:os';
import {
  classifySkillRelevance,
  detectProjectProfile,
  enumerateInstalledSkills,
  writeProfile,
} from './project-profile.mjs';

function formatList(list, { limit = 20 } = {}) {
  if (list.length === 0) return '  (none)';
  const shown = list.slice(0, limit);
  const rest = list.length > limit ? `\n  ... and ${list.length - limit} more` : '';
  return shown.map((name) => `  - ${name}`).join('\n') + rest;
}

export async function runSkillsScopeCli(args = []) {
  const flags = new Set();
  const options = { cwd: process.cwd() };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--json') flags.add('json');
    else if (arg === '--write') flags.add('write');
    else if (arg === '--no-write') flags.add('no-write');
    else if (arg === '--help' || arg === '-h') flags.add('help');
    else if (arg === '--cwd') options.cwd = args[++i];
    else if (arg.startsWith('--cwd=')) options.cwd = arg.slice(6);
  }

  if (flags.has('help')) {
    console.log(`Usage: construct skills scope [options]

Detects the project's tech stack from filesystem signals (package.json,
pyproject.toml, go.mod, Cargo.toml, etc.) and reports which installed
skills are relevant vs irrelevant to the current repo.

Writes .cx/project-profile.json by default (disable with --no-write).

Options:
  --cwd <path>   Target directory (defaults to CWD)
  --json         Emit the profile + classification as JSON
  --no-write     Skip writing .cx/project-profile.json
  --write        Force write (default behavior)
  -h, --help     Show this message

The detection layer is host-agnostic. A future pass can use the profile to
generate per-host skill filters (.claude/settings.json, opencode.json, etc.).
`);
    return;
  }

  const profile = detectProjectProfile(options.cwd);
  const installed = enumerateInstalledSkills(homedir());
  const classification = classifySkillRelevance(profile, installed);

  let profilePath = null;
  if (!flags.has('no-write')) {
    try { profilePath = writeProfile(profile, options.cwd); } catch { /* best effort */ }
  }

  if (flags.has('json')) {
    console.log(JSON.stringify({
      profile,
      classification,
      installedCount: installed.length,
      profilePath,
    }, null, 2));
    return;
  }

  const irrelevantRatio = installed.length === 0 ? 0 :
    Math.round((classification.irrelevant.length / installed.length) * 100);

  console.log('Project profile');
  console.log('═══════════════');
  console.log(`  Root     ${profile.root}`);
  console.log(`  Detected ${profile.tags.length ? profile.tags.join(', ') : '(no signals matched)'}`);
  console.log(`  Signals  ${profile.signals.length ? profile.signals.join(', ') : '(none)'}`);
  if (profilePath) console.log(`  Saved    ${profilePath}`);
  console.log('');

  console.log('Installed skills classification');
  console.log('───────────────────────────────');
  console.log(`  Total installed: ${installed.length}`);
  console.log(`  Relevant:        ${classification.relevant.length}`);
  console.log(`  Irrelevant:      ${classification.irrelevant.length} (${irrelevantRatio}% of total)`);
  console.log(`  Unmapped:        ${classification.unknown.length} (default: treat as relevant)`);
  console.log('');

  if (classification.irrelevant.length > 0) {
    console.log('Irrelevant skills for this project:');
    console.log(formatList(classification.irrelevant));
    console.log('');
    console.log('These are loaded on every turn by the host but do not match this');
    console.log('project\'s tech stack. To reduce per-turn context footprint:');
    console.log('');
    console.log('  - Claude Code: edit ~/.claude/settings.json or per-project .claude/');
    console.log('    plugins.json to disable plugins you don\'t need in this repo.');
    console.log('  - OpenCode:    edit ~/.config/opencode/opencode.json');
    console.log('  - Codex:       edit ~/.codex/agents/ filters');
    console.log('');
    console.log('Future: `construct skills apply --host <name>` will generate these');
    console.log('filter configs automatically from the profile above.');
  }

  if (classification.unknown.length > 0 && classification.unknown.length < 40) {
    console.log('');
    console.log(`Unmapped skills (no relevance rule — default kept):`);
    console.log(formatList(classification.unknown, { limit: 10 }));
  }
}
