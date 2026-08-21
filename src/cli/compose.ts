/**
 * cli/compose.ts — writing one document from the several a run produced.
 *
 * The roles each answered their own concern and each was right to decline the
 * whole, which left composing to the reader — silently, which reads as the
 * system having answered when it has not. This composes, and holds the result
 * to the one discipline that makes composing safe: it may arrange what the
 * roles established and may not add to it.
 */

import { sourcesFor } from '../kernel/store/sources.ts';
import { listTasks } from '../kernel/store/tasks.ts';
import { planFor } from '../kernel/store/plans.ts';
import type { Brief } from '../kernel/brief/schema.ts';
import {
  claimsFrom,
  composeReadiness,
  screenComposition,
  standingLine,
  toComposition,
  unclearedSources,
} from '../kernel/run/compose.ts';
import type { ComposedClaim, SourceDeliverable, SourceStanding } from '../kernel/run/compose.ts';
import { closeGaps } from '../kernel/run/closing.ts';
import type { ClosingRound } from '../kernel/run/closing.ts';
import {
  COMPOSITION_SHAPES,
  shapeByName,
  shapeMatchForOutcome,
  shapeNames,
} from '../kernel/run/shapes.ts';
import type { CompositionShape } from '../kernel/run/shapes.ts';
import {
  collapseObjections,
  positionRepairIsAnImprovement,
  positionShortfalls,
  screenPosition,
  toPosition,
} from '../kernel/run/position.ts';
import type { PositionObjection, ScreenedPosition } from '../kernel/run/position.ts';
import { contestedFacts, contestedLine } from '../kernel/run/contested.ts';
import { latestDraft, promotionOf } from '../kernel/run/promotion.ts';
import {
  deliverableBody,
  renderAttribution,
  renderClaim,
  renderComposedClaim,
  renderHeading,
} from '../kernel/run/publish.ts';
import { groundRootsFor } from '../kernel/run/sourcereads.ts';
import { attributionLine } from '../kernel/voice/voice.ts';
import type { HostAdapter } from '../kernel/hosts/interface.ts';
import { escapeForTerminal } from '../kernel/render/terminal.ts';
import {
  createHostComposer,
  createHostGapCloser,
  createHostObjectionChecker,
  createHostPositionRepairer,
  createHostPositioner,
  createHostShapeChooser,
  createHostSupportChecker,
} from '../hosts/compose.ts';
import { adapterForHost, terminalReport, withStoreAsync } from './runtime.ts';
import { parseHostFlags, splitFlags } from './flags.ts';
import type { HostFlags } from './flags.ts';

const COMPOSE_USAGE =
  'usage: construct compose --run=<id> --host=<opencode|claude|codex|cursor> ' +
  '[--model=…] [--binary=…] [--dir=…] [--timeout=<minutes>] [--no-close] ' +
  `[--shape=<${shapeNames().join('|')}>] [--record]\n`;

/**
 * Write one document from the several a run produced.
 *
 * The roles each answered their own concern and each was right to decline the
 * whole, which left composing to the reader — silently, which reads as the
 * system having answered when it has not. This composes, and holds the result
 * to the one discipline that makes composing safe: it may arrange what the
 * roles established and may not add to it. Every claim names the deliverable
 * it came from, an attribution to a role that produced none is refused here,
 * and each role is then shown its own work beside the claims drawn from it and
 * asked which it does not support.
 */
export async function compose(argv: string[], hostOverride?: HostAdapter): Promise<number> {
  const { flags, words } = splitFlags(argv);
  const run = flags.run ?? words[0];
  if (!run) {
    process.stderr.write(COMPOSE_USAGE);
    return 2;
  }
  let hostFlags: HostFlags;
  try {
    hostFlags = parseHostFlags(flags);
  } catch (error) {
    process.stderr.write(`compose: ${(error as Error).message}\n${COMPOSE_USAGE}`);
    return 2;
  }

  return withStoreAsync(async (store) => {
    const plan = planFor(store, run);
    if (!plan) {
      process.stderr.write(`compose: no plan recorded for ${run}\n`);
      return 1;
    }
    // What shape of document this ask wants back, decided before any model sees
    // the deliverables and overridable outright — an explicit --shape never
    // costs a call, the same rule --domains already gets against the namer.
    // Left unresolved here when no name was given: which document shape an
    // outcome wants is not a fact the wording alone settles reliably, and a
    // model is one call away the moment a host is named for this run, so it
    // is asked rather than guessed once that host exists (below). The keyword
    // guess in run/shapes.ts survives only as the disclosed fallback if the
    // model call itself fails.
    let shape: CompositionShape | undefined;
    if (flags.shape !== undefined) {
      shape = shapeByName(flags.shape);
      if (shape === undefined) {
        process.stderr.write(
          `compose: no shape named "${String(flags.shape)}" — known shapes are ${shapeNames().join(', ')}\n`,
        );
        return 2;
      }
    }

    const done = listTasks(store, run).filter((task) => task.state === 'done');
    const sources: SourceDeliverable[] = done
      .map((task) => ({
        role: task.role,
        text: deliverableBody(latestDraft(store, task.id)?.deliverable ?? task.result),
      }))
      .filter((source) => source.text.trim() !== '');
    // Each role's own brief, so a closing answer can be held to the challenges
    // that role already owed rather than to a set invented for the round.
    const briefs = new Map<string, Brief>(
      done
        .map((task) => [task.role, task.brief as Brief] as const)
        .filter(([, brief]) => brief !== null && typeof brief === 'object'),
    );
    // What each source's own challenges came to. Read here rather than assumed:
    // the states are recorded on every run and were simply never carried to the
    // person reading the document built out of them.
    const standings: SourceStanding[] = done.map((task) => {
      const promotion = promotionOf(store, task.id);
      return {
        role: task.role,
        state: promotion?.state ?? 'unrecorded',
        failing: promotion?.failing ?? [],
        outstanding: promotion?.outstanding ?? [],
        repaired: promotion?.repaired ?? [],
      };
    });

    const readiness = composeReadiness(sources);
    if (!readiness.ready) {
      process.stderr.write(`compose: ${readiness.reason}\n`);
      return 1;
    }

    if (hostFlags.host === undefined && hostOverride === undefined) {
      // No host named: this run stays free, and shape stays unresolved —
      // it is asked of a model once a host exists, never guessed here.
      process.stdout.write(
        `${String(sources.length)} deliverables are ready to compose (${sources.map((s) => s.role).join(', ')}).\n` +
          'Composing them is model work, at cost — one call to arrange, one per role to check\n' +
          'that nothing was added, and one to choose the document shape unless --shape names it:\n' +
          `  construct compose --run=${run} --host=<opencode|claude|codex|cursor>\n`,
      );
      return 0;
    }

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
      process.stderr.write(`compose: host "${host.name}" is not available — ${escapeForTerminal((error as Error).message)}\n`);
      return 1;
    }

    // A host exists and is already being paid for, so which document shape
    // this ask wants is asked rather than guessed. Only the keyword-matched
    // failure path — the host call itself failing, or naming something that
    // is not a real shape — falls back to the guess, and either way the
    // reader is told which one decided, the same disclosure the densifier's
    // "as understood" already gives.
    if (shape === undefined) {
      const chosen = await createHostShapeChooser(host)(plan.outcome, COMPOSITION_SHAPES);
      // chosen is already validated against COMPOSITION_SHAPES by the chooser,
      // so shapeByName cannot actually fail here — the fallback is defensive,
      // not expected to fire.
      const resolved = chosen === null ? undefined : shapeByName(chosen);
      if (resolved !== undefined) {
        shape = resolved;
        process.stdout.write(`shape: ${chosen} (chosen by the model)\n`);
      } else {
        // Which of the two fallbacks this is matters to the reader. A phrase
        // that matched is a guess with something behind it; the default shape
        // is what comes back when nothing matched at all, and it is a real
        // shape name, so printing it alone would read as a choice. Measured on
        // wording the phrase lists were not written against, nothing matches
        // far more often than something does.
        const guess = shapeMatchForOutcome(plan.outcome);
        shape = guess.shape;
        process.stdout.write(
          guess.matched
            ? `shape: ${shape.name} (the model could not be asked; falling back to the keyword guess)\n`
            : `shape: ${shape.name} (the model could not be asked, and no keyword matched either — this is the default, not a reading of your ask; pass --shape to choose)\n`,
        );
      }
    }

    let screened;
    try {
      const reply = await createHostComposer(host)({ outcome: plan.outcome, sources, shape });
      screened = screenComposition(
        toComposition(reply),
        sources,
        shape.sections.map((s) => s.name),
      );
    } catch (error) {
      process.stderr.write(`compose: the deliverables could not be composed (${escapeForTerminal((error as Error).message)}).\n`);
      return 1;
    }
    for (const drop of screened.discarded) {
      process.stdout.write(`  discarded: "${escapeForTerminal(drop.claim.text.slice(0, 60))}" — ${escapeForTerminal(drop.reason)}\n`);
    }

    // Construct's own read, taken before the roles are asked anything, so the
    // same call they get to object to is the one that was formed from their
    // finished work rather than from what survived their objections to it.
    //
    // Fail-soft: a position that could not be produced leaves the arranged
    // document, which is what this command produced before there was one. It
    // must never be able to cost the work it is a judgment about.
    let position: ScreenedPosition | null = null;
    try {
      const read = toPosition(await createHostPositioner(host)({ outcome: plan.outcome, sources }));
      position = read === null ? null : screenPosition(read, sources.map((s) => s.role));
    } catch (error) {
      process.stdout.write(
        `  no position taken (${escapeForTerminal((error as Error).message)}); the arranged document stands alone\n`,
      );
    }
    for (const drop of position?.refused ?? []) {
      process.stdout.write(`  refused from the position: "${escapeForTerminal(drop.text.slice(0, 60))}" — ${escapeForTerminal(drop.reason)}\n`);
    }

    // Each role shown its own deliverable beside the claims drawn from it.
    // Per role rather than per claim: identical coverage, and the cost is
    // bounded by how many concerns the run had rather than by how much the
    // composer wrote.
    const check = createHostSupportChecker(host);
    const unsupported = new Set<ComposedClaim>();
    for (const source of sources) {
      const mine = claimsFrom(screened.claims, source.role);
      if (mine.length === 0) continue;
      let verdict;
      try {
        verdict = await check(source, mine);
      } catch (error) {
        process.stderr.write(
          `compose: ${source.role}'s claims could not be checked (${escapeForTerminal((error as Error).message)}); ` +
            'an unverified composition is not promoted.\n',
        );
        return 1;
      }
      for (const index of verdict.unsupported) {
        const claim = mine[index];
        if (claim) unsupported.add(claim);
      }
      if (verdict.unsupported.length > 0) {
        process.stdout.write(
          `  ${source.role}: ${String(verdict.unsupported.length)} of ${String(mine.length)} claims not supported — ${escapeForTerminal(verdict.detail)}\n`,
        );
      } else if (verdict.detail.length > 0) {
        // A clean verdict still carries something to say when the check ran
        // same-family: the detail field is where createHostSupportChecker
        // puts the correlated-error caveat, and a check nobody printed a
        // qualification for reads as a stronger verdict than it earned.
        process.stdout.write(`  ${source.role}: all claims supported — ${escapeForTerminal(verdict.detail)}\n`);
      }
    }

    // The call put to each role that contributed, in its own call rather than
    // riding the claims check. The claims screen is what lets this document say
    // every line in it was checked, so it is asked with nothing else in the
    // frame; the veto is worth its own call rather than a cheaper coupled one.
    //
    // Fail-soft, unlike the claims check: a role that cannot be reached costs
    // the position its objection, not the run its document.
    const askObjection = createHostObjectionChecker(host);
    let objections: PositionObjection[] = [];
    if (position !== null) {
      for (const source of sources) {
        try {
          const quote = await askObjection(source, position.position.approach);
          if (quote.length > 0) objections.push({ role: source.role, quote });
        } catch (error) {
          process.stdout.write(
            `  ${source.role} could not be asked about the call (${escapeForTerminal((error as Error).message)}); ` +
              'it stands unobjected-to by that role\n',
          );
        }
      }
    }

    // The call goes back to itself once, with what the roles said about it.
    // A deliverable that fails its checks is sent back to its author, and an
    // objection of this kind is more specific than any of those checks: a role
    // has quoted the sentence and said it states work that role did not do.
    // Reporting that leaves the reader holding a call plus a correction to
    // apply themselves.
    //
    // One round, and only taken if it is an improvement — the repair round's
    // rule, because an instruction not to lose ground is not a mechanism.
    let callWasRepaired = false;
    let callWentBack = false;
    if (position !== null && objections.length > 0) {
      const before = position;
      try {
        const second = toPosition(
          await createHostPositionRepairer(host)({
            outcome: plan.outcome,
            sources,
            position: before.position,
            objections: collapseObjections(objections),
          }),
        );
        if (second !== null) {
          const rescreened = screenPosition(second, sources.map((s) => s.role));
          // Only the roles that objected are asked again. A role that had
          // nothing to say about the first call is not owed a second reading of
          // a document edited to answer somebody else, and the claims drawn
          // from it did not change.
          const recheck = createHostObjectionChecker(host);
          const remaining: PositionObjection[] = [];
          for (const role of new Set(objections.map((o) => o.role))) {
            const source = sources.find((s) => s.role === role);
            if (source === undefined) continue;
            const quote = await recheck(source, rescreened.position.approach, true);
            if (quote.length > 0) remaining.push({ role, quote });
          }
          callWentBack = true;
          const better = positionRepairIsAnImprovement(
            { objections, refused: before.refused },
            { objections: remaining, refused: rescreened.refused },
          );
          if (better) {
            position = rescreened;
            objections = remaining;
            callWasRepaired = true;
            for (const drop of rescreened.refused) {
              process.stdout.write(
                `  refused from the repaired position: "${escapeForTerminal(drop.text.slice(0, 60))}" — ${escapeForTerminal(drop.reason)}\n`,
              );
            }
          } else {
            process.stdout.write(
              '  the repaired call was refused: it did not drop an objection without ' +
                'introducing another or losing an attribution; the first call stands\n',
            );
          }
        }
      } catch (error) {
        process.stdout.write(
          `  the call could not be sent back (${escapeForTerminal((error as Error).message)}); it stands with its objections\n`,
        );
      }
    }

    const kept = screened.claims.filter((claim) => !unsupported.has(claim));
    // The record keeps the markers and the slugs the gates read; a reader gets
    // sentences. --record asks for the stored form, for anything downstream
    // that needs to check the text rather than read it.
    const asRecord = flags.record !== undefined;
    process.stdout.write(`\n# ${plan.outcome}\n`);
    // Who framed this, in whose name, before anything they framed. A document
    // that names its concerns only claim by claim leaves the reader to work out
    // at the end who was in the room, and a reader who does not know that
    // cannot weigh what is missing from it.
    process.stdout.write(
      `\n${attributionLine(sources.map((s) => (asRecord ? s.role : renderAttribution(s.role))))}\n`,
    );

    // Before the claims, not after them. A reader who reaches the end of a
    // document and only then learns that none of its sources passed their own
    // gates has already believed it.
    const uncleared = unclearedSources(standings);
    if (uncleared.length > 0) {
      process.stdout.write(
        `\n> **What the sources of this document did not pass.** ${String(uncleared.length)} of ` +
          `${String(standings.length)} deliverables composed here did not come through their own\n` +
          '> challenges clean. The claims below are still each a role\'s own, checked against that\n' +
          "> role — that screen is real and it is not this one.\n>\n" +
          uncleared.map((s) => `> - ${standingLine(s)}\n`).join('') +
          '>\n> They are composed rather than withheld because the run recorded these verdicts and\n' +
          '> can show them, and a reader told which sources were challenged can weigh the document.\n',
      );
    }
    // Before the sections, beside the standing block, for the same reason it
    // sits there: a reader who meets the contradiction after reading the
    // recommendation built on one side of it has already believed the
    // recommendation.
    const contested = contestedFacts(kept.map((c) => ({ text: c.text, from: c.from })));
    if (contested.length > 0) {
      process.stdout.write(
        `\n> **Two roles do not agree about ${contested.length === 1 ? 'a fact' : 'some facts'} in this document.** ` +
          'Each read the same ground and reached\n' +
          '> a different state for the same thing. Nothing here picks a side — the run has no\n' +
          '> standing to decide which role read correctly, and choosing by order of arrival would\n' +
          '> put one half of a live disagreement in the document under a single name.\n>\n' +
          contested.map((fact) => `> - ${escapeForTerminal(contestedLine(fact))}\n`).join(''),
      );
    }

    // Construct's own call, first, because it is the answer to what was asked.
    // Everything below it is the evidence it rests on, each concern named —
    // a reader can always tell which is which, because they are in different
    // parts of the document under different names, which is what lets the
    // judgment be made at all.
    if (position !== null) {
      const p = position.position;
      const say = (text: string) => escapeForTerminal(asRecord ? text : renderClaim(text));
      process.stdout.write(`\n## What Construct makes of this\n\n${say(p.approach)}\n`);
      process.stdout.write(
        '\n*This is a judgment across every concern, not any one concern\'s finding. ' +
          'Nobody was dispatched to make it; the roles below were each asked about their own ' +
          'concern and each was right to answer only that.*\n',
      );
      const listing = (title: string, claims: readonly { text: string; restsOn: readonly string[] }[]) => {
        if (claims.length === 0) return;
        process.stdout.write(`\n**${title}**\n\n`);
        for (const claim of claims) {
          const on = claim.restsOn.map((r) => (asRecord ? r : renderAttribution(r))).join(', ');
          process.stdout.write(`- ${say(claim.text)} [${on}]\n`);
        }
      };
      listing('Why', p.because);
      listing('What it costs', p.costs);
      listing('What happens first', p.first);

      if (p.resolved.length > 0) {
        process.stdout.write('\n**Where the concerns could not both be acted on**\n\n');
        const side = (roles: readonly string[]) =>
          roles.map((role) => (asRecord ? role : renderAttribution(role))).join(', ');
        for (const r of p.resolved) {
          process.stdout.write(
            `- ${say(r.question)} — went with ${side(r.took)} over ` +
              `${side(r.over)}: ${say(r.because)}\n`,
          );
        }
      }
      if (p.strongestObjection.length > 0) {
        process.stdout.write(`\n**The strongest objection to this**\n\n${say(p.strongestObjection)}\n`);
      }
      if (p.preMortem.length > 0) {
        process.stdout.write(`\n**Assume it was taken and it failed**\n\n${say(p.preMortem)}\n`);
      }
      if (p.undecided.length > 0) {
        process.stdout.write('\n**What this could not decide, and what would decide it**\n\n');
        for (const u of p.undecided) {
          process.stdout.write(`- ${say(u.question)} — settled by: ${say(u.settledBy)}\n`);
        }
      }
      // A recommendation with no case against it is an advertisement, and this
      // system holds every role to exactly that standard. Reporting the
      // shortfall rather than withholding the call: the reader can weigh a call
      // they are told arrived without its objection.
      const short = positionShortfalls(p);
      if (short.length > 0) {
        process.stdout.write(
          `\n> **This call did not come with everything it owes.** ${short.join('; ')}. ` +
            'The same checks apply to it as to any deliverable here.\n',
        );
      }
      // What the roles said, after the call had its one chance to answer them.
      // Several roles quoting the same sentence is one contested sentence and
      // prints as one line naming all of them: three lines would read as three
      // problems and bury which sentence is actually in dispute.
      if (objections.length > 0) {
        process.stdout.write(
          '\n> **A concern says the call states its work as something else.** ' +
            (callWasRepaired
              ? 'The call went\n> back once with these objections, and this is what it left standing.'
              : callWentBack
                ? 'The call went\n> back once and what came back did not answer this without costing something else,\n> so the first call stands.'
                : 'It was not sent back.') +
            ' Reported rather than resolved from here: the\n' +
            '> judgment is Construct\'s to make and the objection is theirs to make, and a reader\n' +
            '> is owed both.\n>\n' +
            collapseObjections(objections)
              .map((o) => `> - ${o.roles.join(', ')}: "${escapeForTerminal(o.quote)}"\n`)
              .join(''),
        );
      }
      // A repair the reader cannot see is a fragile path reading as a solid
      // one. The call they are holding is a second attempt, and that is a fact
      // about it.
      if (callWasRepaired) {
        process.stdout.write(
          '\n*This call is a second attempt. A concern objected that the first stated its\n' +
            'work as something it had not established, it was sent back once with those\n' +
            'objections, and what came back dropped objections without introducing new ones.*\n',
        );
      }
      process.stdout.write('\n---\n\n*What each concern established, in its name:*\n');
    }

    const empty: string[] = [];
    for (const section of shape.sections) {
      const inSection = kept.filter((claim) => claim.section === section.name);
      if (inSection.length === 0) {
        empty.push(section.name);
        continue;
      }
      process.stdout.write(`\n## ${asRecord ? section.name : renderHeading(section.name)}\n\n`);
      // Consecutive bullets read as one list; anything else is a block with
      // its own attribution line, so it gets the blank-line spacing a
      // paragraph, table, or diagram actually needs to render correctly.
      let previousKind: string | null = null;
      for (const claim of inSection) {
        if (previousKind !== null && !(previousKind === 'bullet' && claim.kind === 'bullet')) {
          process.stdout.write('\n');
        }
        process.stdout.write(`${escapeForTerminal(renderComposedClaim(claim, asRecord))}\n`);
        previousKind = claim.kind;
      }
    }
    // A section that came back empty is dropped from the document but not from
    // the report. Silently omitting it lets a composition that never stated an
    // answer read like one that had nothing more to add, and the reader cannot
    // tell the difference from the page alone — and once the section set follows
    // the ask, an unfillable section is also the reader's evidence that the ask
    // wanted something these deliverables do not carry.
    if (empty.length > 0) {
      process.stdout.write(
        `\n(the ${shape.name} shape asks for ${empty.join(', ')} and no claim was placed there — ` +
          'a fact about this composition and about what these deliverables hold, ' +
          'not about the roles who wrote them)\n',
      );
    }

    // Naming a gap is where this used to stop, and stopping there hands the
    // reader a question the run was better placed to answer than they are. So
    // the gaps go back to the roles, once: each is shown the list and asked
    // which its own material settles, with the run's ground still licensed to
    // it. Skipped when nothing is open, and skippable on purpose — it is a
    // model call per role, and a reader who only wants the arrangement should
    // not pay for the round that follows it.
    let closing: ClosingRound | null = null;
    if (screened.uncovered.length > 0 && flags['no-close'] === undefined) {
      const groundRoots = groundRootsFor(store, run);
      closing = await closeGaps({
        close: createHostGapCloser(host, plan.outcome, groundRoots),
        groundRoots,
        sources,
        briefs,
        gaps: screened.uncovered,
        report: terminalReport,
      });
    }

    if (closing !== null && closing.closed.length > 0) {
      // A separate section rather than mixed into the composed ones, because
      // the provenance is different and the reader is owed the difference:
      // these carry the role's name from a second dispatch, written in
      // Construct's voice, not the composer's arrangement of a first.
      process.stdout.write('\n## what was open until somebody went and looked\n\n');
      for (const answer of closing.closed) {
        const text = escapeForTerminal(asRecord ? answer.answer : renderClaim(answer.answer));
        const from = asRecord ? answer.role : renderAttribution(answer.role);
        process.stdout.write(`- ${escapeForTerminal(answer.gap)}\n  → ${text} [${from}]\n`);
      }
    }
    if (closing !== null && closing.contested.length > 0) {
      // Two roles answering the same question is a finding, not a tie to break.
      // Printing one of them alone would be the run resolving a disagreement it
      // has no standing to resolve, under a single name.
      process.stdout.write('\n## questions two roles answered differently\n\n');
      for (const item of closing.contested) {
        process.stdout.write(`- ${escapeForTerminal(item.gap)}\n`);
        for (const answer of item.answers) {
          const text = escapeForTerminal(asRecord ? answer.answer : renderClaim(answer.answer));
          const from = asRecord ? answer.role : renderAttribution(answer.role);
          process.stdout.write(`  → ${text} [${from}]\n`);
        }
      }
    }
    for (const drop of closing?.refused ?? []) {
      process.stdout.write(`  discarded: "${escapeForTerminal(drop.gap.slice(0, 60))}" — ${escapeForTerminal(drop.reason)}\n`);
    }

    // The gap is part of the document, not a footnote under it. A composition
    // that silently answers two thirds of an outcome is the failure composing
    // introduces, and naming it is the whole defence.
    process.stdout.write('\n## what nobody answered\n\n');
    const standing = closing?.standing ?? screened.uncovered.map((gap) => ({ gap, reasons: [] }));
    if (screened.uncovered.length === 0) {
      process.stdout.write('- the roles between them addressed every part of the outcome\n');
    } else if (standing.length === 0) {
      process.stdout.write('- every question the composing left open was closed by the round that followed it\n');
    } else {
      for (const item of standing) {
        process.stdout.write(`- ${escapeForTerminal(item.gap)}\n`);
        // A gap several roles opened their material for and could not settle is
        // a different fact from one nobody looked at, and only the reasons can
        // tell them apart. Without them the second reads as the first.
        for (const reason of item.reasons) {
          process.stdout.write(`  (${reason.role} looked: ${escapeForTerminal(reason.reason)})\n`);
        }
      }
    }

    const removed = screened.discarded.length + unsupported.size;
    process.stdout.write(
      `\ncomposed from ${String(sources.length)} deliverables: ${String(kept.length)} claims kept` +
        (removed > 0 ? `, ${String(removed)} refused as unsupported or unattributable` : '') +
        '.\nNothing here was added by the composing: every claim is one of the roles, checked against it.\n' +
        `Shaped as ${shape.article} ${shape.name} — ${shape.answers}` +
        (flags.shape === undefined
          ? `, read from the outcome. Another shape: --shape=<${shapeNames().join('|')}>.\n`
          : ', as asked.\n'),
    );

    // The step after reading it. A document's numbered issues and its
    // what-follows items are changes somebody is about to retype into whichever
    // system the work lives in, and the retyping is where the citation goes
    // missing. Offered only where the workspace has declared somewhere for a
    // change to go — the alternative is advertising a command that would refuse.
    const declared = sourcesFor(store, plan.workspace);
    if (declared.length > 0) {
      process.stdout.write(
        '\nThe findings in these deliverables can become write proposals, each citing the finding\n' +
          'it came from. No model call, nothing written outward, nothing applied:\n' +
          `  construct propose --run=${run} --source=${declared[0].id}\n`,
      );
    }
    return 0;
  });
}
