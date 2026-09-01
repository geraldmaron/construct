/**
 * cli/spend.ts — spend ceilings shared by CLI verbs that can dispatch a host.
 *
 * Kept out of work.ts so the headless work entry does not re-export legacy
 * dispatch constants.
 */

/** Default USD ceiling for a single ask/work dispatch when the flag is omitted. */
export const DEFAULT_SPEND_CEILING = 10;
