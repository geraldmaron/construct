/**
 * cli/ask.ts — the spine end to end in one command.
 *
 * Recording a question and then remembering to work it is the ceremony an
 * outcome earns and a question does not. One concern answers, over whatever
 * sources the workspace declared, and the answer is printed here rather than
 * left for `construct show` — a question the user has to go and collect the
 * answer to has not been answered. Nothing about it is a shortcut around the
 * record: the run, the plan, the source reads, the dispatch, the challenge
 * verdict and the spend all land exactly as `outcome` and `work` leave them.
 */

import { recordRunDispatch } from '../kernel/store/dispatch.ts';
import { storeNamingCache } from '../kernel/store/namings.ts';
import { getTask } from '../kernel/store/tasks.ts';
import { startAskNamed } from '../kernel/run/outcome.ts';
import { highRiskNotice, primaryImplication } from '../kernel/run/ask.ts';
import { workRun } from '../kernel/run/coordinator.ts';
import { deliverableConcerns, licensedReviewFor, limitsFor } from '../kernel/run/accountability.ts';
import { latestDraft } from '../kernel/run/promotion.ts';
import { deliverableBody, renderClaim } from '../kernel/run/publish.ts';
import { groundingSummary, groundRun } from '../kernel/run/groundpass.ts';
import { loadOrCreateSecret } from '../kernel/capabilities/secretfile.ts';
import type { HostAdapter } from '../kernel/hosts/interface.ts';
import { escapeForTerminal } from '../kernel/render/terminal.ts';
import { readRepoManifest } from '../hosts/repo/gates.ts';
import { createHostNamer } from '../hosts/namer.ts';
import { adapterForHost, now, secretFile, withStoreAsync } from './runtime.ts';
import type { HostName } from './runtime.ts';
import { parseFlags, timeoutFlag, workspaceFlag } from './flags.ts';
import { failureLine, money } from './present.ts';
import { surveyor } from './survey.ts';
import { planRun } from './outcome.ts';
import { DEFAULT_SPEND_CEILING } from './work.ts';

/** The same lease `work` takes by default; a single dispatch needs no other rule. */
const DEFAULT_LEASE_MINUTES_ASK = 15;

const ASK_USAGE =
  'usage: construct ask [--host=<opencode|claude|codex|cursor> [--model=…] [--binary=…] [--dir=…]] ' +
  '[--workspace=<name>] [--ceiling=<amount>] [--timeout=<minutes>] "<your question>"\n';

export interface AskArgs {
  readonly question: string;
  readonly host?: HostName;
  readonly model?: string;
  readonly binary?: string;
  readonly dir?: string;
  readonly workspace: string;
  readonly ceiling: number;
  /** How long one host invocation may run, in milliseconds. Host default when unset. */
  readonly timeoutMs?: number;
}

export function parseAskArgs(argv: string[]): AskArgs {
  const { flags, rest } = parseFlags(argv);

  const host = flags.host;
  if (host !== undefined && host !== 'opencode' && host !== 'claude' && host !== 'codex' && host !== 'cursor') {
    throw new Error(`unknown host "${host}" (expected opencode, claude, codex, or cursor)`);
  }
  // Same rule as `outcome`: a flag that only means something with a host, given
  // without one, is a usage error rather than a silent no-op.
  const hostFlags = ['model', 'binary', 'dir', 'timeout'].filter((f) => flags[f] !== undefined);
  if (host === undefined && hostFlags.length > 0) {
    throw new Error(
      `--${hostFlags[0]} only applies when a host is named; add --host=<opencode|claude|codex|cursor>, or drop the flag`,
    );
  }

  const timeoutMs = timeoutFlag(flags);

  const ceiling = flags.ceiling === undefined ? DEFAULT_SPEND_CEILING : Number(flags.ceiling);
  if (!Number.isFinite(ceiling) || ceiling < 0) {
    throw new Error(`--ceiling must be a non-negative number, got "${flags.ceiling}"`);
  }

  return {
    question: rest.join(' ').trim(),
    host,
    model: flags.model,
    binary: flags.binary,
    dir: flags.dir,
    workspace: workspaceFlag(flags),
    ceiling,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  };
}

/**
 * Ask the staff a question.
 *
 * The spine end to end in one command, which is the point: recording a question
 * and then remembering to work it is the ceremony an outcome earns and a
 * question does not. One concern answers, over whatever sources the workspace
 * declared, and the answer is printed here rather than left for `construct
 * show` — a question the user has to go and collect the answer to has not been
 * answered.
 *
 * Nothing about it is a shortcut around the record. The run, the plan, the
 * source reads, the dispatch, the challenge verdict and the spend all land in
 * the store exactly as `outcome` and `work` leave them, and the same commands
 * read them back.
 */
export async function ask(argv: string[], hostOverride?: HostAdapter): Promise<number> {
  let args: AskArgs;
  try {
    args = parseAskArgs(argv);
  } catch (error) {
    process.stderr.write(`ask: ${(error as Error).message}\n${ASK_USAGE}`);
    return 2;
  }
  if (!args.question) {
    process.stderr.write(ASK_USAGE);
    return 2;
  }

  return withStoreAsync(async (store) => {
    const at = now();
    const runId = `run-${at.replace(/[-:.TZ]/g, '')}`;

    const host =
      args.host === undefined && hostOverride === undefined
        ? null
        : (hostOverride ??
          adapterForHost(args.host, { binary: args.binary, model: args.model, dir: args.dir, timeoutMs: args.timeoutMs }));

    if (host) {
      try {
        await host.init();
      } catch (error) {
        process.stderr.write(
          `ask: host "${host.name}" is not available — ${escapeForTerminal((error as Error).message)}\n`,
        );
        return 1;
      }
    }

    // Who answers is inferred exactly as it is for an outcome: the named host's
    // model reads the question, and the keyword map answers only if it fails or
    // if no host was named. A question with no host is recorded and routed and
    // then has nobody to answer it, which is said rather than pretended past.
    const started = host
      ? await startAskNamed(store, {
          runId,
          outcome: args.question,
          at,
          host: host.name,
          namer: createHostNamer(host),
          cache: storeNamingCache(store, { host: host.name, at }),
        })
      : await startAskNamed(store, { runId, outcome: args.question, at });

    process.stdout.write(`run ${started.runId}\n  question: ${args.question}\n\n`);

    const answering = primaryImplication(started.implicated);
    if (!answering) {
      process.stdout.write(
        host
          ? `no concern in the catalog owns this question — ${host.name} read it and named nothing. ` +
              'That is recorded, not silently dropped.\n'
          : 'no concern in the catalog owns this question, by keyword match. ' +
              'Nothing was inferred and no model was consulted.\n',
      );
      if (!host) {
        process.stdout.write(
          '\nA host model reads the question properly, at cost:\n' +
            `  construct ask --host=<opencode|claude|codex|cursor> ${JSON.stringify(args.question)}\n`,
        );
      }
      planRun(store, started, null, args.workspace, at, []);
      return 0;
    }

    process.stdout.write(`answering: ${answering.domain} — ${escapeForTerminal(answering.concern)}\n`);
    process.stdout.write(
      `  ${started.inferredBy === 'keywords' ? 'signals' : 'reason'}: ${escapeForTerminal(answering.signals.join(' '))}\n`,
    );
    const alsoTouched = started.implicated.filter((i) => i !== answering);
    if (alsoTouched.length > 0) {
      // The concerns a question reached and nobody answered are the reason the
      // full run exists. Naming them is what keeps the cheap surface from
      // reading as the complete one.
      process.stdout.write(
        `\nalso implicated, and not asked: ${alsoTouched.map((i) => i.domain).join(', ')}\n` +
          '  A question is answered by one concern. To have them all answered:\n' +
          `  construct outcome ${JSON.stringify(args.question)}\n`,
      );
    }
    if (started.namerFailure !== undefined) {
      process.stdout.write(
        `\nThe model could not be consulted (${escapeForTerminal(started.namerFailure)}); the keyword map answered instead.\n`,
      );
    }
    const notice = highRiskNotice(answering.domain, licensedReviewFor(answering.domain));
    if (notice) process.stdout.write(`\n${notice}\n`);

    planRun(store, started, null, args.workspace, at, [answering]);

    if (!host) {
      process.stdout.write(
        '\nNobody was dispatched: answering costs a model call, and no host was named.\n' +
          `  construct ask --host=<opencode|claude|codex|cursor> ${JSON.stringify(args.question)}\n`,
      );
      return 0;
    }

    recordRunDispatch(store, {
      run: started.runId,
      host: args.host ?? host.name,
      model: args.model,
      binary: args.binary,
      dir: args.dir,
      recordedAt: at,
    });

    // The same grounding pass `work` runs, on this one run: what the declared
    // sources actually hold, surveyed and recorded before the dispatch that
    // will cite them.
    const pass = groundRun(store, started.runId, now(), surveyor(store));
    if (pass) {
      if (!pass.skipped) process.stdout.write(`\ngrounded: ${groundingSummary(pass)}\n`);
    } else {
      // An answer with no declared sources rests on the model's own knowledge,
      // and the reader has to know that before they read it.
      process.stdout.write(
        '\nno sources declared for this workspace, so the answer rests on what the ' +
          'model knows rather than on your material.\n' +
          '  construct source add --kind=<kind> --locator=<where>\n',
      );
    }

    const report = await workRun(store, host, {
      owner: `cli-${String(process.pid)}`,
      clock: now,
      spendCeiling: args.ceiling,
      concurrency: 1,
      leaseMs: DEFAULT_LEASE_MINUTES_ASK * 60 * 1000,
      run: started.runId,
      capabilitySecret: loadOrCreateSecret(secretFile()),
      // What the declared ground already checks about itself, so a lens's
      // obligation can name the repository's own gate instead of only the
      // standard behind it.
      manifests: readRepoManifest,
    });

    const task = report.settled.map((id) => getTask(store, id)).find((t) => t !== null);
    if (!task || task.state !== 'done') {
      process.stderr.write(
        `\nno answer: ${task ? escapeForTerminal(failureLine(task.error)) : 'the dispatch produced nothing'}\n`,
      );
      return 1;
    }

    const draft = latestDraft(store, task.id)?.deliverable ?? task.result;
    const answer = escapeForTerminal(renderClaim(deliverableBody(draft)));
    process.stdout.write(`\n${answer.trimEnd()}\n`);

    const cost = task.spendReported ? `$${money(task.spend)}` : 'cost not reported';
    process.stdout.write(`\n— Construct, framed through ${task.role}, ${cost}\n`);
    // The deliverable's own defects, printed with it rather than left in the
    // log: an answer read without them is an answer read as better than it is.
    for (const concern of deliverableConcerns(task.result)) {
      process.stdout.write(`⚑ ${escapeForTerminal(concern.detail)}\n`);
    }
    for (const limit of limitsFor(store, started.runId, task.id)) {
      process.stdout.write(`⚑ ${escapeForTerminal(limit.label)}\n`);
    }
    if (report.degraded > 0) {
      process.stdout.write(
        '⚑ this ran below the model capability floor its brief declared — see: construct log\n',
      );
    }
    process.stdout.write(`Read back: construct log --run ${started.runId}\n`);
    return 0;
  });
}
