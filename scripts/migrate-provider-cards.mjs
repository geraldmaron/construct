/**
 * scripts/migrate-provider-cards.mjs — generate registry/provider-cards.json (construct-4uxq0.13.7).
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
 *     Exception: docling's card overrides to 'external-pinned' below —
 *     construct-tsyfe.10.3 gave it a committed pyproject.toml/uv.lock, so
 *     unlike whisper it now genuinely is pinned, not merely probed.
 *   - docling/whisper have no removalCriteria in their manifests; the
 *     migrated card records that gap explicitly as
 *     "unknown (not recorded in lib/extensions/manifests/<id>.manifest.json)"
 *     rather than inventing removal conditions the source doesn't state.
 *
 * construct-tsyfe.10.3 adds Provider Cards for the binary-sidecar entries the
 * npm-dep/npm-optional migration above deliberately excludes — pandoc,
 * typst, d2, dot, soffice, vhs, ffmpeg — plus two `kind: 'model'` cards for
 * artifacts with no npm/pip package identity of their own (docling's
 * downloaded ML models; the @huggingface/transformers local embedding
 * model). These are literal objects in BINARY_CARDS/MODEL_CARDS below, not
 * derived from deps/intent.json (none of them are npm packages) or from an
 * ingestion-provider manifest (none of them are ingestion sidecars) — there
 * is no existing source file to reconcile them from, so they are recorded
 * directly here, the same way sidecarCard() is the source of truth for
 * docling/whisper's shape. Version/checksum values are grounded in a real
 * `<bin> --version` run on the authoring machine (recorded per-card in
 * `versionPolicy.notes`) rather than fabricated; where a fact could not be
 * verified (e.g. docling's internal HF model revision, the embedding
 * model's exact commit SHA) the card says so explicitly instead of
 * inventing a plausible-looking value.
 *
 * Idempotent: re-run any time deps/intent.json or the ingestion-provider
 * manifests change. Does not modify either source file.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DOCLING_PIN } from '../lib/runtime/uv-bootstrap.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const INTENT_PATH = join(REPO_ROOT, 'deps', 'intent.json');
const PKG_PATH = join(REPO_ROOT, 'package.json');
const MANIFESTS_DIR = join(REPO_ROOT, 'lib', 'extensions', 'manifests');
const OUTPUT_PATH = join(REPO_ROOT, 'registry', 'provider-cards.json');

const DEFAULT_OWNER = 'construct-core';
const VERSION_REFERENCE_DATE = '2026-07-17';

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

// docling is the one sidecar construct-tsyfe.10.3 actually pins (a committed
// pyproject.toml/uv.lock, consumed by lib/runtime/uv-bootstrap.mjs's
// `uv sync --frozen`) — its versionPolicy overrides the generic
// manifest-derived 'unmanaged' default accordingly. whisper has no such pin
// (system-provisioned, no lockfile) and keeps the generic shape.

function sidecarCard(id) {
  const manifest = readJson(join(MANIFESTS_DIR, `${id}.manifest.json`));
  const card = {
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
  if (id === 'docling') {
    card.versionPolicy = {
      type: 'external-pinned',
      expectedVersion: DOCLING_PIN,
      notes: 'Pinned via the committed lib/runtime/docling-runtime/pyproject.toml + uv.lock (construct-tsyfe.10.3); `uv sync --frozen` installs this exact, checksummed dependency graph rather than resolving fresh. DOCLING_PIN in lib/runtime/uv-bootstrap.mjs and the lockfile\'s docling== pin must match — tests/functional/docling-venv-pin.functional.test.mjs asserts they do.',
    };
  }
  return card;
}

function buildPkgRanges(pkg) {
  return { ...pkg.dependencies, ...pkg.optionalDependencies, ...pkg.devDependencies };
}

// Homebrew/system binaries: no lockfile, no enforced pin — versionPolicy
// records a reference version verified by actually running `<bin> --version`
// on the authoring machine (VERSION_REFERENCE_DATE), not a value construct
// controls. The health check compares live output against this reference and
// warns on drift (decision (a) in construct-tsyfe.10.3); it never hard-fails,
// since these are user-installed, not Construct-bundled.

const BINARY_CARDS = [
  {
    id: 'pandoc',
    kind: 'binary',
    purpose: 'Universal document converter — primary engine for markdown-to-DOCX/PDF/HTML/RTF/ODT/EPUB/LaTeX/TXT export',
    owningWorkflow: 'document-export (pdf, docx, doc, deck, html, rtf, odt, epub, tex, txt formats per lib/registry/manifests/format-engines.default.json)',
    modeRequirement: 'all',
    securityConcerns: 'Runs an external binary over Construct-authored markdown via a Lua filter (vendor/pandoc-ext/diagram.lua); input is Construct\'s own content rather than third-party untrusted input, so the primary risk is a supply-chain-substituted binary rather than input-driven exploitation',
    versionPolicy: {
      type: 'external-pinned',
      expectedVersion: '3.10',
      notes: `Reference version verified via \`pandoc --version\` on the authoring machine (macOS/Homebrew) on ${VERSION_REFERENCE_DATE}. User-installed, not Construct-bundled — the health check warns rather than hard-fails when a different version is installed.`,
    },
    healthCheck: {
      kind: 'subprocess-version',
      detail: 'Runs `pandoc --version`; first stdout line is `pandoc <version>`. A missing binary is separately reported by lib/document-export.mjs\'s detect() as ok:false with installHint(\'pandoc\') — this Provider Card\'s health check layers a version-identity warning on top of that existing presence check, it does not replace it.',
      command: 'pandoc',
      args: ['--version'],
      timeoutMs: 10000,
    },
    fallback: {
      behavior: 'error',
      description: 'No fallback renderer: pandoc is the sole engine for pdf/docx/doc/deck/html/rtf/odt/epub/tex/txt export. Absence makes detect() return ok:false with installHint(\'pandoc\') (`Install pandoc ... brew install pandoc`); pptx export is unaffected (pptxgenjs-based, no pandoc dependency).',
    },
    owner: DEFAULT_OWNER,
    removalCriteria: 'Pandoc is replaced as the document-export engine by a different converter (e.g. a native Node-based typesetting pipeline)',
  },
  {
    id: 'typst',
    kind: 'binary',
    purpose: 'PDF typesetting engine invoked by pandoc (--pdf-engine=typst) for all PDF export',
    owningWorkflow: 'document-export (pdf format — lib/registry/manifests/format-engines.default.json always sets pdfEngine: "typst")',
    modeRequirement: 'all',
    securityConcerns: null,
    versionPolicy: {
      type: 'external-pinned',
      expectedVersion: '0.15.0',
      notes: `Reference version verified via \`typst --version\` on the authoring machine (macOS/Homebrew) on ${VERSION_REFERENCE_DATE}. User-installed, not Construct-bundled — the health check warns rather than hard-fails when a different version is installed.`,
    },
    healthCheck: {
      kind: 'subprocess-version',
      detail: 'Runs `typst --version`; stdout is `typst <version> (<commit>)`.',
      command: 'typst',
      args: ['--version'],
      timeoutMs: 10000,
    },
    fallback: {
      behavior: 'error',
      description: 'Every PDF export routes through pandoc --pdf-engine=typst (lib/document-export.mjs:482,491); there is no alternate pdfEngine in format-engines.default.json. Absence surfaces installHint(\'typst\') (`Install typst ... brew install typst`) and PDF export fails; docx/html/rtf/odt/epub/tex/txt export are unaffected (no pdfEngine dependency).',
    },
    owner: DEFAULT_OWNER,
    removalCriteria: 'PDF export is retargeted to a different pdf-engine (e.g. wkhtmltopdf, weasyprint, or a native Node PDF renderer)',
  },
  {
    id: 'd2',
    kind: 'binary',
    purpose: 'Primary diagram-from-code renderer for `construct diagram` and for diagram fences in exported decks/PDFs/HTML',
    owningWorkflow: 'construct diagram; document-export/deck-export-pptx diagram-fence rendering',
    modeRequirement: 'all',
    securityConcerns: null,
    versionPolicy: {
      type: 'external-pinned',
      expectedVersion: '0.7.1',
      notes: `Reference version verified via \`d2 --version\` on the authoring machine (macOS/Homebrew) on ${VERSION_REFERENCE_DATE}. User-installed, not Construct-bundled — the health check warns rather than hard-fails when a different version is installed.`,
    },
    healthCheck: {
      kind: 'subprocess-version',
      detail: 'Runs `d2 --version`; stdout is a bare version string (no "d2" prefix).',
      command: 'd2',
      args: ['--version'],
      timeoutMs: 10000,
    },
    fallback: {
      behavior: 'degraded-chain',
      chain: [
        { id: 'd2', mode: 'binary', description: 'Primary renderer (lib/diagram.mjs locateRenderer()); distinctive theme, --sketch hand-drawn mode for deck export (lib/deck-export-pptx.mjs:1080).' },
        { id: 'dot', mode: 'binary', description: 'Graphviz fallback for `construct diagram` only (lib/diagram.mjs); ubiquitous, headless `dot -Tsvg|-Tpng`.' },
        { id: 'mermaid-source', mode: 'source-only', description: '`construct diagram` still exits 0, writing Mermaid/D2 SOURCE plus an install hint, no rendered image. deck-export-pptx.mjs instead skips the diagram with a placeholder shape (renderCtx.skipped), not counted as a failed render.' },
      ],
      terminal: 'mermaid-source',
    },
    owner: DEFAULT_OWNER,
    removalCriteria: 'D2 is replaced as the primary diagram renderer by a different code-driven diagramming tool',
  },
  {
    id: 'dot',
    kind: 'binary',
    purpose: 'Graphviz fallback diagram renderer for `construct diagram` when d2 is absent',
    owningWorkflow: 'construct diagram (fallback engine)',
    modeRequirement: 'all',
    securityConcerns: null,
    versionPolicy: {
      type: 'external-pinned',
      expectedVersion: '15.0.0',
      notes: `Reference version verified via \`dot -V\` on the authoring machine (macOS/Homebrew) on ${VERSION_REFERENCE_DATE}. User-installed, not Construct-bundled — the health check warns rather than hard-fails when a different version is installed.`,
    },
    healthCheck: {
      kind: 'subprocess-version',
      detail: 'Graphviz writes its version to stderr for `dot -V`: `dot - graphviz version <version> (<build>)`.',
      command: 'dot',
      args: ['-V'],
      timeoutMs: 10000,
    },
    fallback: {
      behavior: 'degraded-chain',
      chain: [
        { id: 'd2', mode: 'binary', description: 'Primary renderer; see the "d2" Provider Card.' },
        { id: 'dot', mode: 'binary', description: 'This provider: ubiquitous fallback, headless `dot -Tsvg|-Tpng` (lib/diagram.mjs locateRenderer()).' },
        { id: 'mermaid-source', mode: 'source-only', description: 'Neither renderer present: `construct diagram` still exits 0, writing Mermaid/D2 SOURCE plus an install hint.' },
      ],
      terminal: 'mermaid-source',
    },
    owner: DEFAULT_OWNER,
    removalCriteria: 'Graphviz dot is dropped as the diagram-render fallback (e.g. if D2 becomes a hard requirement)',
  },
  {
    id: 'soffice',
    kind: 'binary',
    purpose: 'LibreOffice headless conversion for formats pandoc cannot write (legacy .doc) and for PPTX preview-PNG rendering',
    owningWorkflow: 'document-export (doc format, via lib/libreoffice-export.mjs); render-pipeline.mjs pptx preview rendering',
    modeRequirement: 'all',
    securityConcerns: null,
    versionPolicy: {
      type: 'external-pinned',
      expectedVersion: '26.2.4.2',
      notes: `Reference version verified via \`soffice --version\` on the authoring machine (macOS/Homebrew) on ${VERSION_REFERENCE_DATE}. User-installed, not Construct-bundled — the health check warns rather than hard-fails when a different version is installed.`,
    },
    healthCheck: {
      kind: 'subprocess-version',
      detail: 'Runs `soffice --version`; stdout is `LibreOffice <version> <build-hash>`.',
      command: 'soffice',
      args: ['--version'],
      timeoutMs: 15000,
    },
    fallback: {
      behavior: 'error',
      description: 'Two distinct call sites, different consequences on absence: (1) lib/libreoffice-export.mjs\'s convertDocxToDoc — the sole path for legacy .doc export (ADR-0024) — returns ok:false with libreOfficeInstallHint() (`Install LibreOffice ... brew install --cask libreoffice`); pdf/docx/html/rtf/odt/epub/tex/txt/pptx export are unaffected. (2) lib/render-pipeline.mjs\'s pptx preview renderer degrades gracefully instead — a typed degradation reason, not a hard failure — since it only produces an inspectable preview image, not the export artifact itself.',
    },
    owner: DEFAULT_OWNER,
    removalCriteria: 'Legacy .doc export is dropped entirely, or LibreOffice is replaced by a different down-converter for both use sites',
  },
  {
    id: 'vhs',
    kind: 'binary',
    purpose: 'Terminal-recording engine driving .tape scripts for `construct demo` GIF/MP4/WebM output',
    owningWorkflow: 'construct demo (terminal recordings)',
    modeRequirement: 'all',
    securityConcerns: null,
    versionPolicy: {
      type: 'external-pinned',
      expectedVersion: '0.11.0',
      notes: `Reference version verified via \`vhs --version\` on the authoring machine (macOS/Homebrew) on ${VERSION_REFERENCE_DATE}. User-installed, not Construct-bundled — the health check warns rather than hard-fails when a different version is installed.`,
    },
    healthCheck: {
      kind: 'subprocess-version',
      detail: 'Runs `vhs --version`; stdout is `vhs version <version>`.',
      command: 'vhs',
      args: ['--version'],
      timeoutMs: 10000,
    },
    fallback: {
      behavior: 'degraded-chain',
      chain: [
        { id: 'vhs', mode: 'binary', description: 'Primary terminal recorder driving .tape scripts (lib/demo.mjs locateRecorder()).' },
        { id: 'asciinema', mode: 'binary', description: 'Alternate terminal recorder; a different capture format/workflow, not a drop-in .tape interpreter.' },
        { id: 'refuse', mode: 'error', description: 'Neither vhs nor asciinema present: `construct demo` reports the missing-tool install hint and does not record.' },
      ],
      terminal: 'refuse',
    },
    owner: DEFAULT_OWNER,
    removalCriteria: 'VHS is replaced as the terminal-recording engine, or `construct demo` drops terminal recordings entirely',
  },
  {
    id: 'ffmpeg',
    kind: 'binary',
    purpose: 'webm-to-mp4 transcoding for Playwright-recorded demo videos',
    owningWorkflow: 'construct demo --surface=playwright (mp4 output format)',
    modeRequirement: 'all',
    securityConcerns: null,
    versionPolicy: {
      type: 'external-pinned',
      expectedVersion: '8.1.2',
      notes: `Reference version verified via \`ffmpeg --version\` on the authoring machine (macOS/Homebrew) on ${VERSION_REFERENCE_DATE}. User-installed, not Construct-bundled — the health check warns rather than hard-fails when a different version is installed.`,
    },
    healthCheck: {
      kind: 'subprocess-version',
      detail: 'Runs `ffmpeg --version`; first stdout line is `ffmpeg version <version> Copyright ...`.',
      command: 'ffmpeg',
      args: ['--version'],
      timeoutMs: 10000,
    },
    fallback: {
      behavior: 'error',
      description: 'lib/playwright-demo.mjs\'s transcodeWebmToMp4 returns ok:false ("ffmpeg not on PATH") when mp4 output is requested and ffmpeg is absent; finalizeDemoVideo surfaces that failure directly. The underlying .webm recording remains on disk and unaffected — requesting format="webm" sidesteps the dependency entirely.',
    },
    owner: DEFAULT_OWNER,
    removalCriteria: 'Playwright demo recordings drop mp4 transcoding, or ffmpeg is replaced by a different transcoder',
  },
];

const MODEL_CARDS = [
  {
    id: 'docling-models',
    kind: 'model',
    purpose: 'Layout/OCR/table-structure ML models docling downloads from the Hugging Face Hub on first sidecar run',
    owningWorkflow: 'document-extraction (docling sidecar)',
    modeRequirement: 'all',
    securityConcerns: 'Model weights are fetched from the Hugging Face Hub over the network on first use by the docling package itself, not by Construct code; a compromised or swapped model artifact at that point is a supply-chain vector Construct cannot currently detect independently of pinning docling itself',
    versionPolicy: {
      type: 'unmanaged',
      notes: `Model weights are downloaded by the pinned docling==${DOCLING_PIN} package (lib/runtime/docling-runtime/pyproject.toml, construct-tsyfe.10.3) at first sidecar run; docling's own release pins its default model revision(s) internally. Construct does not independently record or verify a specific Hugging Face model revision/commit SHA for these weights — pinning the docling package itself is the closest available control today. Recording the exact internal model revision(s) would require inspecting the installed docling package's own model-download manifest; documented here as a known gap rather than an invented value (construct-tsyfe.10.3 non-goal: does not vendor or independently pin these weights).`,
    },
    healthCheck: {
      kind: 'manual',
      detail: 'No automated version-identity check exists for the downloaded model weights themselves; the "docling" Provider Card\'s subprocess-version health check verifies the docling package version, which transitively determines which model revision(s) it requests.',
    },
    fallback: {
      behavior: 'degraded-chain',
      chain: [
        { id: 'docling-models', mode: 'sidecar', description: 'Layout-aware extraction models bundled with the pinned docling release.' },
        { id: 'node-native', mode: 'adapter', description: 'unpdf (PDF) or mammoth (DOCX) pure-JS fallback — the same chain the "docling" sidecar Provider Card declares; this card documents the model layer of that same chain, not a separate one.' },
        { id: 'refuse', mode: 'error', description: 'No extractor available for this format; ingest fails loud with an actionable install hint.' },
      ],
      terminal: 'refuse',
    },
    owner: DEFAULT_OWNER,
    removalCriteria: 'unknown (not independently tracked; follows the docling sidecar\'s own removal criteria)',
  },
  {
    id: 'local-embedding-model',
    kind: 'model',
    purpose: 'Xenova/all-MiniLM-L6-v2 ONNX sentence-embedding model for offline/local vector search (lib/storage/embeddings-local.mjs)',
    owningWorkflow: 'knowledge-search, evidence-ingest (local embedding path)',
    modeRequirement: 'solo',
    securityConcerns: 'Model weights are fetched from the Hugging Face Hub on first use (@huggingface/transformers pipeline()); a swapped/compromised model artifact at that revision is a supply-chain vector. allowRemoteModels=false after the first fetch means subsequent runs never re-fetch, but the first fetch is unauthenticated network content.',
    versionPolicy: {
      type: 'unmanaged',
      notes: 'lib/storage/embeddings-local.mjs\'s pipeline(\'feature-extraction\', \'Xenova/all-MiniLM-L6-v2\', ...) requests an explicit, overridable revision (CONSTRUCT_EMBEDDING_MODEL_REVISION env var, default \'main\' — construct-tsyfe.10.3) so a specific commit SHA can be pinned without a code change once one is verified against a live Hugging Face Hub query. This session could not fabricate that commit SHA without network-verifying it against the live Hub API at record time, so \'main\' remains the recorded default rather than an invented pin — a follow-up should resolve and pin the exact revision.',
    },
    healthCheck: {
      kind: 'import-check',
      detail: 'Verified indirectly via the "@huggingface/transformers" npm-optional Provider Card\'s import-check; no separate subprocess exists for the model artifact itself. getModelInfo() in lib/storage/embeddings-local.mjs reports the loaded model id/dimensions at runtime.',
    },
    fallback: {
      behavior: 'graceful-skip',
      description: 'embed()/embedBatch() in lib/storage/embeddings-local.mjs fall back to hashing-bow-v1 (lib/storage/embeddings-legacy.mjs) and mark the result degraded:true with fallbackReason set, whenever the model fails to load — never throws.',
    },
    owner: DEFAULT_OWNER,
    removalCriteria: 'Local embedding is handled by a different mechanism (e.g. llama.cpp bindings) or removed from the feature set',
  },
];

function main() {
  const intentEntries = readJson(INTENT_PATH);
  const pkg = readJson(PKG_PATH);
  const pkgRanges = buildPkgRanges(pkg);

  const npmCards = intentEntries
    .filter((e) => e.kind === 'npm-dep' || e.kind === 'npm-optional')
    .map((e) => npmDepCard(e, pkgRanges));

  const sidecarCards = ['docling', 'whisper'].map(sidecarCard);

  const providers = [...npmCards, ...sidecarCards, ...BINARY_CARDS, ...MODEL_CARDS]
    .sort((a, b) => a.id.localeCompare(b.id));

  const doc = {
    version: 1,
    generatedAt: new Date().toISOString(),
    providers,
  };

  writeFileSync(OUTPUT_PATH, `${JSON.stringify(doc, null, 2)}\n`);
  console.log(`[ok] wrote ${providers.length} provider cards to ${OUTPUT_PATH}`);
}

main();
