/**
 * lib/resources/process-budget.mjs — RSS caps from construct.config.json.
 *
 * Maps long-running Construct processes to `resources.process.*` limits so
 * daemon runners and embed workers share one config surface with doctor.
 */

import { loadProjectConfig } from '../config/project-config.mjs';
import { DEFAULT_MEMORY_CAP_MB } from '../daemons/contract.mjs';

export function loadProcessBudgets(projectRoot, env = process.env) {
  const { config } = loadProjectConfig(projectRoot, env);
  const process = config?.resources?.process ?? {};
  return {
    embedDaemonMaxRssMb: process.embedDaemonMaxRssMb ?? 800,
    mcpServerMaxRssMb: process.mcpServerMaxRssMb ?? 250,
    workerReplicaMaxRssMb: process.workerReplicaMaxRssMb ?? DEFAULT_MEMORY_CAP_MB,
  };
}

export function memoryCapMbFor(daemonName, projectRoot, env = process.env) {
  const budgets = loadProcessBudgets(projectRoot, env);
  switch (daemonName) {
    case 'embed':
    case 'embed-daemon':
      return budgets.embedDaemonMaxRssMb;
    case 'mcp':
    case 'construct-mcp':
      return budgets.mcpServerMaxRssMb;
    case 'intake':
    case 'oracle':
    case 'worker':
      return budgets.workerReplicaMaxRssMb;
    default:
      return DEFAULT_MEMORY_CAP_MB;
  }
}

export function currentRssMb() {
  return process.memoryUsage().rss / (1024 * 1024);
}

export function rssOverCap(capMb) {
  return currentRssMb() > capMb;
}
