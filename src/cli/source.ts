/**
 * cli/source.ts — where a workspace's organizational context lives.
 */

import {
  addSource,
  docsLocatorProblem,
  retireSource,
  setSourceShape,
  SOURCE_KINDS,
  sourceShape,
  sourcesFor,
  SURVEY_EMPHASES,
} from '../kernel/store/sources.ts';
import type { SourceKind, SurveyEmphasis } from '../kernel/store/sources.ts';
import { DOCUMENT_CAP } from '../hosts/sources.ts';
import { now, withStore } from './runtime.ts';
import { parseFlags, workspaceFlag } from './flags.ts';

const SOURCE_USAGE =
  'usage: construct source add --kind=<directory|git|github|jira|docs> --locator=<where> ' +
  '[--workspace=<name>] [--emphasis=<prose|code|all>] [--cap=<documents>]\n' +
  '       construct source list [--workspace=<name>] [--all]\n' +
  '       construct source retire --id=<source-id>\n';

/**
 * Declare, list, and retire the sources a workspace works from. Declaring
 * builds no connector and reads nothing: it names where organizational
 * context lives so a run can be held to what it actually read from there
 * (the provenance rows), and so an outward write can name its target.
 */
export function source(argv: string[]): number {
  const sub = argv[0];
  const { flags } = parseFlags(argv.slice(1));
  const workspace = workspaceFlag(flags);

  if (sub === 'add') {
    const kind = flags.kind ?? '';
    const locator = flags.locator ?? '';
    if (!(SOURCE_KINDS as readonly string[]).includes(kind) || locator.trim() === '') {
      process.stderr.write(SOURCE_USAGE);
      return 2;
    }
    // docs spans three unrelated providers (Google Docs, Confluence, Notion),
    // so unlike jira or github its locator must self-identify both — caught
    // here, before the store, so the refusal is a sentence and not a thrown
    // error the generic catch below would have to decide what to do with.
    if (kind === 'docs') {
      const problem = docsLocatorProblem(locator);
      if (problem) {
        process.stderr.write(`source: ${problem}\n`);
        return 2;
      }
    }
    // How this source is walked, declared with it. Both flags are optional and
    // absent means today's behavior, so nothing about an existing workspace
    // changes by the setting coming into existence.
    const emphasis = flags.emphasis;
    if (emphasis !== undefined && !(SURVEY_EMPHASES as readonly string[]).includes(emphasis)) {
      process.stderr.write(
        `source: unknown emphasis "${emphasis}" (emphases: ${SURVEY_EMPHASES.join(', ')})\n${SOURCE_USAGE}`,
      );
      return 2;
    }
    const cap = flags.cap === undefined ? undefined : Number(flags.cap);
    if (cap !== undefined && (!Number.isInteger(cap) || cap < 1)) {
      process.stderr.write(`source: --cap must be a positive whole number, got "${flags.cap ?? ''}"\n`);
      return 2;
    }
    return withStore((store) => {
      const at = now();
      const id = `src-${at.replace(/[-:.TZ]/g, '')}`;
      try {
        addSource(store, { id, workspace, kind: kind as SourceKind, locator, addedAt: at });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/UNIQUE/i.test(message)) {
          process.stderr.write(
            `source: ${workspace} already declares ${kind} ${locator} — retire the old declaration first if it moved\n`,
          );
          return 1;
        }
        throw error;
      }
      if (emphasis !== undefined || cap !== undefined) {
        const shape = { emphasis: (emphasis ?? 'prose') as SurveyEmphasis, cap: cap ?? DOCUMENT_CAP };
        setSourceShape(store, id, shape, at);
        process.stdout.write(
          `declared ${id}: ${kind} ${locator} (workspace ${workspace}), ` +
            `surveyed ${shape.emphasis}-first, up to ${String(shape.cap)} documents\n`,
        );
        return 0;
      }
      process.stdout.write(`declared ${id}: ${kind} ${locator} (workspace ${workspace})\n`);
      return 0;
    });
  }

  if (sub === 'list') {
    return withStore((store) => {
      const rows = sourcesFor(store, workspace, { includeRetired: flags.all === 'true' });
      if (rows.length === 0) {
        process.stdout.write(`no sources declared for workspace ${workspace}\n`);
        return 0;
      }
      for (const row of rows) {
        const shape = sourceShape(store, row.id);
        process.stdout.write(
          `${row.id}  ${row.kind}  ${row.locator}` +
            (shape ? `  [${shape.emphasis}-first, cap ${String(shape.cap)}]` : '') +
            (row.retiredAt ? `  (retired ${row.retiredAt})` : '') +
            '\n',
        );
      }
      return 0;
    });
  }

  if (sub === 'retire') {
    const id = flags.id ?? '';
    if (id.trim() === '') {
      process.stderr.write(SOURCE_USAGE);
      return 2;
    }
    return withStore((store) => {
      try {
        retireSource(store, id, now());
      } catch (error) {
        process.stderr.write(`source: ${error instanceof Error ? error.message : String(error)}\n`);
        return 1;
      }
      process.stdout.write(`retired ${id}\n`);
      return 0;
    });
  }

  process.stderr.write(SOURCE_USAGE);
  return 2;
}
