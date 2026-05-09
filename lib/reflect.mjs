/**
 * lib/reflect.mjs — construct reflect command implementation.
 *
 * Captures improvement feedback from chat sessions and updates Construct core
 * knowledge base with actionable insights for continuous self-improvement.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { addObservation } from './observation-store.mjs';
import { loadConstructEnv } from './env-config.mjs';
import { KNOWLEDGE_ROOT, KNOWLEDGE_SUBDIRS, inferKnowledgeTarget } from './knowledge/layout.mjs';

const HOME = process.env.HOME || process.env.USERPROFILE;
const USER_ENV_PATH = join(HOME, '.construct', 'config.env');

/**
 * Main reflect command handler.
 * @param {string[]} args - Command line arguments
 */
export async function runReflectCli(args) {
  // Parse arguments
  let target = 'internal';
  let summary = '';

  for (const arg of args) {
    if (arg.startsWith('--target=')) {
      target = arg.split('=')[1];
    } else if (arg.startsWith('--summary=')) {
      summary = arg.split('=')[1];
    }
  }

  // Validate target
  const validTargets = KNOWLEDGE_SUBDIRS.map(s => `knowledge/${s}`);
  const validShorthandTargets = KNOWLEDGE_SUBDIRS; // internal, external, etc.
  const isValidTarget = validTargets.includes(target) || validShorthandTargets.includes(target);
  if (!isValidTarget) {
    console.error(`Error: Invalid target '${target}'. Valid targets: ${validTargets.join(', ')}`);
    process.exit(1);
  }
  
  // Normalize target to full format if shorthand was provided
  if (validShorthandTargets.includes(target) && !target.startsWith('knowledge/')) {
    target = `knowledge/${target}`;
  }

  // If no summary provided, try to get it from stdin or prompt
  if (!summary) {
    // For now, we'll require explicit summary - in future could read from chat context
    console.error('Error: --summary=<text> is required to capture improvement feedback');
    console.error('Example: construct reflect --target=internal --summary="Improve Slack channel intent parsing to handle edge cases"');
    process.exit(1);
  }

  // Resolve the knowledge directory for this target
  const knowledgeSubdir = target.replace('knowledge/', '');
  const knowledgeDir = join(process.cwd(), KNOWLEDGE_ROOT, knowledgeSubdir);
  
  // Ensure the knowledge directory exists
  if (!existsSync(knowledgeDir)) {
    mkdirSync(knowledgeDir, { recursive: true });
  }

  // Generate a filename based on timestamp and summary hash
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const summarySlug = summary
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);
  const filename = `${timestamp}-${summarySlug}.md`;
  const filePath = join(knowledgeDir, filename);

  // Create the markdown content
  const content = [
    '---',
    `source_path: reflect-command`,
    `source_relative_path: ${filename}`,
    `source_extension: .md`,
    `extracted_at: ${new Date().toISOString()}`,
    `extraction_method: reflect-command`,
    `characters: ${summary.length}`,
    `truncated: false`,
    `output_path: ${JSON.stringify(filePath)}`,
    `output_relative_path: ${JSON.stringify(filename)}`,
    '---',
    '',
    `# Improvement Feedback`,
    '',
    summary,
    '',
    '## Context',
    '',
    `- Captured via: construct reflect`,
    `- Timestamp: ${new Date().toISOString()}`,
    `- Target knowledge directory: ${knowledgeSubdir}/`,
    '',
    '## Action Items',
    '',
    '- [ ] Review this feedback for validity and actionability',
    '- [ ] Determine if this requires code changes, documentation updates, or process improvements',
    '- [ ] If actionable, create appropriate issues in the tracker',
    '- [ ] Update relevant documentation or code based on this insight',
    '',
  ].join('\n');

  // Write the file
  writeFileSync(filePath, content);

  // Record an observation about this feedback
  const observationSummary = `[reflect] Improvement feedback captured: ${summary.slice(0, 100)}${summary.length > 100 ? '...' : ''}`;
  addObservation(process.cwd(), {
    role: 'construct',
    category: 'insight', // Feedback is typically an insight unless it's about a problem
    summary: observationSummary,
    content: `Feedback captured via construct reflect:\n\n${summary}\n\nStored as: ${filePath}\nTarget: ${knowledgeSubdir}/`,
    tags: ['reflect', 'improvement-feedback', `knowledge:${knowledgeSubdir}`],
    confidence: 0.9,
    source: 'reflect-command',
  });

  console.log(`✓ Improvement feedback captured and stored as: ${filePath}`);
  console.log(`  Target knowledge directory: ${knowledgeSubdir}/`);
  console.log(`  Use 'construct ingest --target=${target} <file>' to manually add similar feedback in the future`);
}

/**
 * CLI entry point for direct execution.
 */
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  runReflectCli(args).catch((err) => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
}