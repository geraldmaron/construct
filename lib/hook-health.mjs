/**
 * lib/hooks/health-monitor.mjs — Comprehensive hook health verification.
 *
 * Addresses silent hook failures by:
 * 1. Runtime verification that hooks actually execute
 * 2. Health check endpoints for each hook type
 * 3. Automatic recovery and alerting
 * 4. Integration with construct doctor for actionable diagnostics
 *
 * @p95ms 100
 * @maxBlockingScope none
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { configDir, doctorRoot } from './config/xdg.mjs';
import { launcherPath } from './config-dir.mjs';

const CONSTRUCT_DIR = doctorRoot();
const HOOK_HEALTH_DIR = path.join(CONSTRUCT_DIR, 'hook-health');
const HEALTH_CHECK_INTERVAL_MS = 60 * 1000; // 1 minute

// Ensure health tracking directory exists
try {
  fs.mkdirSync(HOOK_HEALTH_DIR, { recursive: true });
} catch { /* ignore */ }

// ---------------------------------------------------------------------------
// Hook registration and tracking
// ---------------------------------------------------------------------------

const REGISTERED_HOOKS = {
  'session-start': {
    name: 'Session Start',
    description: 'Injects context at the beginning of each session',
    critical: true, // Session is unusable without this
    checkMethod: 'ping',
  },
  'stop': {
    name: 'Session Stop',
    description: 'Persists session summary and cost data',
    critical: true, // Cost tracking breaks without this
    checkMethod: 'file',
    evidenceFile: path.join(CONSTRUCT_DIR, 'session-memory-stats.json'),
  },
  'audit-trail': {
    name: 'Audit Trail',
    description: 'Records all mutations for compliance',
    critical: false,
    checkMethod: 'file',
    evidenceFile: path.join(CONSTRUCT_DIR, 'audit-trail.jsonl'),
  },
  'comment-lint': {
    name: 'Comment Lint',
    description: 'Enforces comment standards on edits',
    critical: false,
    checkMethod: 'ping',
  },
  'policy-engine': {
    name: 'Policy Engine',
    description: 'Enforces gates at session end',
    critical: true,
    checkMethod: 'ping',
  },
};

// ---------------------------------------------------------------------------
// Health state management
// ---------------------------------------------------------------------------

function getHealthFilePath(hookName) {
  return path.join(HOOK_HEALTH_DIR, `${hookName}.json`);
}

function readHookHealth(hookName) {
  try {
    const file = getHealthFilePath(hookName);
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
  } catch { /* ignore */ }
  
  return {
    status: 'unknown',
    lastCheck: null,
    lastSuccess: null,
    consecutiveFailures: 0,
    totalChecks: 0,
    totalFailures: 0,
  };
}

function writeHookHealth(hookName, health) {
  try {
    fs.writeFileSync(getHealthFilePath(hookName), JSON.stringify(health, null, 2));
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Health check implementations
// ---------------------------------------------------------------------------

/**
 * "Ping" check: Actually executes the hook with test input
 * and verifies it completes successfully.
 */
async function checkPingHook(hookName, hookPath) {
  try {
    // Create test input based on hook type
    let testInput = {};
    
    if (hookName === 'session-start') {
      testInput = {
        cwd: process.cwd(),
        session_id: `health-check-${Date.now()}`,
        platform: 'health-check',
      };
    } else if (hookName === 'audit-trail') {
      testInput = {
        tool_name: 'Write',
        tool_input: { file_path: '/dev/null', content: 'health-check' },
        cwd: process.cwd(),
        session_id: `health-check-${Date.now()}`,
      };
    } else if (hookName === 'policy-engine') {
      testInput = {
        type: 'Stop',
        cwd: process.cwd(),
        session_id: `health-check-${Date.now()}`,
      };
    }
    
    // Execute hook with test input
    const result = spawnSync(
      process.execPath,
      [hookPath],
      {
        input: JSON.stringify(testInput),
        encoding: 'utf8',
        timeout: 5000,
        env: process.env,
      }
    );
    
    return {
      healthy: result.status === 0,
      exitCode: result.status,
      stderr: result.stderr?.slice(0, 500),
      stdout: result.stdout?.slice(0, 200),
    };
  } catch (error) {
    return {
      healthy: false,
      error: error.message,
    };
  }
}

/**
 * "File" check: Verifies evidence file is being updated.
 */
async function checkFileHook(hookName, evidenceFile) {
  try {
    if (!fs.existsSync(evidenceFile)) {
      return {
        healthy: false,
        error: `Evidence file not found: ${evidenceFile}`,
        recommendation: 'Hook may not be running or file path is wrong',
      };
    }
    
    const stats = fs.statSync(evidenceFile);
    const ageMs = Date.now() - stats.mtimeMs;
    const ageMinutes = Math.floor(ageMs / 60000);
    
    // Consider unhealthy if no updates in 30 minutes for active sessions
    const staleThreshold = 30 * 60 * 1000; // 30 minutes
    
    return {
      healthy: ageMs < staleThreshold,
      lastUpdate: stats.mtime.toISOString(),
      ageMinutes,
      stale: ageMs >= staleThreshold,
      error: ageMs >= staleThreshold 
        ? `No updates in ${ageMinutes} minutes` 
        : undefined,
    };
  } catch (error) {
    return {
      healthy: false,
      error: error.message,
    };
  }
}

// ---------------------------------------------------------------------------
// Main health check orchestrator
// ---------------------------------------------------------------------------

/**
 * Run a comprehensive health check on all registered hooks.
 */
export async function checkAllHooksHealth(options = {}) {
  const { verbose = false, fix = false } = options;
  const results = [];
  
  for (const [hookId, hookConfig] of Object.entries(REGISTERED_HOOKS)) {
    const hookPath = findHookPath(hookId);
    const previousHealth = readHookHealth(hookId);
    
    const checkResult = await checkSingleHook(hookId, hookConfig, hookPath);
    
    // Update health state
    const newHealth = updateHealthState(previousHealth, checkResult);
    writeHookHealth(hookId, newHealth);
    
    results.push({
      id: hookId,
      name: hookConfig.name,
      critical: hookConfig.critical,
      ...checkResult,
      health: newHealth,
    });
    
    if (verbose) {
      const status = checkResult.healthy ? '✓' : (hookConfig.critical ? '✗' : '⚠');
      console.error(`${status} ${hookConfig.name}: ${checkResult.healthy ? 'healthy' : (checkResult.error || 'unhealthy')}`);
    }
    
    // Attempt auto-fix if requested and hook is unhealthy
    if (fix && !checkResult.healthy) {
      const fixResult = await attemptHookFix(hookId, hookPath, checkResult);
      if (fixResult.fixed) {
        checkResult.fixed = true;
        checkResult.fixMethod = fixResult.method;
      }
    }
  }
  
  return {
    healthy: results.every(r => r.healthy || !r.critical),
    criticalHealthy: results.filter(r => r.critical).every(r => r.healthy),
    results,
    timestamp: new Date().toISOString(),
  };
}

async function checkSingleHook(hookId, config, hookPath) {
  // First check: does the hook file exist?
  if (!hookPath) {
    return {
      healthy: false,
      error: `Hook file not found for ${hookId}`,
      recommendation: `Run \`construct sync\` to regenerate hook configuration`,
    };
  }
  
  // Run the appropriate check method
  if (config.checkMethod === 'ping') {
    return checkPingHook(hookId, hookPath);
  } else if (config.checkMethod === 'file') {
    return checkFileHook(hookId, config.evidenceFile);
  }
  
  return { healthy: false, error: 'Unknown check method' };
}

function findHookPath(hookName) {
  // The user hook symlink lives in the XDG config dir; the project-local
  // .construct/lib and the npm-global install are fallbacks.
  const possiblePaths = [
    path.join(configDir(), 'lib', 'hooks', `${hookName}.mjs`),
    launcherPath(process.cwd(), 'lib', 'hooks', `${hookName}.mjs`),
    path.join(homedir(), '.npm-global', 'lib', 'node_modules', '@geraldmaron/construct', 'lib', 'hooks', `${hookName}.mjs`),
  ];
  
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) return p;
  }
  
  // Try to resolve from construct binary location
  try {
    const which = spawnSync('which', ['construct'], { encoding: 'utf8' });
    if (which.status === 0) {
      const constructPath = which.stdout.trim();
      const constructDir = path.dirname(constructPath);
      const fromBin = path.join(constructDir, '..', 'lib', 'node_modules', '@geraldmaron/construct', 'lib', 'hooks', `${hookName}.mjs`);
      if (fs.existsSync(fromBin)) return fromBin;
    }
  } catch { /* ignore */ }
  
  return null;
}

function updateHealthState(previous, checkResult) {
  const now = new Date().toISOString();
  
  return {
    status: checkResult.healthy ? 'healthy' : 'unhealthy',
    lastCheck: now,
    lastSuccess: checkResult.healthy ? now : previous.lastSuccess,
    consecutiveFailures: checkResult.healthy ? 0 : previous.consecutiveFailures + 1,
    totalChecks: previous.totalChecks + 1,
    totalFailures: checkResult.healthy ? previous.totalFailures : previous.totalFailures + 1,
  };
}

// ---------------------------------------------------------------------------
// Auto-fix attempts
// ---------------------------------------------------------------------------

async function attemptHookFix(hookId, hookPath, checkResult) {
  const fixes = [];
  
  // Fix 1: Missing hook file - regenerate
  if (!hookPath) {
    try {
      const result = spawnSync('construct', ['sync'], { encoding: 'utf8', timeout: 30000 });
      if (result.status === 0) {
        fixes.push('regenerated hooks via construct sync');
        // Re-check if hook now exists
        const newPath = findHookPath(hookId);
        if (newPath) {
          return { fixed: true, method: 'regenerated hooks' };
        }
      }
    } catch { /* ignore */ }
  }
  
  // Fix 2: Hook file exists but not executable - fix permissions
  if (hookPath && checkResult.error?.includes('permission')) {
    try {
      fs.chmodSync(hookPath, 0o755);
      fixes.push('fixed permissions');
      return { fixed: true, method: 'fixed permissions' };
    } catch { /* ignore */ }
  }
  
  // Fix 3: Settings.json misconfiguration
  if (checkResult.error?.includes('not configured')) {
    try {
      const result = spawnSync('construct', ['sync'], { encoding: 'utf8', timeout: 30000 });
      if (result.status === 0) {
        return { fixed: true, method: 'resynced settings' };
      }
    } catch { /* ignore */ }
  }
  
  return { fixed: false, attempted: fixes };
}

// ---------------------------------------------------------------------------
// Public API for integration with doctor and CLI
// ---------------------------------------------------------------------------

/**
 * Get a quick health summary for construct doctor.
 */
export async function getHooksHealthSummary() {
  const health = await checkAllHooksHealth({ verbose: false });
  
  const criticalFailed = health.results.filter(r => r.critical && !r.healthy);
  const nonCriticalFailed = health.results.filter(r => !r.critical && !r.healthy);
  
  return {
    overall: health.healthy ? 'healthy' : (health.criticalHealthy ? 'degraded' : 'critical'),
    criticalFailed: criticalFailed.map(r => r.id),
    nonCriticalFailed: nonCriticalFailed.map(r => r.id),
    details: health.results.map(r => ({
      name: r.name,
      status: r.healthy ? 'healthy' : 'unhealthy',
      critical: r.critical,
      error: r.error,
    })),
  };
}

/**
 * Verify a specific hook is working.
 */
export async function verifyHook(hookName) {
  const config = REGISTERED_HOOKS[hookName];
  if (!config) {
    return { exists: false, error: `Unknown hook: ${hookName}` };
  }
  
  const hookPath = findHookPath(hookName);
  const result = await checkSingleHook(hookName, config, hookPath);
  
  return {
    exists: !!hookPath,
    path: hookPath,
    ...result,
  };
}

/**
 * Start continuous health monitoring (for daemon use).
 */
export function startHealthMonitoring(options = {}) {
  const { intervalMs = HEALTH_CHECK_INTERVAL_MS, onUnhealthy } = options;
  
  const interval = setInterval(async () => {
    const health = await checkAllHooksHealth({ verbose: false });
    
    if (!health.healthy && onUnhealthy) {
      onUnhealthy(health);
    }
  }, intervalMs);
  
  return {
    stop: () => clearInterval(interval),
  };
}

/**
 * Format health status for CLI output.
 */
export function formatHealthStatus(health) {
  let output = '';
  
  output += `Hook Health: ${health.overall.toUpperCase()}\n`;
  output += '=' .repeat(50) + '\n\n';
  
  for (const detail of health.details) {
    const icon = detail.status === 'healthy' ? '✓' : (detail.critical ? '✗' : '⚠');
    output += `${icon} ${detail.name}\n`;
    if (detail.error) {
      output += `  Error: ${detail.error}\n`;
    }
    output += '\n';
  }
  
  if (health.criticalFailed.length > 0) {
    output += `\nCRITICAL ISSUES:\n`;
    output += `The following hooks are critical and not functioning:\n`;
    output += health.criticalFailed.join(', ') + '\n';
    output += `\nRecommendation: Run \`construct hooks:health --fix\` to attempt repair\n`;
  }
  
  return output;
}
