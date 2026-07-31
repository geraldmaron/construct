/**
 * lib/workplace-loop/cli.mjs — `construct workplace-loop` command surface
 * mirroring lib/workspace/cli.mjs's and
 * lib/graph/cli.mjs's dispatch shape: numeric exit codes,
 * process.stdout/stderr.write rather than console.*, --json opt-in.
 *
 * Subcommands mirror spike D's five-verb shape (detect | request-approval |
 * approve | apply | verify), now backed by the real ApprovalQueue/
 * control-plane chokepoint (gate.mjs) instead of spike D's local JSON files.
 *
 *   detect [--repo=owner/name] [--json]
 *   request-approval --proposal <id> [--json]
 *   approve --proposal <id> --by <name> [--json]
 *   apply --proposal <id> [--json]
 *   verify --proposal <id> [--json]
 *
 * `ctx.providerFactory`/`ctx.adapterFactories` are optional test-only
 * dependency-injection seams (forwarded to runDetect/applyProposal exactly
 * as their own opts already accept), never read from an environment
 * variable — `bin/construct`'s real invocation passes neither, so a real
 * run always resolves the real GitHub read provider and the real governed
 * adapters. A functional test importing this module directly in an
 * isolated tmpdir passes both to exercise the full CLI dispatch without a
 * live network call or a real external write, the same injection shape
 * lib/writes/control-plane.mjs's own `opts.adapterFactories` already uses.
 */

import { ApprovalQueue } from '../embed/approval-queue.mjs';
import { runDetect } from './detect.mjs';
import { requestApproval, approveAll, applyProposal, recordsForApprovalIds } from './gate.mjs';
import { verifyProposalExecution } from './verify.mjs';
import { loadProposal, saveProposalApprovals } from './state-store.mjs';

function flag(args, name) {
  const prefixed = args.find((a) => a.startsWith(`--${name}=`));
  if (prefixed) return prefixed.slice(name.length + 3);
  const idx = args.indexOf(`--${name}`);
  return idx === -1 ? undefined : args[idx + 1];
}

function openQueue(projectDir) {
  return new ApprovalQueue({ persistPath: ApprovalQueue.resolvePersistPath(projectDir) });
}

async function runDetectCmd(args, { projectDir, json, providerFactory }) {
  const repo = flag(args, 'repo');
  const report = await runDetect(projectDir, { repo, providerFactory });
  if (json) { process.stdout.write(JSON.stringify(report, null, 2) + '\n'); return report.result === 'NO_SOURCE_CONFIGURED' ? 1 : 0; }
  process.stdout.write(`${report.result}${report.result === 'NEW_FINDINGS' ? ` — ${report.meaningfulSignals.length} signal(s), proposal ${report.proposalId ?? '(none)'}` : ''}\n`);
  return report.result === 'NO_SOURCE_CONFIGURED' ? 1 : 0;
}

function runRequestApprovalCmd(args, { projectDir, json }) {
  const proposalId = flag(args, 'proposal');
  if (!proposalId) { process.stderr.write('Usage: construct workplace-loop request-approval --proposal <id>\n'); return 1; }
  try {
    const proposal = loadProposal(projectDir, proposalId);
    const queue = openQueue(projectDir);
    const records = requestApproval(proposal, queue);
    saveProposalApprovals(projectDir, proposalId, records.map((r) => r.approvalId));
    if (json) { process.stdout.write(JSON.stringify({ ok: true, records }, null, 2) + '\n'); return 0; }
    process.stdout.write(`requested approval for ${records.length} effect(s) on ${proposalId}\n`);
    return 0;
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    return 1;
  }
}

function runApproveCmd(args, { projectDir, json }) {
  const proposalId = flag(args, 'proposal');
  const by = flag(args, 'by');
  if (!proposalId || !by) { process.stderr.write('Usage: construct workplace-loop approve --proposal <id> --by <name>\n'); return 1; }
  try {
    const proposal = loadProposal(projectDir, proposalId);
    const queue = openQueue(projectDir);
    const records = recordsForApprovalIds(proposal.approvalIds, queue);
    if (records.length === 0) throw new Error(`no pending approval records for ${proposalId}; run request-approval first`);
    const approved = approveAll(records, queue, { userId: by });
    if (json) { process.stdout.write(JSON.stringify({ ok: true, approved }, null, 2) + '\n'); return 0; }
    process.stdout.write(`approved ${approved.length} effect(s) on ${proposalId}\n`);
    return 0;
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    return 1;
  }
}

async function runApplyCmd(args, { projectDir, json, adapterFactories }) {
  const proposalId = flag(args, 'proposal');
  if (!proposalId) { process.stderr.write('Usage: construct workplace-loop apply --proposal <id>\n'); return 1; }
  try {
    const proposal = loadProposal(projectDir, proposalId);
    const queue = openQueue(projectDir);
    const records = recordsForApprovalIds(proposal.approvalIds, queue);
    if (records.length === 0) throw new Error(`no approval records for ${proposalId}; run request-approval and approve first`);
    const outcomes = await applyProposal(records, queue, { rootDir: projectDir, adapterFactories });
    if (json) { process.stdout.write(JSON.stringify({ ok: true, outcomes }, null, 2) + '\n'); return 0; }
    process.stdout.write(`applied ${outcomes.length} effect(s) on ${proposalId}\n`);
    return 0;
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    return 1;
  }
}

function runVerifyCmd(args, { projectDir, json }) {
  const proposalId = flag(args, 'proposal');
  if (!proposalId) { process.stderr.write('Usage: construct workplace-loop verify --proposal <id>\n'); return 1; }
  try {
    const proposal = loadProposal(projectDir, proposalId);
    const queue = openQueue(projectDir);
    const records = recordsForApprovalIds(proposal.approvalIds, queue);
    const result = verifyProposalExecution(proposal, records, queue);
    if (json) { process.stdout.write(JSON.stringify(result, null, 2) + '\n'); return result.result === 'MATCH' ? 0 : 1; }
    process.stdout.write(`${result.result} (${proposalId})\n`);
    return result.result === 'MATCH' ? 0 : 1;
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    return 1;
  }
}

/**
 * @param {string[]} args
 * @param {{ projectDir: string, providerFactory?: Function, adapterFactories?: object }} ctx
 * @returns {Promise<number>} exit code
 */
export async function runWorkplaceLoopCli(args, { projectDir, providerFactory, adapterFactories } = {}) {
  const sub = args[0] || 'detect';
  const json = args.includes('--json');

  if (sub === 'detect') return runDetectCmd(args, { projectDir, json, providerFactory });
  if (sub === 'request-approval') return runRequestApprovalCmd(args, { projectDir, json });
  if (sub === 'approve') return runApproveCmd(args, { projectDir, json });
  if (sub === 'apply') return runApplyCmd(args, { projectDir, json, adapterFactories });
  if (sub === 'verify') return runVerifyCmd(args, { projectDir, json });
  process.stderr.write(`Unknown workplace-loop subcommand: ${sub}. Available: detect, request-approval, approve, apply, verify\n`);
  return 1;
}
