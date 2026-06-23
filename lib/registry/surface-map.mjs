/**
 * lib/registry/surface-map.mjs — ADR-0039 primary interaction surface per command group.
 *
 * Declarative map from CLI command name to primary surface tier. The CLI registry
 * remains the substrate; this file governs discovery posture without removing verbs.
 *
 * Surfaces:
 *   agent-mcp — MCP tool canonical; CLI --json twin
 *   thin-cli  — human types this at a prompt
 *   tui       — interactive loop emphasized
 *   dashboard — visual/telemetry emphasized
 *   internal  — CI/harness only
 */

export const SURFACE_TIERS = ['agent-mcp', 'thin-cli', 'tui', 'dashboard', 'internal'];

/** @type {Record<string, string>} */
export const COMMAND_SURFACE = {
  install: 'thin-cli',
  init: 'thin-cli',
  dev: 'thin-cli',
  dashboard: 'thin-cli',
  stop: 'thin-cli',
  status: 'thin-cli',
  doctor: 'thin-cli',
  sync: 'thin-cli',
  ingest: 'agent-mcp',
  drop: 'agent-mcp',
  distill: 'agent-mcp',
  ask: 'agent-mcp',
  search: 'agent-mcp',
  knowledge: 'agent-mcp',
  memory: 'agent-mcp',
  reflect: 'agent-mcp',
  intake: 'tui',
  workflow: 'agent-mcp',
  graph: 'agent-mcp',
  capability: 'agent-mcp',
  execution: 'agent-mcp',
  orchestrate: 'agent-mcp',
  models: 'agent-mcp',
  profile: 'tui',
  sandbox: 'tui',
  review: 'dashboard',
  telemetry: 'dashboard',
  evals: 'dashboard',
  improvement: 'dashboard',
  ci: 'thin-cli',
  docs: 'thin-cli',
  export: 'agent-mcp',
  diagram: 'agent-mcp',
  demo: 'agent-mcp',
  beads: 'thin-cli',
  hook: 'internal',
  'lint:comments': 'internal',
  'lint:agents': 'internal',
  'registry:status': 'internal',
  'registry:validate': 'internal',
  'registry:generate-docs': 'internal',
  rules: 'thin-cli',
};

export function surfaceForCommand(name) {
  if (COMMAND_SURFACE[name]) return COMMAND_SURFACE[name];
  if (name.includes(':')) return 'internal';
  return 'thin-cli';
}

export function commandsBySurface(commands) {
  const grouped = Object.fromEntries(SURFACE_TIERS.map((t) => [t, []]));
  for (const cmd of commands) {
    const surface = cmd.surface ?? surfaceForCommand(cmd.name);
    grouped[surface]?.push(cmd.name);
  }
  return grouped;
}
