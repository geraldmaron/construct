/**
 * lib/publish.mjs — `construct publish` orchestrator.
 *
 * Single compound run: artifact release gate (default), detect tooling, export
 * markdown (pandoc-ext/diagram + Construct PDF template), optional VHS terminal
 * demo, optional Playwright recording. --strict requires toolchain and gate.
 */

import fs from 'node:fs';
import path from 'node:path';
import { exportMarkdown, parsePublishFrontmatter, EXPORT_FORMATS } from './document-export.mjs';
import { detectPublishPipeline } from './publish-tooling.mjs';
import { runDemoRecord } from './demo.mjs';
import { loadDemoRecording } from './demo-recording.mjs';
import { recordPlaywrightDemo } from './playwright-demo.mjs';
import { validateArtifactRelease } from './artifact-release-gate.mjs';
import { inferArtifactTypeFromPath } from './artifact-type-from-path.mjs';
import { runOutputQuality } from './output-quality.mjs';
import { configPath } from './config-dir.mjs';
import { resolveArtifactWorkflowContract } from './artifact-manifest.mjs';
import { resolveGateLevel } from './artifact-gate-levels.mjs';

export { parsePublishFrontmatter };

export function formatGateFailureMessage(gateResult, { inputPath, cwd = process.cwd() } = {}) {
  const rel = path.relative(cwd, inputPath);
  const type = gateResult.type || 'unknown';
  const lines = [
    `Publish blocked: artifact release gate failed (${type}: ${rel})`,
    ...gateResult.errors.map((e) => `  - ${typeof e === 'string' ? e : e.message || String(e)}`),
  ];
  if (gateResult.warnings?.length) {
    lines.push('Warnings:');
    for (const w of gateResult.warnings) lines.push(`  - ${w}`);
  }
  lines.push(
    '',
    'Remediation:',
    `  node bin/construct artifact validate ${rel} --type=${type}`,
    '  node bin/construct workflow invoke --workflow-type prd-draft --text "…"',
    '  Run the listed specialists to author the artifact (invoke returns a plan only).',
    '  See skills/docs/prd-workflow.md — validate must pass before publish.',
  );
  return lines.join('\n');
}

export function runPublish({
  inputPath,
  format = 'pdf',
  outputPath,
  demos = [],
  recordings = [],
  figures = true,
  strict = true,
  sourceOnly = false,
  gate = true,
  preview = false,
  artifactType = null,
  cwd = process.cwd(),
  repoRoot,
  env = process.env,
} = {}) {
  const resolvedIn = path.resolve(cwd, inputPath);
  if (!fs.existsSync(resolvedIn)) {
    return { ok: false, message: `Input not found: ${resolvedIn}` };
  }

  const explicitDemos = demos.length > 0;
  const explicitRecordings = recordings.length > 0;
  let demoNames = demos;
  let recordingNames = recordings;
  if (!demoNames.length && !recordingNames.length) {
    const fm = parsePublishFrontmatter(resolvedIn);
    if (fm?.demo) demoNames = [fm.demo];
    if (fm?.recording) recordingNames = [fm.recording];
  }

  const detection = detectPublishPipeline({
    format,
    includeFigures: figures,
    includeTerminalDemo: explicitDemos && demoNames.length > 0 && !sourceOnly,
    cwd,
    repoRoot,
    env,
  });

  const ledger = { export: null, demos: [], recordings: [], detection, gate: null, validation: null };
  const resolvedType = artifactType || inferArtifactTypeFromPath(resolvedIn, { rootDir: cwd });

  if (gate && !sourceOnly && resolvedType) {
    ledger.gate = validateArtifactRelease({
      filePath: resolvedIn,
      type: resolvedType,
      cwd,
      rootDir: repoRoot || cwd,
    });
    if (!ledger.gate.ok && strict) {
      return {
        ok: false,
        strict: true,
        gateBlocked: true,
        ledger,
        message: formatGateFailureMessage(ledger.gate, { inputPath: resolvedIn, cwd }),
      };
    }
  }

  if (strict && !sourceOnly && !detection.present) {
    return { ok: false, strict: true, detection, missing: detection.missing, message: detection.message };
  }

  if (!sourceOnly) {
    const publishDir = configPath(cwd, 'publish');
    const defaultOut = path.join(publishDir, `${path.parse(resolvedIn).name}.${format}`);
    const resolvedOut = outputPath ? path.resolve(cwd, outputPath) : defaultOut;

    ledger.export = exportMarkdown({
      inputPath: resolvedIn,
      outputPath: resolvedOut,
      format,
      figures: figures && !sourceOnly,
      artifactType: resolvedType,
      env,
      cwd,
      repoRoot: repoRoot || cwd,
    });

    if (!ledger.export.ok && strict && !sourceOnly) {
      return { ok: false, strict: true, ledger, message: ledger.export.message };
    }

    // Post-export output validation: validate the produced file, its content roundtrip, and
    // its references; render-smoke and higher levels also capture screenshot evidence. The
    // gate level comes from the artifact's quality contract (defaults to standard).

    if (ledger.export.ok) {
      let gateLevel = 'standard';
      try {
        const contract = resolveArtifactWorkflowContract(resolvedType, { rootDir: repoRoot || cwd, cwd });
        gateLevel = resolveGateLevel(contract?.qualityContract);
      } catch { /* default level */ }

      // --preview forces a render so the user can inspect output before claiming done, even when
      // the artifact's own gate level would not otherwise capture screenshots.
      if (preview && gateLevel !== 'full-certification' && gateLevel !== 'human-reviewed') {
        gateLevel = 'render-smoke';
      }
      const sourceMarkdown = fs.readFileSync(resolvedIn, 'utf8');
      const diagramStrict = /^---\n[\s\S]*?\bcx_diagram_quality:\s*strict\b[\s\S]*?\n---/.test(sourceMarkdown);
      ledger.validation = runOutputQuality({
        exportPath: ledger.export.outputPath,
        format,
        sourceMarkdown,
        baseDir: path.dirname(resolvedIn),
        gateLevel,
        diagramStrict,
        rootDir: cwd,
        env,
      });
    }
  } else {
    ledger.export = { ok: true, skipped: 'source-only' };
  }

  for (const name of demoNames) {
    const demoRequired = explicitDemos && strict && !sourceOnly;
    const demoResult = runDemoRecord(name, {
      cwd,
      format: 'mp4',
      sourceOnly: sourceOnly || (!demoRequired && !detection.steps?.terminalDemo?.present),
      required: demoRequired,
      surface: 'tape',
    });
    ledger.demos.push(demoResult);
    if (demoRequired && !demoResult.ok) {
      return { ok: false, strict: true, ledger, message: demoResult.message };
    }
  }

  for (const name of recordingNames) {
    const recording = loadDemoRecording(name, { cwd, repoRoot: repoRoot || cwd });
    if (!recording) {
      const miss = { ok: false, name, message: `Recording not found: ${name}` };
      ledger.recordings.push(miss);
      if (explicitRecordings && strict && !sourceOnly) {
        return { ok: false, strict: true, ledger, message: miss.message };
      }
      continue;
    }
    const recResult = recordPlaywrightDemo(recording, { cwd, repoRoot: repoRoot || cwd, env });
    ledger.recordings.push(recResult);
    if (explicitRecordings && strict && !sourceOnly && !recResult.ok) {
      return { ok: false, strict: true, ledger, message: recResult.message };
    }
  }

  const exportOk = ledger.export?.ok !== false;
  const validationOk = ledger.validation?.ok !== false;
  const relOutput = ledger.export?.outputPath ? path.relative(cwd, ledger.export.outputPath) : null;

  return {
    ok: exportOk && validationOk,
    ledger,
    message: ledger.export?.skipped
      ? 'Publish source-only complete'
      : exportOk && validationOk
        ? `Published ${path.relative(cwd, ledger.export.outputPath)}`
        : !validationOk && relOutput
          ? preview
            ? `Preview rendered with validation failures: ${relOutput}`
            : `Publish blocked: output validation failed for ${relOutput}`
        : ledger.export?.message || detection.message,
  };
}

export function printPublishHelp() {
  console.log(`Usage: construct publish <markdown> [options]

Orchestrates typed artifact distribution: release gate (default), Pandoc export
with diagram filter and Construct PDF template, optional VHS/Playwright demos.

Options:
  --to=<format>           ${EXPORT_FORMATS.join(' | ')} (default: pdf)
  --output=<path>         Output path (default: .construct/publish/<name>.<format>)
  --type=<doc-type>       Artifact type for release gate (inferred from path when omitted)
  --demo=<name>           Terminal VHS tape name (repeatable)
  --recording=<name>      Playwright recording manifest (repeatable)
  --no-figures            Skip pandoc-ext/diagram filter
  --preview               Render the export to images and report what was verified
  --no-gate               Skip artifact release gate (maintainer escape hatch)
  --source-only           Write sources only; skip rendering
  --no-strict             Do not exit 2 when toolchain or gate fails
  --detect                Print tooling JSON and exit
  -h, --help              Show this message

Frontmatter (optional):
  publish:
    demo: resource-guard-rails
    recording: agentic-platforms-prd

Examples:
  node bin/construct publish docs/prd-platform/brief.md --strict --figures
  node bin/construct publish brief.md --type=research-brief --demo=quickstart
`);
}

// Every flag the publish spec declares maps to a behavior here; an unrecognized
// `--flag` is collected into `unknown` so the CLI can warn instead of silently
// dropping it (the pre-fix parser discarded --recording/--figures without a trace).

export function parsePublishArgs(argv = []) {
  const options = {
    format: 'pdf',
    output: null,
    type: null,
    demos: [],
    recordings: [],
    figures: true,
    strict: true,
    gate: true,
    sourceOnly: false,
    detect: false,
    preview: false,
    help: false,
    input: null,
    unknown: [],
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') { options.help = true; continue; }
    if (arg === '--strict') { options.strict = true; continue; }
    if (arg === '--no-strict') { options.strict = false; continue; }
    if (arg === '--source-only') { options.sourceOnly = true; continue; }
    if (arg === '--figures') { options.figures = true; continue; }
    if (arg === '--no-figures') { options.figures = false; continue; }
    if (arg === '--no-gate') { options.gate = false; continue; }
    if (arg === '--preview') { options.preview = true; continue; }
    if (arg === '--detect') { options.detect = true; continue; }
    if (arg === '--to') { options.format = argv[++i]; continue; }
    if (arg.startsWith('--to=')) { options.format = arg.slice(5); continue; }
    if (arg === '--output') { options.output = argv[++i]; continue; }
    if (arg.startsWith('--output=')) { options.output = arg.slice(9); continue; }
    if (arg === '--type') { options.type = argv[++i]; continue; }
    if (arg.startsWith('--type=')) { options.type = arg.slice(7); continue; }
    if (arg === '--demo') { options.demos.push(argv[++i]); continue; }
    if (arg.startsWith('--demo=')) { options.demos.push(arg.slice(7)); continue; }
    if (arg === '--recording') { options.recordings.push(argv[++i]); continue; }
    if (arg.startsWith('--recording=')) { options.recordings.push(arg.slice('--recording='.length)); continue; }
    if (!arg.startsWith('--')) { options.input = arg; continue; }
    options.unknown.push(arg);
  }
  return options;
}

export async function runPublishCli(argv = [], { cwd = process.cwd(), repoRoot } = {}) {
  const options = parsePublishArgs(argv);
  for (const flag of options.unknown) console.error(`[publish] Ignoring unknown flag: ${flag}`);

  if (options.help) {
    printPublishHelp();
    return { exitCode: 0 };
  }

  if (options.detect) {
    const detection = detectPublishPipeline({
      format: options.format,
      includeFigures: options.figures,
      includeTerminalDemo: options.demos.length > 0,
      cwd,
      repoRoot,
    });
    console.log(JSON.stringify(detection, null, 2));
    return { exitCode: detection.present ? 0 : 2 };
  }

  if (!options.input) {
    printPublishHelp();
    return { exitCode: 1 };
  }

  const result = runPublish({
    inputPath: options.input,
    format: options.format,
    outputPath: options.output,
    demos: options.demos,
    recordings: options.recordings,
    figures: options.figures,
    strict: options.strict,
    gate: options.gate,
    artifactType: options.type,
    sourceOnly: options.sourceOnly,
    preview: options.preview,
    cwd,
    repoRoot,
  });

  if (result.ok) {
    console.log(result.message);
    const validation = result.ledger?.validation;
    if (validation) {
      const pdf = validation.checks?.pdf;
      if (pdf?.pageCount) console.log(`  validity: ${pdf.pageCount} page(s)`);
      const roundtrip = validation.checks?.roundtrip;
      if (roundtrip && !roundtrip.degradation) console.log(`  content: ${roundtrip.message}`);
      if (validation.render?.evidence && !validation.render.result?.degradation) {
        console.log(`  render: ${validation.render.result.images.length} screenshot(s) captured`);
        if (options.preview) for (const img of validation.render.result.images) console.log(`    ${path.relative(cwd, img)}`);
      } else if (options.preview && validation.render?.result?.degradation) {
        console.log(`  render: skipped (${validation.render.result.degradation})`);
      }
      for (const w of validation.diagrams?.warnings || []) {
        console.log(`  diagram ${w.diagram} (${w.kind}): ${w.code} — ${w.detail}`);
      }
      const a11y = validation.a11y;
      if (a11y && !a11y.unsupported) {
        const checked = a11y.coverage.checked.map((c) => `${c.id}:${c.status}`).join(' ');
        console.log(`  a11y [${a11y.format}]: ${checked}`);
        if (a11y.coverage.uncheckable.length) {
          console.log(`  a11y uncheckable: ${a11y.coverage.uncheckable.map((u) => u.id).join(', ')}`);
        }
      }
      for (const f of validation.failures || []) console.log(`  ⚠ ${f}`);
    }
    if (result.ledger?.demos?.length) {
      for (const d of result.ledger.demos) {
        if (d.tapePath) console.log(`  tape: ${d.tapePath}`);
        if (d.artifactPath) console.log(`  demo: ${d.artifactPath}`);
      }
    }
    return { exitCode: 0, result };
  }

  console.error(result.message);
  if (result.ledger?.validation?.ok === false) {
    for (const failure of result.ledger.validation.failures || []) console.error(`  - ${failure}`);
  }
  const exitCode = result.strict && (result.missing?.length || result.gateBlocked) ? 2 : 1;
  return { exitCode, result };
}
