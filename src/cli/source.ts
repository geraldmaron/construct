/**
 * cli/source.ts — where a workspace's organizational context lives.
 */

import {
  addSource,
  authorityLabel,
  docsLocatorProblem,
  getSource,
  retireSource,
  setSourceDeclaration,
  setSourceShape,
  SOURCE_AUTHORITIES,
  SOURCE_KINDS,
  sourceDeclaration,
  sourceShape,
  sourcesFor,
  SURVEY_EMPHASES,
} from '../kernel/store/sources.ts';
import type {
  SourceAuthority,
  SourceDeclaration,
  SourceKind,
  SurveyEmphasis,
} from '../kernel/store/sources.ts';
import {
  declareSourceEdge,
  getSourceEdge,
  relationPhrase,
  retireSourceEdge,
  SOURCE_RELATIONS,
  sourceEdgesFor,
} from '../kernel/store/source-edges.ts';
import type { SourceEdge, SourceRelation } from '../kernel/store/source-edges.ts';
import type { Store } from '../kernel/store/open.ts';
import { DOCUMENT_CAP } from '../hosts/sources.ts';
import { escapeForTerminal } from '../kernel/render/terminal.ts';
import { now, withStore } from './runtime.ts';
import { parseFlags, workspaceFlag } from './flags.ts';
import { jsonFlag, writeJson } from './json.ts';

const SOURCE_USAGE =
  'usage: construct source add --kind=<directory|git|github|jira|docs> --locator=<where> ' +
  '[--workspace=<name>] [--emphasis=<prose|code|all>] [--cap=<documents>] ' +
  '[--authority=<source-of-truth|working|aspirational|archive>] [--relevance=<one line>] [--sensitive]\n' +
  '       construct source describe --id=<source-id> ' +
  '[--authority=<source-of-truth|working|aspirational|archive>] [--relevance=<one line>] ' +
  '[--sensitive] [--not-sensitive]\n' +
  '       construct source list [--workspace=<name>] [--all] [--json]\n' +
  '       construct source retire --id=<source-id>\n' +
  '       construct source relate --from=<source-id> --to=<source-id> ' +
  `--as=<${SOURCE_RELATIONS.join('|')}> [--note=<one line>] [--workspace=<name>]\n` +
  '       construct source relations [--workspace=<name>] [--all]\n' +
  '       construct source unrelate --id=<relationship-id>\n';

/**
 * What a user said about a source, printed the same way wherever it is shown.
 * One writer, because a declaration shown two ways is the second copy this
 * surface exists to avoid.
 */
function declarationLine(declaration: SourceDeclaration): string {
  return (
    `[${authorityLabel(declaration.authority)}` +
    (declaration.sensitive ? ', sensitive' : '') +
    ']' +
    (declaration.relevance === '' ? '' : `  ${declaration.relevance}`)
  );
}

/**
 * A relationship in the words its author used, printed the same way wherever
 * it is shown. Locators rather than ids, because a reader recognizes the place
 * their material lives and does not recognize `src-20260825…`.
 */
function relationLine(store: Store, edge: SourceEdge): string {
  const where = (id: string): string => getSource(store, id)?.locator ?? id;
  return (
    `${where(edge.from)} ${relationPhrase(edge.relation)} ${where(edge.to)}` +
    (edge.note.trim() === '' ? '' : `  — ${edge.note.trim()}`)
  );
}

/**
 * The declaration flags, read once for both the surface that declares a source
 * and the surface that describes one already declared.
 *
 * A flag nobody passed leaves what is already recorded alone: `--relevance`
 * alone restates why a source is here without silently re-tiering it. Only an
 * authority — this source's own, or a new one on this command — can produce a
 * declaration at all, because a relevance line with no standing beside it says
 * nothing about how far a role may carry the source.
 */
function readDeclarationFlags(
  flags: Record<string, string | undefined>,
  existing: SourceDeclaration | null,
): { readonly declaration: SourceDeclaration | null } | { readonly problem: string } {
  const authority = flags.authority;
  if (authority !== undefined && !(SOURCE_AUTHORITIES as readonly string[]).includes(authority)) {
    return {
      problem: `unknown authority "${authority}" (tiers: ${SOURCE_AUTHORITIES.join(', ')})`,
    };
  }
  if (flags.sensitive === 'true' && flags['not-sensitive'] === 'true') {
    return { problem: 'a source is either sensitive or it is not; --sensitive and --not-sensitive contradict' };
  }
  const relevance = flags.relevance;
  const sensitive =
    flags.sensitive === 'true' ? true : flags['not-sensitive'] === 'true' ? false : existing?.sensitive ?? false;
  const stated = authority !== undefined || relevance !== undefined || flags.sensitive === 'true' || flags['not-sensitive'] === 'true';
  if (!stated) return { declaration: null };
  const tier = (authority as SourceAuthority | undefined) ?? existing?.authority;
  if (tier === undefined) {
    return {
      problem:
        'say what this source is before saying why it matters: ' +
        `--authority=<${SOURCE_AUTHORITIES.join('|')}>`,
    };
  }
  return {
    declaration: { authority: tier, relevance: relevance ?? existing?.relevance ?? '', sensitive },
  };
}

/**
 * Declare, list, describe, and retire the sources a workspace works from.
 * Declaring builds no connector and reads nothing: it names where
 * organizational context lives so a run can be held to what it actually read
 * from there (the provenance rows), and so an outward write can name its
 * target.
 *
 * Describing is the user saying what a source is — whether it holds the record
 * or an aspiration, why it is here, whether it is sensitive. It is stated
 * here or not at all: nothing else in this system writes a declaration, so
 * every tier a reader sees is one a person typed.
 *
 * Relating is the same kind of statement about a pair: this strategy governs
 * that repository, this plan supersedes that one, these two cover the same
 * initiative. It is read where it changes something — which material reaches
 * which dispatch, and what a watch over both ends raises when one of them
 * moves — and like a description it is stated here or proposed and decided,
 * never inferred into force.
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
    // What the source is, said with it. Optional here and stated later by
    // `describe`, so a user who does not know yet declares where the context
    // lives and says what it is worth when they do.
    const stated = readDeclarationFlags(flags, null);
    if ('problem' in stated) {
      process.stderr.write(`source: ${stated.problem}\n${SOURCE_USAGE}`);
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
      let line = `declared ${id}: ${kind} ${locator} (workspace ${workspace})`;
      if (emphasis !== undefined || cap !== undefined) {
        const shape = { emphasis: (emphasis ?? 'prose') as SurveyEmphasis, cap: cap ?? DOCUMENT_CAP };
        setSourceShape(store, id, shape, at);
        line += `, surveyed ${shape.emphasis}-first, up to ${String(shape.cap)} documents`;
      }
      if (stated.declaration) {
        setSourceDeclaration(store, id, stated.declaration, at);
        line += `, ${declarationLine(stated.declaration)}`;
      }
      process.stdout.write(`${line}\n`);
      return 0;
    });
  }

  if (sub === 'describe') {
    const id = flags.id ?? '';
    if (id.trim() === '') {
      process.stderr.write(SOURCE_USAGE);
      return 2;
    }
    return withStore((store) => {
      const existing = sourceDeclaration(store, id);
      const stated = readDeclarationFlags(flags, existing);
      if ('problem' in stated) {
        process.stderr.write(`source: ${stated.problem}\n${SOURCE_USAGE}`);
        return 2;
      }
      if (!stated.declaration) {
        process.stderr.write(
          `source: describe says what a source is, and this command says nothing about ${id}\n${SOURCE_USAGE}`,
        );
        return 2;
      }
      try {
        setSourceDeclaration(store, id, stated.declaration, now());
      } catch (error) {
        process.stderr.write(`source: ${error instanceof Error ? error.message : String(error)}\n`);
        return 1;
      }
      process.stdout.write(`described ${id}: ${declarationLine(stated.declaration)}\n`);
      return 0;
    });
  }

  if (sub === 'list') {
    return withStore((store) => {
      const rows = sourcesFor(store, workspace, { includeRetired: flags.all === 'true' });
      if (jsonFlag(argv)) {
        // Each source row with the shape and declaration recorded against it
        // — the same three records the human listing reads, merged the same
        // way, but as data rather than one formatted line per source.
        writeJson(
          rows.map((row) => ({
            ...row,
            shape: sourceShape(store, row.id),
            declaration: sourceDeclaration(store, row.id),
          })),
        );
        return 0;
      }
      if (rows.length === 0) {
        process.stdout.write(`no sources declared for workspace ${workspace}\n`);
        return 0;
      }
      for (const row of rows) {
        const shape = sourceShape(store, row.id);
        const declaration = sourceDeclaration(store, row.id);
        process.stdout.write(
          `${row.id}  ${row.kind}  ${row.locator}` +
            (shape ? `  [${shape.emphasis}-first, cap ${String(shape.cap)}]` : '') +
            (declaration ? `  ${declarationLine(declaration)}` : '') +
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

  if (sub === 'relate') {
    const from = (flags.from ?? '').trim();
    const to = (flags.to ?? '').trim();
    const relation = flags.as ?? '';
    if (from === '' || to === '' || !(SOURCE_RELATIONS as readonly string[]).includes(relation)) {
      process.stderr.write(SOURCE_USAGE);
      return 2;
    }
    return withStore((store) => {
      const at = now();
      // Two relationships declared inside the same millisecond are two
      // statements, not one, so the id is walked past whatever is already
      // there rather than colliding and reading as a duplicate.
      const stem = `rel-${at.replace(/[-:.TZ]/g, '')}-${relation}`;
      let id = stem;
      for (let nth = 2; getSourceEdge(store, id) !== null; nth += 1) id = `${stem}-${String(nth)}`;
      try {
        declareSourceEdge(store, {
          id,
          workspace,
          from,
          to,
          relation: relation as SourceRelation,
          note: flags.note ?? '',
          declaredAt: at,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/UNIQUE/i.test(message)) {
          process.stdout.write('already related that way; the earlier statement stands.\n');
          return 0;
        }
        process.stderr.write(`source: ${escapeForTerminal(message)}\n`);
        return 1;
      }
      process.stdout.write(
        `related ${id}: ${relationLine(store, {
          id,
          workspace,
          from,
          to,
          relation: relation as SourceRelation,
          note: flags.note ?? '',
          declaredAt: at,
          retiredAt: null,
        })}\n`,
      );
      return 0;
    });
  }

  if (sub === 'relations') {
    return withStore((store) => {
      const rows = sourceEdgesFor(store, workspace, { includeRetired: flags.all === 'true' });
      if (rows.length === 0) {
        process.stdout.write(`no relationships declared for workspace ${workspace}\n`);
        return 0;
      }
      for (const row of rows) {
        process.stdout.write(
          `${row.id}  ${relationLine(store, row)}` +
            (row.retiredAt ? `  (retired ${row.retiredAt})` : '') +
            '\n',
        );
      }
      return 0;
    });
  }

  if (sub === 'unrelate') {
    const id = (flags.id ?? '').trim();
    if (id === '') {
      process.stderr.write(SOURCE_USAGE);
      return 2;
    }
    return withStore((store) => {
      try {
        retireSourceEdge(store, id, now());
      } catch (error) {
        process.stderr.write(
          `source: ${escapeForTerminal(error instanceof Error ? error.message : String(error))}\n`,
        );
        return 1;
      }
      process.stdout.write(
        `retired ${id}; it stops governing what any run is assembled from, and stays on the record\n`,
      );
      return 0;
    });
  }

  process.stderr.write(SOURCE_USAGE);
  return 2;
}
