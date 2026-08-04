/**
 * hosts/opencode — OpenCode behind the kernel's host adapter seam.
 *
 * Reached from a consumer as
 * `@geraldmaron/construct-engine/hosts/opencode/index.js`, which is the path
 * package.json's `exports["./hosts/*"]` exists to serve. Adapters live here
 * rather than under kernel/ because an adapter is host-coupled by definition
 * and the kernel stays the part that knows nothing about who executes.
 */

export { createOpenCodeAdapter, HOST_NAME, OPENCODE_CAPABILITIES } from './adapter.ts';
export type {
  OpenCodeAdapter,
  OpenCodeConfig,
  OpenCodeDeliverable,
  OpenCodeRequest,
  OpenCodeSpawnFn,
  SpawnedProcess,
} from './adapter.ts';

export { failedToolCalls, parseLine, reduceTranscript, stripAnsi } from './events.ts';
export type { OpenCodeRunResult, OpenCodeToolCall, OpenCodeUsage } from './events.ts';

export { CONFORMANCE_EXPECTATIONS, PINNED_VERSION } from './pin.ts';
export type { ConformanceExpectation } from './pin.ts';
