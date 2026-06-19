/**
 * lib/publish.mjs — `construct publish` orchestrator.
 *
 * Single compound run: artifact release gate (default), detect tooling, export
 * markdown (pandoc-ext/diagram + Construct PDF template), optional VHS terminal
 * demo, optional Playwright dashboard demo. --strict requires toolchain and gate.
 */

import fs from 'node:fs';
import path from 'node:path';
import { exportMarkdown, parsePublishFrontmatter } from './document-export.mjs';
import { detectPublishPipeline } from './publish-tooling.mjs';
import { runDemoRecord } from './demo.mjs';
import { recordDashboardDemo } from './dashboard-demo.mjs';
import { validateArtifactRelease } from './artifact-release-gate.mjs';
import { inferArtifactTypeFromPath } from './artifact-type-from-path.mjs';

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
  dashboardDemos = [],
  figures = true,
  strict = true,
  sourceOnly = false,
  gate = true,
  artifactType = null,
  cwd = process.cwd(),
  repoRoot,
  env = process.env,
} = {}) {
  const resolvedIn = path.resolve(cwd, inputPath);
  if (!fs.existsSync(resolvedIn)) {
    return { ok: false, message: `Input not found: ${resolvedIn}` };
  }

  let demoNames = demos;
  let dashNames = dashboardDemos;
  if (!demoNames.length && !dashNames.length) {
    const fm = parsePublishFrontmatter(resolvedIn);
    if (fm?.demo) demoNames = [fm.demo];
    if (fm?.dashboardDemo) dashNames = [fm.dashboardDemo];
  }

  const detection = detectPublishPipeline({
    format,
    includeFigures: figures,
    includeTerminalDemo: demoNames.length > 0 && !sourceOnly,
    includeDashboardDemo: dashNames.length > 0 && !sourceOnly,
    cwd,
    repoRoot,
    env,
  });

  const ledger = { export: null, demos: [], dashboardDemos: [], detection, gate: null };
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
    const publishDir = path.join(cwd, '.cx', 'publish');
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
  } else {
    ledger.export = { ok: true, skipped: 'source-only' };
  }

  for (const name of demoNames) {
    const demoResult = runDemoRecord(name, {
      cwd,
      format: 'mp4',
      sourceOnly: sourceOnly || (!strict && !detection.steps?.terminalDemo?.present),
      required: strict && !sourceOnly,
    });
    ledger.demos.push(demoResult);
    if (strict && !sourceOnly && demoResult.required && !demoResult.ok) {
      return { ok: false, strict: true, ledger, message: demoResult.message };
    }
  }

  for (const name of dashNames) {
    const dashResult = recordDashboardDemo(name, { cwd, repoRoot, env });
    ledger.dashboardDemos.push(dashResult);
    if (strict && !sourceOnly && !dashResult.ok) {
      return { ok: false, strict: true, ledger, message: dashResult.message };
    }
  }

  return {
    ok: ledger.export?.ok !== false,
    ledger,
    message: ledger.export?.skipped
      ? 'Publish source-only complete'
      : ledger.export?.ok
        ? `Published ${path.relative(cwd, ledger.export.outputPath)}`
        : ledger.export?.message || detection.message,
  };
}

export function printPublishHelp() {
  console.log(`Usage: construct publish <markdown> [options]

Orchestrates typed artifact distribution: release gate (default), Pandoc export
with diagram filter and Construct PDF template, optional VHS/Playwright demos.

Options:
  --to=<format>           pdf (default) | docx | html
  --output=<path>         Output path (default: .cx/publish/<name>.<format>)
  --type=<doc-type>       Artifact type for release gate (inferred from path when omitted)
  --demo=<name>           Terminal VHS tape name (repeatable)
  --dashboard-demo=<name> Playwright demo spec basename (repeatable)
  --no-figures            Skip pandoc-ext/diagram filter
  --no-gate               Skip artifact release gate (maintainer escape hatch)
  --source-only           Write sources only; skip rendering
  --no-strict             Do not exit 2 when toolchain or gate fails
  --detect                Print tooling JSON and exit
  -h, --help              Show this message

Frontmatter (optional):
  publish:
    demo: resource-guard-rails
    dashboardDemo: cockpit-tour

Examples:
  node bin/construct publish docs/prd-platform/brief.md --strict --figures
  node bin/construct publish brief.md --type=research-brief --demo=quickstart
`);
}

export async function runPublishCli(argv = [], { cwd = process.cwd(), repoRoot } = {}) {
  const options = {
    format: 'pdf',
    output: null,
    type: null,
    demos: [],
    dashboardDemos: [],
    figures: true,
    strict: true,
    gate: true,
    sourceOnly: false,
    detect: false,
    help: false,
    input: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') { options.help = true; continue; }
    if (arg === '--strict') { options.strict = true; continue; }
    if (arg === '--no-strict') { options.strict = false; continue; }
    if (arg === '--source-only') { options.sourceOnly = true; continue; }
    if (arg === '--no-figures') { options.figures = false; continue; }
    if (arg === '--no-gate') { options.gate = false; continue; }
    if (arg === '--detect') { options.detect = true; continue; }
    if (arg === '--to') { options.format = argv[++i]; continue; }
    if (arg.startsWith('--to=')) { options.format = arg.slice(5); continue; }
    if (arg === '--output') { options.output = argv[++i]; continue; }
    if (arg.startsWith('--output=')) { options.output = arg.slice(9); continue; }
    if (arg === '--type') { options.type = argv[++i]; continue; }
    if (arg.startsWith('--type=')) { options.type = arg.slice(7); continue; }
    if (arg === '--demo') { options.demos.push(argv[++i]); continue; }
    if (arg.startsWith('--demo=')) { options.demos.push(arg.slice(7)); continue; }
    if (arg === '--dashboard-demo') { options.dashboardDemos.push(argv[++i]); continue; }
    if (arg.startsWith('--dashboard-demo=')) { options.dashboardDemos.push(arg.slice(17)); continue; }
    if (!arg.startsWith('--')) options.input = arg;
  }

  if (options.help) {
    printPublishHelp();
    return { exitCode: 0 };
  }

  if (options.detect) {
    const detection = detectPublishPipeline({
      format: options.format,
      includeFigures: options.figures,
      includeTerminalDemo: options.demos.length > 0,
      includeDashboardDemo: options.dashboardDemos.length > 0,
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
    dashboardDemos: options.dashboardDemos,
    figures: options.figures,
    strict: options.strict,
    gate: options.gate,
    artifactType: options.type,
    sourceOnly: options.sourceOnly,
    cwd,
    repoRoot,
  });

  if (result.ok) {
    console.log(result.message);
    if (result.ledger?.demos?.length) {
      for (const d of result.ledger.demos) {
        if (d.tapePath) console.log(`  tape: ${d.tapePath}`);
        if (d.artifactPath) console.log(`  demo: ${d.artifactPath}`);
      }
    }
    return { exitCode: 0, result };
  }

  console.error(result.message);
  const exitCode = result.strict && (result.missing?.length || result.gateBlocked) ? 2 : 1;
  return { exitCode, result };
}
