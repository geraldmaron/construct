/**
 * cli/host-names.ts — the hosts this CLI can dispatch through, on their own
 * with no further imports.
 *
 * Split out of runtime.ts so a module that needs only the name list — the
 * settings ladder, validating a `host` preference — does not have to import
 * runtime.ts and everything runtime.ts in turn depends on. runtime.ts
 * re-exports this, so every existing `from './runtime.ts'` import keeps
 * working unchanged.
 */

export const HOST_NAMES = ['opencode', 'claude', 'codex', 'cursor'] as const;

export type HostName = (typeof HOST_NAMES)[number];
