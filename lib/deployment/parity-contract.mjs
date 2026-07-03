/**
 * lib/deployment/parity-contract.mjs — capability parity across deployment modes.
 *
 * Declares, for every dimension of lib/deployment-mode.mjs RESOURCE_TOPOLOGY,
 * whether the capability is `parity` (present in every mode, backend may differ)
 * or `mode-specific` (present only in some modes, by design). validateParityContract
 * cross-checks the declaration against the live topology so the two cannot drift:
 * a new topology dimension with no declaration, or a `parity` capability absent in
 * a mode, fails the check. See ADR-0016.
 *
 * Scope is the static guard only. A live dual-run harness (run a capability in
 * solo and team, compare) is the stronger complement, tracked separately — it
 * needs a provisioned database and so cannot gate every change.
 */

import { DEPLOYMENT_MODES, resolveResourceMode } from '../deployment-mode.mjs';

export const PARITY_CLASSES = ['parity', 'mode-specific'];

// Backend value 'optional' means the capability is present but may run on a
// degraded local backend (e.g. file BM25 in place of pgvector); it still counts
// as present for parity purposes.

export const PARITY_CONTRACT = {
  queue: {
    parityClass: 'parity',
    capability: 'Work intake queue (enqueue, list pending, mark processed)',
    rationale: 'One kind:queue contract via lib/intake/queue.mjs; git-queue is the default provider (filesystem in solo), Postgres is an optional registry-selected provider.',
    evidence: 'tests/intake-queue-factory.test.mjs',
  },
  memory: {
    parityClass: 'parity',
    capability: 'Observation/memory store',
    rationale: 'Local index (solo) and shared Postgres (team) both satisfy the observation schema; Postgres is a secondary store.',
    evidence: 'lib/observation-store.mjs',
  },
  database: {
    parityClass: 'parity',
    capability: 'Knowledge retrieval and durable state',
    rationale: 'Present in every mode; solo degrades to file BM25 + local vectors when Postgres is absent.',
    evidence: 'lib/storage/hybrid-query.mjs',
  },
  telemetry: {
    parityClass: 'parity',
    capability: 'Trace capture',
    rationale: 'Local JSONL is the default in every mode; remote export (OTel/Langfuse) is opt-in, not required for the capability.',
    evidence: 'lib/telemetry/client.mjs',
  },
  workers: {
    parityClass: 'mode-specific',
    capability: 'Background worker pool that claims queued work',
    rationale: 'Solo runs work in-process in the user session; the async Docker/isolated worker pool exists only in team and enterprise.',
    evidence: 'lib/deployment-mode.mjs',
  },
  policy: {
    parityClass: 'mode-specific',
    capability: 'Server-side policy enforcement',
    rationale: 'Solo enforces via local hooks (lightweight); server-side/enforceable policy is a team and enterprise capability.',
    evidence: 'lib/deployment-mode.mjs',
  },
  mcp: {
    parityClass: 'mode-specific',
    capability: 'Brokered MCP with policy, audit, and rate limiting',
    rationale: 'Solo calls MCP tools directly; the broker (and its audit/rate-limit/policy) exists only in team and enterprise.',
    evidence: 'lib/mcp/broker.mjs',
  },
};

function topologyByDimension() {
  const byMode = {};
  for (const mode of DEPLOYMENT_MODES) byMode[mode] = resolveResourceMode(mode);
  const dimensions = new Set();
  for (const mode of DEPLOYMENT_MODES) for (const dim of Object.keys(byMode[mode])) dimensions.add(dim);
  return { byMode, dimensions: [...dimensions] };
}

/**
 * Cross-check the declared parity contract against the live resource topology.
 * Returns { ok, errors }. Failures: an undeclared topology dimension, a declared
 * capability with no topology dimension, an invalid parityClass, a `parity`
 * capability missing from some mode, or a `mode-specific` capability whose backend
 * is identical across all modes (then it is not actually mode-specific).
 */
export function validateParityContract() {
  const { byMode, dimensions } = topologyByDimension();
  const errors = [];

  for (const dim of dimensions) {
    if (!PARITY_CONTRACT[dim]) {
      errors.push(`topology dimension "${dim}" has no parity declaration (declare it parity or mode-specific in PARITY_CONTRACT)`);
    }
  }

  for (const [dim, decl] of Object.entries(PARITY_CONTRACT)) {
    if (!dimensions.includes(dim)) {
      errors.push(`parity declaration "${dim}" has no matching topology dimension`);
      continue;
    }
    if (!PARITY_CLASSES.includes(decl.parityClass)) {
      errors.push(`"${dim}": invalid parityClass "${decl.parityClass}"`);
      continue;
    }
    const values = DEPLOYMENT_MODES.map((m) => byMode[m][dim]);
    if (decl.parityClass === 'parity') {
      const missing = DEPLOYMENT_MODES.filter((m) => !byMode[m][dim]);
      if (missing.length > 0) {
        errors.push(`"${dim}" is declared parity but absent in mode(s): ${missing.join(', ')}`);
      }
    } else if (new Set(values).size === 1) {
      errors.push(`"${dim}" is declared mode-specific but its backend is identical across all modes (${values[0]})`);
    }
    if (!decl.rationale) errors.push(`"${dim}": mode-specific and parity declarations both require a rationale`);
  }

  return { ok: errors.length === 0, errors };
}

export function describeParityContract() {
  const { byMode } = topologyByDimension();
  const rows = Object.entries(PARITY_CONTRACT).map(([dim, decl]) => {
    const backends = DEPLOYMENT_MODES.map((m) => `${m}:${byMode[m][dim]}`).join(' ');
    return { dimension: dim, parityClass: decl.parityClass, backends, capability: decl.capability, rationale: decl.rationale };
  });
  return rows;
}

export async function runDeploymentParityCli(args = []) {
  if (args.includes('--json')) {
    const { ok, errors } = validateParityContract();
    process.stdout.write(JSON.stringify({ ok, errors, contract: describeParityContract() }, null, 2) + '\n');
    if (!ok) process.exit(1);
    return;
  }

  const { ok, errors } = validateParityContract();
  for (const row of describeParityContract()) {
    const mark = row.parityClass === 'parity' ? '=' : '≠';
    process.stdout.write(`${mark} ${row.dimension.padEnd(10)} [${row.parityClass}]  ${row.backends}\n   ${row.capability}\n`);
  }
  process.stdout.write('\n');
  if (ok) {
    process.stdout.write('✓ parity contract reconciled with deployment topology\n');
    return;
  }
  process.stderr.write(`✗ parity contract has ${errors.length} error(s):\n`);
  for (const e of errors) process.stderr.write(`  - ${e}\n`);
  process.exit(1);
}
