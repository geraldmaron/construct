import { type AccessDescriptor, type AccessRequest, accessDescriptor, accessRequest, assessAccess } from '../../source/access.ts';
import { type DataMapping, dataMapping, sourceMapping } from '../../source/mapping.ts';
import { type SourceReadOutcome, SOURCE_READ_OUTCOMES, REPORTED_TEXT_CAP } from '../../source/service.ts';
import { SOURCE_ID, locatorCarriesCredentials } from '../../project/sources-file.ts';
import { ToolInputError, str, obj, closed, list, record, bool } from '../definition.ts';
import { locatorProblem } from '../../source/locators.ts';
import { getSource } from '../../state/sources.ts';
import { ensureSourceEntities } from '../../source/entities.ts';
import { appendActivity } from '../../state/activity.ts';
import { urlCarriesCredentials, urlProblem } from '../../project/urls.ts';
import { dayOf } from '../../registry/slots.ts';
import { type BrokerContext } from '../context.ts';
import { getDecision } from '../../state/decisions.ts';
import { listDriftFindings } from '../../state/drift.ts';
import { getRun } from '../../state/runs.ts';
import { listLiveDeliverables } from '../../state/deliverables.ts';
import { define, projectResolver } from './shared.ts';

const SOURCE_ACTIONS = ['list', 'show', 'refresh', 'report', 'declare', 'check', 'map'] as const;

/** Kinds a session may declare: systems the host reads with its own tools. Directory and git let Construct read files itself, so only the person adds those. */
const DECLARABLE_KINDS = ['github', 'jira', 'docs', 'hris', 'other'] as const;

const DECLARE_ONLY = ['kind', 'purpose', 'locator'] as const;

const DECLARED_PURPOSE = 'named by the person; declared by your assistant in this session';

const PURPOSE_CAP = 200;

const LOCATOR_CAP = 512;

const LOCATOR_EXAMPLES: Readonly<Record<string, string>> = { github: 'owner/repo', jira: 'PROJ', docs: 'confluence:space:ENG' };

interface SourcesInput {
  observation?: AccessDescriptor;
  request?: AccessRequest;
  mapping?: DataMapping;
  item?: string;
  outcome?: SourceReadOutcome;
  reason?: string;
  scope?: string;
  coverage?: Record<string, unknown>;
  action: (typeof SOURCE_ACTIONS)[number];
  id?: string;
  items: Record<string, unknown>[];
  partial: boolean;
  kind?: (typeof DECLARABLE_KINDS)[number];
  purpose?: string;
  locator?: string;
}

/** A suggested id for a name that is not one yet: lowercase, dashes for anything else. */
function idExample(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^[^a-z]+/, '')
    .replace(/-+$/, '')
    .slice(0, 64);
  return SOURCE_ID.test(slug) ? slug : 'jira';
}

function declareInput(raw: Record<string, unknown>, id: string | undefined): Pick<SourcesInput, 'id' | 'kind' | 'purpose' | 'locator'> {
  if (!id)
    throw new ToolInputError('"id" is required for declare: a short name for the system, such as jira or web', {
      field: 'id',
      example: 'jira',
    });
  if (!SOURCE_ID.test(id))
    throw new ToolInputError('"id" is lowercase letters, digits and dashes, starting with a letter, at most 64 characters', {
      field: 'id',
      example: idExample(id),
    });
  const kind = raw.kind;
  if (kind === 'directory' || kind === 'git') {
    throw new ToolInputError(
      'a directory or git source is declared by the person with construct source add, because it lets Construct read files itself',
      { field: 'kind', allowed: DECLARABLE_KINDS, example: 'other' },
    );
  }
  const k = str(raw, 'kind', { oneOf: DECLARABLE_KINDS }) as SourcesInput['kind'];
  const rawPurpose = str(raw, 'purpose', { optional: true });
  const purpose = rawPurpose?.replace(/[\u0000-\u001f\u007f\s]+/g, ' ').trim();
  if (purpose !== undefined && purpose.length > PURPOSE_CAP)
    throw new ToolInputError(`"purpose" is one sentence of at most ${String(PURPOSE_CAP)} characters`, { field: 'purpose' });
  const locator = str(raw, 'locator', { optional: true })?.trim() || undefined;
  if (locator !== undefined) {
    const example = LOCATOR_EXAMPLES[k!];
    if (locator.length > LOCATOR_CAP || /[\u0000-\u001f\u007f]/.test(locator))
      throw new ToolInputError(`"locator" is one line of at most ${String(LOCATOR_CAP)} characters`, { field: 'locator', example });
    if (locatorCarriesCredentials(locator))
      throw new ToolInputError('"locator" carries credentials; your connector holds them, and Construct never records them', {
        field: 'locator',
        example,
      });
    const problem = locatorProblem(k!, locator);
    if (problem) throw new ToolInputError(problem, { field: 'locator', example });
  }
  return { id, kind: k, purpose: purpose || undefined, locator };
}

const ACCESS_REQUEST_PROPERTIES = {
  principal: { type: 'string', description: 'Observed principal, never credentials; 1–512 characters.' },
  scope: { type: 'string', description: 'Exact observed scope; 1–512 characters.' },
  operation: { type: 'string', description: 'Attempted operation; 1–512 characters.' },
  mode: { type: 'string', description: 'Access being checked.', enum: ['read', 'write'] },
} as const;

const ACCESS_REQUEST_REQUIRED = ['principal', 'scope', 'operation', 'mode'] as const;

/** Give the host a repairable nested field without changing access provenance. */
function sourceAccessInput(raw: Record<string, unknown>, key: 'observation' | 'request'): Record<string, unknown> | undefined {
  if (raw[key] === undefined) return undefined;
  try {
    const value = obj(raw, key)!;
    for (const field of ['principal', 'scope', 'operation', ...(key === 'observation' ? ['expiresAt'] : [])]) {
      const text = str(value, field)!;
      if (!text.trim() || text.length > 512) throw new ToolInputError(`${field} must be nonempty and at most 512 characters`, { field });
    }
    str(value, 'mode', { oneOf: ['read', 'write'] });
    if (key === 'observation') {
      if (value.mode === 'write')
        throw new ToolInputError('a source read cannot report a write operation', { field: 'mode', allowed: ['read'] });
      str(value, 'transport', { oneOf: ['api', 'mcp', 'local'] });
      const expiry = value.expiresAt as string;
      if (!/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(expiry) || !Number.isFinite(Date.parse(expiry)))
        throw new ToolInputError('expiresAt must be an explicit expiry instant with a timezone', { field: 'expiresAt' });
      for (const field of ['inputSchema', 'outputSchema']) if (value[field] !== undefined) obj(value, field);
    }
    return value;
  } catch (error) {
    if (!(error instanceof ToolInputError)) throw error;
    const field = error.field === key ? key : `${key}.${error.field}`;
    throw new ToolInputError(`${field}: ${error.message}`, { field, ...(error.allowed ? { allowed: error.allowed } : {}) });
  }
}

export const sources = define<SourcesInput, unknown>({
  name: 'sources',
  title: 'Sources',
  description:
    'Declare, refresh, report and inspect the systems and documents this project reads, with what each is trusted to settle and whether it is reachable and fresh. Declare a system the person named before citing it (open-web pages go under one source named web with kind other), and report only the items you cite from a source Construct cannot read itself, each with its ref, url, title, updatedAt and the passage you rely on.',
  surface: 'interactive',
  readOnly: false,
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', description: 'Inspect, read, check scoped access, or map typed data.', enum: SOURCE_ACTIONS },
      observation: {
        type: 'object',
        description: 'Observed access; omit unknown identity/expiry. Never grants access; session/provenance/grants ignored.',
        properties: {
          ...ACCESS_REQUEST_PROPERTIES,
          mode: { type: 'string', description: 'A source read cannot report a write operation.', enum: ['read'] },
          transport: { type: 'string', description: 'Transport actually used for the read.', enum: ['api', 'mcp', 'local'] },
          expiresAt: { type: 'string', description: 'Observed expiry with timezone; expired access is not current.' },
          inputSchema: { type: 'object', description: 'Observed input schema.' },
          outputSchema: { type: 'object', description: 'Observed output schema.' },
        },
        required: [...ACCESS_REQUEST_REQUIRED, 'transport', 'expiresAt'],
      },
      request: {
        type: 'object',
        description: 'Check permission and current scoped access evidence without making a grant.',
        properties: ACCESS_REQUEST_PROPERTIES,
        required: ACCESS_REQUEST_REQUIRED,
      },
      item: { type: 'string', description: 'Map: item ref; without mapping returns its recorded mapping or unknown shape.' },
      mapping: {
        type: 'object',
        description:
          'Map: {item, records: JSON pointer to rows, identity: pointer within row, fields:[{name,path,type:string/number/boolean,nullable?,unit?,timezone?}], evidence:[refs]}. Unknown identity, units or types block affected calculations.',
      },
      id: { type: 'string', description: 'Source id: lowercase letters, digits and dashes; starts with a letter.' },
      outcome: {
        type: 'string',
        enum: SOURCE_READ_OUTCOMES,
        description: 'Defaults to read. Empty/failed reads preserve evidence, never source-wide freshness.',
      },
      reason: { type: 'string', description: 'For non-read report outcomes: the actual result and what remains unknown.' },
      scope: { type: 'string', description: 'For report: attempted query, item URI or scope; required for non-read outcomes.' },
      coverage: { type: 'object', description: 'Reported completeness, pagination and limitations.' },
      items: {
        type: 'array',
        description: 'Read items; preserve passages, not summaries.',
        items: {
          type: 'object',
          properties: {
            ref: { type: 'string', description: 'Stable nonempty key, unique within source.' },
            url: { type: 'string', description: 'HTTP(S) address a person would open; never credentials.' },
            title: { type: 'string', description: 'Observed item title.' },
            updatedAt: { type: 'string', description: 'Provider last-updated time, when known; not the time you read it.' },
            text: { type: 'string', description: 'Exact readable text; retained up to 256 KiB UTF-8.' },
            truncated: {
              type: 'boolean',
              description:
                'True if content omitted; omission preserves partial status. False requires a full read; separate from list partial.',
            },
            kind: { type: 'string', description: 'Observed item kind.' },
            fingerprint: { type: 'string', description: 'Provider content fingerprint, when available.' },
            weak: { type: 'boolean', description: 'True for a discovered reference that was not read as a version.' },
            schema: { type: 'object', description: 'Observed schema/units; never infer missing shape.' },
          },
          required: ['ref'],
        },
      },
      partial: { type: 'boolean', description: 'Partial read: preserve unreported items.' },
      kind: { type: 'string', description: 'Declare system kind; other includes the web.', enum: DECLARABLE_KINDS },
      purpose: { type: 'string', description: 'For declare: what the person uses it for, in one sentence.' },
      locator: {
        type: 'string',
        description:
          'For declare, when the system has one: where it is (PROJ for jira, owner/repo for github, provider:container:id for docs). Never credentials.',
      },
    },
    required: ['action'],
    additionalProperties: false,
  },
  validate(raw) {
    closed(raw, this.inputSchema);
    const action = str(raw, 'action', { oneOf: SOURCE_ACTIONS }) as SourcesInput['action'];
    const id = str(raw, 'id', { optional: true });
    const items = list(raw, 'items').map((e) => record(e));
    const partial = bool(raw, 'partial', false);
    if (action === 'declare') return { action, items, partial, ...declareInput(raw, id) };
    for (const key of DECLARE_ONLY) {
      if (raw[key] !== undefined && raw[key] !== null) throw new ToolInputError(`"${key}" is for declare only`, { field: key });
    }
    const observationInput = sourceAccessInput(raw, 'observation');
    const requestInput = sourceAccessInput(raw, 'request');
    const observation = observationInput === undefined ? undefined : accessDescriptor(observationInput);
    const request = requestInput === undefined ? undefined : accessRequest(requestInput);
    const mapping = raw.mapping === undefined ? undefined : dataMapping(raw.mapping);
    return {
      action,
      id,
      items,
      partial,
      observation,
      request,
      mapping,
      item: str(raw, 'item', { optional: true }),
      outcome: str(raw, 'outcome', { optional: true, oneOf: SOURCE_READ_OUTCOMES }) as SourceReadOutcome | undefined,
      reason: str(raw, 'reason', { optional: true }),
      scope: str(raw, 'scope', { optional: true }),
      coverage: obj(raw, 'coverage', { optional: true }),
    };
  },
  async run(
    ctx,
    { action, id, items, partial, kind, purpose, locator, outcome, reason, scope, coverage, observation, request, mapping, item },
  ) {
    const at = ctx.now();
    if (action === 'list') return ctx.sources.list().map((s) => ctx.sources.status(s.id, at));
    if (!id) throw new ToolInputError(`"id" is required for ${action}`, { field: 'id' });
    const active = ctx.sources.list();
    if (action === 'declare') {
      if (active.some((s) => s.id === id)) return { declared: false, already: true, source: ctx.sources.status(id, at) };
      if (getSource(ctx.store, id))
        throw new ToolInputError(`source "${id}" was retired; declare it under a new id`, { field: 'id', example: `${id}-2`.slice(0, 64) });
      // A declared source lives in this machine's state only, is treated as confidential, and settles nothing.
      ctx.store.transaction(() => {
        ctx.sources.addLocal(
          {
            id,
            kind: kind!,
            purpose: purpose ?? DECLARED_PURPOSE,
            locator: locator ?? null,
            authorityLevel: 'informative',
            authoritativeFor: [],
            notAuthoritativeFor: [],
            freshnessHours: null,
            sensitivity: 'confidential',
            read: true,
            write: false,
          },
          at,
        );
        ensureSourceEntities(ctx.store, at, ctx.nextId);
        appendActivity(ctx.store, { at, kind: 'source.declared', actor: ctx.actor, payload: { sourceId: id, kind, by: 'relayed' } });
      });
      return {
        declared: true,
        source: { id, kind, origin: 'local', sensitivity: 'confidential', authority: 'informative' },
        next: 'Report what you read from it with sources action report (ref, url, updatedAt, and the passage you rely on) before citing it. It stays on this machine; the person can commit it with construct source add.',
      };
    }
    if (!active.some((s) => s.id === id)) {
      throw new ToolInputError(
        `no source "${id}" is declared; declare it with sources action declare (id, kind), then ${action === 'report' ? 'report again' : 'report what you read from it'}`,
        { field: 'id', allowed: active.map((s) => s.id) },
      );
    }
    if (action === 'show') return ctx.sources.status(id, at);
    if (action === 'check') {
      if (!request) throw new ToolInputError('check requires a scoped access request');
      return assessAccess(ctx.store, id, request, ctx.sessionId, at);
    }
    if (action === 'map') {
      const ref = mapping?.item ?? item;
      if (!ref) throw new ToolInputError('map requires an item or mapping.item');
      if (item && mapping && item !== mapping.item) throw new ToolInputError('item differs from mapping.item');
      return sourceMapping(ctx.store, {
        sourceId: id,
        item: ref,
        mapping,
        resolve: projectResolver(ctx),
        at,
        nextId: () => ctx.nextId('mapping'),
      });
    }
    if (action === 'report') {
      if (items.length === 0 && (!outcome || outcome === 'read'))
        throw new ToolInputError('"items" is required for report: what you read, one entry per item', { field: 'items' });
      const parsed = items.map((i, n) => {
        if (typeof i.ref !== 'string' || i.ref.trim() === '')
          throw new ToolInputError(`items[${String(n)}] needs a ref`, { field: `items[${String(n)}].ref` });
        if (urlCarriesCredentials(i.ref))
          throw new ToolInputError(`items[${String(n)}].ref carries credentials; give the address without them`, {
            field: `items[${String(n)}].ref`,
          });
        const opt = (k: string): string | undefined => {
          if (i[k] === undefined || i[k] === null) return undefined;
          if (typeof i[k] !== 'string') {
            const expected =
              k === 'text'
                ? 'a readable string; extract the observed passage from structured provider content before reporting it'
                : 'a string';
            throw new ToolInputError(`items[${String(n)}].${k} must be ${expected}`, { field: `items[${String(n)}].${k}` });
          }
          return i[k] as string;
        };
        if (i.weak !== undefined && typeof i.weak !== 'boolean')
          throw new ToolInputError(`items[${String(n)}].weak must be a boolean`, { field: `items[${String(n)}].weak` });
        if (i.truncated !== undefined && typeof i.truncated !== 'boolean')
          throw new ToolInputError(`items[${String(n)}].truncated must be a boolean`, { field: `items[${String(n)}].truncated` });
        if (i.schema !== undefined && i.schema !== null && (typeof i.schema !== 'object' || Array.isArray(i.schema)))
          throw new ToolInputError(`items[${String(n)}].schema must be an object`, { field: `items[${String(n)}].schema` });
        const url = i.url === undefined || i.url === null ? undefined : typeof i.url === 'string' ? i.url.trim() : '';
        const problem = url === undefined ? null : urlProblem(url);
        if (problem)
          throw new ToolInputError(`items[${String(n)}].url ${problem}`, {
            field: `items[${String(n)}].url`,
            example: 'https://acme.atlassian.net/browse/PLAT-101',
          });
        const updatedAt = opt('updatedAt');
        if (updatedAt && /^\d{4}-\d{2}-\d{2}(?:[Tt ]|$)/.test(updatedAt.trim()) && dayOf(updatedAt.trim(), 'UTC') === null)
          throw new ToolInputError(
            `items[${String(n)}].updatedAt is not a valid calendar date or timestamp; preserve an unknown provider format as unknown, never invent a date`,
            { field: `items[${String(n)}].updatedAt` },
          );
        return {
          ref: i.ref.trim(),
          title: opt('title'),
          kind: opt('kind'),
          updatedAt,
          text: opt('text'),
          fingerprint: opt('fingerprint'),
          weak: i.weak === true,
          ...(typeof i.truncated === 'boolean' ? { truncated: i.truncated } : {}),
          ...(i.schema && typeof i.schema === 'object' && !Array.isArray(i.schema) ? { schema: i.schema as Record<string, unknown> } : {}),
          ...(url !== undefined ? { url } : {}),
        };
      });
      const reported = ctx.sources.reportRead(
        id,
        { items: parsed, partial, outcome, reason, scope, coverage, observation, sessionId: ctx.sessionId ?? undefined },
        at,
        () => ctx.nextId('snap'),
      );
      // Access observations are scoped reports, not grants or evidence that every source
      // of the same kind is available. They never mutate permitted or available capabilities.
      if (reported.outcome === 'changed' || reported.outcome === 'unchanged' || reported.outcome === 'no_results') {
        const capability = `read_source:${active.find((s) => s.id === id)!.kind}:${id}:read`;
        if (Array.isArray(ctx.host.reported) && !ctx.host.reported.includes(capability)) ctx.host.reported.push(capability);
      }
      if (!reported.truncated?.length) return reported;
      return {
        ...reported,
        next: `The retained text of ${reported.truncated.join(', ')} is incomplete (at most ${String(REPORTED_TEXT_CAP / 1024)} KiB of UTF-8 per item). To capture a missing exact passage, report it using the same stable ref and URL with partial:true and items[].truncated:true; do not create another item for the same URL. For research closure, account for the uncaptured remainder under referenceDispositions using the exact cited ref. Set items[].truncated:false only after a complete read that fits the retained limit.`,
      };
    }
    return ctx.sources.refresh(id, at, () => ctx.nextId('snap'));
  },
});

/**
 * After the person answers a stale-work question, what starting the work they chose would look like. Nothing
 * starts on its own: the host offers it, and start_outcome runs only if the person wants it.
 */
export function followUp(
  ctx: BrokerContext,
  decision: ReturnType<typeof getDecision>,
  resolution: string,
): { suggestedOutcomes?: { workflowId: string; input: Record<string, unknown>; why: string }[] } {
  const subject = (decision?.subject ?? null) as { deliverableIds?: string[]; driftFindingIds?: string[] } | null;
  if (!subject?.deliverableIds?.length) return {};
  const said = resolution.toLowerCase();
  const out: { workflowId: string; input: Record<string, unknown>; why: string }[] = [];
  for (const [i, deliverableId] of subject.deliverableIds.entries()) {
    const finding = subject.driftFindingIds?.[i]
      ? listDriftFindings(ctx.store, {}).find((f) => f.id === subject.driftFindingIds![i])
      : undefined;
    const change = finding?.summary ?? 'material it drew on changed';
    if (said.startsWith('revise')) {
      const body = (listLiveDeliverablesFor(ctx, deliverableId)?.body ?? {}) as { artifact?: unknown };
      out.push({
        workflowId: 'revise-deliverable',
        input: { deliverable: deliverableId, change, ...(typeof body.artifact === 'string' ? { target: body.artifact } : {}) },
        why: `revise ${deliverableId} for: ${change}`,
      });
    } else if (said.startsWith('re-run') || said.startsWith('rerun')) {
      const d = listLiveDeliverablesFor(ctx, deliverableId);
      const run = d ? getRun(ctx.store, d.runId) : undefined;
      if (run)
        out.push({
          workflowId: run.workflowId,
          input: (run.input ?? {}) as Record<string, unknown>,
          why: `run ${run.workflowId} again with its original input`,
        });
    }
  }
  return out.length ? { suggestedOutcomes: out } : {};
}

function listLiveDeliverablesFor(ctx: BrokerContext, id: string) {
  return listLiveDeliverables(ctx.store).find((d) => d.id === id);
}
