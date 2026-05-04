#!/usr/bin/env node
/**
 * lib/hooks/session-optimize.mjs — Session end optimization hook — triggers agent optimization for low-performers.
 *
 * Runs as a Stop hook at session end. Checks recent performance reviews for agents with avgScore < 0.7
 * and invokes `construct optimize <agent>` to generate and apply improvement patches.
 *
 * @p95ms 300
 * @maxBlockingScope Stop (non-blocking, async)
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONSTRUCT_BIN = join(__dirname, '..', '..', 'bin', 'construct');

const OPTIMIZATION_THRESHOLD = 0.7;     // Score below this triggers optimization
const MIN_TRACES_PER_AGENT = 3;          // Minimum traces needed for optimization
const OPTIMIZATION_DAYS = 7;            // Look back 7 days for performance data
const OPTIMIZATION_LOG_DIR = join(homedir(), '.cx', 'optimization-logs');

// Ensure optimization log directory exists
mkdirSync(OPTIMIZATION_LOG_DIR, { recursive: true });

let input = {};
try { input = JSON.parse(readFileSync(0, 'utf8')); } catch { process.exit(0); }

// Only run for Construct sessions
const cwd = input?.cwd || process.cwd();
const projectName = cwd.split('/').pop() || 'project';

// Skip if this is not a Construct project or in global mode
if (projectName !== 'construct' && !existsSync(join(cwd, '.cx'))) {
  process.exit(0);
}

// Read the most recent performance review
function getLatestPerformanceReview() {
  const reviewsDir = join(homedir(), '.cx', 'performance-reviews');
  if (!existsSync(reviewsDir)) return null;
  
  try {
    const files = spawnSync('find', [reviewsDir, '-name', '*.json', '-type', 'f'], {
      encoding: 'utf8',
      timeout: 5000
    }).stdout.trim().split('\n').filter(Boolean);
    
    if (files.length === 0) return null;
    
    // Sort by modification time, newest first
    files.sort((a, b) => {
      try {
        const statA = spawnSync('stat', ['-f', '%m', a], { encoding: 'utf8' }).stdout.trim();
        const statB = spawnSync('stat', ['-f', '%m', b], { encoding: 'utf8' }).stdout.trim();
        return parseInt(statB) - parseInt(statA);
      } catch {
        return 0;
      }
    });
    
    const latestFile = files[0];
    const content = readFileSync(latestFile, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    console.error(`Error reading performance reviews: ${error.message}`);
    return null;
  }
}

// Check if agent needs optimization
function needsOptimization(agentStats) {
  return (
    agentStats.scoredInvocations >= MIN_TRACES_PER_AGENT &&
    agentStats.avgScore < OPTIMIZATION_THRESHOLD &&
    agentStats.lowScoreTraces.length > 0
  );
}

// Run optimization for a specific agent
function optimizeAgent(agentName) {
  console.log(`🔧 Optimizing ${agentName} (score < ${OPTIMIZATION_THRESHOLD})`);
  
  const logFile = join(OPTIMIZATION_LOG_DIR, `${new Date().toISOString().split('T')[0]}-${agentName}.log`);
  const startTime = Date.now();
  
  try {
    // Run construct optimize with auto-apply (no --dry-run)
    const result = spawnSync(CONSTRUCT_BIN, ['optimize', agentName, `--days=${OPTIMIZATION_DAYS}`], {
      cwd,
      encoding: 'utf8',
      timeout: 300000, // 5 minutes timeout for optimization
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    const duration = Date.now() - startTime;
    
    // Log the optimization attempt
    const logEntry = {
      timestamp: new Date().toISOString(),
      agent: agentName,
      durationMs: duration,
      success: result.status === 0,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.status,
      signal: result.signal
    };
    
    writeFileSync(logFile, JSON.stringify(logEntry, null, 2) + '\n');
    
    if (result.status === 0) {
      console.log(`✅ Optimization for ${agentName} completed in ${duration}ms`);
      
      // Record observation about the optimization
      recordOptimizationObservation(agentName, true, duration);
    } else {
      console.log(`❌ Optimization for ${agentName} failed with code ${result.status}`);
      console.log(`Stderr: ${result.stderr.slice(0, 500)}...`);
      
      // Record observation about the failure
      recordOptimizationObservation(agentName, false, duration, result.stderr);
    }
    
    return result.status === 0;
  } catch (error) {
    console.error(`❌ Optimization for ${agentName} threw error: ${error.message}`);
    
    const logEntry = {
      timestamp: new Date().toISOString(),
      agent: agentName,
      durationMs: Date.now() - startTime,
      success: false,
      error: error.message,
      stack: error.stack
    };
    
    writeFileSync(logFile, JSON.stringify(logEntry, null, 2) + '\n');
    return false;
  }
}

// Record optimization observation for learning
function recordOptimizationObservation(agentName, success, durationMs, error = null) {
  const observation = {
    role: 'construct',
    category: success ? 'pattern' : 'anti-pattern',
    summary: success 
      ? `Auto-optimized ${agentName} in ${durationMs}ms`
      : `Auto-optimization failed for ${agentName}: ${error?.slice(0, 200) || 'unknown error'}`,
    content: success
      ? `Automatic optimization triggered for ${agentName} after performance review showed avgScore < ${OPTIMIZATION_THRESHOLD}. Optimization completed successfully in ${durationMs}ms.`
      : `Automatic optimization failed for ${agentName}. Error: ${error || 'Unknown'}. System should notify maintainer.`,
    tags: ['auto-optimization', 'performance-review', agentName],
    confidence: 0.9
  };
  
  try {
    // Use existing observation recording if available
    const observationFile = join(homedir(), '.cx', 'observations', `${Date.now()}-${agentName}-optimization.json`);
    mkdirSync(dirname(observationFile), { recursive: true });
    writeFileSync(observationFile, JSON.stringify(observation, null, 2) + '\n');
  } catch (error) {
    // Non-critical - observation recording failed
    console.error(`Failed to record optimization observation: ${error.message}`);
  }
}

// Main optimization logic
function main() {
  const review = getLatestPerformanceReview();
  if (!review || !review.agentStats || review.agentStats.length === 0) {
    console.log('📊 No performance review data found. Run `construct review` first.');
    process.exit(0);
  }
  
  console.log(`📊 Checking ${review.agentStats.length} agents from performance review ${review.generated}`);
  
  const agentsNeedingOptimization = review.agentStats.filter(needsOptimization);
  
  if (agentsNeedingOptimization.length === 0) {
    console.log(`✅ All ${review.agentStats.length} agents have scores >= ${OPTIMIZATION_THRESHOLD} or insufficient data`);
    process.exit(0);
  }
  
  console.log(`🔧 Found ${agentsNeedingOptimization.length} agents needing optimization:`);
  agentsNeedingOptimization.forEach(agent => {
    console.log(`  • ${agent.name}: avgScore=${agent.avgScore}, invocations=${agent.invocations}`);
  });
  
  // Run optimization for each agent (serial for now)
  let optimizedCount = 0;
  let failedCount = 0;
  
  for (const agent of agentsNeedingOptimization) {
    const success = optimizeAgent(agent.name);
    if (success) {
      optimizedCount++;
    } else {
      failedCount++;
    }
    
    // Small delay between optimizations to avoid rate limits
    if (agentsNeedingOptimization.length > 1) {
      spawnSync('sleep', ['10'], { encoding: 'utf8' });
    }
  }
  
  // Summary
  console.log(`\n📈 Optimization Summary:`);
  console.log(`  • Agents checked: ${review.agentStats.length}`);
  console.log(`  • Needing optimization: ${agentsNeedingOptimization.length}`);
  console.log(`  • Successfully optimized: ${optimizedCount}`);
  console.log(`  • Failed: ${failedCount}`);
  
  if (optimizedCount > 0) {
    console.log(`\n💡 Optimized agents will be evaluated in the next performance review.`);
    console.log(`   Run \`construct review\` after next session to see improvements.`);
  }
  
  // Log summary to file
  const summary = {
    timestamp: new Date().toISOString(),
    project: projectName,
    reviewDate: review.generated,
    agentsChecked: review.agentStats.length,
    agentsNeedingOptimization: agentsNeedingOptimization.length,
    optimizedCount,
    failedCount,
    agents: agentsNeedingOptimization.map(a => ({
      name: a.name,
      avgScore: a.avgScore,
      invocations: a.invocations,
      optimized: optimizeAgent.includes ? 'yes' : 'no'
    }))
  };
  
  const summaryFile = join(OPTIMIZATION_LOG_DIR, `${new Date().toISOString().split('T')[0]}-summary.json`);
  writeFileSync(summaryFile, JSON.stringify(summary, null, 2) + '\n');
}

// Run main logic
try {
  main();
} catch (error) {
  console.error(`❌ Session optimization hook crashed: ${error.message}`);
  console.error(error.stack);
  
  // Log the crash
  const crashLog = join(OPTIMIZATION_LOG_DIR, 'crashes', `${Date.now()}-crash.json`);
  mkdirSync(dirname(crashLog), { recursive: true });
  writeFileSync(crashLog, JSON.stringify({
    timestamp: new Date().toISOString(),
    error: error.message,
    stack: error.stack,
    cwd,
    projectName
  }, null, 2) + '\n');
  
  process.exit(1);
}

process.exit(0);