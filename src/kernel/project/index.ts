/**
 * kernel/project/index.ts — project layout, files, configuration, and setup.
 */

export * from './layout.ts';
export { resolveProjectContext, normalizeProjectRoot, type ProjectContext, type ResolveProjectContextInput } from './context.ts';
export {
  ProjectFileError,
  UnsupportedProjectFileError,
  UNSUPPORTED_PROJECT_FILE_MESSAGE,
  MAX_PROJECT_FILE_BYTES,
  FORBIDDEN_FILE_KEY_WORDS,
  readJsonFile,
  writeJsonFile,
  symlinkBetween,
} from './files.ts';
export * from './config.ts';
export * from './constitution.ts';
export * from './sources-file.ts';
export * from './lock.ts';
export * from './legacy.ts';
export * from './discover.ts';
export * from './initialize.ts';
export * from './reset.ts';
