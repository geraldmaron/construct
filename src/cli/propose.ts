/**
 * cli/propose.ts — turning findings into changes somebody can decide on.
 *
 * The deliverables ended at the reader: a document with numbered issues is a
 * list of changes somebody now retypes into whatever tracker the work lives
 * in, and the retyping is where the citation is lost. Extraction is
 * mechanical, costs no model call, and is re-runnable. Filing a proposal
 * never writes outward by itself: a proposal is a row to be decided on.
 *
 * `triage` is the one subcommand where a row's fate can be settled the
 * moment it is filed rather than left for a person to open later: its dedupe
 * findings are low risk by construction (kernel/run/triage.ts), so where a
 * workspace already holds standing write consent and a host is given, they
 * are carried out immediately — through the same applyProposal seam
 * decide.ts uses for a human's own approvals, never a second path. A create
 * or update proposal is never carried out from here: applyProposal itself
 * refuses one without a person's decision, standing consent or no.
 */

import { readFileSync } from 'node:fs';
import type { Store } from '../kernel/store/open.ts';
import {
  DOC_EDIT_KINDS,
  getProposal,
  getSource,
  pendingProposals,
  proposeDocEdit,
  proposeWrite,
  sourcesFor,
  writeConsentAllowsLowRisk,
} from '../kernel/store/sources.ts';
import type { DocEditKind, Source, WriteProposal } from '../kernel/store/sources.ts';
import { listTasks } from '../kernel/store/tasks.ts';
import { planFor } from '../kernel/store/plans.ts';
import {
  claimsDeliverable,
  docEditProposal,
  proposalsFrom,
  proposeActionsWithModel,
  resolveFindingCitation,
  WRITE_ACTIONS,
} from '../kernel/run/proposals.ts';
import type { Deliverable, WriteAction, WriteActionProposer } from '../kernel/run/proposals.ts';
import { createHostActionProposer } from '../hosts/writeaction.ts';
import { auditProposals, evaluateGates, renderAuditDeliverable } from '../kernel/run/repoaudit.ts';
import { triageProposals } from '../kernel/run/triage.ts';
import type { TrackerIssue } from '../kernel/run/triage.ts';
import { applyProposal } from '../kernel/run/apply.ts';
import type { ProposalApplier } from '../kernel/run/apply.ts';
import { latestDraft } from '../kernel/run/promotion.ts';
import { deliverableBody } from '../kernel/run/publish.ts';
import { escapeForTerminal } from '../kernel/render/terminal.ts';
import { gatherRepoFacts } from '../hosts/repo/audit.ts';
import { createHostApplier } from '../hosts/contextloop.ts';
import { hasCapability } from '../kernel/hosts/interface.ts';
import type { HostAdapter } from '../kernel/hosts/interface.ts';
import { adapterForHost, now, withStore, withStoreAsync } from './runtime.ts';
import { parseFlags, parseHostFlags, splitFlags, workspaceFlag } from './flags.ts';
import type { HostFlags } from './flags.ts';
import { writeProposalRow } from './present.ts';

const PROPOSE_USAGE =
  'usage: construct propose --run=<id> --source=<source-id> [--task=<id>] [--workspace=<name>] [--dry-run]\n' +
  `         [--action=<row-id>:<${WRITE_ACTIONS.join('|')}>] [--host=<opencode|claude|codex|cursor>]\n` +
  '       construct propose doc --source=<source-id> --document=<path in that source>\n' +
  '         --kind=redline|insertion|authored --because=<what grounds it>\n' +
  '         [--was=<words it replaces>|--was-file=<path>]   (redline)\n' +
  '         [--at=<where it goes>|--at-file=<path>]         (insertion)\n' +
  '         [--now=<words that stand there>|--now-file=<path>]\n' +
  '         [--run=<id>] [--workspace=<name>] [--dry-run]\n' +
  '         (a flag value is one line; words spanning more than one go in a file)\n' +
  '       construct propose triage --source=<source-id> --live=<file of that tracker\'s current issues>\n' +
  '         [--workspace=<name>] [--dry-run] [--host=<opencode|claude>]\n' +
  '         (labels and comments carry out under standing consent when a host is given; ' +
  'creates and updates always wait for a person)\n' +
  '       construct propose list [--workspace=<name>]\n';

/**
 * The declared, still-active source a change would be made against, or the
 * exit code that says why there is none.
 *
 * Which source is never inferred, even where a workspace declares exactly one:
 * the id is the difference between a proposal a person can decide on and a
 * change aimed at a system nobody named.
 */
function targetSource(
  store: Store,
  workspace: string,
  sourceId: string,
  // Two verbs share this resolver, and an error is only actionable if it names
  // the command the reader actually typed.
  command: 'propose' | 'audit',
): Source | number {
  if (sourceId === '' || sourceId === 'true') {
    process.stderr.write(`${command}: name the source these changes would be made against.\n`);
    const declared = sourcesFor(store, workspace);
    for (const source of declared) {
      process.stderr.write(`  --source=${source.id}  (${source.kind} ${source.locator})\n`);
    }
    if (declared.length === 0) {
      process.stderr.write(
        `  workspace ${workspace} has declared none: construct source add --kind=<kind> --locator=<where>\n`,
      );
    }
    return 2;
  }
  const target = getSource(store, sourceId);
  if (!target || target.workspace !== workspace) {
    process.stderr.write(
      `propose: workspace ${workspace} declares no source ${sourceId}.\n` +
        '  construct source list --workspace=' + workspace + '\n',
    );
    return 1;
  }
  if (target.retiredAt) {
    // A retired source stays inspectable because past provenance points at it.
    // Proposing a change into one would aim at a system this workspace has
    // said it no longer works from.
    process.stderr.write(
      `propose: ${sourceId} was retired at ${target.retiredAt}; it is not somewhere to send changes.\n`,
    );
    return 1;
  }
  return target;
}

/** A run's finished deliverables, optionally narrowed to one task. */
function finishedDeliverables(store: Store, run: string, only: string): Deliverable[] {
  return listTasks(store, run)
    .filter((task) => task.state === 'done')
    .filter((task) => only === '' || only === 'true' || task.id === only)
    .map((task) => ({
      task: task.id,
      role: task.role,
      text: deliverableBody(latestDraft(store, task.id)?.deliverable ?? task.result),
    }))
    .filter((deliverable) => deliverable.text.trim() !== '');
}

/**
 * One side of a change, given inline or read from a file.
 *
 * Both ways in exist because a redline's halves are the words of a document
 * and a document's words do not fit on a command line. Naming both at once is
 * a usage error rather than a silent preference for one: a person who wrote
 * the change twice does not know which copy is about to be proposed.
 */
function changeSide(
  flags: Record<string, string>,
  name: string,
): { text: string } | { error: string } {
  const inline = flags[name];
  const file = flags[`${name}-file`];
  if (inline !== undefined && file !== undefined) {
    return { error: `--${name} and --${name}-file both name those words; give one of them` };
  }
  if (file !== undefined) {
    if (file.trim() === '') return { error: `--${name}-file names no file` };
    try {
      return { text: readFileSync(file, 'utf8') };
    } catch (error) {
      return { error: `cannot read --${name}-file ${file}: ${(error as Error).message}` };
    }
  }
  return { text: inline ?? '' };
}

/** Whether either form of a side was given at all, empty or not. */
function gaveSide(flags: Record<string, string>, name: string): boolean {
  return flags[name] !== undefined || flags[`${name}-file`] !== undefined;
}

/**
 * Propose one change to a document: a redline of words already there, an
 * insertion beside them, or a document authored into the source.
 *
 * The same record, the same two tiers and the same gate as a change to a
 * ticket, because it is the same act — words landing in a system this tool
 * does not own. Both document tiers come out high: a redline's struck words
 * are not on the page afterwards for a reader to put back, and a documents
 * source is what runs read as organizational context, so a workspace's
 * standing yes to low-risk changes must never be what publishes prose into
 * one. Nothing here writes outward and nothing here can; carrying the change
 * out is a separate recorded act on the decide surface.
 */
function proposeDoc(flags: Record<string, string>): number {
  const kind = (flags.kind ?? '').trim();
  if (!(DOC_EDIT_KINDS as readonly string[]).includes(kind)) {
    process.stderr.write(
      `propose: --kind must be one of ${DOC_EDIT_KINDS.join(', ')}` +
        (kind === '' ? '' : `, not "${kind}"`) +
        `\n${PROPOSE_USAGE}`,
    );
    return 2;
  }
  // Each kind has its own word for its anchor, because they are not the same
  // thing: --was quotes words that will be gone, --at names a place where
  // nothing is displaced. Accepting either word for either kind would let a
  // redline be filed as an insertion, which is the one distinction the person
  // deciding is reading the row for.
  if (kind === 'redline' && gaveSide(flags, 'at')) {
    process.stderr.write('propose: a redline names the words it replaces with --was, not --at.\n');
    return 2;
  }
  if (kind === 'insertion' && gaveSide(flags, 'was')) {
    process.stderr.write('propose: an insertion names where it goes with --at, not --was.\n');
    return 2;
  }
  const sides = { was: changeSide(flags, 'was'), at: changeSide(flags, 'at'), now: changeSide(flags, 'now') };
  for (const side of Object.values(sides)) {
    if ('error' in side) {
      process.stderr.write(`propose: ${side.error}\n`);
      return 2;
    }
  }
  const anchor = gaveSide(flags, 'was')
    ? (sides.was as { text: string }).text
    : gaveSide(flags, 'at')
      ? (sides.at as { text: string }).text
      : '';

  // The shape refusals are pure, so they run before the store is opened: a
  // change refused for saying too little is refused identically on a machine
  // whose store cannot open at all.
  const shape = docEditProposal({
    kind: kind as DocEditKind,
    source: 'unresolved',
    locator: 'unresolved',
    document: (flags.document ?? '').trim(),
    anchor,
    proposed: (sides.now as { text: string }).text,
    citation: (flags.because ?? '').trim(),
  });
  if (shape.refused !== undefined) {
    process.stderr.write(`propose: nothing was filed — ${shape.refused}\n`);
    return 1;
  }

  return withStore((store) => {
    const asked = (flags.run ?? '').trim();
    const run = asked === '' || asked === 'true' ? '' : asked;
    const recorded = run === '' ? null : planFor(store, run);
    if (run !== '' && !recorded) {
      process.stderr.write(`propose: no plan recorded for ${run}\n`);
      return 1;
    }
    const workspace = flags.workspace?.trim() || recorded?.workspace || workspaceFlag(flags);
    const target = targetSource(store, workspace, (flags.source ?? '').trim(), 'propose');
    if (typeof target === 'number') return target;

    const built = docEditProposal({
      kind: kind as DocEditKind,
      source: target.id,
      locator: target.locator,
      document: (flags.document ?? '').trim(),
      anchor,
      proposed: (sides.now as { text: string }).text,
      citation: (flags.because ?? '').trim(),
    });
    if (built.refused !== undefined) {
      process.stderr.write(`propose: nothing was filed — ${built.refused}\n`);
      return 1;
    }
    const proposal = built.proposal;

    // A citation that claims a line of a deliverable has to resolve to one.
    // The words of a redline are not in the deliverable — a finding says what
    // is wrong, not what the document should say instead — so what is checked
    // is that the cited line exists, which is the same check extraction makes
    // and the reason a proposal can be read back to its origin at all.
    if (claimsDeliverable(proposal.justification)) {
      if (run === '') {
        process.stderr.write(
          `propose: ${proposal.justification} cites a deliverable, so name the run it belongs to:\n` +
            '  --run=<id>\n',
        );
        return 1;
      }
      const grounded = finishedDeliverables(store, run, '').some(
        (deliverable) => resolveFindingCitation(deliverable, proposal.justification) !== null,
      );
      if (!grounded) {
        process.stderr.write(
          `propose: ${proposal.justification} resolves to no line of any finished deliverable in ${run}.\n`,
        );
        return 1;
      }
    }

    const at = now();
    const row: WriteProposal = {
      id: proposal.id,
      workspace,
      run: run === '' ? null : run,
      source: proposal.source,
      change: proposal.change,
      justification: proposal.justification,
      risk: proposal.risk,
      proposedAt: at,
    };
    // Shown through the queue's own renderer before it is filed, so what a
    // person reads here is exactly what they will read when they decide it.
    process.stdout.write(
      `against ${target.kind} ${target.locator}, as the queue will show it:\n\n`,
    );
    writeProposalRow(store, row, writeConsentAllowsLowRisk(store, workspace));

    if (flags['dry-run'] !== undefined) {
      process.stdout.write('\nnothing was filed: --dry-run shows what would be proposed.\n');
      return 0;
    }
    if (getProposal(store, proposal.id) !== null) {
      process.stdout.write('\nalready proposed; the earlier row stands.\n');
      return 0;
    }
    try {
      proposeDocEdit(store, row, {
        kind: proposal.kind,
        document: proposal.document,
        anchor: proposal.anchor,
        proposed: proposal.proposed,
        recordedAt: at,
      });
    } catch (error) {
      process.stderr.write(`propose: ${(error as Error).message}\n`);
      return 1;
    }
    process.stdout.write(
      `\nfiled ${proposal.id} at ${proposal.risk} risk.\n` +
        'Nothing was written to that document, and nothing here can be: the change moves only\n' +
        'through a recorded decision, and a high-risk one only through a person.\n' +
        `  construct propose list --workspace=${workspace}\n` +
        `  construct decide --approve=${proposal.id} "<why>"\n`,
    );
    return 0;
  });
}

/**
 * One tracker's current issues, read from a file the caller supplies — the
 * same reason cli/reconcile.ts's --live works this way: Construct holds no
 * tracker connectors, so it never fetches a live issue on its own.
 */
function readTrackerIssues(file: string): readonly TrackerIssue[] | string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    return `cannot read tracker issues from ${file}: ${(error as Error).message}`;
  }
  if (!Array.isArray(parsed)) return `${file} must hold a JSON array of tracker issues`;
  const issues: TrackerIssue[] = [];
  for (let index = 0; index < parsed.length; index += 1) {
    const entry = parsed[index] as { id?: unknown; title?: unknown } | null;
    if (typeof entry?.id !== 'string' || entry.id.trim() === '') {
      return `${file}: entry ${String(index)} names no string "id"`;
    }
    if (typeof entry.title !== 'string' || entry.title.trim() === '') {
      return `${file}: entry ${String(index)} (${entry.id}) names no string "title"`;
    }
    issues.push({ id: entry.id, title: entry.title });
  }
  return issues;
}

/**
 * Dedupe a tracker source's current issues into write proposals, and — when
 * a host is given — carry the low-risk ones straight out under the
 * workspace's standing consent. A create or update proposal is never
 * attempted here: applyProposal refuses one before it reaches the host
 * unless a person already approved it, so a high-risk row from this pass
 * stays queued exactly as a high-risk row from any other proposer does.
 */
async function proposeTriage(flags: Record<string, string>, hostOverride?: HostAdapter): Promise<number> {
  const liveFile = (flags.live ?? '').trim();
  if (liveFile === '' || liveFile === 'true') {
    process.stderr.write(`propose: triage reads a tracker's current issues from a file.\n${PROPOSE_USAGE}`);
    return 2;
  }
  const issues = readTrackerIssues(liveFile);
  if (typeof issues === 'string') {
    process.stderr.write(`propose: ${issues}\n`);
    return 1;
  }

  let hostFlags: HostFlags;
  try {
    hostFlags = parseHostFlags(flags);
  } catch (error) {
    process.stderr.write(`propose: ${(error as Error).message}\n${PROPOSE_USAGE}`);
    return 2;
  }

  return withStoreAsync(async (store) => {
    const workspace = workspaceFlag(flags);
    const target = targetSource(store, workspace, (flags.source ?? '').trim(), 'propose');
    if (typeof target === 'number') return target;

    const { proposals, matches } = triageProposals({ source: target.id, locator: target.locator, issues });
    process.stdout.write(
      `${String(matches.length)} likely duplicate(s) among ${String(issues.length)} issue(s) read from ` +
        `${target.kind} ${target.locator}:\n`,
    );
    if (matches.length === 0) {
      process.stdout.write('nothing to propose.\n');
      return 0;
    }

    let applier: ProposalApplier | undefined;
    if (flags['dry-run'] === undefined && (hostOverride !== undefined || hostFlags.host !== undefined)) {
      const adapter =
        hostOverride ??
        adapterForHost(hostFlags.host, {
          binary: hostFlags.binary,
          model: hostFlags.model,
          dir: hostFlags.dir,
          timeoutMs: hostFlags.timeoutMs,
        });
      // Asked before a model call is spent, matching decide.ts's own apply
      // path: a read-only dispatch posture cannot carry a change out however
      // it is asked, so triage still files proposals but never attempts one.
      if (!hasCapability(adapter, 'outward-write')) {
        process.stderr.write(
          `propose: host "${adapter.name}" dispatches read-only, so it cannot carry a change out; ` +
            'proposals below will still be filed, none will be applied.\n',
        );
      } else {
        try {
          await adapter.init();
        } catch (error) {
          process.stderr.write(
            `propose: host "${adapter.name}" is not available — ${escapeForTerminal((error as Error).message)}\n`,
          );
          return 1;
        }
        applier = createHostApplier(adapter, (id) => {
          const declared = getSource(store, id);
          return { kind: declared?.kind ?? '', locator: declared?.locator ?? 'an undeclared source' };
        });
      }
    }

    const at = now();
    let filed = 0;
    let already = 0;
    const risks = { low: 0, high: 0 };
    let applied = 0;
    let queued = 0;
    for (const proposal of proposals) {
      process.stdout.write(
        `  ${proposal.id}  [${proposal.risk}, ${proposal.action}]  ${escapeForTerminal(proposal.change)}\n` +
          `      because: ${escapeForTerminal(proposal.justification)}\n`,
      );
      if (flags['dry-run'] !== undefined) continue;
      if (getProposal(store, proposal.id) === null) {
        proposeWrite(store, {
          id: proposal.id,
          workspace,
          run: null,
          source: proposal.source,
          change: proposal.change,
          justification: proposal.justification,
          risk: proposal.risk,
          proposedAt: at,
        });
        filed += 1;
        risks[proposal.risk] += 1;
      } else {
        already += 1;
      }
      if (applier !== undefined) {
        const outcome = await applyProposal(store, applier, proposal.id, at);
        if (outcome.outcome === 'applied') {
          applied += 1;
          process.stdout.write(`      applied under standing consent: ${escapeForTerminal(outcome.detail)}\n`);
        } else {
          queued += 1;
          process.stdout.write(`      queued (${outcome.outcome}): ${escapeForTerminal(outcome.reason)}\n`);
        }
      }
    }

    if (flags['dry-run'] !== undefined) {
      process.stdout.write('\nnothing was filed: --dry-run shows what triage would propose.\n');
      return 0;
    }
    process.stdout.write(
      `\nfiled ${String(filed)} proposal(s) against ${target.kind} ${target.locator}` +
        ` (${String(risks.low)} low, ${String(risks.high)} high)` +
        (already > 0 ? `, ${String(already)} already proposed` : '') +
        (applier !== undefined
          ? `; ${String(applied)} applied under standing consent, ${String(queued)} left queued for a decision`
          : '') +
        '.\n' +
        (applier === undefined
          ? '  no host carried anything out — construct decide --apply=<id> --host=<opencode|claude>\n'
          : '') +
        `  construct propose list --workspace=${workspace}\n`,
    );
    return 0;
  });
}

/**
 * Turn the findings in a run's finished deliverables into write proposals, and
 * show the ones already waiting.
 *
 * The deliverables ended at the reader: a document with numbered issues and a
 * what-follows section is a list of changes somebody now retypes into whatever
 * tracker the work lives in, and the retyping is where the citation is lost —
 * the sentence arrives in the tracker with nobody able to say which finding it
 * came from. Extraction is mechanical, costs no model call, and is re-runnable:
 * ids are derived from the deliverable and the line, so proposing twice
 * proposes the same rows and the second pass says which were already filed.
 *
 * Nothing is written outward here and nothing here can write outward. A
 * proposal is a row to be decided on; carrying one out is a recorded decision
 * on a different surface, and low-risk standing consent is the workspace's own
 * declaration rather than anything this command may assume.
 */
export async function propose(argv: string[], hostOverride?: HostAdapter): Promise<number> {
  const { flags, words } = splitFlags(argv);

  if (words[0] === 'list') {
    return withStore((store) => {
      const workspace = workspaceFlag(flags);
      const pending = pendingProposals(store, workspace);
      if (pending.length === 0) {
        process.stdout.write(`no proposals waiting for workspace ${workspace}.\n`);
        return 0;
      }
      const standing = writeConsentAllowsLowRisk(store, workspace);
      process.stdout.write(`proposals waiting in workspace ${workspace} (${String(pending.length)}):\n\n`);
      for (const proposal of pending) writeProposalRow(store, proposal, standing);
      process.stdout.write(
        '\nNothing here has been carried out. A proposal moves only through a recorded decision:\n' +
          '  construct decide --approve=<id> "<why>"   (or --reject)\n',
      );
      return 0;
    });
  }

  if (words[0] === 'doc') return proposeDoc(flags);

  if (words[0] === 'triage') return proposeTriage(flags, hostOverride);

  if (words.length > 0) {
    process.stderr.write(`propose: unknown subcommand "${words[0]}"\n${PROPOSE_USAGE}`);
    return 2;
  }

  const run = (flags.run ?? '').trim();
  if (run === '' || run === 'true') {
    process.stderr.write(PROPOSE_USAGE);
    return 2;
  }

  // A row's action named outright, ahead of anything else deciding it — the
  // same "an explicit choice is resolved before either guess runs" rule
  // --shape gets against compose's shape chooser. Parsed before the store
  // opens so a malformed flag is a usage error, not a run half-read. Split on
  // the LAST colon, not the first: a row id embeds its task id, and a task id
  // is itself `<run>:<role>`, so only the rightmost colon is ever the one
  // this flag added.
  const actionFlag = (flags.action ?? '').trim();
  let actionOverrides: ReadonlyMap<string, WriteAction> | undefined;
  if (actionFlag !== '' && actionFlag !== 'true') {
    const sep = actionFlag.lastIndexOf(':');
    const rowId = sep === -1 ? '' : actionFlag.slice(0, sep).trim();
    const named = sep === -1 ? '' : actionFlag.slice(sep + 1).trim();
    if (rowId === '' || !(WRITE_ACTIONS as readonly string[]).includes(named)) {
      process.stderr.write(
        `propose: --action must be "<row-id>:<action>" with action one of ${WRITE_ACTIONS.join(', ')}, got "${actionFlag}"\n`,
      );
      return 2;
    }
    actionOverrides = new Map([[rowId, named as WriteAction]]);
  }

  let hostFlags: HostFlags;
  try {
    hostFlags = parseHostFlags(flags);
  } catch (error) {
    process.stderr.write(`propose: ${(error as Error).message}\n${PROPOSE_USAGE}`);
    return 2;
  }

  return withStoreAsync(async (store) => {
    const recorded = planFor(store, run);
    if (!recorded) {
      process.stderr.write(`propose: no plan recorded for ${run}\n`);
      return 1;
    }
    const workspace = flags.workspace?.trim() || recorded.workspace;

    const sourceId = (flags.source ?? '').trim();
    const target = targetSource(store, workspace, sourceId, 'propose');
    if (typeof target === 'number') return target;

    const only = (flags.task ?? '').trim();
    const deliverables: Deliverable[] = finishedDeliverables(store, run, only);

    if (deliverables.length === 0) {
      process.stderr.write(
        `propose: ${run} has no finished deliverable to read` +
          (only === '' || only === 'true' ? '' : ` for task ${only}`) +
          '.\n  construct show --run ' + run + '\n',
      );
      return 1;
    }

    // A host named is a host already being paid for, so a row the caller has
    // not already decided is put to the model rather than left to the
    // keyword read alone — the same duality compose already carries between
    // its keyword shape guess and createHostShapeChooser.
    let proposer: WriteActionProposer | undefined;
    if (hostFlags.host !== undefined || hostOverride !== undefined) {
      const host =
        hostOverride ??
        adapterForHost(hostFlags.host, {
          binary: hostFlags.binary,
          model: hostFlags.model,
          dir: hostFlags.dir,
          timeoutMs: hostFlags.timeoutMs,
        });
      try {
        await host.init();
      } catch (error) {
        process.stderr.write(`propose: host "${host.name}" is not available — ${escapeForTerminal((error as Error).message)}\n`);
        return 1;
      }
      proposer = createHostActionProposer(host);
    }

    const at = now();
    let filed = 0;
    let already = 0;
    const risks = { low: 0, high: 0 };
    for (const deliverable of deliverables) {
      const modelActions = proposer
        ? await proposeActionsWithModel(deliverable, proposer, actionOverrides)
        : undefined;
      const extraction = proposalsFrom({
        deliverable,
        source: sourceId,
        locator: target.locator,
        actionOverrides,
        modelActions,
      });
      process.stdout.write(
        `\n${deliverable.role} (${deliverable.task}): ` +
          `${String(extraction.proposals.length)} finding(s) that could be proposed\n`,
      );
      for (const drop of extraction.refused) {
        process.stdout.write(`  refused: "${escapeForTerminal(drop.text.slice(0, 60))}" — ${escapeForTerminal(drop.reason)}\n`);
      }
      for (const proposal of extraction.proposals) {
        // Silence here would let a model's guess, or a caller's override,
        // read as the same mechanical default the keyword path is — the
        // "never silently" rule the shape chooser's own disclosure follows.
        const disclosure =
          proposal.actionSource === 'model' ? ' (model-proposed)' :
          proposal.actionSource === 'override' ? ' (overridden)' : '';
        process.stdout.write(
          `  ${proposal.id}  [${proposal.risk}, ${proposal.action}${disclosure}]  ${escapeForTerminal(proposal.change)}\n` +
            `      because: ${escapeForTerminal(proposal.justification)}\n`,
        );
        if (flags['dry-run'] !== undefined) continue;
        if (getProposal(store, proposal.id) !== null) {
          process.stdout.write('      already proposed; the earlier row stands\n');
          already += 1;
          continue;
        }
        proposeWrite(store, {
          id: proposal.id,
          workspace,
          run,
          source: proposal.source,
          change: proposal.change,
          justification: proposal.justification,
          risk: proposal.risk,
          proposedAt: at,
        });
        filed += 1;
        risks[proposal.risk] += 1;
      }
    }

    if (flags['dry-run'] !== undefined) {
      process.stdout.write('\nnothing was filed: --dry-run shows what extraction would propose.\n');
      return 0;
    }
    process.stdout.write(
      `\nfiled ${String(filed)} proposal(s) against ${target.kind} ${target.locator}` +
        ` (${String(risks.low)} low, ${String(risks.high)} high)` +
        (already > 0 ? `, ${String(already)} already proposed` : '') +
        '.\nNothing was written anywhere outside this system, and nothing here can be: a proposal\n' +
        'moves only through a recorded decision, and a high-risk one only through a human.\n' +
        `  construct propose list --workspace=${workspace}\n`,
    );
    return 0;
  });
}

/**
 * Audit a declared source's own files against the enablement gates
 * (accessibility tests, security tests, CI, lint strictness, typecheck), and
 * file a write proposal for every gate this pass found missing.
 *
 * The judgment is kernel/run/repoaudit.ts's, read from facts
 * hosts/repo/audit.ts gathered off the source's own locator. This function is
 * the store-touching glue construct propose already has a shape for: resolve
 * the declared source, run the pure pass over what it reads, and file what it
 * found through proposeWrite, the one door an outward change has. Nothing
 * here writes to the audited repository, and nothing here can — a proposal is
 * a row to be decided on, and carrying one out is a different, separately
 * recorded act.
 */
export function audit(argv: string[]): number {
  const { flags } = parseFlags(argv);
  return withStore((store) => {
    const workspace = workspaceFlag(flags);
    const target = targetSource(store, workspace, (flags.source ?? '').trim(), 'audit');
    if (typeof target === 'number') return target;
    if (target.kind !== 'directory' && target.kind !== 'git') {
      process.stderr.write(
        `audit: ${target.id} is a ${target.kind} source; an enablement audit reads a repository's own ` +
          'files, which only a directory or git source has.\n',
      );
      return 1;
    }

    const facts = gatherRepoFacts(target.locator);
    if (facts.outcome === 'unreachable') {
      process.stderr.write(`audit: ${target.locator} — ${facts.reason}\n`);
      return 1;
    }

    const findings = evaluateGates(facts);
    const proposals = auditProposals({ findings, source: target.id, locator: target.locator });
    process.stdout.write(renderAuditDeliverable({ locator: target.locator, findings, proposals }));
    process.stdout.write('\n');

    if (flags['dry-run'] !== undefined) {
      process.stdout.write('nothing was filed: --dry-run shows what would be proposed.\n');
      return 0;
    }

    const at = now();
    let filed = 0;
    let already = 0;
    const risks = { low: 0, high: 0 };
    for (const proposal of proposals) {
      if (getProposal(store, proposal.id) !== null) {
        already += 1;
        continue;
      }
      proposeWrite(store, {
        id: proposal.id,
        workspace,
        run: null,
        source: proposal.source,
        change: proposal.change,
        justification: proposal.justification,
        risk: proposal.risk,
        proposedAt: at,
      });
      filed += 1;
      risks[proposal.risk] += 1;
    }
    process.stdout.write(
      `filed ${String(filed)} proposal(s) against ${target.kind} ${target.locator}` +
        ` (${String(risks.low)} low, ${String(risks.high)} high)` +
        (already > 0 ? `, ${String(already)} already proposed` : '') +
        '.\nNothing was written to that repository, and nothing here can be: a proposal moves only\n' +
        'through a recorded decision, and a high-risk one only through a human.\n' +
        `  construct propose list --workspace=${workspace}\n`,
    );
    return 0;
  });
}
