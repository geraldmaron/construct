/**
 * lib/improvement/cli.mjs — CLI handlers for `construct improvement <subcommand>`.
 *
 * Subcommands: submit, review, pending, show, approve, apply, rollback, list.
 * Each command reads or writes durable state under `.construct/improvement/` and routes
 * proposals through the governed controller; apply and rollback record human acts
 * but do not mutate live artifacts.
 */
import fs from 'node:fs';

import {
  applyRecord,
  approveRecord,
  formatReviewSummary,
  listPending,
  resolveKnownApprovers,
  reviewRecord,
  rollbackRecord,
  submitBundle,
} from './surface.mjs';
import { listRecords, loadRecord } from './store.mjs';

function readJsonArg(args, prefix) {
  const hit = args.find((a) => a.startsWith(prefix));
  if (!hit) return null;
  const file = hit.slice(prefix.length);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function flagValue(args, prefix) {
  const hit = args.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : null;
}

function usage() {
  process.stderr.write(
    'Usage: construct improvement <submit|review|pending|show|approve|apply|rollback|list> [--json]\n'
    + '  submit   --bundle=FILE | (--trace=FILE --dataset=FILE --report=FILE [--trigger=KIND])\n'
    + '  review   <id>\n'
    + '  pending\n'
    + '  show     <id>\n'
    + '  approve  <id> [--identity=USER]\n'
    + '  apply    <id> [--monitor=ID]\n'
    + '  rollback <id> [--reason=TEXT]\n'
    + '  list     [--state=STATE]\n',
  );
}

export async function runImprovementCli(args, { projectDir = process.cwd() } = {}) {
  const json = args.includes('--json');
  const sub = args.find((a) => !a.startsWith('-'));
  const positional = args.filter((a) => !a.startsWith('-'));

  if (!sub || sub === '--help' || sub === '-h') {
    usage();
    return sub === '--help' || sub === '-h' ? 0 : 1;
  }

  const write = (payload) => {
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
  };

  switch (sub) {
    case 'submit': {
      const bundle = readJsonArg(args, '--bundle=');
      const trace = bundle?.trace ?? readJsonArg(args, '--trace=');
      const dataset = bundle?.dataset ?? readJsonArg(args, '--dataset=');
      const evaluationReport = bundle?.evaluationReport ?? readJsonArg(args, '--report=');
      const triggerKind = flagValue(args, '--trigger=') || bundle?.trigger?.kind || 'operator-request';
      const trigger = bundle?.trigger || { kind: triggerKind, optIn: true };
      const result = submitBundle({
        projectDir,
        bundle: bundle || {
          trace,
          trigger,
          dataset,
          evaluationReport,
          approver: flagValue(args, '--approver=') || resolveKnownApprovers(projectDir)[0] || null,
        },
      });
      if (json) write(result);
      else if (!result.ok) {
        process.stderr.write(`submit refused: ${result.stage || result.error}\n`);
        if (result.governance?.refusals?.length) {
          process.stderr.write(`  refusals: ${result.governance.refusals.join(', ')}\n`);
        }
        return 1;
      } else {
        process.stdout.write(`submitted ${result.record.id} → ${result.record.proposal.state}\n`);
      }
      return result.ok ? 0 : 1;
    }

    case 'review': {
      const id = positional[1];
      if (!id) { usage(); return 1; }
      const result = reviewRecord(projectDir, id);
      if (!result.ok) {
        process.stderr.write(`review failed: ${result.error}\n`);
        return 1;
      }
      if (json) write(result);
      else process.stdout.write(formatReviewSummary(result.record, result.governance) + '\n');
      return 0;
    }

    case 'pending': {
      const pending = listPending(projectDir);
      if (json) write({ pending });
      else {
        if (!pending.length) process.stdout.write('No proposals awaiting approval.\n');
        for (const row of pending) {
          process.stdout.write(`${row.id} · ${row.proposal?.type} · ${row.proposal?.state}\n`);
        }
      }
      return 0;
    }

    case 'show': {
      const id = positional[1];
      if (!id) { usage(); return 1; }
      const record = loadRecord(projectDir, id);
      if (!record) {
        process.stderr.write(`not found: ${id}\n`);
        return 1;
      }
      if (json) write(record);
      else process.stdout.write(formatReviewSummary(record) + '\n');
      return 0;
    }

    case 'approve': {
      const id = positional[1];
      if (!id) { usage(); return 1; }
      const result = approveRecord(projectDir, id, { identity: flagValue(args, '--identity=') });
      if (!result.ok) {
        process.stderr.write(`approve failed: ${result.error}\n`);
        return 1;
      }
      if (json) write(result);
      else process.stdout.write(`approved ${id} → ${result.record.proposal.state}\n`);
      return 0;
    }

    case 'apply': {
      const id = positional[1];
      if (!id) { usage(); return 1; }
      const result = applyRecord(projectDir, id, { monitor: flagValue(args, '--monitor=') });
      if (!result.ok) {
        process.stderr.write(`apply failed: ${result.error}\n`);
        return 1;
      }
      if (json) write(result);
      else process.stdout.write(`applied ${id} → ${result.record.proposal.state}\n`);
      return 0;
    }

    case 'rollback': {
      const id = positional[1];
      if (!id) { usage(); return 1; }
      const result = rollbackRecord(projectDir, id, { reason: flagValue(args, '--reason=') || 'operator-rollback' });
      if (!result.ok) {
        process.stderr.write(`rollback failed: ${result.error}\n`);
        return 1;
      }
      if (json) write(result);
      else process.stdout.write(`rolled back ${id} → ${result.record.proposal.state}\n`);
      return 0;
    }

    case 'list': {
      const state = flagValue(args, '--state=');
      const rows = listRecords(projectDir, { state });
      if (json) write({ proposals: rows });
      else {
        if (!rows.length) process.stdout.write('No improvement proposals.\n');
        for (const row of rows) {
          process.stdout.write(`${row.id} · ${row.proposal?.type} · ${row.proposal?.state}\n`);
        }
      }
      return 0;
    }

    default:
      process.stderr.write(`Unknown subcommand: ${sub}\n`);
      usage();
      return 1;
  }
}
