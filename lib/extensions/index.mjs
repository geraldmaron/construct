/**
 * lib/extensions/index.mjs — public API for the extension manifest system.
 *
 * Re-exports all symbols from the three extension sub-modules so consumers
 * can import from a single entry point:
 *
 *   import { validateManifest, loadManifestsFromDir, MANIFEST_KINDS } from './extensions/index.mjs';
 */

export {
  MANIFEST_KINDS,
  REQUIRED_FIELDS,
  OPTIONAL_FIELDS,
  COMPAT_VERSION,
} from './manifest-schema.mjs';

export { validateManifest } from './validate.mjs';

export {
  loadManifestsFromDir,
  mergeManifests,
  resolveManifestDirs,
} from './loader.mjs';
