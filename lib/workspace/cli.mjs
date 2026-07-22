/**
 * lib/workspace/cli.mjs — `construct workspace-domain` command surface (design doc
 * §8), mirroring lib/graph/cli.mjs's dispatch shape: numeric exit codes,
 * process.stdout/stderr.write rather than console.*, --json opt-in.
 *
 * Subcommands:
 *   init [--name=] [--remote=] [--deployment=embedded|shared]   ensureWorkspace.
 *   show [--json]                                               getWorkspace.
 *   activate / archive                                          lifecycle transitions.
 *   member add <ref> [--role=owner|member] / member remove <ref> / member list [--json]
 *   settings get <key> / settings set <key> <value> / settings list [--json]
 */

import {
  ensureWorkspace, getWorkspace, activateWorkspace, archiveWorkspace,
  addMember, removeMember, listMembers, getSetting, setSetting, getSettings,
} from './store.mjs';
import { sqliteAvailable } from './sqlite-db.mjs';

function requireSqlite() {
  if (sqliteAvailable()) return null;
  process.stderr.write('This command requires the Workspace domain store (node:sqlite, Node >=22.5).\n');
  return 1;
}

function parseFlag(args, name) {
  const flag = args.find((a) => a.startsWith(`--${name}=`));
  return flag ? flag.slice(name.length + 3) : undefined;
}

function runInit(args, { projectDir, json }) {
  const name = parseFlag(args, 'name');
  const remote = parseFlag(args, 'remote');
  const deployment = parseFlag(args, 'deployment') || 'embedded';
  const workspace = ensureWorkspace(projectDir, { name, remote, deployment });
  if (json) {
    process.stdout.write(JSON.stringify({ ok: true, workspace }, null, 2) + '\n');
    return 0;
  }
  process.stdout.write(`✓ workspace ${workspace.id} (${workspace.state})\n`);
  return 0;
}

function runShow({ projectDir, json }) {
  const workspace = getWorkspace(projectDir);
  if (!workspace) {
    if (json) {
      process.stdout.write(JSON.stringify({ ok: true, found: false, workspace: null }, null, 2) + '\n');
      return 1;
    }
    process.stderr.write('No workspace found for this project. Run `construct workspace-domain init` first.\n');
    return 1;
  }
  if (json) {
    process.stdout.write(JSON.stringify({ ok: true, found: true, workspace }, null, 2) + '\n');
    return 0;
  }
  process.stdout.write(`${workspace.id}\n`);
  process.stdout.write(`  name:       ${workspace.name}\n`);
  process.stdout.write(`  root:       ${workspace.rootPath}\n`);
  process.stdout.write(`  remote:     ${workspace.remote ?? '(none)'}\n`);
  process.stdout.write(`  deployment: ${workspace.deployment}\n`);
  process.stdout.write(`  state:      ${workspace.state}\n`);
  process.stdout.write(`  owner:      ${workspace.owner ?? '(none)'}\n`);
  return 0;
}

function runTransition(transitionFn, { projectDir, json }) {
  try {
    const workspace = transitionFn(projectDir);
    if (json) {
      process.stdout.write(JSON.stringify({ ok: true, workspace }, null, 2) + '\n');
      return 0;
    }
    process.stdout.write(`✓ workspace ${workspace.id} is now ${workspace.state}\n`);
    return 0;
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    return 1;
  }
}

function runMember(args, { projectDir, json }) {
  const sub = args[1];
  if (sub === 'add') {
    const ref = args.slice(2).find((a) => !a.startsWith('--'));
    const role = parseFlag(args, 'role') || 'member';
    if (!ref) {
      process.stderr.write('Usage: construct workspace-domain member add <ref> [--role=owner|member]\n');
      return 1;
    }
    try {
      const member = addMember(projectDir, ref, { role });
      if (json) { process.stdout.write(JSON.stringify({ ok: true, member }, null, 2) + '\n'); return 0; }
      process.stdout.write(`✓ ${member.memberRef} (${member.role})\n`);
      return 0;
    } catch (err) {
      process.stderr.write(`${err.message}\n`);
      return 1;
    }
  }
  if (sub === 'remove') {
    const ref = args.slice(2).find((a) => !a.startsWith('--'));
    if (!ref) {
      process.stderr.write('Usage: construct workspace-domain member remove <ref>\n');
      return 1;
    }
    removeMember(projectDir, ref);
    if (json) { process.stdout.write(JSON.stringify({ ok: true, removed: ref }, null, 2) + '\n'); return 0; }
    process.stdout.write(`✓ removed ${ref}\n`);
    return 0;
  }
  if (sub === 'list' || !sub) {
    const members = listMembers(projectDir);
    if (json) { process.stdout.write(JSON.stringify({ ok: true, members }, null, 2) + '\n'); return 0; }
    process.stdout.write(`members (${members.length}):\n`);
    for (const m of members) process.stdout.write(`  ${m.memberRef} (${m.role})\n`);
    return 0;
  }
  process.stderr.write(`Unknown workspace member subcommand: ${sub}. Available: add, remove, list\n`);
  return 1;
}

function runSettings(args, { projectDir, json }) {
  const sub = args[1];
  if (sub === 'get') {
    const key = args[2];
    if (!key) {
      process.stderr.write('Usage: construct workspace-domain settings get <key>\n');
      return 1;
    }
    const value = getSetting(projectDir, key);
    if (json) { process.stdout.write(JSON.stringify({ ok: true, key, value: value ?? null }, null, 2) + '\n'); return 0; }
    process.stdout.write(`${key}: ${value === undefined ? '(unset)' : JSON.stringify(value)}\n`);
    return 0;
  }
  if (sub === 'set') {
    const key = args[2];
    const raw = args[3];
    if (!key || raw === undefined) {
      process.stderr.write('Usage: construct workspace-domain settings set <key> <value>\n');
      return 1;
    }
    let value;
    try { value = JSON.parse(raw); } catch { value = raw; }
    try {
      const settings = setSetting(projectDir, key, value);
      if (json) { process.stdout.write(JSON.stringify({ ok: true, settings }, null, 2) + '\n'); return 0; }
      process.stdout.write(`✓ ${key} = ${JSON.stringify(value)}\n`);
      return 0;
    } catch (err) {
      process.stderr.write(`${err.message}\n`);
      return 1;
    }
  }
  if (sub === 'list' || !sub) {
    const settings = getSettings(projectDir);
    if (settings === null) {
      process.stderr.write('No workspace found for this project. Run `construct workspace-domain init` first.\n');
      return 1;
    }
    if (json) { process.stdout.write(JSON.stringify({ ok: true, settings }, null, 2) + '\n'); return 0; }
    process.stdout.write(JSON.stringify(settings, null, 2) + '\n');
    return 0;
  }
  process.stderr.write(`Unknown workspace settings subcommand: ${sub}. Available: get, set, list\n`);
  return 1;
}

/**
 * @param {string[]} args
 * @param {{ projectDir: string }} ctx
 * @returns {number} exit code
 */
export function runWorkspaceCli(args, { projectDir }) {
  const guard = requireSqlite();
  if (guard) return guard;

  const sub = args[0] || 'show';
  const json = args.includes('--json');

  if (sub === 'init') return runInit(args, { projectDir, json });
  if (sub === 'show') return runShow({ projectDir, json });
  if (sub === 'activate') return runTransition(activateWorkspace, { projectDir, json });
  if (sub === 'archive') return runTransition(archiveWorkspace, { projectDir, json });
  if (sub === 'member') return runMember(args, { projectDir, json });
  if (sub === 'settings') return runSettings(args, { projectDir, json });
  process.stderr.write(`Unknown workspace subcommand: ${sub}. Available: init, show, activate, archive, member, settings\n`);
  return 1;
}
