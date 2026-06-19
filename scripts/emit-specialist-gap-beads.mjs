/**
 * emit-specialist-gap-beads.mjs — file Wave C remediation beads from audit-enrichments gaps.
 *
 * Idempotent: reads scripts/audit/specialist-gap-beads.json for emitted ids; updates
 * specialists/audit-enrichments.json beadId fields when new beads are created.
 *
 * Run: node scripts/emit-specialist-gap-beads.mjs [--dry-run]
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAP_PATH = path.join(REPO, 'scripts', 'audit', 'specialist-gap-beads.json');
const ENRICHMENTS_PATH = path.join(REPO, 'specialists', 'audit-enrichments.json');

const EPIC = {
  key: 'epic',
  title: 'Skills & specialists remediation — Wave C role overlays',
  description: [
    'Follow-up from closed construct-hcr9. Raise adequate specialists and role overlays',
    'to strong grade per docs/concepts/specialist-skill-audit.md gaps.',
    '',
    'Source: specialists/audit-enrichments.json + construct audit specialists matrix.',
    '',
    'Acceptance: each child closed with overlay/skill diff + audit grade bump or gap cleared.',
  ].join('\n'),
  type: 'epic',
  priority: '2',
  labels: 'skills,specialists,quality',
};

const CHILDREN = [
  {
    key: 'research-validity',
    title: 'Deepen user-research validity and verify research workflow split',
    description: [
      'Specialists: cx-ux-researcher, cx-researcher, cx-explorer.',
      'Overlays: roles/researcher.ux, roles/researcher.explorer.',
      '',
      'Gaps: deepen validity methodology; confirm external-only research-workflow;',
      'confirm codebase-research-workflow bound to explorer profile.',
      '',
      'Acceptance:',
      '1. skills/docs/user-research-workflow.md covers inter-rater + validity threats with tests or lint.',
      '2. construct audit specialists shows gap cleared or grade strong for listed specialists.',
    ].join('\n'),
    acceptance: 'ux-researcher gap cleared in audit matrix; workflow bindings verified in profiles.',
    priority: '2',
    labels: 'skills,research',
    specialists: ['ux-researcher', 'researcher', 'explorer'],
    roleOverlays: ['researcher.ux', 'researcher.explorer'],
  },
  {
    key: 'review-gates',
    title: 'Devil-advocate PRD gate and FMEA role overlay',
    description: [
      'Specialists: cx-product-manager, cx-devil-advocate.',
      'Overlays: roles/reviewer.devil-advocate.',
      '',
      'Gaps: mandatory devil-advocate gate on PRD ship; FMEA enumeration on high-risk artifacts.',
      '',
      'Acceptance:',
      '1. artifact-manifest prd requiredReviewers includes cx-devil-advocate or contract enforces handoff.',
      '2. skills/roles/reviewer.devil-advocate.md documents FMEA steps; release gate or contract cites it.',
    ].join('\n'),
    acceptance: 'PRD ship requires devil-advocate review; FMEA steps in devil-advocate overlay.',
    priority: '1',
    labels: 'skills,review,gates',
    specialists: ['product-manager', 'devil-advocate'],
    roleOverlays: ['reviewer.devil-advocate'],
  },
  {
    key: 'artifact-tone',
    title: 'ADR diagram enforcement and manifest tone matrix wiring',
    description: [
      'Specialists: cx-architect, cx-docs-keeper.',
      'Overlays: roles/operator.docs.',
      '',
      'Gaps: ADR context diagram enforcement; per-doc-type tone matrix wired to manifest.',
      '',
      'Acceptance:',
      '1. adr manifest visualRequirements enforced in tests.',
      '2. tone-profiles.json + manifest toneDefault drive docs-keeper prompt or skill; doctor/audit cross-check passes.',
    ].join('\n'),
    acceptance: 'ADR context diagram gate green; docs-keeper tone gap cleared.',
    priority: '2',
    labels: 'skills,artifacts,tone',
    specialists: ['architect', 'docs-keeper'],
    roleOverlays: ['operator.docs'],
  },
  {
    key: 'security-compliance',
    title: 'STRIDE/PASTA and legal risk taxonomy overlays',
    description: [
      'Specialists: cx-security, cx-legal-compliance.',
      'Overlays: roles/security, roles/security.legal-compliance.',
      '',
      'Gaps: explicit STRIDE/PASTA steps; risk taxonomy and technical-legal bridge.',
      '',
      'Acceptance: overlay files enumerate STRIDE/PASTA and risk taxonomy; threat-model manifest reviewers unchanged.',
    ].join('\n'),
    acceptance: 'security and legal-compliance gaps cleared in audit matrix.',
    priority: '2',
    labels: 'skills,security,compliance',
    specialists: ['security', 'legal-compliance'],
    roleOverlays: ['security', 'security.legal-compliance'],
  },
  {
    key: 'sre-release',
    title: 'Error-budget and canary rollback overlays',
    description: [
      'Specialists: cx-sre, cx-release-manager.',
      'Overlays: roles/operator.sre, roles/operator.release.',
      '',
      'Gaps: error-budget policy explicit; canary failure-detection and SLO rollback trees.',
      '',
      'Acceptance: operator.sre and operator.release overlays document policies; audit gaps cleared.',
    ].join('\n'),
    acceptance: 'sre and release-manager gaps cleared in audit matrix.',
    priority: '2',
    labels: 'skills,sre,release',
    specialists: ['sre', 'release-manager'],
    roleOverlays: ['operator.sre', 'operator.release'],
  },
  {
    key: 'tpm-strategy',
    title: 'TPM critical-path and strategy scenario overlays',
    description: [
      'Specialists: cx-operations, cx-business-strategist.',
      'Overlays: roles/product-manager.business-strategy.',
      '',
      'Gaps: critical-path method and resource leveling; Porter Five Forces and scenario planning.',
      '',
      'Acceptance: overlays updated; adequate grades cleared in audit matrix.',
    ].join('\n'),
    acceptance: 'operations and business-strategist gaps cleared.',
    priority: '3',
    labels: 'skills,strategy,operations',
    specialists: ['operations', 'business-strategist'],
    roleOverlays: ['product-manager.business-strategy'],
  },
  {
    key: 'platform-data',
    title: 'Platform IaC/SBOM and data lineage overlays',
    description: [
      'Specialists: cx-platform-engineer, cx-data-engineer.',
      'Overlays: roles/engineer.platform, roles/data-engineer.pipeline.',
      '',
      'Gaps: IaC maturity and SBOM; data lineage and SLA maturity; pipeline lineage observability.',
      '',
      'Acceptance: overlays document lineage/SBOM/IaC; audit gaps cleared.',
    ].join('\n'),
    acceptance: 'platform-engineer and data-engineer gaps cleared.',
    priority: '2',
    labels: 'skills,platform,data',
    specialists: ['platform-engineer', 'data-engineer'],
    roleOverlays: ['engineer.platform', 'data-engineer.pipeline'],
  },
  {
    key: 'design-a11y',
    title: 'Design-system and cognitive accessibility overlays',
    description: [
      'Specialists: cx-designer, cx-accessibility.',
      'Overlays: roles/designer, roles/designer.accessibility.',
      '',
      'Gaps: design-system maturity; cognitive accessibility rigor.',
      '',
      'Acceptance: overlays updated; designer and accessibility gaps cleared in audit.',
    ].join('\n'),
    acceptance: 'designer and accessibility gaps cleared.',
    priority: '2',
    labels: 'skills,design,a11y',
    specialists: ['designer', 'accessibility'],
    roleOverlays: ['designer', 'designer.accessibility'],
  },
  {
    key: 'debug-observability',
    title: 'Causal debugging and SPC trace-review overlays',
    description: [
      'Specialists: cx-debugger, cx-trace-reviewer.',
      'Overlays: roles/debugger, roles/reviewer.trace.',
      '',
      'Gaps: causal-model root-cause enumeration; statistical process control drift detection.',
      '',
      'Acceptance: overlays document causal enumeration and SPC; audit gaps cleared.',
    ].join('\n'),
    acceptance: 'debugger and trace-reviewer gaps cleared.',
    priority: '2',
    labels: 'skills,debugging,observability',
    specialists: ['debugger', 'trace-reviewer'],
    roleOverlays: ['debugger', 'reviewer.trace'],
  },
  {
    key: 'oracle-routing',
    title: 'Oracle read-model remediation routing evidence',
    description: [
      'Specialist: cx-oracle.',
      '',
      'Gap: read-model gaps need explicit remediation routing evidence.',
      '',
      'Acceptance: lib/oracle/read-model.mjs or synthesize emits actionable routing artifact;',
      'construct audit specialists oracle gap cleared.',
    ].join('\n'),
    acceptance: 'oracle specialist gap cleared; routing evidence in Oracle output.',
    priority: '2',
    labels: 'skills,oracle',
    specialists: ['oracle'],
    roleOverlays: [],
  },
  {
    key: 'research-science',
    title: 'RD-lead power analysis and effect-size overlay',
    description: [
      'Specialist: cx-rd-lead (roles/architect overlay).',
      '',
      'Gap: add power analysis and effect-size estimation to role overlay.',
      '',
      'Acceptance: skills/roles/architect.md or rd-lead prompt includes power/effect-size guidance;',
      'audit gap cleared.',
    ].join('\n'),
    acceptance: 'rd-lead gap cleared in audit matrix.',
    priority: '3',
    labels: 'skills,research,science',
    specialists: ['rd-lead'],
    roleOverlays: ['architect'],
  },
];

function bd(args) {
  return execFileSync('bd', args, { cwd: REPO, encoding: 'utf8' });
}

function parseId(out) {
  const m = out.match(/Created issue:\s*(construct-[a-z0-9.]+)/i);
  return m?.[1] ?? null;
}

function createIssue({ parent, title, description, acceptance, type, priority, labels }) {
  const args = [
    'create', title,
    '--description', description,
    '--type', type,
    '--priority', priority,
    '--labels', labels,
  ];
  if (acceptance) args.push('--acceptance', acceptance);
  if (parent) args.push('--parent', parent);
  return parseId(bd(args));
}

function main() {
  const dryRun = process.argv.includes('--dry-run');
  const emitted = fs.existsSync(MAP_PATH)
    ? JSON.parse(fs.readFileSync(MAP_PATH, 'utf8'))
    : { epicId: null, children: {} };

  if (!emitted.epicId && !dryRun) {
    emitted.epicId = createIssue({
      title: EPIC.title,
      description: EPIC.description,
      type: EPIC.type,
      priority: EPIC.priority,
      labels: EPIC.labels,
    });
    process.stdout.write(`[gap-beads] epic: ${emitted.epicId}\n`);
  } else if (!emitted.epicId) {
    process.stdout.write(`[gap-beads] would create epic: ${EPIC.title}\n`);
  }

  const epicId = emitted.epicId || 'construct-EPIC';

  for (const child of CHILDREN) {
    if (emitted.children[child.key]) {
      if (dryRun) {
        process.stdout.write(`[gap-beads] exists ${child.key}: ${emitted.children[child.key]}\n`);
      } else {
        process.stdout.write(`[gap-beads] skip ${child.key}: ${emitted.children[child.key]}\n`);
      }
      continue;
    }
    if (dryRun) {
      process.stdout.write(`[gap-beads] would create: ${child.title}\n`);
      emitted.children[child.key] = `construct-${child.key}`;
      continue;
    }
    const id = createIssue({
      parent: epicId,
      title: child.title,
      description: child.description,
      acceptance: child.acceptance,
      type: 'task',
      priority: child.priority,
      labels: child.labels,
    });
    if (!id) throw new Error(`failed to create bead for ${child.key}`);
    emitted.children[child.key] = id;
    process.stdout.write(`[gap-beads] ${child.key}: ${id}\n`);
  }

  if (dryRun) return;

  const enrichments = JSON.parse(fs.readFileSync(ENRICHMENTS_PATH, 'utf8'));

  for (const [name, meta] of Object.entries(enrichments.specialists ?? {})) {
    if (meta.gap === '—') meta.beadId = 'construct-hcr9';
  }

  for (const child of CHILDREN) {
    const beadId = emitted.children[child.key];
    for (const name of child.specialists ?? []) {
      if (enrichments.specialists?.[name]) enrichments.specialists[name].beadId = beadId;
    }
    for (const key of child.roleOverlays ?? []) {
      if (!enrichments.roleOverlays?.[key]) continue;
      enrichments.roleOverlays[key].beadId = beadId;
    }
  }

  fs.writeFileSync(ENRICHMENTS_PATH, `${JSON.stringify(enrichments, null, 2)}\n`);
  fs.mkdirSync(path.dirname(MAP_PATH), { recursive: true });
  fs.writeFileSync(MAP_PATH, `${JSON.stringify(emitted, null, 2)}\n`);
  process.stdout.write(`[gap-beads] updated ${ENRICHMENTS_PATH} beadIds\n`);
}

main();
