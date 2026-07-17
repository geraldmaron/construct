/**
 * tests/functional/fixtures/embed-daemon-execution-gap-blocked-runner.mjs —
 * child process driver for embed-daemon-execution-gap-blocked.functional.test.mjs
 * (construct-4uxq0.9.6: Job 12 "execution-gap" honest-reporting path).
 *
 * A registry with no 'jira' entry at all means the analysis cannot run.
 * Before this bead, the job's outer branch (`result.gaps.length > 0` vs the
 * `else`) collapsed this into the same "[embed] Execution gap: no gaps
 * detected" log line a genuine zero-gap run produces, with no notification
 * distinguishing the two. Subscribes to the notification bus
 * (lib/embed/notifications.mjs) before starting the daemon and waits for the
 * 'execution-gap' event the job's own `!result.ranAnalysis` branch emits —
 * event-driven, not a poll against `daemon.lastSnapshot()`, since that field
 * only gets populated once Job 1 (snapshot, also runImmediately) completes,
 * and Job 12's own 2-hour interval gives no second chance within a test
 * timeout if that race were lost.
 *
 * Reads CX_ROOT_DIR and TICK_TIMEOUT_MS from env.
 */

import { EmbedDaemon } from '../../../lib/embed/daemon.mjs';
import { EMPTY_CONFIG } from '../../../lib/embed/config.mjs';
import { onEmbedNotification } from '../../../lib/embed/notifications.mjs';
import { ApprovalQueue } from '../../../lib/embed/approval-queue.mjs';
import { addObservation } from '../../../lib/observation-store.mjs';

const rootDir = process.env.CX_ROOT_DIR;
const timeoutMs = Number(process.env.TICK_TIMEOUT_MS || 15_000);

function emptyRegistry() {
  return { get: () => null };
}

async function waitForExecutionGapNotification(timeout) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => { unsubscribe(); resolve(null); }, timeout);
    const unsubscribe = onEmbedNotification((event) => {
      if (event.source !== 'execution-gap') return;
      clearTimeout(timer);
      unsubscribe();
      resolve(event);
    });
  });
}

async function main() {
  await addObservation(rootDir, {
    role: 'construct',
    category: 'insight',
    summary: 'PRD: launch the quasar-widget self-service flow',
    content: 'Strategy doc describing the quasar-widget self-service flow requirements.',
    tags: ['prd'],
    source: 'test-fixture',
  });

  const persistPath = `${rootDir}/.construct/approvals/queue.jsonl`;
  const daemon = new EmbedDaemon({
    config: EMPTY_CONFIG,
    registry: emptyRegistry(),
    rootDir,
    workspaceDir: rootDir,
    env: process.env,
    persistPath,
  });

  const notificationPromise = waitForExecutionGapNotification(timeoutMs);
  await daemon.start();
  const event = await notificationPromise;

  daemon.stop();

  const queue = new ApprovalQueue({ persistPath });
  const proposedIssue = queue.list().find((r) => r.toolCall?.tool === 'atlassian-jira.issue') ?? null;

  const ok = event != null
    && event.type === 'warning'
    && event.meta?.ran === false
    && event.meta?.error === 'jira provider not registered'
    && proposedIssue === null;

  process.stdout.write(JSON.stringify({ ok, event, proposedIssue }) + '\n');

  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  process.stdout.write(JSON.stringify({ ok: false, error: err?.stack || String(err) }) + '\n');
  process.exit(1);
});
