/**
 * cli/lessons.ts — the held-lessons queue, made visible, and the one write a
 * human makes on it.
 *
 * The admission gate holds every run-derived or externally-sourced lesson
 * unconditionally, which is the gate doing its job — but a held lesson was
 * invisible once its decide-time line scrolled away. Admitting re-runs that
 * same gate with a human-approval basis naming its approver: the gate, not
 * this command, is what turns that into an admission.
 */

import { getLesson, lessonsFor } from '../kernel/store/lessons.ts';
import {
  admissionDomainFor,
  admissionOf,
  decideAdmission,
} from '../kernel/lessons/admission.ts';
import { escapeForTerminal } from '../kernel/render/terminal.ts';
import { now, withStore } from './runtime.ts';
import { parseFlags, workspaceFlag } from './flags.ts';
import { jsonFlag, writeJson } from './json.ts';

const LESSONS_USAGE =
  'usage: construct lessons [--workspace=<name>] [--json]\n' +
  '       construct lessons --admit=<lesson-id> --by=<approver> [--detail="<why>"] [--workspace=<name>]\n';

/**
 * The held-lessons queue, made visible, and the one write a human makes on it.
 *
 * The admission gate holds every run-derived or externally-sourced lesson
 * unconditionally — that is the gate doing its job — but a held lesson was
 * invisible once its decide-time line scrolled away: the readers were kernel
 * functions with no command in front of them, reachable only by opening the
 * database by hand. Listing shows the standing verdict for every lesson in
 * the workspace, and a lesson with no verdict at all lists as held, because
 * absence of a verdict is a hold nobody wrote down. Admitting re-runs the
 * same gate with a human-approval basis naming its approver — the gate, not
 * this command, is what turns that into an admission, so the rule that only
 * an explicit human admits high-risk, external, or run-derived lessons lives
 * in exactly one place.
 */
export function lessons(argv: string[]): number {
  const { flags, rest } = parseFlags(argv);
  if (rest.length > 0) {
    process.stderr.write(LESSONS_USAGE);
    return 2;
  }
  const workspace = workspaceFlag(flags);

  if (flags.admit !== undefined) {
    const id = flags.admit.trim();
    // A bare `--by` parses as the flag-present sentinel 'true', and a bare
    // `--admit` the same way. The point of the flag is a named human, so a
    // sentinel is a missing name, not an approver called "true" — and an
    // admission recorded against it would forge the exact audit line the
    // gate exists to keep.
    const approver = flags.by === 'true' ? '' : (flags.by?.trim() ?? '');
    if (!id || id === 'true' || !approver) {
      process.stderr.write('lessons: admitting needs the lesson and its human.\n' + LESSONS_USAGE);
      return 2;
    }
    return withStore((store) => {
      const lesson = getLesson(store, id);
      if (!lesson) {
        process.stderr.write(`lessons: no lesson ${id}\n`);
        return 1;
      }
      const decision = decideAdmission(store, {
        lessonId: id,
        domain: admissionDomainFor(store, lesson),
        basis: {
          kind: 'human-approval',
          approver,
          detail: flags.detail?.trim() || 'approved from the held-lessons queue',
        },
        decidedAt: now(),
      });
      process.stdout.write(`${decision.verdict} ${id}: ${escapeForTerminal(decision.reason)}\n`);
      return 0;
    });
  }

  return withStore((store) => {
    const recorded = lessonsFor(store, workspace);
    if (jsonFlag(argv)) {
      // Every recorded lesson with the admission verdict standing against it
      // — the same pairing the held/admitted listing below reads, as the
      // stored records rather than the two printed sections.
      writeJson(recorded.map((lesson) => ({ lesson, verdict: admissionOf(store, lesson.id) })));
      return 0;
    }
    if (recorded.length === 0) {
      process.stdout.write(`lessons: none recorded for workspace "${workspace}".\n`);
      return 0;
    }
    const standing = recorded.map((lesson) => ({ lesson, verdict: admissionOf(store, lesson.id) }));
    const held = standing.filter((s) => s.verdict?.verdict !== 'admitted');
    const admitted = standing.filter((s) => s.verdict?.verdict === 'admitted');
    process.stdout.write(
      `lessons for workspace "${workspace}": ${held.length} held, ${admitted.length} admitted.\n`,
    );
    const print = (entries: typeof standing, title: string): void => {
      if (entries.length === 0) return;
      process.stdout.write(`\n  ${title}:\n`);
      for (const { lesson, verdict } of entries) {
        process.stdout.write(`    ${lesson.id}  [${lesson.kind}]\n`);
        process.stdout.write(`      ${escapeForTerminal(lesson.body)}\n`);
        process.stdout.write(
          `      ${verdict ? `${verdict.verdict}: ${escapeForTerminal(verdict.reason)}` : 'held: no verdict recorded — absence of a verdict is a hold nobody wrote down'}\n`,
        );
        process.stdout.write(`      cites ${escapeForTerminal(lesson.citation)}\n`);
      }
    };
    print(held, 'held');
    print(admitted, 'admitted');
    if (held.length > 0) {
      process.stdout.write('\nAdmit one with: construct lessons --admit=<id> --by=<your name>\n');
    }
    return 0;
  });
}
