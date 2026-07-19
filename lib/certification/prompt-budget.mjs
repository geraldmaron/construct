/**
 * lib/certification/prompt-budget.mjs — composed prompt weight evidence for skill chains.
 *
 * Estimates always-on token budget for representative orchestration chains against
 * the active model operating profile (balanced default, small when CONSTRUCT_MODEL_PROFILE=small).
 */

import fs from 'node:fs';
import path from 'node:path';

import { MODEL_OPERATING_PROFILES, resolveModelOperatingProfile } from '../model-router.mjs';
import { estimateTokensSync } from '../token-engine.js';
import { routeRequest } from '../orchestration-policy.mjs';

const REPRESENTATIVE_CHAINS = Object.freeze([
  {
    id: 'prd-draft-orchestrated',
    request: 'Draft a product PRD for tenant billing isolation with sourced risks.',
    fileCount: 3,
    moduleCount: 2,
    skillPaths: ['docs/prd-workflow', 'perspectives/product-manager'],
  },
  {
    id: 'security-review-focused',
    request: 'Review authentication changes for STRIDE threats and escalation paths.',
    fileCount: 5,
    moduleCount: 2,
    skillPaths: ['quality-gates/verify-security', 'perspectives/security'],
  },
  {
    id: 'adr-architecture-orchestrated',
    request: 'Propose an ADR for multi-region failover with rejected alternatives.',
    fileCount: 4,
    moduleCount: 3,
    skillPaths: ['docs/adr-workflow', 'perspectives/architect'],
  },
]);

function findConstructRoot(startPath = process.cwd()) {
  let current = path.resolve(startPath);
  while (true) {
    if (fs.existsSync(path.join(current, 'package.json'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(startPath);
    current = parent;
  }
}

function readSkillBody(relPath, rootDir) {
  const root = findConstructRoot(rootDir);
  const file = path.join(root, 'skills', `${relPath}.md`);
  if (!fs.existsSync(file)) return '';
  return fs.readFileSync(file, 'utf8');
}

function estimateChainTokens(chain, { rootDir, modelId = 'openai/gpt-4o' } = {}) {
  const profile = resolveModelOperatingProfile({ envValues: process.env });
  const routing = routeRequest({
    request: chain.request,
    fileCount: chain.fileCount,
    moduleCount: chain.moduleCount,
  });

  let skillTokens = 0;
  for (const skillPath of chain.skillPaths) {
    skillTokens += estimateTokensSync(readSkillBody(skillPath, rootDir), modelId);
  }

  const orchestrationHint = JSON.stringify({
    track: routing.track,
    specialists: routing.specialists?.slice(0, 3) ?? [],
    gates: routing.gates ?? {},
  });

  const alwaysOn = estimateTokensSync(chain.request, modelId)
    + estimateTokensSync(orchestrationHint, modelId)
    + Math.min(skillTokens, profile.roleFlavorTokens)
    + profile.taskPacketTokens
    + profile.contextDigestTokens;

  return {
    chainId: chain.id,
    profileId: profile.id,
    maxPromptTokens: profile.maxPromptTokens,
    estimatedAlwaysOnTokens: alwaysOn,
    skillTokensRaw: skillTokens,
    roleFlavorCap: profile.roleFlavorTokens,
    pass: alwaysOn <= profile.maxPromptTokens,
  };
}

export function measurePromptBudgetChains({ rootDir, env = process.env } = {}) {
  const prev = { ...process.env };
  Object.assign(process.env, env);
  try {
    const profile = resolveModelOperatingProfile({ envValues: env });
    const chains = REPRESENTATIVE_CHAINS.map((chain) => estimateChainTokens(chain, { rootDir }));
    const failures = chains.filter((c) => !c.pass);
    return {
      pass: failures.length === 0,
      profile: {
        id: profile.id,
        maxPromptTokens: profile.maxPromptTokens,
        source: 'lib/model-router.mjs MODEL_OPERATING_PROFILES',
      },
      chains,
      errors: failures.map((f) => `${f.chainId}: ${f.estimatedAlwaysOnTokens} > ${f.maxPromptTokens}`),
    };
  } finally {
    Object.assign(process.env, prev);
  }
}

export function listOperatingProfileThresholds() {
  return Object.values(MODEL_OPERATING_PROFILES).map((p) => ({
    id: p.id,
    maxPromptTokens: p.maxPromptTokens,
  }));
}
