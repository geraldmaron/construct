/**
 * lib/init/doc-lanes.mjs — shared documentation lane definitions for init flows.
 *
 * Single source for DOC_LANES, presets, lane order, and alias normalization used
 * by both `construct init` (init-unified) and the legacy init-docs entrypoint.
 */

export const DOC_LANES = {
  adrs: {
    title: 'ADRs',
    dir: 'adr',
    description: 'Architecture decision records for decisions that have already been made.',
    templates: ['adr.md'],
  },
  briefs: {
    title: 'Briefs',
    dir: 'briefs',
    description: 'Research, evidence, signal, and one-pager style documents.',
    templates: [
      'research-brief.md',
      'evidence-brief.md',
      'signal-brief.md',
      'one-pager.md',
      'customer-profile.md',
      'product-intelligence-report.md',
      'backlog-proposal.md',
    ],
  },
  changelogs: {
    title: 'Changelogs',
    dir: 'changelogs',
    description: 'User-facing release notes and version history entries.',
    templates: ['changelog-entry.md'],
  },
  memos: {
    title: 'Memos',
    dir: 'memos',
    description: 'Decision memos and internal arguments for alignment and approval.',
    templates: ['memo.md'],
  },
  meetings: {
    title: 'Meetings',
    dir: 'meetings',
    description: 'Meeting notes, minutes, retros, standups, planning sessions, and agendas.',
    templates: ['__meeting-notes-template__'],
  },
  notes: {
    title: 'Notes',
    dir: 'notes',
    description: 'Working notes and lightweight durable context outside formal docs or meetings.',
    templates: ['__notes-template__'],
  },
  onboarding: {
    title: 'Onboarding',
    dir: 'onboarding',
    description: 'Runnable setup guides and first-day workflows for engineers, product, or ops.',
    templates: ['onboarding.md'],
  },
  postmortems: {
    title: 'Postmortems',
    dir: 'postmortems',
    description: 'Blameless incident reports: timeline, root cause, contributing factors, and corrective actions.',
    templates: ['incident-report.md'],
  },
  prds: {
    title: 'PRDs',
    dir: 'prds',
    description: 'Product and capability requirement documents.',
    templates: ['prd.md', 'meta-prd.md', 'prd-business.md', 'prd-platform.md', 'prfaq.md'],
  },
  rfcs: {
    title: 'RFCs',
    dir: 'rfcs',
    description: 'Architecture and implementation proposals that need review before a decision.',
    templates: ['rfc.md', 'rfc-platform.md'],
  },
  runbooks: {
    title: 'Runbooks',
    dir: 'runbooks',
    description: 'Operational procedures, diagnostics, remediation, and escalation paths.',
    templates: ['runbook.md'],
  },
};

export const LANE_ORDER = ['adrs', 'briefs', 'changelogs', 'memos', 'meetings', 'notes', 'onboarding', 'postmortems', 'prds', 'rfcs', 'runbooks'];

export const DOC_PRESETS = {
  lean: ['adrs', 'memos', 'meetings', 'notes', 'prds'],
  product: ['adrs', 'memos', 'meetings', 'notes', 'prds', 'rfcs'],
  full: LANE_ORDER,
};

export const DEFAULT_LANES = DOC_PRESETS.lean;

export const LANE_ALIASES = {
  adr: 'adrs',
  adrs: 'adrs',
  brief: 'briefs',
  briefs: 'briefs',
  changelog: 'changelogs',
  changelogs: 'changelogs',
  releases: 'changelogs',
  release: 'changelogs',
  memo: 'memos',
  memos: 'memos',
  meeting: 'meetings',
  meetings: 'meetings',
  minutes: 'meetings',
  retro: 'meetings',
  note: 'notes',
  notes: 'notes',
  onboard: 'onboarding',
  onboarding: 'onboarding',
  postmortem: 'postmortems',
  postmortems: 'postmortems',
  incident: 'postmortems',
  incidents: 'postmortems',
  prd: 'prds',
  prds: 'prds',
  rfc: 'rfcs',
  rfcs: 'rfcs',
  runbook: 'runbooks',
  runbooks: 'runbooks',
};

export function normalizeLaneKey(name) {
  return LANE_ALIASES[name.trim().toLowerCase()] ?? name.trim().toLowerCase();
}

export function normalizeCustomLaneName(name) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function parseCsvList(value) {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function parseSelectableLanes(value) {
  return value
    .split(/[,\n]/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      if (/^\d+$/.test(entry)) {
        const lane = LANE_ORDER[Number(entry) - 1];
        return lane ?? '';
      }
      return normalizeLaneKey(entry);
    })
    .filter((lane) => lane in DOC_LANES);
}
