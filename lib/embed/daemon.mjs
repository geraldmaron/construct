/**
 * lib/embed/daemon.mjs — embed mode daemon.
 *
 * Ties together: config, provider registry, scheduler, snapshot engine,
 * approval queue, and output dispatch. This is what `construct embed start`
 * runs.
 *
 * Usage:
 *   const daemon = new EmbedDaemon({ configPath, registry });
 *   await daemon.start();
 *   // ...
 *   daemon.stop();
 */

import { loadEmbedConfig } from './config.mjs';
import { Scheduler } from './scheduler.mjs';
import { SnapshotEngine, renderMarkdown } from './snapshot.mjs';
import { ApprovalQueue } from './approval-queue.mjs';
import { dispatchOutputs } from './output.mjs';
import { ProviderRegistry } from './providers/registry.mjs';

export class EmbedDaemon {
  #config = null;
  #registry = null;
  #env = null;
  #scheduler = null;
  #snapshotEngine = null;
  #approvalQueue = null;
  #status = 'stopped';
  #lastSnapshot = null;
  #configPath = null;
  #persistPath = null;

  /**
   * @param {object} opts
   * @param {string} opts.configPath          - Path to embed.yaml
   * @param {ProviderRegistry} [opts.registry] - Pre-built registry (default: fromEnv)
   * @param {object} [opts.env]               - Env override (default: process.env)
   * @param {string} [opts.persistPath]       - Approval queue persistence path
   */
  constructor({ configPath, registry, env, persistPath } = {}) {
    this.#configPath = configPath;
    this.#registry = registry ?? null;
    this.#env = env ?? process.env;
    this.#persistPath = persistPath;
  }

  async start() {
    if (this.#status === 'running') throw new Error('EmbedDaemon is already running');

    this.#config = loadEmbedConfig(this.#configPath);

    // Build the provider registry from env if one wasn't injected (normal runtime path)
    if (!this.#registry) {
      this.#registry = await ProviderRegistry.fromEnv(this.#env);
    }

    this.#config = loadEmbedConfig(this.#configPath);
    this.#scheduler = new Scheduler();
    this.#snapshotEngine = new SnapshotEngine(this.#registry, this.#config);
    this.#approvalQueue = new ApprovalQueue({
      require: this.#config.approval.require,
      timeoutMs: this.#config.approval.timeout_ms,
      fallback: this.#config.approval.fallback,
      persistPath: this.#persistPath,
    });

    // Initialize providers for all sources
    for (const source of this.#config.sources) {
      const provider = this.#registry.get(source.provider);
      if (!provider) {
        process.stderr.write(`[embed] Warning: provider "${source.provider}" not registered — skipping\n`);
      }
    }

    // Schedule snapshot generation
    this.#scheduler.register(
      'snapshot',
      this.#config.snapshot.intervalMs,
      async () => {
        const snapshot = await this.#snapshotEngine.generate();
        this.#lastSnapshot = snapshot;
        await dispatchOutputs(snapshot, this.#config.outputs, this.#registry);
        process.stderr.write(`[embed] Snapshot generated at ${snapshot.completedAt} — ${snapshot.summary.totalItems} items, ${snapshot.summary.errorCount} errors\n`);
      },
      { runImmediately: true },
    );

    // Schedule approval queue expiry check
    this.#scheduler.register(
      'approval-expiry',
      60_000,
      async () => {
        const expired = this.#approvalQueue.expireStale();
        if (expired.length) {
          process.stderr.write(`[embed] Expired ${expired.length} stale approval item(s)\n`);
        }
      },
    );

    this.#scheduler.start();
    this.#status = 'running';
    process.stderr.write(`[embed] Daemon started. Snapshot interval: ${this.#config.snapshot.intervalMs}ms\n`);
  }

  stop() {
    this.#scheduler?.stop();
    this.#status = 'stopped';
    process.stderr.write('[embed] Daemon stopped.\n');
  }

  status() {
    return {
      status: this.#status,
      lastSnapshot: this.#lastSnapshot
        ? { generatedAt: this.#lastSnapshot.generatedAt, summary: this.#lastSnapshot.summary }
        : null,
      pendingApprovals: this.#approvalQueue?.list('pending').length ?? 0,
      schedulerTasks: this.#scheduler?.status() ?? [],
    };
  }

  approvalQueue() {
    return this.#approvalQueue;
  }

  lastSnapshot() {
    return this.#lastSnapshot;
  }
}
