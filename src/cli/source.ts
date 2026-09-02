/**
 * cli/source.ts — declare and inspect the ground the project reads. Declared
 * sources live in the committed sources file; local ones stay in state.
 */

import { AUTHORITY_LEVELS, SENSITIVITIES, retireSource, type AuthorityLevel, type Sensitivity } from '../kernel/state/sources.ts';
import { RELATION_KINDS, addRelation, type RelationKind } from '../kernel/state/graph.ts';
import { validateSourcesFile, type DeclaredSource, type SourcesFile } from '../kernel/project/sources-file.ts';
import { writeJsonFile } from '../kernel/project/files.ts';
import { SOURCE_KINDS, locatorProblem } from '../kernel/source/locators.ts';
import { createSourceService } from '../kernel/source/service.ts';
import { ensureSourceEntities, sourceEntity } from '../kernel/source/entities.ts';
import { readDirectorySource } from '../hosts/sources/directory.ts';
import { boolFlag, stringFlag, type CommandSpec, type ParsedArgs } from './commands.ts';
import { createContext, openProject, withProject, type CliContext } from './context.ts';
import { esc, say, writeJson, UsageError, OperationError } from './output.ts';

const group = 'Sources';

export const SOURCE_SPECS: readonly CommandSpec[] = [
  { path: ['source', 'list'], gloss: 'every active source with reachability and freshness', group, positionals: [], flags: [], readOnly: true },
  { path: ['source', 'show'], gloss: 'one source: purpose, authority, freshness, last read', group, positionals: ['<id>'], flags: [], readOnly: true },
  {
    path: ['source', 'add'],
    gloss: 'declare a source (committed) or add one only this checkout knows (--local)',
    group,
    positionals: ['<id>'],
    flags: [
      { name: 'kind', gloss: `one of ${SOURCE_KINDS.join(' | ')}`, takesValue: true },
      { name: 'purpose', gloss: 'what this source is for, in a sentence', takesValue: true },
      { name: 'locator', gloss: 'where it is: a path, PROJ, owner/repo, provider:container:id', takesValue: true },
      { name: 'authority', gloss: `overall trust: ${AUTHORITY_LEVELS.join(' | ')} (default informative)`, takesValue: true },
      { name: 'authoritative-for', gloss: 'a claim type this source settles', takesValue: true, repeatable: true },
      { name: 'not-authoritative-for', gloss: 'a claim type this source must not settle', takesValue: true, repeatable: true },
      { name: 'sensitivity', gloss: `${SENSITIVITIES.join(' | ')} (default internal)`, takesValue: true },
      { name: 'freshness-hours', gloss: 'how old a read may be before it is stale', takesValue: true },
      { name: 'write', gloss: 'this source may be written to (still gated per action)', takesValue: false },
      { name: 'local', gloss: 'keep it out of the committed file; the locator may be sensitive', takesValue: false },
    ],
    readOnly: false,
  },
  { path: ['source', 'retire'], gloss: 'retire a source; its history stays', group, positionals: ['<id>'], flags: [], readOnly: false },
  { path: ['source', 'refresh'], gloss: 'read a source now and record what changed', group, positionals: ['<id>'], flags: [], readOnly: false },
  {
    path: ['source', 'relate'],
    gloss: `record how two sources stand to each other: ${RELATION_KINDS.filter((k) => ['governs', 'supersedes', 'contradicts', 'depends_on', 'feeds'].includes(k)).join(' | ')}`,
    group,
    positionals: ['<from-id>', '<relation>', '<to-id>'],
    flags: [],
    readOnly: false,
  },
];

function readers() {
  return new Map([['directory', readDirectorySource]]);
}

function declaredFrom(id: string, args: ParsedArgs): DeclaredSource {
  const kind = stringFlag(args, 'kind');
  if (!kind || !(SOURCE_KINDS as readonly string[]).includes(kind)) throw new UsageError(`--kind must be one of ${SOURCE_KINDS.join(' | ')}`);
  const purpose = stringFlag(args, 'purpose');
  if (!purpose) throw new UsageError('--purpose says what this source is for');
  const locator = stringFlag(args, 'locator') ?? null;
  const problem = locatorProblem(kind, locator);
  if (problem) throw new UsageError(problem);
  const authority = stringFlag(args, 'authority') ?? 'informative';
  if (!(AUTHORITY_LEVELS as readonly string[]).includes(authority)) throw new UsageError(`--authority must be one of ${AUTHORITY_LEVELS.join(' | ')}`);
  const sensitivity = stringFlag(args, 'sensitivity') ?? 'internal';
  if (!(SENSITIVITIES as readonly string[]).includes(sensitivity)) throw new UsageError(`--sensitivity must be one of ${SENSITIVITIES.join(' | ')}`);
  const fresh = stringFlag(args, 'freshness-hours');
  const freshnessHours = fresh === undefined ? null : Number(fresh);
  if (freshnessHours !== null && !(freshnessHours > 0)) throw new UsageError('--freshness-hours must be a positive number');
  const authoritativeFor = [...new Set(((args.flags['authoritative-for'] as readonly string[] | string | undefined) ?? []) as string[])];
  const notAuthoritativeFor = [...new Set(((args.flags['not-authoritative-for'] as readonly string[] | string | undefined) ?? []) as string[])];
  return {
    id, kind, purpose, locator,
    authorityLevel: authority as AuthorityLevel,
    authoritativeFor: typeof authoritativeFor === 'string' ? [authoritativeFor] : authoritativeFor,
    notAuthoritativeFor: typeof notAuthoritativeFor === 'string' ? [notAuthoritativeFor] : notAuthoritativeFor,
    freshnessHours,
    sensitivity: sensitivity as Sensitivity,
    read: true,
    write: boolFlag(args, 'write'),
  };
}

export async function sourceCommand(sub: string, args: ParsedArgs, ctx: CliContext = createContext()): Promise<number> {
  switch (sub) {
    case 'list':
      return withProject(ctx, ({ store }) => {
        const svc = createSourceService(store, { readers: readers() });
        const at = ctx.now();
        const rows = svc.list().map((s) => svc.status(s.id, at));
        if (args.json) {
          writeJson(rows);
          return 0;
        }
        if (rows.length === 0) {
          say('no sources declared. `construct source add <id> --kind ... --purpose ...` declares one.');
          return 0;
        }
        for (const r of rows) say(`${esc(r.source.id)}  ${r.source.kind}  ${r.source.origin}  ${r.source.reachability}  ${r.freshness}  ${esc(r.source.purpose)}`);
        return 0;
      });
    case 'show': {
      const id = args.positionals[0]!;
      return withProject(ctx, ({ store }) => {
        const svc = createSourceService(store, { readers: readers() });
        if (!svc.list().some((s) => s.id === id)) throw new OperationError(`no active source ${id}`, '`construct source list` shows the ones that exist.');
        const r = svc.status(id, ctx.now());
        if (args.json) {
          writeJson(r);
          return 0;
        }
        say(`${esc(r.source.id)} (${r.source.kind}, ${r.source.origin})`);
        say(`  purpose: ${esc(r.source.purpose)}`);
        say(`  locator: ${r.source.locator ? esc(r.source.locator) : 'none'}`);
        say(`  authority: ${r.source.authorityLevel}; settles ${r.authoritativeFor.length ? r.authoritativeFor.map(esc).join(', ') : 'nothing declared'}; must not settle ${r.notAuthoritativeFor.length ? r.notAuthoritativeFor.map(esc).join(', ') : 'nothing declared'}`);
        say(`  sensitivity: ${r.source.sensitivity}; reads ${r.source.canRead ? 'yes' : 'no'}; writes ${r.source.canWrite ? 'allowed per action' : 'no'}`);
        say(`  reachability: ${r.source.reachability}; freshness: ${r.freshness}${r.lastSnapshot ? ` (last read ${r.lastSnapshot.takenAt}, ${esc(r.lastSnapshot.summary ?? '')})` : ''}`);
        return 0;
      });
    }
    case 'add': {
      const id = args.positionals[0]!;
      const declared = declaredFrom(id, args);
      return withProject(ctx, ({ store, layout, files }) => {
        const at = ctx.now();
        const svc = createSourceService(store, { readers: readers() });
        if (boolFlag(args, 'local')) {
          svc.addLocal({ ...declared }, at);
        } else {
          const current: SourcesFile = files.sources ?? { format: 'construct-sources', formatVersion: 2, sources: [] };
          if (current.sources.some((s) => s.id === id)) throw new OperationError(`source ${id} is already declared`, '`construct source show ' + id + '` shows it.');
          const next = validateSourcesFile({ ...current, sources: [...current.sources, { ...declared, capabilities: { read: declared.read, write: declared.write } }] }, layout.sourcesFile);
          writeJsonFile(layout.sourcesFile, next);
          svc.syncDeclarations(next, at);
        }
        ensureSourceEntities(store, at, ctx.nextId);
        const r = svc.status(id, at);
        if (args.json) writeJson(r);
        else {
          say(`${boolFlag(args, 'local') ? 'added local source' : 'declared source'} ${esc(id)} (${declared.kind})${boolFlag(args, 'local') ? '; it stays out of the committed file' : ' in .construct/sources.json'}`);
          say(`Next: \`construct source refresh ${esc(id)}\` reads it${declared.kind === 'directory' ? '' : ' once a reader for this kind is connected through your host'}.`);
        }
        return 0;
      });
    }
    case 'retire': {
      const id = args.positionals[0]!;
      return withProject(ctx, ({ store, layout, files }) => {
        const at = ctx.now();
        const svc = createSourceService(store, { readers: readers() });
        const source = svc.list().find((s) => s.id === id);
        if (!source) throw new OperationError(`no active source ${id}`);
        if (source.origin === 'declared') {
          const current = files.sources!;
          const next = validateSourcesFile({ ...current, sources: current.sources.filter((s) => s.id !== id) }, layout.sourcesFile);
          writeJsonFile(layout.sourcesFile, next);
          svc.syncDeclarations(next, at);
        } else {
          retireSource(store, id, at);
        }
        if (args.json) writeJson({ id, retired: true });
        else say(`retired source ${esc(id)}; its snapshots and claims stay on the record`);
        return 0;
      });
    }
    case 'refresh': {
      const id = args.positionals[0]!;
      const project = openProject(ctx);
      try {
        const svc = createSourceService(project.store, { readers: readers() });
        if (!svc.list().some((s) => s.id === id)) throw new OperationError(`no active source ${id}`);
        const result = await svc.refresh(id, ctx.now(), () => ctx.nextId('snap'));
        if (args.json) writeJson(result);
        else if (result.outcome === 'unreachable') say(`${esc(id)}: unreachable (${esc(result.reason ?? '')})`);
        else say(`${esc(id)}: ${result.outcome}${result.snapshot ? ` (${esc(result.snapshot.summary ?? '')})` : ''}`);
        return result.outcome === 'unreachable' ? 1 : 0;
      } finally {
        project.store.close();
      }
    }
    case 'relate': {
      const [fromId, relation, toId] = args.positionals as [string, string, string];
      const allowed: readonly RelationKind[] = ['governs', 'supersedes', 'contradicts', 'depends_on', 'feeds'];
      if (!(allowed as readonly string[]).includes(relation)) throw new UsageError(`relation must be one of ${allowed.join(' | ')}`);
      return withProject(ctx, ({ store }) => {
        const at = ctx.now();
        ensureSourceEntities(store, at, ctx.nextId);
        const svc = createSourceService(store, { readers: readers() });
        const from = svc.list().find((s) => s.id === fromId);
        const to = svc.list().find((s) => s.id === toId);
        if (!from) throw new OperationError(`no active source ${fromId}`);
        if (!to) throw new OperationError(`no active source ${toId}`);
        const fromEntity = sourceEntity(store, from.id, from.kind)!;
        const toEntity = sourceEntity(store, to.id, to.kind)!;
        const rel = addRelation(store, { id: ctx.nextId('rel'), kind: relation as RelationKind, fromId: fromEntity.id, toId: toEntity.id, basis: 'declared', confidence: 1, confirmed: true, at });
        if (args.json) writeJson(rel);
        else say(`recorded: ${esc(fromId)} ${relation} ${esc(toId)} (declared by you, confirmed)`);
        return 0;
      });
    }
    default:
      throw new UsageError(`source has no subcommand "${sub}"`);
  }
}
