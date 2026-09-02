/**
 * kernel/registry/validation.ts — closed schemas for the skill and workflow
 * manifests, plus the agreement checks between a skill's portable frontmatter
 * and its Construct manifest.
 */

import { ACTION_TIERS, type ActionTier } from '../state/steps.ts';
import { isRange, isVersion } from './semver.ts';
import {
  INTERACTION_CLASSES,
  SKILL_MANIFEST_FORMAT,
  SKILL_MANIFEST_VERSION,
  WORKFLOW_MANIFEST_FORMAT,
  WORKFLOW_MANIFEST_VERSION,
  type InteractionClass,
  type SkillManifest,
  type VersionedDependency,
  type WorkflowManifest,
  type WorkflowStep,
} from './models.ts';

export class ManifestError extends Error {
  readonly path: string;

  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = 'ManifestError';
    this.path = path;
  }
}

const ID = /^[a-z][a-z0-9-]{0,63}$/;
const CAPABILITY = /^[a-z][a-z0-9_]*(:[a-z][a-z0-9_-]*)?$/;
/** Words that name a tool rather than a capability; a manifest may not use them. */
const TOOL_WORDS = /\b(websearch|webfetch|bash|shell|subagent|mcp__|npx|curl|python|node)\b/i;

function rec(raw: unknown, path: string, what: string): Record<string, unknown> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new ManifestError(path, `${what} must be an object`);
  return raw as Record<string, unknown>;
}

function str(r: Record<string, unknown>, key: string, path: string, opts: { readonly optional?: boolean } = {}): string {
  const v = r[key];
  if (v === undefined && opts.optional) return '';
  if (typeof v !== 'string' || v.trim() === '') throw new ManifestError(path, `"${key}" must be a non-empty string`);
  return v;
}

function strList(r: Record<string, unknown>, key: string, path: string, opts: { readonly optional?: boolean; readonly nonEmpty?: boolean } = {}): string[] {
  const v = r[key];
  if (v === undefined) {
    if (opts.optional) return [];
    throw new ManifestError(path, `"${key}" is required`);
  }
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string' || x.trim() === '')) throw new ManifestError(path, `"${key}" must be a list of non-empty strings`);
  if (opts.nonEmpty && v.length === 0) throw new ManifestError(path, `"${key}" must name at least one item`);
  return v as string[];
}

function bool(r: Record<string, unknown>, key: string, path: string, fallback: boolean): boolean {
  const v = r[key];
  if (v === undefined) return fallback;
  if (typeof v !== 'boolean') throw new ManifestError(path, `"${key}" must be true or false`);
  return v;
}

function num(r: Record<string, unknown>, key: string, path: string, fallback: number, min: number): number {
  const v = r[key];
  if (v === undefined) return fallback;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min) throw new ManifestError(path, `"${key}" must be a number >= ${String(min)}`);
  return v;
}

function oneOf<T extends string>(value: string, allowed: readonly T[], path: string, key: string): T {
  if (!(allowed as readonly string[]).includes(value)) throw new ManifestError(path, `"${key}" must be one of ${allowed.join(' | ')} (got ${value})`);
  return value as T;
}

function deps(r: Record<string, unknown>, key: string, path: string): VersionedDependency[] {
  const v = r[key];
  if (v === undefined) return [];
  if (!Array.isArray(v)) throw new ManifestError(path, `"${key}" must be a list`);
  return v.map((item, i) => {
    const d = rec(item, path, `"${key}[${String(i)}]"`);
    const id = str(d, 'id', path);
    const range = str(d, 'range', path);
    if (!ID.test(id)) throw new ManifestError(path, `"${key}[${String(i)}].id" must be a kebab-case id`);
    if (!isRange(range)) throw new ManifestError(path, `"${key}[${String(i)}].range" must be a version range such as ^1.2.0`);
    return { id, range };
  });
}

function capabilities(r: Record<string, unknown>, key: string, path: string): string[] {
  const list = strList(r, key, path, { optional: true });
  for (const c of list) {
    if (!CAPABILITY.test(c)) throw new ManifestError(path, `"${key}" names "${c}", which is not a capability name (lowercase, underscores, optional :scope)`);
    if (TOOL_WORDS.test(c)) throw new ManifestError(path, `"${key}" names a tool ("${c}"); declare the capability it needs instead`);
  }
  return list;
}

function tiers(r: Record<string, unknown>, key: string, path: string): ActionTier[] {
  return strList(r, key, path, { optional: true }).map((t) => oneOf(t, ACTION_TIERS, path, key));
}

export function validateSkillManifest(raw: unknown, path: string): SkillManifest {
  const r = rec(raw, path, 'the manifest');
  if (r.format !== SKILL_MANIFEST_FORMAT || r.formatVersion !== SKILL_MANIFEST_VERSION) {
    throw new ManifestError(path, `must carry format ${SKILL_MANIFEST_FORMAT} ${String(SKILL_MANIFEST_VERSION)}`);
  }
  const id = str(r, 'id', path);
  if (!ID.test(id)) throw new ManifestError(path, '"id" must be a kebab-case id');
  const version = str(r, 'version', path);
  if (!isVersion(version)) throw new ManifestError(path, '"version" must be a semantic version');
  const gates = (() => {
    const v = r.qualityGates;
    if (v === undefined) return [];
    if (!Array.isArray(v)) throw new ManifestError(path, '"qualityGates" must be a list');
    return v.map((g, i) => {
      const gate = rec(g, path, `"qualityGates[${String(i)}]"`);
      return { validator: str(gate, 'validator', path), appliesTo: str(gate, 'appliesTo', path), required: bool(gate, 'required', path, true) };
    });
  })();
  const observed = (() => {
    const v = r.observedOn;
    if (v === undefined) return [];
    if (!Array.isArray(v)) throw new ManifestError(path, '"observedOn" must be a list');
    return v.map((o, i) => {
      const ob = rec(o, path, `"observedOn[${String(i)}]"`);
      const note = str(ob, 'note', path);
      if (/\b(works|passes|succeeds|verified)\b/i.test(note) && !/\b(on|dated|run)\b/i.test(note)) {
        throw new ManifestError(path, `"observedOn[${String(i)}].note" claims success without naming the run or date that showed it`);
      }
      return { host: str(ob, 'host', path), model: str(ob, 'model', path), note };
    });
  })();
  return {
    format: SKILL_MANIFEST_FORMAT,
    formatVersion: SKILL_MANIFEST_VERSION,
    id,
    title: str(r, 'title', path),
    version,
    category: oneOf(str(r, 'category', path), ['method', 'operational', 'professional'] as const, path, 'category'),
    owner: str(r, 'owner', path),
    activation: strList(r, 'activation', path, { nonEmpty: true }),
    standDown: strList(r, 'standDown', path, { nonEmpty: true }),
    interactionClasses: strList(r, 'interactionClasses', path, { nonEmpty: true }).map((c) => oneOf(c, INTERACTION_CLASSES, path, 'interactionClasses')),
    outcomes: strList(r, 'outcomes', path, { optional: true }),
    deliverableTypes: strList(r, 'deliverableTypes', path, { optional: true }),
    inputs: strList(r, 'inputs', path, { optional: true }),
    outputSchemas: strList(r, 'outputSchemas', path, { optional: true }),
    requiredSourceTypes: strList(r, 'requiredSourceTypes', path, { optional: true }),
    minimumEvidence: str(r, 'minimumEvidence', path, { optional: true }),
    capabilities: capabilities(r, 'capabilities', path),
    actionTiers: tiers(r, 'actionTiers', path),
    skillDependencies: deps(r, 'skillDependencies', path),
    workflowDependencies: deps(r, 'workflowDependencies', path),
    qualityGates: gates,
    escalation: strList(r, 'escalation', path, { optional: true }),
    licensedReviewBoundaries: strList(r, 'licensedReviewBoundaries', path, { optional: true }),
    observedOn: observed,
    evals: strList(r, 'evals', path, { optional: true }),
  };
}

/** The portable frontmatter fields the manifest must agree with. */
export interface SkillFrontmatter {
  readonly name: string;
  readonly version: string | null;
  readonly description: string;
}

export function checkFrontmatterAgreement(frontmatter: SkillFrontmatter, manifest: SkillManifest, path: string): void {
  if (frontmatter.name !== manifest.id) throw new ManifestError(path, `SKILL.md name "${frontmatter.name}" and manifest id "${manifest.id}" disagree`);
  if (frontmatter.version === null) throw new ManifestError(path, 'SKILL.md carries no metadata.version to agree with the manifest');
  if (frontmatter.version !== manifest.version) throw new ManifestError(path, `SKILL.md version ${frontmatter.version} and manifest version ${manifest.version} disagree`);
}

function step(raw: unknown, path: string, i: number): WorkflowStep {
  const r = rec(raw, path, `"steps[${String(i)}]"`);
  const id = str(r, 'id', path);
  if (!ID.test(id)) throw new ManifestError(path, `"steps[${String(i)}].id" must be a kebab-case id`);
  const skillRaw = r.skill;
  let skill: VersionedDependency | null = null;
  if (skillRaw !== undefined && skillRaw !== null) {
    const s = rec(skillRaw, path, `"steps[${String(i)}].skill"`);
    skill = { id: str(s, 'id', path), range: str(s, 'range', path) };
    if (!ID.test(skill.id) || !isRange(skill.range)) throw new ManifestError(path, `"steps[${String(i)}].skill" must be {id, range}`);
  }
  const sources = (() => {
    const v = r.sources;
    if (v === undefined) return [];
    if (!Array.isArray(v)) throw new ManifestError(path, `"steps[${String(i)}].sources" must be a list`);
    return v.map((s, j) => {
      const src = rec(s, path, `"steps[${String(i)}].sources[${String(j)}]"`);
      return {
        kind: str(src, 'kind', path),
        freshness: oneOf(typeof src.freshness === 'string' ? src.freshness : 'any', ['fresh', 'any'] as const, path, 'freshness'),
        required: bool(src, 'required', path, true),
      };
    });
  })();
  const inputsRaw = r.inputs === undefined ? {} : rec(r.inputs, path, `"steps[${String(i)}].inputs"`);
  const inputs: Record<string, string> = {};
  for (const [k, v] of Object.entries(inputsRaw)) {
    if (typeof v !== 'string' || !/^(input\.[a-zA-Z_][\w]*|steps\.[a-z][a-z0-9-]*\.[a-zA-Z_][\w]*)$/.test(v)) {
      throw new ManifestError(path, `"steps[${String(i)}].inputs.${k}" must reference input.<key> or steps.<id>.<output>`);
    }
    inputs[k] = v;
  }
  const retryRaw = r.retry === undefined ? {} : rec(r.retry, path, `"steps[${String(i)}].retry"`);
  return {
    id,
    title: str(r, 'title', path),
    needs: strList(r, 'needs', path, { optional: true }),
    skill,
    capabilities: capabilities(r, 'capabilities', path),
    sources,
    tier: oneOf(str(r, 'tier', path), ACTION_TIERS, path, 'tier'),
    inputs,
    outputs: strList(r, 'outputs', path, { optional: true }),
    validators: strList(r, 'validators', path, { optional: true }),
    loadBearing: bool(r, 'loadBearing', path, false),
    challenge: bool(r, 'challenge', path, false),
    retry: { maxAttempts: num(retryRaw, 'maxAttempts', path, 1, 1), backoffMs: num(retryRaw, 'backoffMs', path, 0, 0) },
    timeoutMs: num(r, 'timeoutMs', path, 600_000, 1000),
  };
}

export function validateWorkflowManifest(raw: unknown, path: string): WorkflowManifest {
  const r = rec(raw, path, 'the manifest');
  if (r.format !== WORKFLOW_MANIFEST_FORMAT || r.formatVersion !== WORKFLOW_MANIFEST_VERSION) {
    throw new ManifestError(path, `must carry format ${WORKFLOW_MANIFEST_FORMAT} ${String(WORKFLOW_MANIFEST_VERSION)}`);
  }
  const id = str(r, 'id', path);
  if (!ID.test(id)) throw new ManifestError(path, '"id" must be a kebab-case id');
  const version = str(r, 'version', path);
  if (!isVersion(version)) throw new ManifestError(path, '"version" must be a semantic version');
  const schemaRaw = r.inputSchema === undefined ? {} : rec(r.inputSchema, path, '"inputSchema"');
  const inputSchema: Record<string, 'string' | 'number' | 'boolean' | 'string[]' | 'object'> = {};
  for (const [k, v] of Object.entries(schemaRaw)) {
    inputSchema[k] = oneOf(String(v), ['string', 'number', 'boolean', 'string[]', 'object'] as const, path, `inputSchema.${k}`);
  }
  const requiredInputs = strList(r, 'requiredInputs', path, { optional: true });
  for (const k of requiredInputs) if (!(k in inputSchema)) throw new ManifestError(path, `"requiredInputs" names "${k}", which inputSchema does not declare`);
  const stepsRaw = r.steps;
  if (!Array.isArray(stepsRaw) || stepsRaw.length === 0) throw new ManifestError(path, '"steps" must be a non-empty list');
  const steps = stepsRaw.map((s, i) => step(s, path, i));
  const ids = new Set<string>();
  for (const s of steps) {
    if (ids.has(s.id)) throw new ManifestError(path, `step id "${s.id}" appears twice`);
    ids.add(s.id);
  }
  for (const s of steps) {
    if (s.needs.includes(s.id)) throw new ManifestError(path, `step "${s.id}" needs itself`);
    for (const need of s.needs) if (!ids.has(need)) throw new ManifestError(path, `step "${s.id}" needs "${need}", which is not a step`);
    for (const [k, ref] of Object.entries(s.inputs)) {
      if (ref.startsWith('input.')) {
        const key = ref.slice('input.'.length);
        if (!(key in inputSchema)) throw new ManifestError(path, `step "${s.id}" input "${k}" reads ${ref}, which inputSchema does not declare`);
      } else {
        const [, upstreamId, output] = ref.split('.') as [string, string, string];
        const upstream = steps.find((u) => u.id === upstreamId);
        if (!upstream) throw new ManifestError(path, `step "${s.id}" input "${k}" reads ${ref}, but there is no step "${upstreamId}"`);
        if (!upstream.outputs.includes(output)) throw new ManifestError(path, `step "${s.id}" input "${k}" reads ${ref}, but step "${upstreamId}" declares no output "${output}"`);
        if (!s.needs.includes(upstreamId)) throw new ManifestError(path, `step "${s.id}" reads from "${upstreamId}" without listing it in needs`);
      }
    }
    if (s.loadBearing && s.validators.length === 0) throw new ManifestError(path, `step "${s.id}" is load-bearing but names no validator`);
  }
  const deliverableRaw = rec(r.deliverable, path, '"deliverable"');
  return {
    format: WORKFLOW_MANIFEST_FORMAT,
    formatVersion: WORKFLOW_MANIFEST_VERSION,
    id,
    title: str(r, 'title', path),
    version,
    purpose: str(r, 'purpose', path),
    activation: strList(r, 'activation', path, { nonEmpty: true }),
    standDown: strList(r, 'standDown', path, { nonEmpty: true }),
    interactionClass: oneOf(str(r, 'interactionClass', path), INTERACTION_CLASSES, path, 'interactionClass') as InteractionClass,
    inputSchema,
    requiredInputs,
    steps,
    triggers: strList(r, 'triggers', path, { nonEmpty: true }).map((t) => oneOf(t, ['manual', 'schedule', 'event'] as const, path, 'triggers')),
    onNoData: oneOf(typeof r.onNoData === 'string' ? r.onNoData : 'block', ['succeed_empty', 'block', 'fail'] as const, path, 'onNoData'),
    onStaleData: oneOf(typeof r.onStaleData === 'string' ? r.onStaleData : 'block', ['block', 'proceed_flagged', 'fail'] as const, path, 'onStaleData'),
    concurrency: oneOf(typeof r.concurrency === 'string' ? r.concurrency : 'single', ['single', 'per_input'] as const, path, 'concurrency'),
    dedupeKey: strList(r, 'dedupeKey', path, { optional: true }),
    cancellation: oneOf(typeof r.cancellation === 'string' ? r.cancellation : 'after_step', ['immediate', 'after_step'] as const, path, 'cancellation'),
    deliverable: { kind: str(deliverableRaw, 'kind', path), schema: str(deliverableRaw, 'schema', path), challenge: bool(deliverableRaw, 'challenge', path, false) },
    proposes: strList(r, 'proposes', path, { optional: true }).map((p) => oneOf(p, ['constitution', 'sources', 'skills', 'workflows', 'lessons'] as const, path, 'proposes')),
    evals: strList(r, 'evals', path, { optional: true }),
  };
}
