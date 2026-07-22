/**
 * CLI handlers for Workspace Preset discovery and project selection.
 *
 * Extends the generic registry catalog with project-scoped apply/show behavior
 * so operators can inspect and switch presets without hand-editing config.
 */

import {
  loadWorkspacePreset,
  resolveActiveWorkspacePreset,
} from './loader.mjs';
import { listWorkspacePresets as listRegistryWorkspacePresets } from '../registry/loader.mjs';
import {
  grepFilter,
  formatNotFoundError,
  listColumnWidth,
  recordId,
  truncate,
} from '../registry/catalog-format.mjs';
import { suggestClosestMatch } from '../cli-commands.mjs';
import { setConfigValueWithValidation } from '../config/project-config.mjs';
import { applyDocsPack } from '../init/scaffold-docs-pack.mjs';
import { DOC_PACK_ORDER, DOC_PACKS, DOC_PRESETS } from '../init/doc-lanes.mjs';

function flagValue(args, name) {
  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  return index !== -1 ? args[index + 1] : undefined;
}

function positionalArgs(args) {
  return args.filter((arg) => !arg.startsWith('--'));
}

function parseDocsPresetArg(args) {
  const inline = args.find((arg) => arg.startsWith('--docs-preset='));
  if (!inline) return null;
  return inline.slice('--docs-preset='.length).trim().toLowerCase();
}

async function promptDocsPackChoice() {
  const { selectOption } = await import('../tty-prompts.mjs');
  return selectOption({
    title: 'Add a documentation pack?',
    instructions: '↑↓ Navigate · Enter Select · Q Cancel (default is docs/ only)',
    options: [
      {
        value: null,
        label: 'Skip — docs/ folder only',
        description: 'No lane templates. Add later with construct init --docs-preset=lean or construct workspace-preset apply <id> --docs-preset=lean.',
      },
      ...DOC_PACK_ORDER.map((id) => ({
        value: id,
        label: DOC_PACKS[id].title,
        description: DOC_PACKS[id].description,
      })),
    ],
  });
}

async function resolveDocsPackSelection(args, { dryRun, skipInteractive, errorln }) {
  const explicit = parseDocsPresetArg(args);
  if (explicit) {
    if (!DOC_PRESETS[explicit]) {
      errorln(`Unknown docs pack: ${explicit}. Available: ${DOC_PACK_ORDER.join(', ')}`);
      return { preset: null, error: true };
    }
    return { preset: explicit, error: false };
  }

  if (dryRun || skipInteractive || !process.stdin.isTTY) {
    return { preset: null, error: false };
  }

  try {
    const preset = await promptDocsPackChoice();
    return { preset: preset || null, error: false };
  } catch (err) {
    if (err?.message === 'Canceled by user.') {
      errorln('Canceled.');
      return { preset: null, error: true };
    }
    throw err;
  }
}

export async function runWorkspacePresetList(args = [], { cwd = process.cwd(), println = console.log } = {}) {
  const jsonOutput = args.includes('--json');
  const grep = flagValue(args, '--grep');
  const active = resolveActiveWorkspacePreset(cwd);
  const activeId = active?.id || null;
  let records = listRegistryWorkspacePresets().sort((a, b) => recordId(a).localeCompare(recordId(b)));
  records = grepFilter(records, grep);

  if (jsonOutput) {
    println(JSON.stringify(records.map((record) => ({
      id: record.id,
      displayName: record.displayName || record.id,
      tagline: record.tagline || null,
      skillCount: Array.isArray(record.skills) ? record.skills.length : 0,
      procedureCount: Array.isArray(record.procedures) ? record.procedures.length : 0,
      experimental: record.experimental === true,
      active: record.id === activeId,
    })), null, 2));
    return 0;
  }

  if (!records.length) {
    println(grep ? `No workspace presets match "${grep}".` : 'No workspace preset records found.');
    return 0;
  }

  const width = listColumnWidth(records, { extra: 2 });
  if (activeId) println(`Active preset: ${activeId}\n`);
  for (const record of records) {
    const marker = record.id === activeId ? '* ' : '  ';
    const tagline = truncate(record.tagline || record.displayName || '', 56);
    const counts = [
      Array.isArray(record.skills) ? `${record.skills.length} skills` : null,
      Array.isArray(record.procedures) && record.procedures.length ? `${record.procedures.length} procedures` : null,
      record.experimental ? 'experimental' : null,
    ].filter(Boolean).join(', ');
    const suffix = [tagline, counts].filter(Boolean).join(' · ');
    println(`${marker}${record.id.padEnd(width)} ${suffix}`.trimEnd());
  }
  println('\nRun `construct workspace-preset show <id>` to inspect one; `construct workspace-preset apply <id>` to switch.');
  return 0;
}

export async function runWorkspacePresetShow(args = [], { cwd = process.cwd(), println = console.log, errorln = console.error } = {}) {
  const jsonOutput = args.includes('--json');
  const positional = positionalArgs(args);
  const id = positional[0] || null;

  if (!id) {
    const active = resolveActiveWorkspacePreset(cwd);
    if (jsonOutput) {
      println(JSON.stringify(active, null, 2));
      return 0;
    }
    println(`Active Workspace Preset: ${active.id} (${active.displayName || active.id})`);
    if (active.tagline) println(active.tagline);
    println('');
    println(`Skills (${active.skills?.length || 0}): ${(active.skills || []).join(', ') || 'none'}`);
    println(`Procedures (${active.procedures?.length || 0}): ${(active.procedures || []).join(', ') || 'none'}`);
    const intakeTypes = active.intake?.types || [];
    const intakeStages = active.intake?.stages || [];
    if (intakeTypes.length) println(`Intake types: ${intakeTypes.join(', ')}`);
    if (intakeStages.length) println(`Intake stages: ${intakeStages.join(', ')}`);
    println('\nAdd --json for the full record, or pass an id to inspect a catalog preset.');
    return 0;
  }

  const record = loadWorkspacePreset(id);
  if (!record) {
    formatNotFoundError('Workspace Preset', id, listRegistryWorkspacePresets().map((entry) => entry.id), { errorln });
    return 1;
  }

  if (jsonOutput) {
    println(JSON.stringify(record, null, 2));
    return 0;
  }

  println(`${record.displayName || record.id} (${record.id})`);
  if (record.tagline) println(record.tagline);
  println('');
  println(`Skills (${record.skills?.length || 0}): ${(record.skills || []).join(', ') || 'none'}`);
  println(`Procedures (${record.procedures?.length || 0}): ${(record.procedures || []).join(', ') || 'none'}`);
  const intakeTypes = record.intake?.types || [];
  const intakeStages = record.intake?.stages || [];
  if (intakeTypes.length) println(`Intake types: ${intakeTypes.join(', ')}`);
  if (intakeStages.length) println(`Intake stages: ${intakeStages.join(', ')}`);
  println('\nAdd --json for the full record.');
  return 0;
}

export async function runWorkspacePresetApply(args = [], { cwd = process.cwd(), println = console.log, errorln = console.error } = {}) {
  const dryRun = args.includes('--dry-run');
  const skipInteractive = args.includes('--yes') || !process.stdin.isTTY;
  const id = positionalArgs(args)[0];
  if (!id) {
    errorln('Usage: construct workspace-preset apply <id> [--dry-run] [--docs-preset=lean|product|full] [--yes]');
    errorln('Sets construct.config.json workspacePreset after validating the catalog id.');
    errorln('Documentation packs are opt-in: pass --docs-preset or answer the interactive picker on a TTY.');
    return 1;
  }

  const docsSelection = await resolveDocsPackSelection(args, { dryRun, skipInteractive, errorln });
  if (docsSelection.error) return 1;

  const record = loadWorkspacePreset(id);
  if (!record) {
    formatNotFoundError('Workspace Preset', id, listRegistryWorkspacePresets().map((entry) => entry.id), { errorln });
    return 1;
  }

  const result = setConfigValueWithValidation('workspacePreset', id, { cwd, dryRun });
  if (!result.success) {
    errorln(result.message);
    for (const message of result.errors || []) errorln(`  ${message}`);
    return 1;
  }

  println(dryRun ? result.message : `Workspace Preset set to ${id} (${record.displayName || id}).`);
  if (!dryRun) {
    println('Run `construct workspace-preset list` to confirm the active marker, or `construct sync` if platform files need refresh.');
  }

  if (docsSelection.preset) {
    if (dryRun) {
      println(`Would apply docs pack: ${docsSelection.preset} (--docs-preset=${docsSelection.preset}).`);
      return 0;
    }
    const packResult = applyDocsPack({ cwd, docsPreset: docsSelection.preset });
    if (!packResult.ok) {
      errorln(packResult.message);
      return 1;
    }
    const counts = packResult.createdCount != null
      ? ` (${packResult.createdCount} created, ${packResult.skippedCount} skipped)`
      : '';
    println(`Docs pack applied: ${docsSelection.preset}${counts}.`);
  } else if (!dryRun) {
    println('Docs: no pack added (opt in with `--docs-preset=lean|product|full` or re-run on a TTY for the picker).');
  }

  return 0;
}

export async function runWorkspacePresetCommand(args = [], io = {}) {
  const subcommand = args[0] || 'list';
  const rest = args.slice(1);
  const errorln = io.errorln || console.error;
  if (subcommand === 'list') return runWorkspacePresetList(rest, io);
  if (subcommand === 'show') return runWorkspacePresetShow(rest, io);
  if (subcommand === 'apply') return runWorkspacePresetApply(rest, io);
  const available = ['list', 'show', 'apply'];
  const suggestion = suggestClosestMatch(subcommand, available);
  errorln(`Unknown workspace-preset subcommand: ${subcommand}. Available: ${available.join(', ')}`);
  if (suggestion) errorln(`Did you mean: ${suggestion}?`);
  return 1;
}
