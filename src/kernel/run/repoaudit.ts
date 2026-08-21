/**
 * kernel/run/repoaudit.ts — auditing what a consumer repository has enabled,
 * against the standards layer, as findings a person can check and proposals
 * a person can decide on.
 *
 * A benchmark a reader cannot check is not evidence, it is a claim wearing a
 * number. So every verdict here rests on one fact this run actually read from
 * the repository — a script list, a directory listing, a file's presence or
 * its stated absence — and the finding says which. A gate this pass cannot
 * evaluate from what it read is reported as exactly that, never guessed at:
 * a repository with no package.json gets "no package.json found", never a
 * silently-assumed zero.
 *
 * This is judgment only. hosts/repo/gates.ts is the IO half — it is the one
 * side allowed to touch a filesystem — and hands back RepoFacts, already
 * gathered, for this module to reason over. The split is the one
 * hosts/repo/evidence.ts already draws for the tracker reconcile: gathering
 * in hosts/, deciding here, so the decision is testable against a fixture
 * without a filesystem in sight.
 *
 * Findings become write proposals through the same primitive every other
 * outward change uses (store/sources.ts's proposeWrite), not through
 * run/proposals.ts's deliverable extraction. That module turns a role's own
 * prose into proposals by reading the finding's leading verb, because the
 * prose could say anything and the tier has to be read out of it. Every
 * finding here is already one of a fixed, known set — five gates, checked the
 * same way on every run — so the tier is a property of which gate is missing,
 * decided once below, not sniffed from a sentence. Reusing the verb-reading
 * path would let a rephrasing of the same finding change its risk tier, which
 * is exactly the instability a fixed checklist exists to avoid.
 */

import type { DeliverableTemplate, Slot } from '../plan/schema.ts';
import { standardsFor } from '../plan/standards.ts';

const slot = (name: string, expects: string, required = true): Slot => ({ name, expects, required });

/** What one repository's own files say, already gathered by the IO side. */
export interface RepoFacts {
  /** The ground root this audit was pointed at — every citation below is a path under it. */
  readonly root: string;
  readonly packageJson: {
    readonly path: string;
    readonly scripts: Readonly<Record<string, string>>;
  } | null;
  /** Workflow files under .github/workflows, relative to root, sorted. Empty when none exist. */
  readonly ciWorkflowFiles: readonly string[];
  /** Which eslint config file exists, if any — for the lint-strictness citation. */
  readonly eslintConfigPath: string | null;
  /** A tsconfig.json, or a "typescript" dependency, makes this a TypeScript project. */
  readonly isTypeScriptProject: boolean;
}

/** The gathered facts, or why the root could not be read — the same shape hosts/sources.ts uses for a source it cannot walk. */
export type RepoFactsResult =
  | ({ readonly outcome: 'read' } & RepoFacts)
  | { readonly outcome: 'unreachable'; readonly root: string; readonly reason: string };

export const GATE_IDS = ['a11y-tests', 'security-tests', 'ci', 'lint-strictness', 'typecheck'] as const;

export type GateId = (typeof GATE_IDS)[number];

export type GateStatus = 'enabled' | 'missing' | 'not-applicable';

export interface GateFinding {
  readonly gate: GateId;
  readonly label: string;
  readonly status: GateStatus;
  /** The file this verdict rests on, exactly as read — or where its absence was checked. */
  readonly citation: string;
  /** What was actually found there, in words a reader can check against the file itself. */
  readonly detail: string;
  /** The write a proposal would make. Set only when status is 'missing' and a proposal can be built. */
  readonly proposedChange: string | null;
  readonly risk: 'low' | 'high' | null;
  /** Why that tier, stated so the choice can be checked rather than taken on faith. */
  readonly riskReason: string | null;
  /** The external standard this gate's obligation descends from, named the way plan/standards.ts names it — or null where none grounds it. */
  readonly standard: string | null;
}

/** The standard a lens's method stands on, named for a reader — or null when plan/standards.ts records none. */
function standardCitation(lens: string): string | null {
  const ref = standardsFor(lens)?.refs[0];
  return ref ? `${ref.name} (${ref.publisher})` : null;
}

function scriptListDetail(scripts: Readonly<Record<string, string>>): string {
  const names = Object.keys(scripts);
  return names.length === 0 ? 'no scripts declared' : `scripts: ${names.join(', ')}`;
}

/** The finding every package.json-dependent gate reports when there is no package.json to read at all. */
function noPackageJson(gate: GateId, label: string, facts: RepoFacts, standard: string | null): GateFinding {
  return {
    gate,
    label,
    status: 'missing',
    citation: `${facts.root}/package.json`,
    detail: 'no package.json found',
    // Proposing to add a script to a file that does not exist would be
    // authoring a new file, not the small, additive edit the low tier below
    // is reasoned about — so no automatic proposal is built for this shape,
    // and a person reads the missing gate from the deliverable text instead.
    proposedChange: null,
    risk: null,
    riskReason: null,
    standard,
  };
}

const ADDITIVE_SCRIPT_RISK_REASON =
  'a new script key added to package.json runs nothing on its own — it takes effect only the next ' +
  'time a person or an existing process chooses to invoke it, and removing the line undoes it completely';

const A11Y_SCRIPT_RE = /a11y|accessib/i;

function checkA11yTests(facts: RepoFacts): GateFinding {
  const standard = standardCitation('design');
  if (!facts.packageJson) return noPackageJson('a11y-tests', 'accessibility tests', facts, standard);
  const { path, scripts } = facts.packageJson;
  const matched = Object.keys(scripts).find((name) => A11Y_SCRIPT_RE.test(name));
  if (matched) {
    return {
      gate: 'a11y-tests',
      label: 'accessibility tests',
      status: 'enabled',
      citation: path,
      detail: `scripts["${matched}"] = "${scripts[matched]}" (${scriptListDetail(scripts)})`,
      proposedChange: null,
      risk: null,
      riskReason: null,
      standard,
    };
  }
  return {
    gate: 'a11y-tests',
    label: 'accessibility tests',
    status: 'missing',
    citation: path,
    detail: `no accessibility-test script among its scripts (${scriptListDetail(scripts)})`,
    proposedChange: 'add a "test:a11y" script to package.json',
    risk: 'low',
    riskReason: ADDITIVE_SCRIPT_RISK_REASON,
    standard,
  };
}

const SECURITY_SCRIPT_RE = /secur|vuln/i;

function checkSecurityTests(facts: RepoFacts): GateFinding {
  const standard = standardCitation('security');
  if (!facts.packageJson) return noPackageJson('security-tests', 'security tests', facts, standard);
  const { path, scripts } = facts.packageJson;
  const matched = Object.keys(scripts).find((name) => SECURITY_SCRIPT_RE.test(name));
  if (matched) {
    return {
      gate: 'security-tests',
      label: 'security tests',
      status: 'enabled',
      citation: path,
      detail: `scripts["${matched}"] = "${scripts[matched]}" (${scriptListDetail(scripts)})`,
      proposedChange: null,
      risk: null,
      riskReason: null,
      standard,
    };
  }
  return {
    gate: 'security-tests',
    label: 'security tests',
    status: 'missing',
    citation: path,
    detail: `no security-test script among its scripts (${scriptListDetail(scripts)})`,
    proposedChange: 'add a "test:security" script to package.json',
    risk: 'low',
    riskReason: ADDITIVE_SCRIPT_RISK_REASON,
    standard,
  };
}

function checkCi(facts: RepoFacts): GateFinding {
  const citation = `${facts.root}/.github/workflows`;
  if (facts.ciWorkflowFiles.length > 0) {
    return {
      gate: 'ci',
      label: 'continuous integration',
      status: 'enabled',
      citation,
      detail: `${String(facts.ciWorkflowFiles.length)} workflow file(s): ${facts.ciWorkflowFiles.join(', ')}`,
      proposedChange: null,
      risk: null,
      riskReason: null,
      standard: null,
    };
  }
  return {
    gate: 'ci',
    label: 'continuous integration',
    status: 'missing',
    citation,
    detail: 'no CI configuration found (no .github/workflows directory, or it holds no workflow files)',
    proposedChange: "add a CI workflow under .github/workflows that runs the repository's own checks on every push",
    risk: 'high',
    riskReason:
      'unlike an inert script nobody runs until asked, a CI workflow is standing automation that starts ' +
      'executing unattended on the next push — spending minutes and touching whatever secrets the workflow ' +
      'is granted — before anyone has reviewed a single run of it, so a person decides before it exists',
    standard: null,
  };
}

const MAX_WARNINGS_RE = /--max-warnings[= ]/;

function checkLintStrictness(facts: RepoFacts): GateFinding {
  if (!facts.packageJson) return noPackageJson('lint-strictness', 'lint strictness', facts, null);
  const { path, scripts } = facts.packageJson;
  const configNote = facts.eslintConfigPath
    ? `an eslint config exists at ${facts.eslintConfigPath}`
    : 'no eslint config file found';
  const lintScript = scripts.lint;
  if (lintScript === undefined) {
    return {
      gate: 'lint-strictness',
      label: 'lint strictness',
      status: 'missing',
      citation: path,
      detail: `no "lint" script in package.json (${configNote}; ${scriptListDetail(scripts)})`,
      proposedChange: 'add a "lint" script to package.json that fails on any warning (for example, --max-warnings=0)',
      risk: 'low',
      riskReason: ADDITIVE_SCRIPT_RISK_REASON,
      standard: null,
    };
  }
  if (MAX_WARNINGS_RE.test(lintScript)) {
    return {
      gate: 'lint-strictness',
      label: 'lint strictness',
      status: 'enabled',
      citation: path,
      detail: `scripts.lint runs "${lintScript}" (${configNote})`,
      proposedChange: null,
      risk: null,
      riskReason: null,
      standard: null,
    };
  }
  return {
    gate: 'lint-strictness',
    label: 'lint strictness',
    status: 'missing',
    citation: path,
    detail: `scripts.lint runs "${lintScript}" with no --max-warnings budget configured (${configNote})`,
    proposedChange: 'add a --max-warnings budget to package.json\'s "lint" script so warnings fail the check rather than passing silently',
    risk: 'low',
    riskReason:
      'the edit is one line of an existing script, reversible with the same revert as any other line; it ' +
      "changes what the next run of the repo's own lint step reports, which a person reviewing the proposal " +
      'sees before it lands rather than after',
    standard: null,
  };
}

function checkTypecheck(facts: RepoFacts): GateFinding {
  if (!facts.isTypeScriptProject) {
    return {
      gate: 'typecheck',
      label: 'typecheck',
      status: 'not-applicable',
      citation: `${facts.root}/tsconfig.json`,
      detail: 'no tsconfig.json and no "typescript" dependency in package.json — not a TypeScript project',
      proposedChange: null,
      risk: null,
      riskReason: null,
      standard: null,
    };
  }
  if (!facts.packageJson) return noPackageJson('typecheck', 'typecheck', facts, null);
  const { path, scripts } = facts.packageJson;
  const matched = scripts.typecheck !== undefined ? 'typecheck' : scripts['type-check'] !== undefined ? 'type-check' : null;
  if (matched) {
    return {
      gate: 'typecheck',
      label: 'typecheck',
      status: 'enabled',
      citation: path,
      detail: `scripts["${matched}"] = "${scripts[matched]}"`,
      proposedChange: null,
      risk: null,
      riskReason: null,
      standard: null,
    };
  }
  return {
    gate: 'typecheck',
    label: 'typecheck',
    status: 'missing',
    citation: path,
    detail: `no "typecheck" script in package.json, though the repository is TypeScript (${scriptListDetail(scripts)})`,
    proposedChange: 'add a "typecheck" script to package.json (for example, "tsc --noEmit")',
    risk: 'low',
    riskReason: ADDITIVE_SCRIPT_RISK_REASON,
    standard: null,
  };
}

/** Every gate, checked against what this pass actually read, in GATE_IDS order. */
export function evaluateGates(facts: RepoFacts): readonly GateFinding[] {
  return [
    checkA11yTests(facts),
    checkSecurityTests(facts),
    checkCi(facts),
    checkLintStrictness(facts),
    checkTypecheck(facts),
  ];
}

export interface AuditProposal {
  readonly id: string;
  readonly gate: GateId;
  readonly source: string;
  readonly change: string;
  readonly justification: string;
  readonly risk: 'low' | 'high';
}

/**
 * Missing gates as write proposals against the declared source, via the same
 * shape store/sources.ts's proposeWrite takes. Ids are derived from the
 * source and the gate, not hashed or timestamped, so auditing the same
 * source twice proposes the same rows rather than doubling the queue — the
 * same idempotence run/proposals.ts gets from deriving ids off the
 * deliverable and the line.
 */
export function auditProposals(input: {
  readonly findings: readonly GateFinding[];
  readonly source: string;
  readonly locator: string;
}): readonly AuditProposal[] {
  const proposals: AuditProposal[] = [];
  for (const finding of input.findings) {
    if (finding.status !== 'missing') continue;
    if (finding.proposedChange === null || finding.risk === null) continue;
    proposals.push({
      id: `wp-audit-${input.source}-${finding.gate}`,
      gate: finding.gate,
      source: input.source,
      change: `${finding.proposedChange} in ${input.locator}`,
      // The citation is the file this run actually read and what it found
      // there — never the standard that motivates the gate, which belongs to
      // the deliverable's framing, not to the claim that the repo lacks this.
      justification: `${finding.citation}: ${finding.detail}`,
      risk: finding.risk,
    });
  }
  return proposals;
}

/** The deliverable form this audit fills: what a domain template declares, mirrored for a checklist no domain owns. */
export const AUDIT_TEMPLATE: DeliverableTemplate = {
  deliverable: 'repo enablement audit',
  form: 'issues',
  slots: [
    slot('finding', 'how many of the checked gates are enabled, missing, or not applicable, stated first'),
    slot(
      'gates-checked',
      'every gate checked, each cited to the file that grounds its verdict — present, missing, or not applicable, and why',
    ),
    slot(
      'missing-enables',
      'each missing gate as a numbered issue: what is absent, the file that shows it, and the write proposed to close it, or "none" when every applicable gate is already enabled',
    ),
    slot(
      'proposals-filed',
      'the write proposals filed from this audit, each carrying its citation and risk tier, or "none" when nothing was proposed',
    ),
  ],
};

function sectionHeading(slotName: string): string {
  return slotName
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function findingSection(findings: readonly GateFinding[], proposals: readonly AuditProposal[]): string[] {
  const enabled = findings.filter((f) => f.status === 'enabled').length;
  const missing = findings.filter((f) => f.status === 'missing').length;
  const notApplicable = findings.filter((f) => f.status === 'not-applicable').length;
  return [
    `${String(enabled)} of ${String(findings.length)} checked gate(s) enabled, ${String(missing)} missing` +
      (notApplicable > 0 ? `, ${String(notApplicable)} not applicable` : '') +
      `. ${String(proposals.length)} write proposal(s) filed from this audit.`,
  ];
}

function gatesCheckedSection(findings: readonly GateFinding[]): string[] {
  return findings.map((f) => {
    const standardNote = f.standard ? ` — obligation from ${f.standard}` : '';
    return `- ${f.label} [${f.status}]${standardNote}: ${f.detail} (${f.citation})`;
  });
}

function missingEnablesSection(findings: readonly GateFinding[]): string[] {
  const missing = findings.filter((f) => f.status === 'missing');
  if (missing.length === 0) return ['none — every applicable gate is already enabled.'];
  return missing.map((f, i) => {
    const proposed = f.proposedChange
      ? `Proposed: ${f.proposedChange} [${String(f.risk)} risk: ${String(f.riskReason)}]`
      : 'No automatic write proposed for this repository shape — see detail.';
    return `${String(i + 1)}. ${f.label} is missing. ${f.detail} (${f.citation}). ${proposed}`;
  });
}

function proposalsFiledSection(proposals: readonly AuditProposal[]): string[] {
  if (proposals.length === 0) return ['none.'];
  return proposals.map((p) => `- ${p.id} [${p.risk} risk]: ${p.change} — because ${p.justification}`);
}

/**
 * The audit as a document a person reads, filling AUDIT_TEMPLATE's slots in
 * order — one section per slot, so the two cannot silently drift apart.
 */
export function renderAuditDeliverable(input: {
  readonly locator: string;
  readonly findings: readonly GateFinding[];
  readonly proposals: readonly AuditProposal[];
}): string {
  const { locator, findings, proposals } = input;
  const bodyFor: Readonly<Record<string, () => string[]>> = {
    finding: () => findingSection(findings, proposals),
    'gates-checked': () => gatesCheckedSection(findings),
    'missing-enables': () => missingEnablesSection(findings),
    'proposals-filed': () => proposalsFiledSection(proposals),
  };
  const lines: string[] = [`# Repo enablement audit — ${locator}`, ''];
  for (const s of AUDIT_TEMPLATE.slots) {
    lines.push(`## ${sectionHeading(s.name)}`, '', ...bodyFor[s.name](), '');
  }
  return lines.join('\n').trimEnd() + '\n';
}
