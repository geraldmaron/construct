import { closed, str, num, ToolInputError } from '../definition.ts';
import { isHistoryTopic, historyPage, contextPage } from '../context-page.ts';
import { constitutionCompleteness } from '../../project/constitution.ts';
import { listOpenDecisions } from '../../state/decisions.ts';
import { listActiveRuns } from '../../state/runs.ts';
import { listReady } from '../../work/service.ts';
import { listClaims, listRelations } from '../../state/graph.ts';
import { listDriftFindings } from '../../state/drift.ts';
import { listStatements } from '../../state/profile.ts';
import { presentSessions } from '../../coord/awareness.ts';
import { skillQuality } from '../../state/quality.ts';
import { define } from './shared.ts';

const TOPICS = [
  'summary',
  'constitution',
  'sources',
  'decisions',
  'runs',
  'entities',
  'claims',
  'relations',
  'drift',
  'statements',
  'quality',
  'work',
  'sessions',
  'activity',
  'source_history',
] as const;

export const projectContext = define<{ topic: (typeof TOPICS)[number]; query?: string; limit: number; cursor?: string }, unknown>({
  name: 'project_context',
  title: 'Project context',
  description:
    'Targeted reads of what Construct knows: the constitution, sources, decisions, runs, entities, claims, relations, drift findings, remembered statements, work, the sessions present in the project, resolved decisions, activity history, or source_history (recorded source revisions). Ask for one topic at a time; pass a query to narrow. Search covers full history before paging. Results name their revision, selection reason and nextCursor; pass that cursor with the same topic/query to continue. A changed snapshot asks you to restart.',
  surface: 'interactive',
  readOnly: true,
  inputSchema: {
    type: 'object',
    properties: {
      topic: { type: 'string', description: 'What to read.', enum: TOPICS },
      cursor: { type: 'string', description: 'nextCursor from the previous page; keep topic and query unchanged.' },
      query: { type: 'string', description: 'A word or id to narrow by.' },
      limit: { type: 'number', description: 'At most this many items (default 50).' },
    },
    required: ['topic'],
    additionalProperties: false,
  },
  validate(raw) {
    closed(raw, this.inputSchema);
    return {
      topic: str(raw, 'topic', { oneOf: TOPICS }) as (typeof TOPICS)[number],
      query: str(raw, 'query', { optional: true }),
      limit: Math.max(1, Math.min(Math.floor(num(raw, 'limit') ?? 50), 200)),
      cursor: str(raw, 'cursor', { optional: true }),
    };
  },
  run(ctx, { topic, query, limit, cursor }) {
    if (isHistoryTopic(topic)) return historyPage(ctx.store, topic, query, limit, cursor);
    if (cursor && (topic === 'summary' || topic === 'constitution'))
      throw new ToolInputError('this topic is not paged', { field: 'cursor' });
    const page = <T>(items: readonly T[], text: (item: T) => string, q: string | undefined, n: number) =>
      contextPage(items, text, topic, q, n, cursor);
    switch (topic) {
      case 'summary': {
        const c = ctx.files.constitution;
        return {
          constitution: c ? { ...c, completeness: constitutionCompleteness(c) } : null,
          sources: ctx.sources.summary(ctx.now()),
          openDecisions: listOpenDecisions(ctx.store).length,
          activeRuns: listActiveRuns(ctx.store).length,
          readyWork: listReady(ctx.store, ctx.now()).length,
        };
      }
      case 'constitution':
        return ctx.files.constitution;
      case 'sources': {
        const p = page(ctx.sources.list(), (s) => `${s.id} ${s.kind} ${s.purpose}`, query, limit);
        return { ...p, items: p.items.map((s) => ctx.sources.status(s.id, ctx.now())) };
      }
      case 'claims':
        return page(listClaims(ctx.store), (c) => `${c.id} ${c.claimType} ${c.statement}`, query, limit);
      case 'relations':
        return page(listRelations(ctx.store), (r) => `${r.id} ${r.kind} ${r.fromId} ${r.toId}`, query, limit);
      case 'drift':
        return page(listDriftFindings(ctx.store), (f) => `${f.id} ${f.kind} ${f.summary}`, query, limit);
      case 'statements':
        return page(listStatements(ctx.store), (s) => `${s.kind} ${s.text}`, query, limit);
      case 'sessions':
        return page(
          presentSessions(ctx.store, { now: ctx.now(), sessionId: ctx.sessionId }),
          (s) => `${s.id} ${s.host} ${s.client ?? ''} ${s.lane} ${s.branch ?? ''} ${s.agents.join(' ')}`,
          query,
          limit,
        );
      case 'quality':
        return page(skillQuality(ctx.store), (q) => `${q.skill} ${q.version}`, query, limit);
      default:
        return null;
    }
  },
});
