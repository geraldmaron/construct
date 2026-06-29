#!/usr/bin/env node
/**
 * scripts/migrate-org-modular.mjs — one-shot split of unified-registry.json into specialists/org/**.
 *
 * Emits groups, squads, specialists, contracts, and policies as individual JSON files.
 * Product-group pilots five squads; other macro groups get one squad each.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'specialists', 'unified-registry.json');
const ORG = path.join(ROOT, 'specialists', 'org');

const PRODUCT_SQUADS = [
  {
    id: 'product-management-team',
    name: 'Product Management',
    owner: 'product-manager',
    specialists: ['cx-product-manager'],
    roles: [
      'product-manager',
      'product-manager.product',
      'product-manager.platform',
      'product-manager.enterprise',
      'product-manager.ai-product',
      'product-manager.growth',
      'product-manager.business-strategy',
    ],
    collaborators: ['ux-research-team', 'design-team', 'research-team'],
    charter:
      'Own requirements, evidence-backed prioritization, and PRD-family artifacts. PM flavors (platform, growth, enterprise, AI product) are overlays — pick one per task. Escalates scope conflicts to Product Group leadership.',
  },
  {
    id: 'ux-research-team',
    name: 'UX Research',
    owner: 'ux-researcher',
    specialists: ['cx-ux-researcher'],
    roles: ['ux-researcher'],
    collaborators: ['product-management-team', 'design-team'],
    charter:
      'Own user research, usability findings, and evidence that grounds product decisions. Partners with Product Management on intake and with Design on interaction validation.',
  },
  {
    id: 'design-team',
    name: 'Design',
    owner: 'designer',
    specialists: ['cx-designer'],
    roles: ['designer'],
    collaborators: ['product-management-team', 'ux-research-team', 'accessibility-team'],
    charter:
      'Own interaction and visual design decisions within product scope. Partners with Accessibility on inclusive patterns and with Product Management on acceptance criteria.',
  },
  {
    id: 'research-team',
    name: 'Research',
    owner: 'researcher',
    specialists: ['cx-researcher'],
    roles: ['researcher'],
    collaborators: ['product-management-team', 'ux-research-team'],
    charter:
      'Own exploratory research, codebase discovery, and knowledge synthesis that informs product framing. Does not own implementation or release timing.',
  },
  {
    id: 'accessibility-team',
    name: 'Accessibility',
    owner: 'accessibility',
    specialists: ['cx-accessibility'],
    roles: ['accessibility'],
    collaborators: ['design-team', 'product-management-team'],
    charter:
      'Own accessibility standards, audits, and WCAG conformance for product surfaces. Can block ship when acceptance criteria violate accessibility policy.',
  },
];

const MECHANICAL_SQUADS = {
  'engineering-group': { id: 'engineering-team', name: 'Engineering', owner: 'architect' },
  'quality-group': { id: 'quality-team', name: 'Quality', owner: 'reviewer' },
  'governance-group': { id: 'governance-team', name: 'Governance', owner: 'security' },
  'operations-group': { id: 'operations-team', name: 'Operations', owner: 'sre' },
  'strategy-group': { id: 'strategy-team', name: 'Strategy', owner: 'rd-lead' },
};

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function main() {
  const registry = JSON.parse(fs.readFileSync(SRC, 'utf8'));
  const specsByGroup = {};
  for (const [id, spec] of Object.entries(registry.specialists)) {
    const g = spec.team;
    specsByGroup[g] = specsByGroup[g] || [];
    specsByGroup[g].push({ id, ...spec });
  }

  const squadIdsByGroup = {};
  const allSquads = {};

  for (const [groupId, group] of Object.entries(registry.teams)) {
    if (groupId === 'product-group') {
      const squadIds = PRODUCT_SQUADS.map((s) => s.id);
      squadIdsByGroup[groupId] = squadIds;
      const groupOut = {
        ...group,
        kind: 'group',
        squads: squadIds,
      };
      writeJson(path.join(ORG, 'groups', `${groupId}.json`), groupOut);

      for (const squadDef of PRODUCT_SQUADS) {
        const spec = specsByGroup[groupId].find((s) => squadDef.specialists.includes(s.id));
        const squad = {
          id: squadDef.id,
          kind: 'squad',
          groupId,
          name: squadDef.name,
          owner: squadDef.owner,
          roles: squadDef.roles,
          collaborators: squadDef.collaborators,
          specialists: squadDef.specialists,
          decisionRights: group.decisionRights,
          forbiddenDecisions: group.forbiddenDecisions,
          escalationPath: group.escalationPath,
          charter: squadDef.charter,
          contact: group.contact,
        };
        allSquads[squadDef.id] = squad;
        writeJson(path.join(ORG, 'teams', `${squadDef.id}.json`), squad);
      }
    } else {
      const mech = MECHANICAL_SQUADS[groupId];
      const members = specsByGroup[groupId] || [];
      const squadId = mech.id;
      squadIdsByGroup[groupId] = [squadId];
      const groupOut = { ...group, kind: 'group', squads: [squadId] };
      writeJson(path.join(ORG, 'groups', `${groupId}.json`), groupOut);

      const squad = {
        id: squadId,
        kind: 'squad',
        groupId,
        name: mech.name,
        owner: mech.owner,
        roles: group.roles,
        specialists: members.map((m) => m.id),
        collaborators: [],
        decisionRights: group.decisionRights,
        forbiddenDecisions: group.forbiddenDecisions,
        escalationPath: group.escalationPath,
        charter: group.charter,
        contact: group.contact,
        evidence: group.evidence,
        sources: group.sources,
      };
      allSquads[squadId] = squad;
      writeJson(path.join(ORG, 'teams', `${squadId}.json`), squad);
    }
  }

  for (const [specId, spec] of Object.entries(registry.specialists)) {
    const oldGroup = spec.team;
    let squadId;
    if (oldGroup === 'product-group') {
      const found = PRODUCT_SQUADS.find((s) => s.specialists.includes(specId));
      squadId = found?.id;
    } else {
      squadId = MECHANICAL_SQUADS[oldGroup]?.id;
    }
    if (!squadId) throw new Error(`No squad for ${specId} in ${oldGroup}`);

    const { team, ...rest } = spec;
    const out = {
      ...rest,
      team: squadId,
      teamId: squadId,
      groupId: oldGroup,
    };
    writeJson(path.join(ORG, 'specialists', `${specId}.json`), out);
  }

  for (const [contractId, contract] of Object.entries(registry.contracts)) {
    writeJson(path.join(ORG, 'contracts', `${contractId}.json`), { id: contractId, ...contract });
  }

  for (const [policyId, policy] of Object.entries(registry.policies)) {
    writeJson(path.join(ORG, 'policies', `${policyId}.json`), { id: policyId, ...policy });
  }

  console.log(`Wrote org modular files under ${ORG}`);
  console.log(`  groups: ${Object.keys(registry.teams).length}`);
  console.log(`  squads: ${Object.keys(allSquads).length}`);
  console.log(`  specialists: ${Object.keys(registry.specialists).length}`);
  console.log(`  contracts: ${Object.keys(registry.contracts).length}`);
  console.log(`  policies: ${Object.keys(registry.policies).length}`);
}

main();
