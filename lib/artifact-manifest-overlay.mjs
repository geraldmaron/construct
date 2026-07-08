/**
 * lib/artifact-manifest-overlay.mjs — project/user tier overlays and the
 * sanctioned `adhoc` type for the artifact capability manifest.
 *
 * The builtin manifest (specialists/artifact-manifest.json) is the shipped
 * source of truth and is never modified. A user may extend the registered
 * document classes two ways without touching the builtin:
 *
 *   - Register a custom type with `construct templates register <type>`, which
 *     writes a project-tier overlay entry here and a matching template file
 *     under .construct/templates/docs/<type>.md.
 *   - Author a one-off `adhoc` artifact, a code-level sanctioned type injected
 *     at load time so it resolves with zero prior registration.
 *
 * Overlays merge over the builtin by the same three-tier precedence the
 * extension loader uses (builtin < user < project), deep-merged per type so an
 * overlay may tweak a single field. The sanctioned adhoc entry sits below the
 * builtin so a builtin type of the same name would always win.
 */

import fs from 'node:fs';
import path from 'node:path';

// Project-local config dir, mirroring lib/extensions/loader.mjs (project tier
// = <rootDir>/.cx/). Kept as a local constant so this module has no dependency
// on the config-dir consolidation that postdates staging.

const PROJECT_CONFIG_DIR = '.cx';

function configPath(projectRoot, ...segments) {
  return path.join(projectRoot, PROJECT_CONFIG_DIR, ...segments);
}

export const ADHOC_TYPE = 'adhoc';
export const OVERLAY_FILENAME = 'artifact-manifest.overlay.json';

// The adhoc type is instructions-driven: no fixed structure, so its release
// gate keeps the quality checks (structural lint runs against an empty section
// set, citation discipline, a one-paragraph prose floor) while leaving the
// document shape free-form. Free-form structure, not free-form quality.

export const SANCTIONED_ARTIFACTS = Object.freeze({
  [ADHOC_TYPE]: {
    template: 'templates/docs/adhoc.md',
    documentClass: ADHOC_TYPE,
    description: 'Sanctioned one-off artifact: structure follows the supplied instructions, quality gates still apply.',
    primaryOwners: ['cx-product-manager', 'cx-operations'],
    toneDefault: 'direct',
    toneAllowed: ['direct', 'executive-concise', 'friendly'],
    aliases: ['ad-hoc', 'free-form', 'freeform'],
    structureRequirements: [],
    visualRequirements: [],
    researchProfile: null,
    outputDir: 'docs/adhoc',
    releaseGate: {
      structuralLint: true,
      citationLint: true,
      proseMinimum: 1,
      requiredReviewers: [],
      optionalReviewers: [],
    },
  },
});

function homeFromEnv(homeDir) {
  return homeDir ?? (process.env.HOME || process.env.USERPROFILE || '');
}

/**
 * Canonical overlay file paths for the user and project tiers.
 *
 * @param {{ cwd?: string, homeDir?: string }} [opts]
 * @returns {{ user: string|null, project: string }}
 */
export function overlayPaths({ cwd = process.cwd(), homeDir } = {}) {
  const home = homeFromEnv(homeDir);
  return {
    user: home ? path.join(home, '.config', 'construct', OVERLAY_FILENAME) : null,
    project: configPath(cwd, OVERLAY_FILENAME),
  };
}

function readOverlayArtifacts(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return parsed && typeof parsed.artifacts === 'object' && parsed.artifacts ? parsed.artifacts : null;
  } catch {
    return null;
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Deep-merge per artifact type so an overlay entry may override a single field
// (e.g. outputDir) without restating the whole entry. Arrays replace wholesale
// — a caller redefining structureRequirements means the full new list.

function mergeEntry(base, next) {
  if (!isPlainObject(base)) return structuredClone(next);
  if (!isPlainObject(next)) return structuredClone(next);
  const out = { ...base };
  for (const [key, value] of Object.entries(next)) {
    out[key] = isPlainObject(value) && isPlainObject(out[key]) ? mergeEntry(out[key], value) : structuredClone(value);
  }
  return out;
}

function mergeArtifactLayers(...layers) {
  const merged = {};
  for (const layer of layers) {
    if (!isPlainObject(layer)) continue;
    for (const [type, entry] of Object.entries(layer)) {
      merged[type] = mergeEntry(merged[type], entry);
    }
  }
  return merged;
}

/**
 * Merge the sanctioned, user-overlay, and project-overlay artifact maps onto a
 * builtin manifest's artifacts, returning a new manifest object. The builtin
 * top-level fields (version, description, workflowDefaults) are preserved.
 *
 * @param {object} builtinManifest
 * @param {{ cwd?: string, homeDir?: string }} [opts]
 * @returns {object}
 */
export function applyArtifactOverlays(builtinManifest, { cwd = process.cwd(), homeDir } = {}) {
  const paths = overlayPaths({ cwd, homeDir });
  const userArtifacts = readOverlayArtifacts(paths.user);
  const projectArtifacts = readOverlayArtifacts(paths.project);
  const artifacts = mergeArtifactLayers(
    SANCTIONED_ARTIFACTS,
    builtinManifest.artifacts ?? {},
    userArtifacts,
    projectArtifacts,
  );
  return { ...builtinManifest, artifacts };
}

/**
 * A cheap signature over the overlay files so the manifest cache invalidates
 * when a user registers a type or edits an overlay within one long-running
 * process (the MCP server). Missing files contribute a stable zero.
 *
 * @param {{ cwd?: string, homeDir?: string }} [opts]
 * @returns {string}
 */
export function overlaySignature({ cwd = process.cwd(), homeDir } = {}) {
  const { user, project } = overlayPaths({ cwd, homeDir });
  return [user, project]
    .map((p) => {
      if (!p) return 'x:0';
      try {
        const stat = fs.statSync(p);
        return `${p}:${stat.mtimeMs}`;
      } catch {
        return `${p}:0`;
      }
    })
    .join('|');
}

function slugType(type) {
  return String(type ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Memo-like defaults per R2: a custom type resolves a sensible author/reviewer
// chain and a standard release gate unless the overlay entry overrides them.

function defaultOverlayEntry(type, { description, template } = {}) {
  return {
    template: template ?? `templates/docs/${type}.md`,
    documentClass: type,
    description: description || `Custom document class: ${type}`,
    primaryOwners: ['cx-product-manager', 'cx-operations'],
    toneDefault: 'direct',
    toneAllowed: ['direct', 'executive-concise', 'friendly'],
    structureRequirements: [],
    visualRequirements: [],
    researchProfile: null,
    releaseGate: {
      structuralLint: true,
      citationLint: true,
      proseMinimum: 1,
      requiredReviewers: [],
      optionalReviewers: [],
    },
    registeredBy: 'construct templates register',
    registeredAt: new Date().toISOString().slice(0, 10),
  };
}

const DEFAULT_TEMPLATE_SKELETON = (type, description) => `# {title}

<!-- ${description || `Custom ${type} document`} · registered via \`construct templates register ${type}\` -->

## Summary

One-paragraph overview of what this document decides or communicates, in enough
detail that the release gate's prose floor is met. Replace this text.

## Details

Expand the substance here. Cite sources with links or mark unverified claims
with [unverified] so the citation gate passes.

## Next steps

- Action or decision requested
`;

/**
 * Register a custom document class in the project tier: write the template file
 * under .construct/templates/docs/<type>.md and add or update the type's entry
 * in the project overlay. The builtin manifest is never touched.
 *
 * @param {object} args
 * @param {string} args.type
 * @param {string} [args.description]
 * @param {string} [args.from]        path to a template file to seed the override
 * @param {string} [args.cwd]
 * @param {string} [args.homeDir]
 * @param {boolean} [args.force]      overwrite an existing template file
 * @returns {{ type: string, overlayPath: string, templatePath: string, existed: boolean }}
 */
export function registerArtifactType({ type, description, from, cwd = process.cwd(), homeDir, force = false } = {}) {
  const safeType = slugType(type);
  if (!safeType) throw new Error('type is required (letters, digits, dot, dash, underscore)');

  const templatePath = configPath(cwd, 'templates', 'docs', `${safeType}.md`);
  const existed = fs.existsSync(templatePath);
  fs.mkdirSync(path.dirname(templatePath), { recursive: true });

  let templateBody;
  if (from) {
    const src = path.resolve(cwd, from);
    if (!fs.existsSync(src)) throw new Error(`--from template not found: ${from}`);
    templateBody = fs.readFileSync(src, 'utf8');
  } else if (!existed || force) {
    templateBody = DEFAULT_TEMPLATE_SKELETON(safeType, description);
  }
  if (templateBody !== undefined && (!existed || force || from)) {
    fs.writeFileSync(templatePath, templateBody.endsWith('\n') ? templateBody : `${templateBody}\n`);
  }

  const { project: overlayPath } = overlayPaths({ cwd, homeDir });
  fs.mkdirSync(path.dirname(overlayPath), { recursive: true });
  let overlay = { version: 1, artifacts: {} };
  if (fs.existsSync(overlayPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(overlayPath, 'utf8'));
      if (isPlainObject(parsed)) {
        overlay = { version: parsed.version ?? 1, artifacts: isPlainObject(parsed.artifacts) ? parsed.artifacts : {} };
      }
    } catch {
      overlay = { version: 1, artifacts: {} };
    }
  }
  const prior = isPlainObject(overlay.artifacts[safeType]) ? overlay.artifacts[safeType] : null;
  overlay.artifacts[safeType] = mergeEntry(defaultOverlayEntry(safeType, { description }), prior || {});
  if (description) overlay.artifacts[safeType].description = description;
  fs.writeFileSync(overlayPath, `${JSON.stringify(overlay, null, 2)}\n`);

  return { type: safeType, overlayPath, templatePath, existed };
}
