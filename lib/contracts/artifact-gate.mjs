/**
 * lib/contracts/artifact-gate.mjs — binds the contract enforcement ladder
 * (lib/contracts/enforcement.mjs) to the artifact release gate chokepoint
 * (lib/artifact-release-gate.mjs), construct-uizpv.5.
 *
 * An artifact engages a contract by declaring risk flags in its frontmatter:
 *
 *   ---
 *   cx_risk_flags: compliance, privacy
 *   ---
 *
 * Declaration is the trigger, so nothing is blocked until an author says the
 * artifact carries the risk. That keeps the ladder opt-in per document rather
 * than inferring risk from prose, which would make the gate fire on wording.
 *
 * Fail-closed: an unreadable contract set blocks the release rather than
 * passing, mirroring lib/policy/audit-gate.mjs. The evaluator is not permitted
 * to report a clean gate it never actually ran.
 */

import fs from 'node:fs';

import {
  ContractEvaluatorUnavailableError,
  evaluateContractGate,
} from './enforcement.mjs';
import { loadGateRecords } from './sign-off.mjs';

export const RISK_FLAGS_FIELD = 'cx_risk_flags';

/**
 * Risk flags declared in an artifact's frontmatter, as a deduped list.
 * A missing or unparseable frontmatter block yields no flags — the artifact
 * simply engages no contracts.
 */
export function parseArtifactRiskFlags(filePath) {
  let head;
  try {
    head = fs.readFileSync(filePath, 'utf8').slice(0, 4096);
  } catch {
    return [];
  }
  const match = head.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return [];

  for (const line of match[1].split('\n')) {
    const m = line.match(/^([\w-]+)\s*:\s*(.+)$/);
    if (!m || m[1] !== RISK_FLAGS_FIELD) continue;
    const raw = m[2].trim().replace(/^['"]|['"]$/g, '').replace(/^\[|\]$/g, '');
    const flags = raw
      .split(',')
      .map((flag) => flag.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean);
    return [...new Set(flags)];
  }
  return [];
}

function formatBlock(entry) {
  return `contract gate [${entry.level ?? 'invalid'}]: ${entry.reason}`;
}

/**
 * Evaluate the contract ladder for one artifact and return release-gate
 * shaped `{ errors, warnings, contractGate }`.
 *
 * Blocked contracts become errors (the release gate fails). Overrides and
 * advisory contracts become warnings — visible in the gate output, not fatal.
 */
export function evaluateArtifactContracts({
  filePath,
  artifactType = null,
  projectRoot = process.cwd(),
  rootDir,
  registry = null,
  riskFlags = null,
} = {}) {
  const flags = riskFlags ?? parseArtifactRiskFlags(filePath);
  if (flags.length === 0) {
    return { errors: [], warnings: [], contractGate: { evaluated: [], riskFlags: [] } };
  }

  let records;
  try {
    records = loadGateRecords({ projectRoot, artifactRef: filePath });
  } catch (err) {
    return {
      errors: [`contract gate: sign-off store unreadable (${err.message}) — release refused fail-closed`],
      warnings: [],
      contractGate: { evaluated: [], riskFlags: flags, unavailable: true },
    };
  }

  let result;
  try {
    result = evaluateContractGate({
      artifactType,
      riskFlags: flags,
      rootDir,
      registry,
      signOffs: records.signOffs,
      overrides: records.overrides,
    });
  } catch (err) {
    if (err instanceof ContractEvaluatorUnavailableError) {
      return {
        errors: [`contract gate: ${err.message} — release refused fail-closed`],
        warnings: [],
        contractGate: { evaluated: [], riskFlags: flags, unavailable: true },
      };
    }
    throw err;
  }

  const warnings = [
    ...result.overridden.map((entry) => `contract gate [soft]: contract '${entry.contractId}' overridden — ${entry.reason}`),
    ...result.advisory.map((entry) => `contract gate [advisory]: ${entry.reason}`),
  ];

  return {
    errors: result.blocked.map(formatBlock),
    warnings,
    contractGate: {
      evaluated: result.evaluated,
      blocked: result.blocked,
      overridden: result.overridden,
      advisory: result.advisory,
      riskFlags: flags,
    },
  };
}
