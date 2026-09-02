/**
 * kernel/source/authority.ts — is a source allowed to settle this, and is what
 * it said still current?
 *
 * Authority is configured per claim type and never assumed from a system's
 * kind. A claim recorded from a source inherits the source's sensitivity at
 * least, its authority for that claim type, and a freshness window.
 */

import type { StateStore } from '../state/open.ts';
import { addClaim, type Claim } from '../state/graph.ts';
import {
  SENSITIVITIES,
  freshnessOf,
  getSource,
  isAuthoritativeFor,
  listSources,
  type AuthorityLevel,
  type Sensitivity,
  type Source,
} from '../state/sources.ts';

/** The more restrictive of two classifications. */
export function mostRestrictive(a: Sensitivity, b: Sensitivity): Sensitivity {
  return SENSITIVITIES.indexOf(a) >= SENSITIVITIES.indexOf(b) ? a : b;
}

/** Active sources declared authoritative for a claim type. */
export function authoritativeSourcesFor(store: StateStore, claimType: string): Source[] {
  return listSources(store, { status: 'active' }).filter((s) => isAuthoritativeFor(store, s.id, claimType) === 'yes');
}

/** What authority a claim of this type carries when it comes from this source. */
export function claimAuthorityFrom(store: StateStore, source: Source, claimType: string): AuthorityLevel {
  if (source.authorityLevel === 'untrusted') return 'untrusted';
  return isAuthoritativeFor(store, source.id, claimType) === 'yes' ? 'authoritative' : 'informative';
}

export interface RecordClaimFromSourceInput {
  readonly id: string;
  readonly sourceId: string;
  readonly subjectId: string;
  readonly claimType: string;
  readonly statement: string;
  readonly value?: unknown;
  readonly confidence: number;
  /** Requested classification; the source's own is applied when stricter. */
  readonly sensitivity?: Sensitivity;
  readonly observedAt: string;
  /** Used when the source declares no freshness expectation. */
  readonly defaultFreshnessHours: number;
  readonly at: string;
}

/**
 * Record what a source said about a subject. Authority and sensitivity are
 * derived from the source, never chosen by the caller.
 */
export function recordClaimFromSource(store: StateStore, input: RecordClaimFromSourceInput): Claim {
  const source = getSource(store, input.sourceId);
  if (!source) throw new Error(`no source ${input.sourceId}`);
  if (source.status !== 'active') throw new Error(`source ${input.sourceId} is retired; it cannot supply new claims`);
  const hours = source.freshnessHours ?? input.defaultFreshnessHours;
  const freshUntil = new Date(Date.parse(input.observedAt) + hours * 3_600_000).toISOString();
  return addClaim(store, {
    id: input.id,
    subjectId: input.subjectId,
    claimType: input.claimType,
    statement: input.statement,
    value: input.value,
    sourceId: source.id,
    provenance: 'source',
    authority: claimAuthorityFrom(store, source, input.claimType),
    sensitivity: mostRestrictive(source.sensitivity, input.sensitivity ?? 'public'),
    confidence: input.confidence,
    observedAt: input.observedAt,
    freshUntil,
    at: input.at,
  });
}

export interface AuthorityVerdict {
  readonly sufficient: boolean;
  readonly reasons: readonly string[];
  readonly supporting: readonly Claim[];
}

/**
 * Can these claims settle a conclusion of this claim type? Yes only when at
 * least one live claim comes from a source declared authoritative for the
 * type and that source's last read is not stale. Every shortfall is named.
 */
export function authorityVerdict(
  store: StateStore,
  input: { readonly claimType: string; readonly claims: readonly Claim[]; readonly at: string },
): AuthorityVerdict {
  const reasons: string[] = [];
  const supporting: Claim[] = [];
  const live = input.claims.filter((c) => c.status !== 'superseded' && c.claimType === input.claimType);
  if (live.length === 0) reasons.push(`no live claim of type ${input.claimType}`);
  for (const claim of live) {
    if (claim.provenance === 'user' && claim.status === 'confirmed') {
      supporting.push(claim);
      continue;
    }
    if (!claim.sourceId) {
      reasons.push(`claim ${claim.id} names no source`);
      continue;
    }
    const authority = isAuthoritativeFor(store, claim.sourceId, input.claimType);
    if (authority !== 'yes') {
      reasons.push(`source ${claim.sourceId} is ${authority === 'no' ? 'declared not authoritative' : 'not declared authoritative'} for ${input.claimType}`);
      continue;
    }
    const freshness = freshnessOf(store, claim.sourceId, input.at);
    if (freshness === 'stale' || freshness === 'never_read') {
      reasons.push(`source ${claim.sourceId} is ${freshness === 'stale' ? 'stale' : 'unread'}`);
      continue;
    }
    if (claim.freshUntil !== null && claim.freshUntil < input.at) {
      reasons.push(`claim ${claim.id} passed its freshness window at ${claim.freshUntil}`);
      continue;
    }
    supporting.push(claim);
  }
  return { sufficient: supporting.length > 0, reasons, supporting };
}
