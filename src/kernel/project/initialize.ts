/**
 * kernel/project/initialize.ts — create or reconcile a project's Construct files.
 *
 * Idempotent: files that exist and validate are kept; files that are missing
 * are written; files from an earlier alpha stop everything with their exact
 * paths named, unparsed. One database, ignored by Git.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openStateStore, type StateStore } from '../state/open.ts';
import { getProfile, upsertProfile } from '../state/profile.ts';
import { readJsonFile, writeJsonFile } from './files.ts';
import { newProjectConfig, validateProjectConfig, type ProjectConfig } from './config.ts';
import { emptyConstitution, validateConstitution, type Constitution } from './constitution.ts';
import { emptySourcesFile, validateSourcesFile, type SourcesFile } from './sources-file.ts';
import { emptyLock, validateLock, type RegistryLock } from './lock.ts';
import { detectLegacyProjectFiles, type LegacyTarget } from './legacy.ts';
import { PROJECT_DIR_NAME, STATE_GITIGNORE_PATTERN, projectLayout, type ProjectLayout } from './layout.ts';

export class LegacyProjectError extends Error {
  readonly targets: readonly LegacyTarget[];

  constructor(targets: readonly LegacyTarget[]) {
    super(
      'Found files from an earlier Construct alpha, which this version does not read:\n' +
        targets.map((t) => `  ${t.path}  (${t.what})`).join('\n') +
        '\nRun `construct reset` to see exactly what would be removed, then confirm. Nothing else in the project is touched.',
    );
    this.name = 'LegacyProjectError';
    this.targets = targets;
  }
}

export interface InitializeProjectInput {
  readonly root: string;
  /** Minted by the caller; stable for the project's life. */
  readonly projectId: string;
  readonly name: string;
  readonly at: string;
}

export interface InitializeProjectResult {
  readonly layout: ProjectLayout;
  readonly config: ProjectConfig;
  readonly constitution: Constitution;
  readonly sources: SourcesFile;
  readonly lock: RegistryLock;
  readonly created: {
    readonly projectFile: boolean;
    readonly constitution: boolean;
    readonly sources: boolean;
    readonly lock: boolean;
    readonly state: boolean;
  };
  readonly gitignoreUpdated: boolean;
  readonly store: StateStore;
}

function ensureGitignore(root: string): boolean {
  const gi = join(root, '.gitignore');
  if (!existsSync(gi)) {
    writeFileSync(gi, `# Construct runtime state\n${STATE_GITIGNORE_PATTERN}\n`, 'utf8');
    return true;
  }
  const text = readFileSync(gi, 'utf8');
  const covered = text.split(/\r?\n/).some((line) => {
    const t = line.trim();
    return (
      t === STATE_GITIGNORE_PATTERN ||
      t === STATE_GITIGNORE_PATTERN.slice(0, -1) ||
      t === `${PROJECT_DIR_NAME}/` ||
      t === `${PROJECT_DIR_NAME}/**`
    );
  });
  if (covered) return false;
  const prefix = text.length === 0 || text.endsWith('\n') ? '' : '\n';
  appendFileSync(gi, `${prefix}# Construct runtime state\n${STATE_GITIGNORE_PATTERN}\n`, 'utf8');
  return true;
}

function ensureFile<T>(
  root: string,
  path: string,
  validate: (raw: unknown, path: string) => T,
  fresh: () => T,
): { readonly value: T; readonly created: boolean } {
  const existing = readJsonFile(root, path, validate);
  if (existing !== null) return { value: existing, created: false };
  const value = fresh();
  writeJsonFile(path, value);
  return { value, created: true };
}

export function initializeProject(input: InitializeProjectInput): InitializeProjectResult {
  const layout = projectLayout(input.root);
  const legacy = detectLegacyProjectFiles(input.root);
  if (legacy.length > 0) throw new LegacyProjectError(legacy);

  mkdirSync(layout.dir, { recursive: true });
  mkdirSync(layout.stateDir, { recursive: true });

  const config = ensureFile(input.root, layout.projectFile, validateProjectConfig, () =>
    newProjectConfig({ id: input.projectId, name: input.name, at: input.at }),
  );
  const constitution = ensureFile(input.root, layout.constitutionFile, validateConstitution, () =>
    emptyConstitution(config.value.name),
  );
  const sources = ensureFile(input.root, layout.sourcesFile, validateSourcesFile, emptySourcesFile);
  const lock = ensureFile(input.root, layout.lockFile, validateLock, emptyLock);
  const gitignoreUpdated = ensureGitignore(input.root);

  const stateExisted = existsSync(layout.dbPath);
  const store = openStateStore(layout.dbPath);
  if (getProfile(store) === null) {
    upsertProfile(store, { name: config.value.name, onboardingState: 'incomplete' }, input.at);
  }

  return {
    layout,
    config: config.value,
    constitution: constitution.value,
    sources: sources.value,
    lock: lock.value,
    created: {
      projectFile: config.created,
      constitution: constitution.created,
      sources: sources.created,
      lock: lock.created,
      state: !stateExisted,
    },
    gitignoreUpdated,
    store,
  };
}

/** Read the four committed files of an initialized project without touching state. */
export function readProjectFiles(root: string): {
  readonly config: ProjectConfig | null;
  readonly constitution: Constitution | null;
  readonly sources: SourcesFile | null;
  readonly lock: RegistryLock | null;
} {
  const layout = projectLayout(root);
  return {
    config: readJsonFile(root, layout.projectFile, validateProjectConfig),
    constitution: readJsonFile(root, layout.constitutionFile, validateConstitution),
    sources: readJsonFile(root, layout.sourcesFile, validateSourcesFile),
    lock: readJsonFile(root, layout.lockFile, validateLock),
  };
}
