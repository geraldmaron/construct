/**
 * kernel/drift/detect.ts — drift against declared, traceable obligations,
 * found deterministically from the context graph before any model reads.
 *
 * Every finding names its evidence, the obligations it affects, a
 * confidence, and a repair path. Nothing is found by similarity; a finding
 * is a relation, a status, a date, or a sum that is wrong. Silence is the
 * correct answer when nothing material changed.
 */

import type { StateStore } from '../state/open.ts';
import { listEntities, listRelations, listClaims, staleClaims, type Entity, type Relation } from '../state/graph.ts';
import { listSources, latestSnapshot, isAuthoritativeFor } from '../state/sources.ts';
import { listStatements } from '../state/profile.ts';
import { addDriftFinding, listDriftFindings, type DriftFinding, type DriftKind } from '../state/drift.ts';

export interface DetectedDrift {
  readonly kind: DriftKind;
  readonly summary: string;
  readonly evidence: readonly { readonly ref: string; readonly note: string }[];
  readonly affected: readonly string[];
  readonly confidence: number;
  readonly repairPath: string;
}

export interface DetectOptions {
  readonly at: string;
  /** When true, a code component changed after its governing decision is a finding. */
  readonly requireDecisionForChanges?: boolean;
}

function byId(entities: readonly Entity[]): Map<string, Entity> {
  return new Map(entities.map((e) => [e.id, e]));
}

function incoming(relations: readonly Relation[], toId: string, kind: Relation['kind']): Relation[] {
  return relations.filter((r) => r.toId === toId && r.kind === kind && r.status !== 'retired');
}

function outgoing(relations: readonly Relation[], fromId: string, kind: Relation['kind']): Relation[] {
  return relations.filter((r) => r.fromId === fromId && r.kind === kind && r.status !== 'retired');
}

export function detectDrift(store: StateStore, options: DetectOptions): DetectedDrift[] {
  const out: DetectedDrift[] = [];
  const entities = listEntities(store, { limit: 5000 });
  const ids = byId(entities);
  const relations = listRelations(store);
  const active = (e: Entity) => e.status === 'active';

  // 1. Governing source changed after claims were taken from it, or claims passed their window.
  for (const source of listSources(store, { status: 'active' })) {
    const snap = latestSnapshot(store, source.id);
    if (!snap) continue;
    const dependents = listClaims(store, { sourceId: source.id }).filter((c) => c.status !== 'superseded' && c.observedAt < snap.takenAt);
    if (dependents.length > 0) {
      out.push({
        kind: 'stale_dependent_claims',
        summary: `${source.id} changed on ${snap.takenAt}; ${String(dependents.length)} claim(s) were taken from it before that`,
        evidence: [{ ref: `source:${source.id}`, note: `snapshot ${snap.digest} at ${snap.takenAt}` }, ...dependents.slice(0, 5).map((c) => ({ ref: `claim:${c.id}`, note: `observed ${c.observedAt}: ${c.statement}` }))],
        affected: dependents.map((c) => `claim:${c.id}`),
        confidence: 0.9,
        repairPath: `refresh the claims from ${source.id}'s current snapshot, or supersede the ones no longer supported`,
      });
    }
  }
  const expired = staleClaims(store, options.at);
  if (expired.length > 0) {
    out.push({
      kind: 'stale_dependent_claims',
      summary: `${String(expired.length)} claim(s) passed their freshness window`,
      evidence: expired.slice(0, 5).map((c) => ({ ref: `claim:${c.id}`, note: `fresh until ${c.freshUntil ?? '?'}: ${c.statement}` })),
      affected: expired.map((c) => `claim:${c.id}`),
      confidence: 1,
      repairPath: 'refresh the sources behind them',
    });
  }

  // 2. Confirmed principles and constraints with no implementation or verification evidence.
  const obligations = listStatements(store, { status: 'confirmed' }).filter((s) => s.kind === 'principle' || s.kind === 'constraint' || s.kind === 'invariant');
  const decisions = entities.filter((e) => e.kind === 'decision' && active(e));
  for (const ob of obligations) {
    const carrier = decisions.find((d) => d.externalRef === `statement:${ob.id}`);
    if (!carrier) {
      out.push({
        kind: 'unverified_obligation',
        summary: `${ob.kind} "${ob.text}" has no decision, requirement, or test tracing to it`,
        evidence: [{ ref: `statement:${ob.id}`, note: ob.text }],
        affected: [`statement:${ob.id}`],
        confidence: 0.7,
        repairPath: 'link the obligation to the decision or requirement that carries it and the test or metric that verifies it, or record that it is aspirational',
      });
      continue;
    }
    const implemented = incoming(relations, carrier.id, 'implements').length > 0;
    const verified = incoming(relations, carrier.id, 'verifies').length > 0;
    if (!implemented || !verified) {
      out.push({
        kind: 'unverified_obligation',
        summary: `${ob.kind} "${ob.text}" is ${implemented ? '' : 'not implemented'}${!implemented && !verified ? ' and ' : ''}${verified ? '' : 'not verified'} by anything on record`,
        evidence: [{ ref: `statement:${ob.id}`, note: ob.text }, { ref: `entity:${carrier.id}`, note: `decision carrying it: ${carrier.name}` }],
        affected: [`statement:${ob.id}`, `entity:${carrier.id}`],
        confidence: 0.8,
        repairPath: implemented ? 'add the test or metric that verifies it' : 'link the code or artifact that implements it',
      });
    }
  }

  // 3. Requirements with no implementation or verification link.
  for (const req of entities.filter((e) => e.kind === 'requirement' && active(e))) {
    const implemented = incoming(relations, req.id, 'implements').length > 0;
    const verified = incoming(relations, req.id, 'verifies').length > 0;
    if (!implemented || !verified) {
      out.push({
        kind: 'unlinked_requirement',
        summary: `requirement "${req.name}" has ${implemented ? 'an implementation' : 'no implementation'} and ${verified ? 'verification' : 'no verification'} linked`,
        evidence: [{ ref: `entity:${req.id}`, note: req.name }],
        affected: [`entity:${req.id}`],
        confidence: 0.85,
        repairPath: implemented ? 'link the test or metric that verifies it' : 'link the component or work item that implements it, or retire the requirement',
      });
    }
  }

  // 4. Code changed after the decision that governs it, when the project requires a decision.
  if (options.requireDecisionForChanges) {
    for (const code of entities.filter((e) => e.kind === 'code_component' && active(e))) {
      const changed = listClaims(store, { subjectId: code.id, claimType: 'changed' }).filter((c) => c.status !== 'superseded').sort((a, b) => (a.observedAt < b.observedAt ? 1 : -1))[0];
      if (!changed) continue;
      const governors = incoming(relations, code.id, 'governs').map((r) => ids.get(r.fromId)).filter((e): e is Entity => !!e);
      const covered = governors.some((g) => g.updatedAt >= changed.observedAt || g.createdAt >= changed.observedAt);
      if (!covered) {
        out.push({
          kind: 'change_without_decision',
          summary: `${code.name} changed on ${changed.observedAt} with no decision or requirement recorded for it`,
          evidence: [{ ref: `claim:${changed.id}`, note: changed.statement }, ...governors.map((g) => ({ ref: `entity:${g.id}`, note: `governing ${g.kind} last updated ${g.updatedAt}` }))],
          affected: [`entity:${code.id}`],
          confidence: 0.6,
          repairPath: 'record the decision or requirement behind the change, or state that policy does not require one for this component',
        });
      }
    }
  }

  // 5. Implementation contradicts an accepted decision or requirement.
  for (const r of relations.filter((x) => x.kind === 'contradicts' && x.status !== 'retired')) {
    const from = ids.get(r.fromId);
    const to = ids.get(r.toId);
    if (!from || !to) continue;
    if (!(to.kind === 'decision' || to.kind === 'requirement') || !active(to)) continue;
    out.push({
      kind: 'contradicts_obligation',
      summary: `${from.kind} "${from.name}" contradicts ${to.kind} "${to.name}"`,
      evidence: [{ ref: `relation:${r.id}`, note: `${r.basis}, confidence ${String(r.confidence)}${r.sourceId ? `, from ${r.sourceId}` : ''}` }],
      affected: [`entity:${to.id}`, `entity:${from.id}`],
      confidence: r.confidence,
      repairPath: `change ${from.name} to honor ${to.name}, or supersede ${to.name} with a recorded decision`,
    });
  }

  // 6. Superseded documents still active.
  for (const r of relations.filter((x) => x.kind === 'supersedes' && x.status !== 'retired')) {
    const older = ids.get(r.toId);
    const newer = ids.get(r.fromId);
    if (!older || !newer || older.kind !== 'artifact') continue;
    if (active(older)) {
      out.push({
        kind: 'duplicate_active_document',
        summary: `"${older.name}" is superseded by "${newer.name}" but is still active`,
        evidence: [{ ref: `relation:${r.id}`, note: 'supersedes' }, { ref: `entity:${older.id}`, note: `status ${older.status}` }],
        affected: [`entity:${older.id}`],
        confidence: 0.95,
        repairPath: `mark "${older.name}" superseded, or retire the supersedes relation if it is wrong`,
      });
    }
  }

  // 7. Initiatives missing owner, work, capacity, or measure; 8. work with no goal; 9. capacity conflicts.
  const initiatives = entities.filter((e) => e.kind === 'initiative' && active(e));
  for (const init of initiatives) {
    const missing: string[] = [];
    if (outgoing(relations, init.id, 'owned_by').filter((r) => r.status === 'confirmed').length === 0) missing.push('a confirmed owner');
    if (incoming(relations, init.id, 'contributes_to').length + incoming(relations, init.id, 'implements').length === 0) missing.push('linked work');
    if (incoming(relations, init.id, 'verifies').length === 0) missing.push('a measure');
    if (listClaims(store, { subjectId: init.id, claimType: 'allocation' }).filter((c) => c.status !== 'superseded').length === 0) missing.push('a capacity allocation');
    if (missing.length > 0) {
      out.push({
        kind: 'initiative_incomplete',
        summary: `initiative "${init.name}" lacks ${missing.join(', ')}`,
        evidence: [{ ref: `entity:${init.id}`, note: init.name }],
        affected: [`entity:${init.id}`],
        confidence: 0.9,
        repairPath: `record ${missing.join(', ')} for "${init.name}" from an authoritative source, or pause the initiative`,
      });
    }
  }
  for (const work of entities.filter((e) => e.kind === 'work_item' && active(e))) {
    if (outgoing(relations, work.id, 'contributes_to').length + outgoing(relations, work.id, 'implements').length === 0) {
      out.push({
        kind: 'work_without_goal',
        summary: `work item "${work.name}" is linked to no initiative or requirement`,
        evidence: [{ ref: `entity:${work.id}`, note: work.name }],
        affected: [`entity:${work.id}`],
        confidence: 0.85,
        repairPath: 'link it to the initiative or requirement it serves, or ask whether it should be stopped',
      });
    }
  }
  const byOwner = new Map<string, { initiative: Entity; allocation: number; claimId: string }[]>();
  for (const init of initiatives) {
    const owner = outgoing(relations, init.id, 'owned_by').find((r) => r.status === 'confirmed');
    if (!owner) continue;
    const alloc = listClaims(store, { subjectId: init.id, claimType: 'allocation' }).filter((c) => c.status !== 'superseded' && typeof c.value === 'number')[0];
    if (!alloc) continue;
    const list = byOwner.get(owner.toId) ?? [];
    list.push({ initiative: init, allocation: alloc.value as number, claimId: alloc.id });
    byOwner.set(owner.toId, list);
  }
  for (const [ownerId, allocations] of byOwner) {
    const total = allocations.reduce((s, a) => s + a.allocation, 0);
    if (total > 1.0001 && allocations.length > 1) {
      const owner = ids.get(ownerId);
      out.push({
        kind: 'capacity_conflict',
        summary: `${owner?.name ?? ownerId} is allocated ${String(Math.round(total * 100))}% across ${allocations.map((a) => `"${a.initiative.name}"`).join(', ')}`,
        evidence: allocations.map((a) => ({ ref: `claim:${a.claimId}`, note: `${a.initiative.name}: ${String(Math.round(a.allocation * 100))}%` })),
        affected: allocations.map((a) => `entity:${a.initiative.id}`),
        confidence: 0.9,
        repairPath: `decide which of these commitments ${owner?.name ?? 'the owner'} carries; the sum cannot exceed one`,
      });
    }
  }

  // 10. Conclusions resting on sources not authoritative for the claim type.
  for (const claim of listClaims(store, { status: 'confirmed' })) {
    if (!claim.sourceId || claim.provenance === 'user') continue;
    if (isAuthoritativeFor(store, claim.sourceId, claim.claimType) !== 'yes') {
      out.push({
        kind: 'insufficient_authority',
        summary: `confirmed claim "${claim.statement}" rests on ${claim.sourceId}, which is not declared authoritative for ${claim.claimType}`,
        evidence: [{ ref: `claim:${claim.id}`, note: `from ${claim.sourceId}, provenance ${claim.provenance}` }],
        affected: [`claim:${claim.id}`],
        confidence: 0.9,
        repairPath: `declare ${claim.sourceId} authoritative for ${claim.claimType} if it is, or re-source the claim`,
      });
    }
  }
  return out;
}

/** Record detections as findings, skipping any already open for the same kind and affected set. */
export function recordDrift(store: StateStore, input: { readonly runId: string; readonly detected: readonly DetectedDrift[]; readonly at: string; readonly nextId: (prefix: string) => string }): { readonly recorded: DriftFinding[]; readonly alreadyOpen: number } {
  const open = listDriftFindings(store, { status: 'open' });
  const key = (kind: string, affected: readonly string[]) => `${kind}|${[...affected].sort().join(',')}`;
  const seen = new Set(open.map((f) => key(f.kind, f.affected)));
  const recorded: DriftFinding[] = [];
  let alreadyOpen = 0;
  for (const d of input.detected) {
    const k = key(d.kind, d.affected);
    if (seen.has(k)) {
      alreadyOpen += 1;
      continue;
    }
    seen.add(k);
    recorded.push(addDriftFinding(store, { id: input.nextId('drift'), runId: input.runId, kind: d.kind, summary: d.summary, evidence: d.evidence, affected: d.affected, confidence: d.confidence, repairPath: d.repairPath, at: input.at }));
  }
  return { recorded, alreadyOpen };
}
