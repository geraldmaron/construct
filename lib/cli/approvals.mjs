/**
 * lib/cli/approvals.mjs — `construct approvals` CLI handler.
 *
 * Loads the ApprovalQueue from the appropriate persistence path and
 * implements list / approve / deny / status subcommands.
 */

import { ApprovalQueue } from '../embed/approval-queue.mjs';
import { getDeploymentMode } from '../deployment-mode.mjs';

/**
 * Run the approvals CLI command.
 * @param {string[]} args
 * @param {object} ctx
 * @param {string} ctx.rootDir
 * @param {string} ctx.homeDir
 * @param {object} ctx.env
 * @param {Function} ctx.println
 * @param {Function} ctx.errorln
 * @returns {number} exit code
 */
export async function runApprovalsCli(args, { rootDir, homeDir, env, println, errorln }) {
  const sub = args[0];
  if (!sub || sub === '--help' || sub === '-h') {
    println('Usage: construct approvals <list|approve|deny|status>');
    println('');
    println('Subcommands:');
    println('  list              List pending approvals');
    println('  approve <id>      Approve a pending approval by id');
    println('  deny <id>         Deny a pending approval by id');
    println('  status <id>       Show full status of a specific approval');
    return 0;
  }

  const deploymentMode = getDeploymentMode(env, { cwd: rootDir });
  const persistPath = ApprovalQueue.resolvePersistPath(rootDir, deploymentMode);
  const queue = new ApprovalQueue({ persistPath });

  if (sub === 'list') {
    const pending = queue.getPending();
    if (pending.length === 0) {
      println('No pending approvals.');
      return 0;
    }
    for (const r of pending) {
      const rb = r.requestedBy || {};
      const by = rb.role || rb.userId || rb.serviceId || 'unknown';
      println(`${r.approvalId}`);
      println(`  tool:        ${r.toolCall?.tool || '?'}`);
      println(`  requestedAt: ${r.requestedAt}`);
      println(`  requestedBy: ${by}`);
      println(`  expiresAt:   ${r.expiresAt}`);
      println('');
    }
    return 0;
  }

  if (sub === 'approve') {
    const id = args[1];
    if (!id) {
      errorln('Usage: construct approvals approve <id>');
      return 1;
    }
    try {
      const record = queue.approve(id, {
        decidedBy: {
          role: process.env.CONSTRUCT_ROLE || 'cli-operator',
          userId: process.env.USER || process.env.USERNAME || null,
          source: 'cli',
        },
      });
      println(`Approved: ${record.approvalId} (tool: ${record.toolCall?.tool})`);
      return 0;
    } catch (err) {
      errorln(`Error: ${err.message}`);
      return 1;
    }
  }

  if (sub === 'deny') {
    const id = args[1];
    if (!id) {
      errorln('Usage: construct approvals deny <id> [--reason=...]');
      return 1;
    }
    const reasonFlag = args.find((a) => a.startsWith('--reason='));
    const reason = reasonFlag ? reasonFlag.slice('--reason='.length) : 'denied by operator';
    try {
      const record = queue.deny(id, {
        decidedBy: {
          role: process.env.CONSTRUCT_ROLE || 'cli-operator',
          userId: process.env.USER || process.env.USERNAME || null,
          source: 'cli',
        },
        reason,
      });
      println(`Denied: ${record.approvalId} (reason: ${reason})`);
      return 0;
    } catch (err) {
      errorln(`Error: ${err.message}`);
      return 1;
    }
  }

  if (sub === 'status') {
    const id = args[1];
    if (!id) {
      errorln('Usage: construct approvals status <id>');
      return 1;
    }
    const record = queue.getById(id);
    if (!record) {
      errorln(`Approval not found: ${id}`);
      return 1;
    }
    println(JSON.stringify(record, null, 2));
    return 0;
  }

  errorln(`Unknown approvals subcommand: ${sub}. Available: list, approve, deny, status`);
  return 1;
}