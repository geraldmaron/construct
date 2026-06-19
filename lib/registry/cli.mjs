/**
 * lib/registry/cli.mjs — CLI handlers for registry validate, status, and doc generation.
 */

import { validateCapabilityRegistry, loadCapabilityRegistry } from './validate.mjs';
import { generateCapabilitiesDoc, checkCapabilitiesDocDrift } from './generate-docs.mjs';
import { triageBoundOrphans, formatConsolidationProposalMarkdown } from './consolidation.mjs';

export async function runRegistryStatus(args = [], { rootDir, println = console.log } = {}) {
  const jsonOutput = args.includes('--json');
  const { capabilities = [] } = loadCapabilityRegistry({ rootDir });

  if (jsonOutput) {
    println(JSON.stringify(capabilities, null, 2));
    return 0;
  }

  println('Construct Capability Registry');
  println('='.repeat(40));
  println('');

  for (const cap of capabilities) {
    const tier = cap.criticality ?? '—';
    println(`[${tier}] ${cap.name ?? cap.id} (${cap.id})`);
    if (cap.description) println(`  ${cap.description}`);
    const surfaces = Object.entries(cap.surfaces ?? {}).filter(([, v]) => v?.supported);
    if (surfaces.length) {
      println(`  surfaces: ${surfaces.map(([n]) => n).join(', ')}`);
    }
    const validated = cap.lastValidated ? cap.lastValidated.slice(0, 10) : 'never';
    println(`  humanGate: ${cap.humanGate ?? '—'}  lastValidated: ${validated}`);
    println('');
  }
  return 0;
}

export async function runRegistryValidate(args = [], { rootDir, println = console.log, errorln = console.error } = {}) {
  const jsonOutput = args.includes('--json');
  const report = validateCapabilityRegistry({ rootDir });

  if (jsonOutput) {
    println(JSON.stringify(report, null, 2));
    return report.valid ? 0 : 1;
  }

  println(`Registry: ${report.registryPath}`);
  println(`Entries: ${report.count}`);
  if (report.errors.length) {
    errorln(`Errors (${report.errors.length}):`);
    for (const e of report.errors) errorln(`  ✗ ${e}`);
  }
  if (report.warnings.length) {
    println(`Warnings (${report.warnings.length}):`);
    for (const w of report.warnings) println(`  ⚠ ${w}`);
  }
  if (report.valid && !report.warnings.length) println('✓ Registry valid');
  else if (report.valid) println('✓ Registry valid (with warnings)');
  else errorln('✗ Registry invalid');

  return report.valid ? 0 : 1;
}

export async function runRegistryGenerateDocs(args = [], { rootDir, println = console.log, errorln = console.error } = {}) {
  if (args.includes('--check')) {
    const { drift } = checkCapabilitiesDocDrift({ rootDir });
    if (drift) {
      errorln('capabilities.md drift — run `construct registry:generate-docs`');
      return 1;
    }
    println('capabilities.md is up to date');
    return 0;
  }
  const out = generateCapabilitiesDoc({ rootDir });
  println(`Generated ${out}`);
  return 0;
}

export async function runRegistryConsolidationProposal(args = [], { rootDir, println = console.log } = {}) {
  const triage = triageBoundOrphans({ rootDir });
  println(formatConsolidationProposalMarkdown(triage));
  return 0;
}
