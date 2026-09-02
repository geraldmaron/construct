/**
 * kernel/project-v1/index.ts — project identity and layout.
 */

export {
  resolveProjectContext,
  normalizeProjectRoot,
  type ProjectContext,
  type ResolveProjectContextInput,
} from './context.ts';
export {
  PROJECT_DIR_NAME,
  PROJECT_CONFIG_NAME,
  PROJECT_STATE_DIR_NAME,
  PROJECT_DB_NAME,
  projectDir,
  projectConfigPath,
  projectStateDir,
  projectDbPath,
} from './layout.ts';
export {
  initializeProject,
  STATE_GITIGNORE_PATTERN,
  PROJECT_CONFIG_FORMAT,
  PROJECT_CONFIG_VERSION,
  type ProjectConfig,
  type InitializeProjectResult,
} from './initialize.ts';
export { resetProject, type ResetProjectOptions } from './reset.ts';