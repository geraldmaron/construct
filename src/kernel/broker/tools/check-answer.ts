import { parseDerivations, verifyDerivations, DERIVATION_EXAMPLE, type BoundDerivation } from '../../workflow/derivations.ts';
import { type ClaimCheck, claimChecks, assessClaims } from '../../workflow/claim-support.ts';
import { closed, obj, list, record, str, ToolInputError } from '../definition.ts';
import { type ResolvedPeriod, checkSlot, resolvePeriod, type PeriodSpec } from '../../registry/slots.ts';
import { settledTerms } from '../../project/governance.ts';
import { listStatements } from '../../state/profile.ts';
import { runValidators, periodCoverage } from '../../workflow/validators.ts';
import { appendActivity } from '../../state/activity.ts';
import { provenanceOf } from '../../project/evidence.ts';
import { define, projectResolver } from './shared.ts';
import { CITATION_ITEM, citationsInput } from './citations.ts';

interface CheckAnswerInput {
  claims: ClaimCheck[];
  derivations: BoundDerivation[];
  answer: string;
  citations: { ref: string; excerpt?: string }[];
  period?: Record<string, unknown>;
  outsidePeriod?: { ref: string; why: string }[];
  historicalEvidence?: { ref: string; why: string }[];
  superseded: { ref: string; replacedBy: string }[];
  setAside: string[];
}

/** The checks a plain answer gets: nothing that needs an artifact, a template, or a workflow's shape. */
export const ANSWER_CHECKS = [
  'citations_present',
  'evidence_refs_resolve',
  'excerpts_match',
  'numbers_grounded',
  'superseded_acknowledged',
  'settled_not_contradicted',
] as const;

export const checkAnswer = define<CheckAnswerInput, unknown>({
  name: 'check_answer',
  title: 'Check an answer before giving it',
  description:
    'For an explicit evidence check or an answer relying on Construct-held evidence or governed project statements, pass the answer and what it rests on; Construct returns what is unsupported: citations that name nothing real, quotes that do not match, figures not from what was cited, superseded or settled material stated as current, and sources updated after the period the answer covers. It starts nothing and records only that a check happened and how it went.',
  surface: 'interactive',
  readOnly: false,
  inputSchema: {
    type: 'object',
    properties: {
      derivations: {
        type: 'array',
        description:
          'Bound arithmetic only: {id,claim,value:string,expression,operands:[{value:string,ref,excerpt}|{value:string,derivationId}],decimalPlaces?:0–12}. Exact claim text scopes each result. Constants: 0,1,2,3,4,7,10,12,24,52,60,100,365,1000. Arithmetic never establishes semantic support.',
        items: { type: 'object' },
      },
      answer: { type: 'string', description: 'The answer you are about to give, as you would give it.' },
      historicalEvidence: {
        type: 'array',
        description: 'Historical citations used as history, never as current support: {ref,why}.',
        items: { type: 'object' },
      },
      claims: {
        type: 'array',
        items: { type: 'object' },
        description:
          'Optional bounded claim checks: {claim: exact answer text, refs:[citations], calculation?:{sourceId,item,field,operation:sum,expected,unit}}. Sums require a recorded complete typed mapping and claim text Total <field> is <expected> <unit>. Unrecognized semantic claims remain unknown.',
      },
      citations: { type: 'array', description: 'What it rests on: {ref, excerpt?} entries.', items: CITATION_ITEM },
      period: {
        type: 'object',
        description:
          'The period the answer covers, when it covers one: {semantics: as_of | changed_during | evidence_window, and one of relative (such as last_quarter), quarter with or without year, year, or from and to as YYYY-MM-DD}.',
      },
      outsidePeriod: {
        type: 'array',
        description: 'Cited items updated after the period that belong in the answer anyway: {ref, why} entries.',
        items: { type: 'object' },
      },
      superseded: { type: 'array', description: 'Superseded documents you cite: {ref, replacedBy} entries.', items: { type: 'object' } },
      setAside: { type: 'array', description: 'Ids of settled statements the answer knowingly discusses.', items: { type: 'string' } },
    },
    required: ['answer'],
    additionalProperties: false,
  },
  validate(raw) {
    closed(raw, this.inputSchema);
    let derivations: BoundDerivation[];
    try {
      derivations = parseDerivations(raw.derivations);
    } catch (e) {
      throw new ToolInputError((e as Error).message, { field: 'derivations', example: [DERIVATION_EXAMPLE] });
    }
    const citations = citationsInput(raw, 'citations');
    const period = obj(raw, 'period', { optional: true });
    const outsidePeriod = list(raw, 'outsidePeriod').map((e) => {
      const r = record(e);
      return { ref: typeof r.ref === 'string' ? r.ref : '', why: typeof r.why === 'string' ? r.why : '' };
    });
    const historicalEvidence = list(raw, 'historicalEvidence').map((e) => {
      const r = record(e);
      return { ref: str(r, 'ref')!, why: str(r, 'why')! };
    });
    const superseded = list(raw, 'superseded').map((e) => {
      const r = record(e);
      return { ref: typeof r.ref === 'string' ? r.ref : '', replacedBy: typeof r.replacedBy === 'string' ? r.replacedBy : '' };
    });
    const setAside = list(raw, 'setAside').filter((x): x is string => typeof x === 'string');
    return {
      derivations,
      historicalEvidence,
      superseded,
      setAside,
      answer: str(raw, 'answer')!,
      claims: claimChecks(raw.claims),
      citations,
      ...(period ? { period } : {}),
      ...(outsidePeriod.length ? { outsidePeriod } : {}),
    };
  },
  run(ctx, { answer, claims, derivations, citations, period: spec, outsidePeriod, historicalEvidence, superseded, setAside }) {
    // A period is checked and worked out at the moment of asking, before anything is recorded.
    let period: ResolvedPeriod | null = null;
    if (spec) {
      const at = ctx.now();
      const wrong = checkSlot('period', 'period', spec, { at, sourceIds: [] });
      if (wrong.length)
        throw new ToolInputError(`${wrong.map((p) => p.message).join('; ')}. ${wrong[0]!.remedy}`, {
          field: 'period',
          example: { semantics: 'changed_during', relative: 'last_quarter' },
        });
      period = resolvePeriod(spec as unknown as PeriodSpec, at);
    }
    const resolve = projectResolver(ctx);
    const settled = settledTerms(listStatements(ctx.store, { kind: 'constraint', status: 'confirmed' }));
    const checks: string[] = [...ANSWER_CHECKS, ...(period ? ['within_period'] : [])];
    const claimSupport = assessClaims({ answer, claims, citations, resolve, store: ctx.store, at: ctx.now() });
    const output = {
      historicalEvidence,
      summary: answer,
      derivations: [...derivations, ...claimSupport.results.flatMap((r) => (r.derivation ? [r.derivation] : []))],
      ...(outsidePeriod ? { outsidePeriod } : {}),
      ...(superseded.length ? { superseded } : {}),
      ...(setAside.length ? { setAside } : {}),
    };
    const arithmetic = verifyDerivations({ derivations: output.derivations, texts: [answer], evidence: citations, resolve });
    const results = runValidators(checks, {
      output,
      expectedKeys: [],
      evidence: citations,
      resolvableRefs: new Set(),
      resolve,
      settled,
      period,
    });
    const problems = results.flatMap((r) => r.problems.map((p) => ({ check: r.validator, problem: p })));
    for (const result of claimSupport.results)
      if (result.status === 'contradicted' || (result.status === 'unknown' && claims.some((c) => c.claim === result.claim)))
        problems.push({
          check: 'claim_support',
          problem: `${result.claim}: ${result.status}. ${result.problems.join('; ') || result.basis}`,
        });
    // Counted, so how often answers are checked is something a person can see, not something to hope for.
    appendActivity(ctx.store, {
      at: ctx.now(),
      kind: 'answer.checked',
      actor: ctx.actor,
      payload: { ok: problems.length === 0, problems: problems.length, citations: citations.length },
    });
    // Admitted on the host's word alone (policy.hostReads accept): the person should hear which parts those are.
    const unverified = [...new Set(citations.filter((c) => resolve(c.ref)?.provenance === 'unverified').map((c) => c.ref))];
    const onWord =
      unverified.length === 0
        ? ''
        : `; no recorded read holds ${unverified.slice(0, 5).join(', ')}${unverified.length > 5 ? ` (+${String(unverified.length - 5)} more)` : ''}, so say the parts resting on ${unverified.length === 1 ? 'it' : 'them'} are unverified, or record what you read with sources action report and check again`;
    return {
      ok: problems.length === 0,
      assurance: 'structural',
      arithmetic: { results: arithmetic.results, semanticSupportVerified: false },
      semanticSupportVerified: false,
      claimSupport,
      limits:
        'Citation, excerpt, figure and policy checks do not establish that evidence entails every claim or that research is complete.',
      problems,
      evidence: provenanceOf(citations, resolve),
      ...(period
        ? {
            period: {
              from: period.from,
              to: period.to,
              timezone: period.timezone,
              assumptions: period.assumptions,
              coverage: periodCoverage(citations, resolve, period, outsidePeriod ?? []),
            },
          }
        : {}),
      next:
        (problems.length === 0
          ? 'Structural checks passed. Review whether the evidence actually supports each claim before answering; these checks do not establish semantic support. Name unsupported parts and reported sources.'
          : 'fix what is listed, or give the answer with the unsupported parts named as unsupported') + onWord,
    };
  },
});
