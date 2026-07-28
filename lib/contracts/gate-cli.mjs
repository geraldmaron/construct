/**
 * lib/contracts/gate-cli.mjs — `construct contract` surface for the
 * enforcement ladder (construct-uizpv.5).
 *
 * Subcommands:
 *   status <artifact> [--type=<t>]   show which contracts gate an artifact
 *   sign-off <contract> --as=<wp>    record an approval that clears a rung
 *   override <contract> --reason=…   proceed past a soft rung, audited
 *
 * `override` deliberately refuses a hard rung rather than reporting success
 * on a no-op: an override that silently fails to clear anything is worse than
 * one that says it cannot.
 */

import path from 'node:path';

import { evaluateArtifactContracts } from './artifact-gate.mjs';
import { loadEnforceableContracts, resolveContractEnforcement } from './enforcement.mjs';
import { recordOverride, recordSignOff } from './sign-off.mjs';
import { inferArtifactTypeFromPath } from '../artifact-type-from-path.mjs';

function readFlag(args, name) {
  const hit = args.find((arg) => arg.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1) : null;
}

function usage(stream = process.stderr) {
  stream.write('Usage: construct contract <status|sign-off|override> [...]\n');
  stream.write('  construct contract status <artifact> [--type=<artifact-type>] [--json]\n');
  stream.write('  construct contract sign-off <contract-id> --as=<worker-profile> [--artifact=<path>] [--reason=<text>]\n');
  stream.write('  construct contract override <contract-id> --reason=<text> [--artifact=<path>] [--actor=<name>]\n');
}

function resolveArtifactRef(value, projectRoot) {
  if (!value) return null;
  return path.resolve(projectRoot, value);
}

function cmdStatus(args, { projectRoot, rootDir, println, errorln }) {
  const target = args.find((arg) => !arg.startsWith('--'));
  if (!target) {
    errorln('contract status requires an artifact path');
    usage();
    return 1;
  }
  const filePath = resolveArtifactRef(target, projectRoot);
  const artifactType = readFlag(args, '--type') || inferArtifactTypeFromPath(filePath, { rootDir: projectRoot });
  const result = evaluateArtifactContracts({ filePath, artifactType, projectRoot, rootDir });

  if (args.includes('--json')) {
    println(JSON.stringify({ filePath, artifactType, ...result }, null, 2));
    return result.errors.length === 0 ? 0 : 1;
  }

  const flags = result.contractGate.riskFlags;
  if (flags.length === 0) {
    println(`No risk flags declared in ${target} — no contracts engaged.`);
    return 0;
  }
  println(`Risk flags: ${flags.join(', ')}`);
  for (const entry of result.contractGate.evaluated || []) {
    const cleared = entry.clearedBy ? ` (cleared by ${entry.clearedBy})` : '';
    println(`  [${entry.level}] ${entry.contractId}${cleared}`);
  }
  for (const warning of result.warnings) println(`  ! ${warning}`);
  for (const error of result.errors) errorln(`  ✗ ${error}`);
  return result.errors.length === 0 ? 0 : 1;
}

function cmdSignOff(args, { projectRoot, rootDir, println, errorln }) {
  const contractId = args.find((arg) => !arg.startsWith('--'));
  const workerProfile = readFlag(args, '--as');
  if (!contractId || !workerProfile) {
    errorln('contract sign-off requires <contract-id> and --as=<worker-profile>');
    usage();
    return 1;
  }

  const contract = loadEnforceableContracts({ rootDir }).find((entry) => entry.id === contractId);
  if (!contract) {
    errorln(`Unknown contract: ${contractId}`);
    return 1;
  }
  const enforcement = resolveContractEnforcement(contract);
  if (enforcement.error) {
    errorln(enforcement.error);
    return 1;
  }
  if (!enforcement.approvalWorkerProfiles.includes(workerProfile)) {
    errorln(`Worker Profile '${workerProfile}' is not an approver for '${contractId}' (declared: ${enforcement.approvalWorkerProfiles.join(', ') || 'none'})`);
    return 1;
  }

  const record = recordSignOff({
    projectRoot,
    contractId,
    workerProfile,
    artifactRef: resolveArtifactRef(readFlag(args, '--artifact'), projectRoot),
    actor: readFlag(args, '--actor'),
    reason: readFlag(args, '--reason'),
  });
  println(`Recorded sign-off: ${contractId} approved by ${workerProfile}${record.artifactRef ? ` for ${record.artifactRef}` : ' (contract-wide)'}`);
  return 0;
}

function cmdOverride(args, { projectRoot, rootDir, println, errorln }) {
  const contractId = args.find((arg) => !arg.startsWith('--'));
  const reason = readFlag(args, '--reason');
  if (!contractId || !reason) {
    errorln('contract override requires <contract-id> and --reason=<text>');
    usage();
    return 1;
  }

  const contract = loadEnforceableContracts({ rootDir }).find((entry) => entry.id === contractId);
  if (!contract) {
    errorln(`Unknown contract: ${contractId}`);
    return 1;
  }
  const enforcement = resolveContractEnforcement(contract);
  if (enforcement.level === 'hard') {
    errorln(`Contract '${contractId}' is hard-blocked and cannot be overridden — it clears only via sign-off from: ${enforcement.approvalWorkerProfiles.join(', ')}`);
    return 1;
  }
  if (enforcement.level === 'advisory') {
    errorln(`Contract '${contractId}' is advisory and blocks nothing — there is nothing to override`);
    return 1;
  }

  const record = recordOverride({
    projectRoot,
    contractId,
    reason,
    actor: readFlag(args, '--actor'),
    artifactRef: resolveArtifactRef(readFlag(args, '--artifact'), projectRoot),
  });
  println(`Recorded override: ${contractId} — ${record.reason} (written to the audit trail)`);
  return 0;
}

export function runContractGateCli(args = [], {
  projectRoot = process.cwd(),
  rootDir,
  println = (line) => process.stdout.write(`${line}\n`),
  errorln = (line) => process.stderr.write(`${line}\n`),
} = {}) {
  const sub = args[0];
  const rest = args.slice(1);
  const ctx = { projectRoot, rootDir, println, errorln };

  if (sub === 'status') return cmdStatus(rest, ctx);
  if (sub === 'sign-off') return cmdSignOff(rest, ctx);
  if (sub === 'override') return cmdOverride(rest, ctx);

  errorln(`Unknown contract subcommand: ${sub || '(none)'}. Available: status, sign-off, override`);
  usage();
  return 1;
}
