/**
 * lib/graph/relational/schema-version.mjs — current relational graph schema
 * version.
 *
 * A single constant both backends' meta row and the reconciliation trust
 * decision (reconcile.mjs) compare against, so a future schema change bumps
 * exactly one number rather than every call site that stamps or checks it.
 */

export const CURRENT_SCHEMA_VERSION = 1;
