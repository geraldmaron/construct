/**
 * lib/packs/cli.mjs — `construct pack` command surface.
 *
 * Subcommands:
 *   list             Every pack discovered across builtin/user/project tiers
 *                     (loader.mjs precedence merge), each annotated with its
 *                     durable enabled state (enablement.mjs).
 *   enable <id>      Validate the pack's on-disk manifest and record it as
 *                     enabled in .construct/packs.json. Refuses — naming the exact
 *                     validation error — on an incompatible compatVersion or
 *                     any other manifest defect.
 *   disable <id>     Remove the pack's enabled entry. Idempotent. Refuses to
 *                     disable the core pack.
 *   info <id>        Full manifest plus enabled state for one pack.
 *
 * `--json` on every subcommand emits a machine-readable payload; the text
 * form is the human-readable default.
 */

import { loadAllPacks } from './loader.mjs';
import { readEnablementState, isEnabled, enablePack, disablePack } from './enablement.mjs';

function annotatedPacks({ rootDir, homeDir, packageRoot, env, deploymentMode }) {
  const { packs, errors } = loadAllPacks({ rootDir, homeDir, packageRoot, env, deploymentMode });
  const state = readEnablementState(rootDir);
  const annotated = packs.map((p) => ({
    id: p.id,
    version: p.version,
    tier: p._tier,
    enabled: isEnabled(p.id, state, { packageRoot }),
    manifestPath: p._manifestPath || p._packDir || null,
  }));
  return { packs: annotated, errors, state };
}

function runList({ rootDir, packageRoot, json }) {
  const { packs, errors } = annotatedPacks({ rootDir, packageRoot });
  packs.sort((a, b) => a.id.localeCompare(b.id));
  if (json) {
    process.stdout.write(JSON.stringify({ packs, errors }, null, 2) + '\n');
    return 0;
  }
  process.stdout.write(`Packs (${packs.length}):\n`);
  for (const p of packs) {
    process.stdout.write(`  ${p.enabled ? '●' : '○'} ${p.id}@${p.version} [${p.tier}]${p.enabled ? ' (enabled)' : ''}\n`);
  }
  for (const e of errors) process.stdout.write(`  ! ${e}\n`);
  return 0;
}

/**
 * Splits a `<pack-id>[@version]` spec on the last '@', so a scoped id like
 * '@fixture/sample' (no version) stays intact while '@fixture/sample@2.0.0'
 * splits into id '@fixture/sample' and version '2.0.0'.
 */
function parsePackSpec(spec) {
  const at = spec.lastIndexOf('@');
  if (at <= 0) return { packId: spec, requestedVersion: undefined };
  return { packId: spec.slice(0, at), requestedVersion: spec.slice(at + 1) };
}

function runEnable(args, { rootDir, packageRoot, json }) {
  const id = args.find((a) => !a.startsWith('--'));
  if (!id) {
    process.stderr.write('Usage: construct pack enable <pack-id>[@version] [--json]\n');
    return 1;
  }
  const { packId, requestedVersion } = parsePackSpec(id);

  const result = enablePack(packId, { rootDir, packageRoot, requestedVersion });
  if (json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return result.ok ? 0 : 1;
  }
  if (!result.ok) {
    process.stderr.write(`✖ ${result.error}\n`);
    return 1;
  }
  process.stdout.write(result.alreadyCore ? `✓ ${packId} is the core pack (always enabled)\n` : `✓ enabled ${packId}@${result.pack.version} [${result.tier}]\n`);
  return 0;
}

function runDisable(args, { rootDir, packageRoot, json }) {
  const id = args.find((a) => !a.startsWith('--'));
  if (!id) {
    process.stderr.write('Usage: construct pack disable <pack-id> [--json]\n');
    return 1;
  }
  const result = disablePack(id, { rootDir, packageRoot });
  if (json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return result.ok ? 0 : 1;
  }
  if (!result.ok) {
    process.stderr.write(`✖ ${result.error}\n`);
    return 1;
  }
  process.stdout.write(result.wasEnabled ? `✓ disabled ${id}\n` : `${id} was not enabled (no-op)\n`);
  return 0;
}

function runInfo(args, { rootDir, packageRoot, json }) {
  const id = args.find((a) => !a.startsWith('--'));
  if (!id) {
    process.stderr.write('Usage: construct pack info <pack-id> [--json]\n');
    return 1;
  }
  const { packs: rawPacks } = loadAllPacks({ rootDir, packageRoot });
  const pack = rawPacks.find((p) => p.id === id);
  if (!pack) {
    process.stderr.write(`pack not found: ${id}\n`);
    return 1;
  }
  const state = readEnablementState(rootDir);
  const enabled = isEnabled(id, state, { packageRoot });
  const result = { ...pack, enabled, enabledDetail: state.enabled[id] || null };
  if (json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return 0;
  }
  process.stdout.write(`${pack.id}@${pack.version} [${pack._tier}] ${enabled ? '(enabled)' : '(disabled)'}\n`);
  if (pack.workerProfiles) process.stdout.write(`  worker profiles: ${Object.keys(pack.workerProfiles).length}\n`);
  if (pack.prompts) process.stdout.write(`  prompts: ${Object.keys(pack.prompts).length}\n`);
  if (pack.frameworks) process.stdout.write(`  frameworks: ${Object.keys(pack.frameworks).length}\n`);
  return 0;
}

/**
 * @param {string[]} args
 * @param {{ rootDir: string, packageRoot?: string }} ctx
 * @returns {number} exit code
 */
export function runPackCli(args, { rootDir, packageRoot } = {}) {
  const sub = args[0];
  const rest = args.slice(1);
  const json = args.includes('--json');

  if (sub === 'list') return runList({ rootDir, packageRoot, json });
  if (sub === 'enable') return runEnable(rest, { rootDir, packageRoot, json });
  if (sub === 'disable') return runDisable(rest, { rootDir, packageRoot, json });
  if (sub === 'info') return runInfo(rest, { rootDir, packageRoot, json });

  process.stderr.write(`Unknown pack subcommand: ${sub}. Available: list, enable, disable, info\n`);
  return 1;
}
