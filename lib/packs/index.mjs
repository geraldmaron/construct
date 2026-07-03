/**
 * lib/packs/index.mjs — public API for the pack manifest system.
 *
 * Re-exports all symbols from the five pack sub-modules so consumers
 * can import from a single entry point:
 *
 *   import { validatePackManifest, loadAllPacks, PACK_REQUIRED_FIELDS } from './packs/index.mjs';
 */

export {
  PACK_REQUIRED_FIELDS, PACK_OPTIONAL_FIELDS, PACK_COMPAT_VERSION,
  PACK_ID_RE, PACK_SOURCE_TIERS,
} from './manifest-schema.mjs';

export { validatePackManifest } from './validate.mjs';

export { validatePackPrompts, resolvePersonaPrompt } from './prompts.mjs';

export { loadCorePack } from './core-pack.mjs';

export {
  loadPacksFromDir, mergePackTiers, resolvePackDirs, loadAllPacks,
} from './loader.mjs';