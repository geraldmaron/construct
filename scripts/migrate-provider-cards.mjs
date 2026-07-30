/**
 * scripts/migrate-provider-cards.mjs — generate registry/provider-cards.json.
 *
 * Reconciles, without replacing, two prior scattered sources into Provider
 * Card form per schemas/provider-card.schema.json:
 *   1. deps/intent.json's npm-dep/npm-optional entries (core npm runtime deps
 *      and optional/provider-plugin npm deps). npm-dev/npm-dev-dep/
 *      binary-sidecar entries other than docling/whisper are out of scope
 *      for this migration (build-time-only deps are not "things Construct
 *      depends on to run"; the remaining binary-sidecar entries — pandoc,
 *      typst, libreoffice, uv, docker, gh, op — get their first Provider
 *      Cards from sibling beads construct-tsyfe.4.3/.5.3/.6.5/.6.7/.10.3).
 *   2. lib/extensions/manifests/{docling,whisper}.manifest.json, the
 *      ingestion-provider manifests lib/ingest/sidecar-providers.mjs reads.
 *
 * Field-mapping decisions (recorded here, not silently applied):
 *   - deps/intent.json has no per-entry `owner`; every migrated npm-dep/
 *     npm-optional card defaults owner to 'construct-core', matching the
 *     owner value the docling/whisper manifests already declare.
 *   - deps/intent.json's free-text `healthCheck` string becomes
 *     { kind: 'import-check', detail: <original string> } — every
 *     npm-dep/npm-optional entry's healthCheck text starts with
 *     `require(...)`, confirmed by inspection at migration time.
 *   - A literal string "null" in `securityConcerns` (a data-entry quirk in
 *     deps/intent.json, e.g. apache-arrow/ink/react/pptxgenjs/
 *     pptx-embed-fonts/zod) is normalized to JSON null.
 *   - `versionPolicy.range` is read live from package.json
 *     dependencies/optionalDependencies, not copied from intent.json (which
 *     doesn't carry a range) — kept accurate by re-running this script.
 *   - docling/whisper get versionPolicy.type 'unmanaged': neither manifest
 *     declares an enforced version pin, only an install/health probe.
 *   - docling/whisper have no removalCriteria in their manifests; the
 *     migrated card records that gap explicitly as
 *     "unknown (not recorded in lib/extensions/manifests/<id>.manifest.json)"
 *     rather than inventing removal conditions the source doesn't state.
 *   - construct-tsyfe.6.5 adds Pandoc and Typst as the first `kind: 'binary'`
 *     cards, migrated from deps/intent.json's `binary-sidecar` entries for
 *     those two ids only; construct-tsyfe.6.7 adds LibreOffice as a
 *     `legacy: true` binary card with a behavior-based removalCriteria string
 *     (no target date). uv/docker/gh/op stay unmigrated, reserved for sibling
 *     bead construct-tsyfe.10.3. `healthCheck` free text ("pandoc --version"/
 *     "typst --version"/"soffice --headless --norestore --version")
 *     splits on whitespace into `{ command, args }` for the
 *     `subprocess-version` shape. `fallback.description` carries the exact
 *     install-hint strings lib/document-export.mjs's `installHint()` already
 *     returns for these two names (BINARY_INSTALL_HINTS below) — that
 *     function now looks the card up via findProviderCard() first, so the
 *     two copies must stay byte-identical. `degradationBehavior`
 *     ("graceful-skip" for both, the reviewed classification already in
 *     deps/intent.json) is carried through unchanged rather than
 *     re-litigated.
 *
 * Idempotent: re-run any time deps/intent.json or the ingestion-provider
 * manifests change. Does not modify either source file.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const INTENT_PATH = join(REPO_ROOT, 'deps', 'intent.json');
const PKG_PATH = join(REPO_ROOT, 'package.json');
const MANIFESTS_DIR = join(REPO_ROOT, 'lib', 'extensions', 'manifests');
const OUTPUT_PATH = join(REPO_ROOT, 'registry', 'provider-cards.json');

const DEFAULT_OWNER = 'construct-core';

// Sourced verbatim from lib/document-export.mjs's installHint() so
// findProviderCard()-backed lookups there return byte-identical text.

const BINARY_IDS = ['pandoc', 'typst', 'libreoffice'];
const BINARY_INSTALL_HINTS = {
  pandoc: 'Install pandoc to enable document export (e.g. `brew install pandoc` on macOS, `apt install pandoc` on Debian/Ubuntu, or https://pandoc.org/installing.html).',
  typst: 'Install typst to enable PDF export via Pandoc (`brew install typst` on macOS, https://github.com/typst/typst/releases for binaries).',
  libreoffice: 'Install LibreOffice to enable legacy .doc export (e.g. `brew install --cask libreoffice` on macOS, `apt install libreoffice` on Debian/Ubuntu, or https://www.libreoffice.org/download/). Override with CONSTRUCT_LIBREOFFICE_BIN.',
};

const LIBREOFFICE_REMOVAL_CRITERIA =
  'Remove when Pandoc ships a native .doc writer, .doc/.odp export is dropped from Construct, or PPTX diagram rasterization no longer requires LibreOffice.';

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function npmDepCard(entry, pkgRanges) {
  const securityConcerns = entry.securityConcerns === 'null' ? null : entry.securityConcerns ?? null;
  return {
    id: entry.id,
    kind: entry.kind,
    purpose: entry.purpose,
    owningWorkflow: entry.owningWorkflow,
    modeRequirement: entry.modeRequirement,
    securityConcerns,
    versionPolicy: {
      type: 'npm-semver',
      range: pkgRanges[entry.id] || null,
    },
    healthCheck: {
      kind: 'import-check',
      detail: entry.healthCheck,
    },
    fallback: {
      behavior: entry.degradationBehavior,
    },
    owner: DEFAULT_OWNER,
    removalCriteria: entry.removalCriteria,
  };
}

function sidecarCard(id) {
  const manifest = readJson(join(MANIFESTS_DIR, `${id}.manifest.json`));
  return {
    id: manifest.id,
    kind: 'sidecar',
    purpose: manifest.docs,
    owningWorkflow: (manifest.capabilities || []).join(', '),
    securityConcerns: `installSource='${manifest.installSource}', securityClassification='${manifest.securityClassification}' per lib/extensions/manifests/${id}.manifest.json`,
    versionPolicy: {
      type: 'unmanaged',
      notes: `Provisioned via ${manifest.installSource}; no enforced version pin, version (if any) is reported by the health-check subprocess only.`,
    },
    healthCheck: {
      kind: 'subprocess-version',
      detail: manifest.healthCheck.description,
      command: manifest.healthCheck.command,
      args: manifest.healthCheck.args,
      timeoutMs: manifest.healthCheck.timeoutMs,
    },
    fallback: {
      behavior: 'degraded-chain',
      chain: manifest.degradation.chain,
      terminal: manifest.degradation.terminal,
    },
    owner: manifest.owner,
    removalCriteria: `unknown (not recorded in lib/extensions/manifests/${id}.manifest.json)`,
  };
}

function binaryCard(entry) {
  const [command, ...args] = entry.healthCheck.split(' ');
  const securityConcerns = entry.securityConcerns === 'null' ? null : entry.securityConcerns ?? null;
  const card = {
    id: entry.id,
    kind: 'binary',
    purpose: entry.purpose,
    owningWorkflow: entry.owningWorkflow,
    modeRequirement: entry.modeRequirement,
    securityConcerns,
    versionPolicy: {
      type: 'unmanaged',
      notes: 'Resolved via PATH at export time; no enforced version pin (pinning/checksums are construct-tsyfe.10.3\'s scope). Version (if any) is reported by the health-check subprocess only.',
    },
    healthCheck: {
      kind: 'subprocess-version',
      detail: entry.id === 'libreoffice'
        ? 'Runs `soffice --headless --norestore --version`; matches lib/providers/libreoffice-export-provider.mjs headless usability probe.'
        : `Runs \`${entry.healthCheck}\`; matches lib/document-export.mjs's binVersion() helper used by detect().`,
      command,
      args,
      ...(entry.id === 'libreoffice' ? { timeoutMs: 5000 } : {}),
    },
    fallback: {
      behavior: entry.degradationBehavior,
      description: BINARY_INSTALL_HINTS[entry.id],
    },
    owner: DEFAULT_OWNER,
    removalCriteria: entry.id === 'libreoffice' ? LIBREOFFICE_REMOVAL_CRITERIA : entry.removalCriteria,
  };
  if (entry.id === 'libreoffice') card.legacy = true;
  return card;
}

function buildPkgRanges(pkg) {
  return { ...pkg.dependencies, ...pkg.optionalDependencies, ...pkg.devDependencies };
}

function main() {
  const intentEntries = readJson(INTENT_PATH);
  const pkg = readJson(PKG_PATH);
  const pkgRanges = buildPkgRanges(pkg);

  const npmCards = intentEntries
    .filter((e) => (e.kind === 'npm-dep' || e.kind === 'npm-optional') && e.disposition !== 'remove')
    .map((e) => npmDepCard(e, pkgRanges));

  const sidecarCards = ['docling', 'whisper'].map(sidecarCard);

  const binaryCards = intentEntries
    .filter((e) => e.kind === 'binary-sidecar' && BINARY_IDS.includes(e.id))
    .map(binaryCard);

  const providers = [...npmCards, ...sidecarCards, ...binaryCards].sort((a, b) => a.id.localeCompare(b.id));

  const doc = {
    version: 1,
    generatedAt: new Date().toISOString(),
    providers,
  };

  writeFileSync(OUTPUT_PATH, `${JSON.stringify(doc, null, 2)}\n`);
  console.log(`[ok] wrote ${providers.length} provider cards to ${OUTPUT_PATH}`);
}

main();
