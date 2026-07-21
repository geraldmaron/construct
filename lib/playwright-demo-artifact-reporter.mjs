/**
 * lib/playwright-demo-artifact-reporter.mjs — ESM re-export shim for the CJS reporter.
 *
 * Playwright's runner config references the CJS reporter by absolute path; this
 * module is the production import anchor so the dead-code audit sees inbound use.
 */

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
export const PLAYWRIGHT_DEMO_ARTIFACT_REPORTER_CJS = fileURLToPath(
  new URL('./playwright-demo-artifact-reporter.cjs', import.meta.url),
);
export default require('./playwright-demo-artifact-reporter.cjs');
