/**
 * lib/workspace/schema-version.mjs — current Workspace domain schema version.
 *
 * Mirrors lib/graph/relational/schema-version.mjs's single-constant shape, for
 * a future meta/freshness table (none exists yet — see design doc §5) to read
 * rather than every call site hardcoding a number.
 */

export const CURRENT_SCHEMA_VERSION = 1;
