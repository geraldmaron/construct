#!/usr/bin/env node
/**
 * lib/hooks/session-optimize.mjs — Session end optimization hook — triggers agent optimization for low-performers.
 *
 * Runs as a Stop hook at session end. Checks recent performance reviews for agents with avgScore < 0.7
 * and schedules `construct optimize <agent> --dry-run` detached so the Stop hook returns within budget.
 *
 * @p95ms 300
 * @maxBlockingScope Stop (non-blocking, async)
 *
 * @lifecycle Stop
 * @matcher  *
 * @exits 0 = pass
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONSTRUCT_BIN = join(__dirname, '..', '..', 'bin', 'construct');

const OPTIMIZATION_THRESHOLD = 0.7;
const MIN_TRACES_PER_AGENT = 3;
const OPTIMIZATION_DAYS = 7;
const OPTIMIZATION_LOG_DIR = join(homedir(), '.cx', 'optimization-logs');
const REVIEWS_DIR = join(homedir(), '.cx', 'performance-reviews');

mkdirSync(OPTIMIZATION_LOG_DIR, { recursive: true });

let input = {};
try { input = JSON.parse(readFileSync(0, 'utf8')); } catch { process.exit(0); }

const cwd = input?.cwd || process.cwd();
const projectName = cwd.split('/').pop() || 'project';

if (projectName !== 'construct' && !existsSync(join(cwd, '.cx'))) {
  process.exit(0);
}

const REVIEW_REFRESH_MS = 6 * 60 * 60 * 1000;

function spawnDetached(args, { cwd: workDir = cwd } = {}) {
  try {
    const child = spawn(process.execPath, args, {
      cwd: workDir,
      stdio: 'ignore',
      detached: true,
      env: process.env,
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

function listReviewJsonFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => join(dir, name));
}

function maybeRefreshReviews() {
  let needsRefresh = false;
  try {
    const files = listReviewJsonFiles(REVIEWS_DIR);
    if (files.length === 0) {
      needsRefresh = true;
    } else {
      const newestMs = files.reduce((acc, filePath) => {
        try {
          return Math.max(acc, statSync(filePath).mtimeMs);
        } catch {
          return acc;
        }
      }, 0);
      if (Date.now() - newestMs > REVIEW_REFRESH_MS) needsRefresh = true;
    }
  } catch {
    /* refresh is best-effort */
  }

  if (!needsRefresh) return;

  spawnDetached([CONSTRUCT_BIN, 'review', '--quiet']);
}

function getLatestPerformanceReview() {
  try {
    const files = listReviewJsonFiles(REVIEWS_DIR);
    if (files.length === 0) return null;

    files.sort((a, b) => {
      try {
        return statSync(b).mtimeMs - statSync(a).mtimeMs;
      } catch {
        return 0;
      }
    });

    return JSON.parse(readFileSync(files[0], 'utf8'));
  } catch (error) {
    console.error(`Error reading performance reviews: ${error.message}`);
    return null;
  }
}

function needsOptimization(agentStats) {
  return (
    agentStats.scoredInvocations >= MIN_TRACES_PER_AGENT &&
    agentStats.avgScore < OPTIMIZATION_THRESHOLD &&
    agentStats.lowScoreTraces.length > 0
  );
}

function scheduleAgentOptimization(agentName) {
  const logFile = join(OPTIMIZATION_LOG_DIR, `${new Date().toISOString().split('T')[0]}-${agentName}-scheduled.json`);
  const scheduled = spawnDetached([
    CONSTRUCT_BIN,
    'optimize',
    agentName,
    `--days=${OPTIMIZATION_DAYS}`,
    '--dry-run',
  ]);
  writeFileSync(logFile, `${JSON.stringify({
    timestamp: new Date().toISOString(),
    agent: agentName,
    scheduled,
    mode: 'detached-dry-run',
  })}\n`);
  return scheduled;
}

function main() {
  maybeRefreshReviews();

  const review = getLatestPerformanceReview();
  if (!review || !review.agentStats || review.agentStats.length === 0) {
    console.log('📊 No performance review data found. Run `construct review` first.');
    process.exit(0);
  }

  const agentsNeedingOptimization = review.agentStats.filter(needsOptimization);

  if (agentsNeedingOptimization.length === 0) {
    console.log(`✅ All ${review.agentStats.length} agents have scores >= ${OPTIMIZATION_THRESHOLD} or insufficient data`);
    process.exit(0);
  }

  console.log(`🔧 Scheduling ${agentsNeedingOptimization.length} detached optimization preview(s):`);
  let scheduledCount = 0;
  for (const agent of agentsNeedingOptimization) {
    console.log(`  • ${agent.name}: avgScore=${agent.avgScore}, invocations=${agent.invocations}`);
    if (scheduleAgentOptimization(agent.name)) scheduledCount += 1;
  }

  const summaryFile = join(OPTIMIZATION_LOG_DIR, `${new Date().toISOString().split('T')[0]}-summary.json`);
  writeFileSync(summaryFile, `${JSON.stringify({
    timestamp: new Date().toISOString(),
    project: projectName,
    reviewDate: review.generated,
    agentsChecked: review.agentStats.length,
    agentsNeedingOptimization: agentsNeedingOptimization.length,
    scheduledCount,
    agents: agentsNeedingOptimization.map((a) => ({
      name: a.name,
      avgScore: a.avgScore,
      invocations: a.invocations,
    })),
  }, null, 2)}\n`);

  console.log(`\n📈 Optimization previews scheduled: ${scheduledCount}/${agentsNeedingOptimization.length}`);
}

try {
  main();
} catch (error) {
  console.error(`❌ Session optimization hook crashed: ${error.message}`);
  const crashLog = join(OPTIMIZATION_LOG_DIR, 'crashes', `${Date.now()}-crash.json`);
  mkdirSync(dirname(crashLog), { recursive: true });
  writeFileSync(crashLog, `${JSON.stringify({
    timestamp: new Date().toISOString(),
    error: error.message,
    stack: error.stack,
    cwd,
    projectName,
  }, null, 2)}\n`);
  process.exit(1);
}

process.exit(0);
