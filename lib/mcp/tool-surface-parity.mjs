/**
 * lib/mcp/tool-surface-parity.mjs — partition invariant for the MCP tool surface.
 *
 * The exposed surface is split into a flat core (CORE_TOOL_NAMES) and a long tail
 * reached through the `call` gateway. Both are hand-maintained beside the catalog
 * (ALL_TOOL_DEFS), so a typo in a core name silently drops a tool from BOTH the
 * flat surface and the gateway enum, making it unreachable. These helpers enforce
 * the partition from the catalog as the single source of truth: every declared
 * core name must be a real catalog tool, and the flat core plus the gateway enum
 * must together cover the catalog exactly once (no gap, no overlap, no phantom).
 */

// A core name that is not in the catalog is a typo or a stale entry; it must be
// rejected loudly rather than silently dropping the tool from every surface.

export function assertCoreSubsetOfCatalog(coreNames, catalog) {
  const catalogSet = catalog instanceof Set ? catalog : new Set(catalog);
  const phantom = [...coreNames].filter((name) => !catalogSet.has(name));
  if (phantom.length > 0) {
    throw new Error(
      `tool-surface-parity: ${phantom.length} core tool name(s) absent from the catalog: ${phantom.join(', ')} — `
      + 'a typo in CORE_TOOL_NAMES drops the tool from both the flat surface and the call enum.',
    );
  }
  return true;
}

// The flat core and the gateway enum must partition the catalog exactly once.
// Returns the partition diagnostics; assertToolSurfacePartition throws on any break.

export function checkToolSurfacePartition({ catalog, flat, enumNames }) {
  const catalogSet = catalog instanceof Set ? catalog : new Set(catalog);
  const surfaced = [...flat, ...enumNames];

  const overlap = flat.filter((name) => enumNames.includes(name));
  const duplicates = [...new Set(surfaced.filter((name, idx) => surfaced.indexOf(name) !== idx))];
  const missing = [...catalogSet].filter((name) => !flat.includes(name) && !enumNames.includes(name));
  const phantom = [...new Set(surfaced.filter((name) => !catalogSet.has(name)))];

  return {
    ok: overlap.length === 0 && duplicates.length === 0 && missing.length === 0 && phantom.length === 0,
    overlap: overlap.sort(),
    duplicates: duplicates.sort(),
    missing: missing.sort(),
    phantom: phantom.sort(),
  };
}

export function assertToolSurfacePartition({ catalog, flat, enumNames }) {
  const result = checkToolSurfacePartition({ catalog, flat, enumNames });
  if (!result.ok) {
    const parts = [];
    if (result.overlap.length) parts.push(`flat AND enum: ${result.overlap.join(', ')}`);
    if (result.duplicates.length) parts.push(`surfaced twice: ${result.duplicates.join(', ')}`);
    if (result.missing.length) parts.push(`unreachable: ${result.missing.join(', ')}`);
    if (result.phantom.length) parts.push(`not in catalog: ${result.phantom.join(', ')}`);
    throw new Error(`tool-surface-parity: partition broken — ${parts.join('; ')}`);
  }
  return true;
}
