/**
 * kernel/state/index.ts — Construct state format 3.
 */

export { STATE_FORMAT_ID, STATE_FORMAT_VERSION, UNSUPPORTED_STATE_MESSAGE, UnsupportedStateError } from './format.ts';
export { openStateStore, type StateStore } from './open.ts';
export { REQUIRED_TABLES } from './schema.ts';
export { IllegalTransitionError } from './rows.ts';
export { appendActivity, listActivity, type ActivityEvent } from './activity.ts';
export * from './profile.ts';
export * from './sources.ts';
export * from './graph.ts';
export * from './admission.ts';
export * from './staff.ts';
export * from './resolved.ts';
export * from './runs.ts';
export * from './steps.ts';
export * from './deliverables.ts';
export * from './decisions.ts';
export * from './grants.ts';
export * from './drift.ts';
export * from './triggers.ts';
export { V2_REQUIRED_TABLES, migrateV2ToV3 } from './migrate.ts';
