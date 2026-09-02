/**
 * kernel/source/connector.ts — what a connector declares about the system it reaches.
 *
 * A connector says what kind of system it speaks to, which claim types that
 * system can supply, what it can read and write, and where its credential
 * lives (never the kernel, never a committed file). Authority is not part of
 * a declaration: a source is authoritative only for what the project
 * configures, claim type by claim type.
 */

import type { ActionTier } from '../state/steps.ts';
import type { SourceKind } from './locators.ts';

export const CREDENTIAL_SOURCES = ['host', 'environment', 'connector'] as const;
export type CredentialSource = (typeof CREDENTIAL_SOURCES)[number];

export interface ConnectorDeclaration {
  readonly id: string;
  readonly systemKind: SourceKind;
  /** Claim types the system can supply evidence for. Supply is not authority. */
  readonly supplies: readonly string[];
  /** Claim types the system is commonly mistaken as authoritative for. */
  readonly commonlyMistakenFor: readonly string[];
  readonly read: boolean;
  readonly write: boolean;
  readonly writeTiers: readonly ActionTier[];
  readonly credentialSource: CredentialSource;
  readonly notes: string;
}

/** What one read of a source produced, as the connector or host reports it. */
export interface SnapshotReport {
  readonly digest: string;
  readonly summary: string;
  readonly evidenceRef?: string;
  /** Whether code that ran produced this, or a host relayed a claim about running. */
  readonly evidence: 'witnessed' | 'reported';
  readonly items?: readonly SnapshotItem[];
}

export interface SnapshotItem {
  readonly externalRef: string;
  readonly kind: string;
  readonly name: string;
  readonly attributes?: Readonly<Record<string, unknown>>;
}

export type ReadOutcome =
  | { readonly outcome: 'read'; readonly report: SnapshotReport }
  | { readonly outcome: 'unreachable'; readonly reason: string };

/** A reader for one source kind: given a locator, what is there. */
export type SourceReader = (input: { readonly sourceId: string; readonly kind: string; readonly locator: string | null }) => Promise<ReadOutcome>;

export const BUILTIN_CONNECTOR_DECLARATIONS: readonly ConnectorDeclaration[] = Object.freeze([
  {
    id: 'github',
    systemKind: 'github',
    supplies: ['work_item', 'code_change', 'code_component', 'contributor_activity', 'review_activity'],
    commonlyMistakenFor: ['ownership', 'reporting_line', 'capacity'],
    read: true,
    write: true,
    writeTiers: ['external_write'],
    credentialSource: 'host',
    notes: 'Commits and reviews show who touched what, which is collaboration, not ownership or authority.',
  },
  {
    id: 'jira',
    systemKind: 'jira',
    supplies: ['work_item', 'initiative_link', 'assignment', 'status', 'throughput_history'],
    commonlyMistakenFor: ['capacity', 'ownership', 'priority_truth'],
    read: true,
    write: true,
    writeTiers: ['external_write'],
    credentialSource: 'environment',
    notes: 'Velocity is throughput history under past conditions; it is never capacity.',
  },
  {
    id: 'docs',
    systemKind: 'docs',
    supplies: ['document', 'stated_intent', 'decision_record', 'requirement'],
    commonlyMistakenFor: ['current_truth'],
    read: true,
    write: true,
    writeTiers: ['draft', 'external_write'],
    credentialSource: 'host',
    notes: 'A document says what someone wrote when they wrote it; freshness decides whether it still governs.',
  },
  {
    id: 'hris',
    systemKind: 'hris',
    supplies: ['employment', 'reporting_line', 'team_membership', 'role_title', 'headcount'],
    commonlyMistakenFor: ['capacity', 'decision_rights', 'actual_collaboration'],
    read: true,
    write: false,
    writeTiers: [],
    credentialSource: 'connector',
    notes: 'Formal structure. Reporting lines still need confirmation before Construct treats them as authority.',
  },
  {
    id: 'directory',
    systemKind: 'directory',
    supplies: ['document', 'code_component', 'test', 'configuration'],
    commonlyMistakenFor: [],
    read: true,
    write: true,
    writeTiers: ['project_write'],
    credentialSource: 'host',
    notes: 'Local files the host can already read.',
  },
]);

export function connectorDeclaration(id: string): ConnectorDeclaration | null {
  return BUILTIN_CONNECTOR_DECLARATIONS.find((c) => c.id === id) ?? null;
}

/** A one-paragraph description a person can read before trusting a source. */
export function describeConnector(c: ConnectorDeclaration): string {
  const rw = c.read && c.write ? 'reads and writes' : c.read ? 'reads only' : c.write ? 'writes only' : 'neither reads nor writes';
  const mistaken = c.commonlyMistakenFor.length ? ` It is not authoritative for ${c.commonlyMistakenFor.join(', ')} unless you say so.` : '';
  return `${c.id} ${rw} a ${c.systemKind} system and can supply ${c.supplies.join(', ')}.${mistaken} Credentials stay with the ${c.credentialSource}. ${c.notes}`;
}
