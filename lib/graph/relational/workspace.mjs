/**
 * lib/graph/relational/workspace.mjs — workspace scope key for the relational
 * graph store.
 *
 * The Workspace domain object (target-model.md concept 1) has no store yet.
 * Until it exists, the `workspace` scope column on every relational graph
 * table is populated from deriveProjectKey (lib/state-root.mjs) — the same
 * derivation every other machine-scoped store already keys on — so one
 * graph.db resolves to one workspace's row set. A real Workspace record
 * replaces this derivation later without changing the column shape (directive
 * §19: "one product model across embedded and shared deployments").
 */

import { deriveProjectKey } from '../../state-root.mjs';

export function resolveGraphWorkspace(rootDir) {
  return deriveProjectKey(rootDir);
}
