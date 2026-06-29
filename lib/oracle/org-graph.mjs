/**
 * lib/oracle/org-graph.mjs — org-in-a-box propagation graph collector.
 *
 * Loads policy inventory, workflow gates, intake sign-offs, and capability
 * human gates. Produces findings for synthesizeVerdict — no side effects.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { alignmentFindings } from '../workflow-state.mjs';
import { loadCapabilityRegistry } from '../registry/validate.mjs';
import { isConstructPackageRepo } from '../host-disposition.mjs';
import { loadRegistry } from '../registry/loader.mjs';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(MODULE_DIR, '../..');

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function collectPolicyInventory(rootDir) {
  let policies = [];
  try {
    const registry = loadRegistry({ rootDir, skipValidation: true });
    const raw = registry.policies || {};
    policies = Array.isArray(raw) ? raw : Object.values(raw);
  } catch {
    return { present: false, count: 0, policies: [] };
  }
  const orphans = [];
  for (const p of policies) {
    if (p.source && p.source !== 'built-in' && !p.source.startsWith('specialists/')) {
      const rulePath = path.join(rootDir, p.source);
      if (!fs.existsSync(rulePath)) orphans.push(p.id);
    }
  }
  return { present: true, count: policies.length, orphanPolicyIds: orphans };
}

function collectWorkflow(projectDir) {
  const file = path.join(projectDir, '.cx', 'workflow.json');
  const workflow = readJsonSafe(file);
  if (!workflow) return { present: false, findings: alignmentFindings(null) };
  return { present: true, workflow, findings: alignmentFindings(workflow) };
}

function collectIntakeSignoffs(projectDir) {
  const pendingDir = path.join(projectDir, '.cx', 'intake', 'pending');
  if (!fs.existsSync(pendingDir)) return { pendingCount: 0, legalPending: [], approvalPending: [] };
  const legalPending = [];
  const approvalPending = [];
  for (const name of fs.readdirSync(pendingDir)) {
    if (!name.endsWith('.json')) continue;
    const packet = readJsonSafe(path.join(pendingDir, name));
    if (!packet) continue;
    const triage = packet.triage ?? {};
    if (triage.intakeType === 'legal-compliance' || triage.primaryOwner === 'legal-compliance') {
      legalPending.push({ id: packet.id ?? name.replace(/\.json$/, ''), triage });
    }
    if (triage.requiresApproval === true) {
      approvalPending.push({ id: packet.id ?? name.replace(/\.json$/, ''), triage });
    }
  }
  return { pendingCount: legalPending.length + approvalPending.length, legalPending, approvalPending };
}

function collectCapabilityGates(rootDir) {
  const raw = loadCapabilityRegistry({ rootDir });
  const unvalidated = [];
  for (const cap of raw.capabilities ?? []) {
    if (cap.criticality !== 'P0' && cap.criticality !== 'P1') continue;
    if (!cap.lastValidated) {
      unvalidated.push({ id: cap.id, criticality: cap.criticality, humanGate: cap.humanGate ?? null });
    }
  }
  return { count: (raw.capabilities ?? []).length, unvalidatedP0P1: unvalidated };
}

function collectPropagationSignals({ rootDir, projectDir, parity, registryValidate }) {
  const registryPath = path.join(rootDir, 'specialists', 'org');
  let registryMtime = null;
  try {
    registryMtime = fs.statSync(registryPath).mtimeMs;
  } catch { /* ignore */ }

  const staleSurfaces = (parity?.surfaces ?? []).filter((s) => s.stale || s.status === 'drift');
  const registryFailed = registryValidate && !registryValidate.valid;
  const needsPropagation = (!parity?.ok && !parity?.skipped) || staleSurfaces.length > 0 || registryFailed;

  return {
    registryMtime,
    needsPropagation,
    staleSurfaceCount: staleSurfaces.length,
    registryFailed,
  };
}

/**
 * @param {object} opts
 * @param {string} opts.rootDir
 * @param {string} opts.projectDir
 * @param {object} [opts.parity]
 * @param {object} [opts.registryValidate]
 */
export function collectOrgGraph({ rootDir = PACKAGE_ROOT, projectDir, parity, registryValidate }) {
  return {
    policyInventory: collectPolicyInventory(rootDir),
    workflow: collectWorkflow(projectDir),
    intakeSignoffs: collectIntakeSignoffs(projectDir),
    capabilityGates: collectCapabilityGates(rootDir),
    propagation: collectPropagationSignals({ rootDir, projectDir, parity, registryValidate }),
    isToolRepo: isConstructPackageRepo(projectDir),
  };
}

/**
 * Convert org graph into supplemental gap descriptors for synthesize.
 *
 * @param {object} orgGraph
 * @returns {object[]}
 */
export function orgGraphToGapHints(orgGraph) {
  const hints = [];
  if (orgGraph.propagation?.needsPropagation) {
    hints.push({ id: 'propagation-stale', severity: 'medium', signal: 'org-graph', detail: 'Upstream registry or parity drift — downstream surfaces may be stale' });
  }
  if (orgGraph.policyInventory?.orphanPolicyIds?.length) {
    hints.push({
      id: 'policy-coverage-gap',
      severity: 'medium',
      signal: 'policy-inventory',
      detail: `${orgGraph.policyInventory.orphanPolicyIds.length} policy source(s) missing on disk`,
    });
  }
  for (const f of orgGraph.workflow?.findings ?? []) {
    if (f.severity === 'HIGH') {
      hints.push({
        id: 'workflow-misaligned',
        severity: 'high',
        signal: 'workflow',
        detail: f.issue,
        gateType: 'executive-gate',
        task: f.task ?? null,
      });
    }
  }
  if (orgGraph.intakeSignoffs?.legalPending?.length) {
    hints.push({
      id: 'legal-review-pending',
      severity: 'high',
      signal: 'intake',
      detail: `${orgGraph.intakeSignoffs.legalPending.length} legal-compliance intake packet(s) awaiting sign-off`,
      gateType: 'legal-compliance',
    });
  }
  const unvalidated = orgGraph.capabilityGates?.unvalidatedP0P1 ?? [];
  const p0Unvalidated = unvalidated.filter((c) => c.criticality === 'P0');
  if (p0Unvalidated.length) {
    hints.push({
      id: 'capability-unvalidated',
      severity: 'medium',
      signal: 'capabilities',
      detail: `P0/P1 capabilities without validation stamp: ${p0Unvalidated.map((c) => c.id).slice(0, 5).join(', ')}`,
      gateType: 'capability-human-gate',
    });
  }
  return hints;
}
