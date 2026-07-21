/**
 * tests/acceptance/packed-install-removed-surfaces.mjs
 *
 * Interim removed CLI surface registry for packed consumer install gates.
 * Generalizes to migration-compat-expiration-enforcement once that bead lands.
 */

import assert from 'node:assert/strict';

/**
 * CLI surfaces that must not dispatch from a packed+installed consumer tree.
 * Interim hardcoded list until migration-compat-expiration-enforcement ships.
 */
export const REMOVED_CLI_SURFACES = [
  {
    id: 'matrix',
    probeArgs: ['matrix', 'stat'],
    label: 'construct matrix (deprecated alias of construct graph, ADR-0053)',
  },
];

/** Return combined stdout + stderr for diagnostic messages. */
function combinedOutput(result) {
  return `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();
}

/**
 * Assert each removed surface is absent from an installed construct binary.
 *
 * @param {(args: string[]) => { status: number | null, stdout?: string, stderr?: string }} runConstruct
 * @param {{ label?: string, surfaces?: typeof REMOVED_CLI_SURFACES }} [opts]
 */
export function assertRemovedSurfacesAbsent(runConstruct, opts = {}) {
  const label = opts.label ?? 'packed install';
  const surfaces = opts.surfaces ?? REMOVED_CLI_SURFACES;

  for (const surface of surfaces) {
    const result = runConstruct(surface.probeArgs);
    const output = combinedOutput(result);

    assert.notEqual(
      result.status,
      0,
      `${label}: removed surface "${surface.id}" (${surface.label}) still dispatches with exit 0\n---\n${output}\n---`,
    );
  }
}
