/**
 * kernel/source/locators.ts — what a locator for each source kind must look like.
 *
 * Pure checks. A locator is refused with a sentence that says what shape was
 * expected, so a person fixes the declaration rather than guessing.
 */

export const SOURCE_KINDS = ['directory', 'git', 'github', 'jira', 'docs', 'hris', 'other'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export function githubLocatorProblem(locator: string): string | null {
  const trimmed = locator.trim();
  if (trimmed === '') return 'a github locator names no repository';
  const parts = trimmed.split('/');
  if (parts.length < 2) {
    return `a github locator names its owner and repository as "<owner>/<repo>" (for example anthropics/claude-code); "${trimmed}" has no "/" separating them`;
  }
  if (parts.length > 2) return `a github locator names one repository, "<owner>/<repo>"; "${trimmed}" names more than that`;
  const [owner, repo] = parts.map((p) => p.trim());
  if (owner === '') return `a github locator names which owner the repository belongs to; "${trimmed}" leaves it empty`;
  if (repo === '') return `a github locator names which repository ${owner!} owns; "${trimmed}" leaves the repository empty`;
  return null;
}

export function jiraLocatorProblem(locator: string): string | null {
  const trimmed = locator.trim();
  if (trimmed === '') return 'a jira locator names no project';
  if (!/^[A-Z][A-Z0-9_]{1,9}$/.test(trimmed)) {
    return `a jira locator is a project key such as PROJ (uppercase letters, digits, underscore); got "${trimmed}"`;
  }
  return null;
}

export const DOCS_PROVIDERS = ['google-docs', 'confluence', 'notion'] as const;
export type DocsProvider = (typeof DOCS_PROVIDERS)[number];

export interface DocsLocator {
  readonly provider: DocsProvider;
  readonly container: string;
  readonly id: string;
}

function readDocsLocator(locator: string): { ok: true; value: DocsLocator } | { ok: false; reason: string } {
  const trimmed = locator.trim();
  if (trimmed === '') return { ok: false, reason: 'a docs locator names nothing to read' };
  const first = trimmed.indexOf(':');
  if (first < 0) {
    return { ok: false, reason: `a docs locator is "<provider>:<container>:<id>" (for example confluence:space:ENG); "${trimmed}" names no provider` };
  }
  const provider = trimmed.slice(0, first).trim();
  const rest = trimmed.slice(first + 1);
  const second = rest.indexOf(':');
  if (second < 0) {
    return { ok: false, reason: `a docs locator names its container after the provider, as "<provider>:<container>:<id>"; "${trimmed}" names no container` };
  }
  if (!(DOCS_PROVIDERS as readonly string[]).includes(provider)) {
    return { ok: false, reason: `"${provider}" is not a docs provider Construct knows (${DOCS_PROVIDERS.join(', ')})` };
  }
  const container = rest.slice(0, second).trim();
  const id = rest.slice(second + 1).trim();
  if (container === '') return { ok: false, reason: `a docs locator names what groups pages inside ${provider} (space, folder, workspace); "${trimmed}" leaves it empty` };
  if (id === '') return { ok: false, reason: `a docs locator names which ${container} to read; "${trimmed}" leaves the id empty` };
  return { ok: true, value: { provider: provider as DocsProvider, container, id } };
}

export function parseDocsLocator(locator: string): DocsLocator | null {
  const r = readDocsLocator(locator);
  return r.ok ? r.value : null;
}

export function docsLocatorProblem(locator: string): string | null {
  const r = readDocsLocator(locator);
  return r.ok ? null : r.reason;
}

export function directoryLocatorProblem(locator: string): string | null {
  const trimmed = locator.trim();
  if (trimmed === '') return 'a directory locator names no path';
  if (!trimmed.startsWith('/')) return `a directory locator is an absolute path; "${trimmed}" is relative`;
  if (trimmed.split('/').includes('..')) return `a directory locator does not climb with ".."; got "${trimmed}"`;
  return null;
}

export function gitLocatorProblem(locator: string): string | null {
  const trimmed = locator.trim();
  if (trimmed === '') return 'a git locator names no repository';
  if (/^[a-z][a-z0-9+.-]*:\/\/[^/@\s]+@/i.test(trimmed) || /^[^@\s/]+@[^:\s]+:/.test(trimmed) && /:[^@]*@/.test(trimmed)) {
    return 'a git locator carries no credentials; the host or connector holds them';
  }
  return null;
}

/** The problem with a locator for its kind, or null when it is well-formed. */
export function locatorProblem(kind: SourceKind | string, locator: string | null): string | null {
  if (locator === null) return null;
  switch (kind) {
    case 'github':
      return githubLocatorProblem(locator);
    case 'jira':
      return jiraLocatorProblem(locator);
    case 'docs':
      return docsLocatorProblem(locator);
    case 'directory':
      return directoryLocatorProblem(locator);
    case 'git':
      return gitLocatorProblem(locator);
    default:
      return locator.trim() === '' ? `a ${kind} locator names nothing` : null;
  }
}
