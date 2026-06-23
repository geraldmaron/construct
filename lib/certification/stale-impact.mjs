/**
 * lib/certification/stale-impact.mjs — mark certification evidence stale on ledger path changes.
 *
 * When files in a capability ledger changePaths entry change, related certification
 * evidence in .cx/certification/status.json is marked stale. Integrates with the
 * graph impact rollup via staleCapabilitiesFromChange.
 */

import fs from 'node:fs';
import path from 'node:path';
import { loadCapabilityLedger } from '../capability-ledger.mjs';

function findProjectRoot(startPath = process.cwd()) {
  let current = path.resolve(startPath);
  while (true) {
    if (fs.existsSync(path.join(current, 'package.json'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(startPath);
    current = parent;
  }
}

export function certificationStatusPath(rootDir = process.cwd()) {
  return path.join(findProjectRoot(rootDir), '.cx', 'certification', 'status.json');
}

function normalizeRel(rel) {
  return rel.split('\\').join('/').replace(/^\.\//, '');
}

export function pathMatchesChangePath(changedFile, changePath) {
  const file = normalizeRel(changedFile);
  const pattern = normalizeRel(changePath);
  if (pattern.endsWith('/**')) {
    const prefix = pattern.slice(0, -3);
    return file === prefix || file.startsWith(`${prefix}/`);
  }
  if (pattern.includes('**')) {
    const segment = pattern.replace(/\*\*/g, '').replace(/\/$/, '');
    return file.includes(segment);
  }
  return file === pattern;
}

export function capabilitiesForChangedPaths(changedFiles, { rootDir } = {}) {
  const ledgerPath = path.join(findProjectRoot(rootDir), 'tests', 'capabilities', 'ledger.json');
  if (!fs.existsSync(ledgerPath)) return new Map();
  const { ledger } = loadCapabilityLedger({ rootDir });
  const norm = [...new Set((changedFiles ?? []).map(normalizeRel).filter(Boolean))];
  const matched = new Map();

  for (const capability of ledger.capabilities ?? []) {
    const paths = capability.changePaths ?? [];
    const hits = norm.filter((file) => paths.some((cp) => pathMatchesChangePath(file, cp)));
    if (hits.length) matched.set(capability.id, hits);
  }
  return matched;
}

export function staleCapabilitiesFromChange({ rootDir, changedFiles }) {
  const matched = capabilitiesForChangedPaths(changedFiles, { rootDir });
  return [...matched.keys()].sort();
}

function defaultCapabilityStatus(capabilityId) {
  return {
    capabilityId,
    status: 'current',
    lastVerifiedAt: null,
    staleSince: null,
    staleReason: null,
    stalePaths: [],
  };
}

export function loadCertificationStatus({ rootDir, createIfMissing = false } = {}) {
  const filePath = certificationStatusPath(rootDir);
  if (!fs.existsSync(filePath)) {
    if (!createIfMissing) return { filePath, status: null, exists: false };
    const ledgerPath = path.join(findProjectRoot(rootDir), 'tests', 'capabilities', 'ledger.json');
    if (!fs.existsSync(ledgerPath)) {
      return { filePath, status: { version: 1, updatedAt: new Date().toISOString(), capabilities: {} }, exists: false };
    }
    const { ledger } = loadCapabilityLedger({ rootDir });
    const capabilities = {};
    for (const cap of ledger.capabilities ?? []) {
      capabilities[cap.id] = defaultCapabilityStatus(cap.id);
    }
    const status = { version: 1, updatedAt: new Date().toISOString(), capabilities };
    return { filePath, status, exists: false };
  }
  const status = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return { filePath, status, exists: true };
}

export function applyStaleImpact({ rootDir, changedFiles, now = () => new Date().toISOString() } = {}) {
  const matched = capabilitiesForChangedPaths(changedFiles, { rootDir });
  const ledgerPath = path.join(findProjectRoot(rootDir), 'tests', 'capabilities', 'ledger.json');
  if (!fs.existsSync(ledgerPath)) {
    return { filePath: certificationStatusPath(rootDir), status: null, markedCapabilities: [], staleCapabilities: [] };
  }
  const { filePath, status: existing } = loadCertificationStatus({ rootDir, createIfMissing: true });
  const { ledger } = loadCapabilityLedger({ rootDir });

  const capabilities = { ...(existing?.capabilities ?? {}) };
  for (const cap of ledger.capabilities ?? []) {
    if (!capabilities[cap.id]) capabilities[cap.id] = defaultCapabilityStatus(cap.id);
  }

  const stamp = now();
  const marked = [];
  for (const [capabilityId, hits] of matched) {
    const entry = capabilities[capabilityId] ?? defaultCapabilityStatus(capabilityId);
    entry.status = 'stale';
    entry.staleSince = entry.staleSince ?? stamp;
    entry.staleReason = `changePaths touched: ${hits.join(', ')}`;
    entry.stalePaths = [...new Set([...(entry.stalePaths ?? []), ...hits])].sort();
    capabilities[capabilityId] = entry;
    marked.push(capabilityId);
  }

  const status = {
    version: 1,
    updatedAt: stamp,
    capabilities,
  };

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(status, null, 2)}\n`);

  return {
    filePath,
    status,
    markedCapabilities: marked.sort(),
    staleCapabilities: Object.values(capabilities).filter((c) => c.status === 'stale').map((c) => c.capabilityId).sort(),
  };
}

export function rollupStaleImpact({ rootDir, changedFiles }) {
  const graphStale = staleCapabilitiesFromChange({ rootDir, changedFiles });
  const { status } = loadCertificationStatus({ rootDir });
  const persisted = status
    ? Object.values(status.capabilities ?? {}).filter((c) => c.status === 'stale').map((c) => c.capabilityId)
    : [];
  return [...new Set([...graphStale, ...persisted])].sort();
}
