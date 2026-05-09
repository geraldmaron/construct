#!/usr/bin/env node
/**
 * lib/init-update.mjs — update existing projects with latest AGENTS.md template.
 * 
 * For projects that already have AGENTS.md but need to sync with the latest
 * Construct operating rules and CI enforcement.
 * 
 * Usage:
 *   node lib/init-update.mjs [--dry-run] [--cwd=path]
 *   construct init:update [--dry-run]
 */

import fs from "node:fs";
import path from "node:path";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const cwdArg = args.find(arg => arg.startsWith("--cwd="));
const cwd = cwdArg ? path.resolve(cwdArg.split("=")[1]) : process.cwd();

console.log(`📝 Updating project documentation in ${cwd}`);

// Load the AGENTS.md template from project-init-shared
async function loadAgentsTemplate(projectName) {
  const modulePath = path.join(import.meta.dirname, 'project-init-shared.mjs');
  try {
    // Import the module and call the buildAgentsGuide function
    const module = await import(modulePath);
    if (module.buildAgentsGuide) {
      return module.buildAgentsGuide(projectName);
    }
    throw new Error('Could not find buildAgentsGuide function in project-init-shared.mjs');
  } catch (error) {
    console.error(`❌ Failed to load AGENTS.md template: ${error.message}`);
    process.exit(1);
  }
}

function updateAgentsMd(existingContent, newTemplate) {
  // We'll do a simple replacement for now
  // In a real implementation, we'd parse the existing file and merge sections
  
  console.log(`🔄 Updating AGENTS.md`);
  
  if (dryRun) {
    console.log(`📋 Dry run - would update AGENTS.md`);
    console.log(`--- Current AGENTS.md (first 200 chars) ---`);
    console.log(existingContent.substring(0, 200) + '...');
    console.log(`--- New AGENTS.md (first 200 chars) ---`);
    console.log(newTemplate.substring(0, 200) + '...');
    return null;
  }
  
  // Backup existing file
  const backupPath = path.join(cwd, 'AGENTS.md.backup');
  writeFileSync(backupPath, existingContent, 'utf8');
  console.log(`📦 Created backup at ${backupPath}`);
  
  // Write new template
  const agentsPath = path.join(cwd, 'AGENTS.md');
  writeFileSync(agentsPath, newTemplate, 'utf8');
  console.log(`✅ Updated AGENTS.md`);
  
  return newTemplate;
}

function updateCiWorkflow(cwd) {
  const workflowPath = path.join(cwd, '.github', 'workflows', 'ci.yml');
  if (!existsSync(workflowPath)) {
    console.log(`⚠️  No CI workflow found at ${workflowPath}`);
    return false;
  }
  
  let content = readFileSync(workflowPath, 'utf8');
  
  // Check if docs:verify is already in the workflow
  if (content.includes('construct docs:verify')) {
    console.log(`✅ CI workflow already has docs:verify check`);
    return false;
  }
  
  // Find the test job and add docs:verify after doctor
  if (content.includes('node bin/construct doctor')) {
    const updatedContent = content.replace(
      /(\s+- run: node bin\/construct doctor\s*)/,
      '$1      - run: node bin/construct docs:verify\n'
    );
    
    if (dryRun) {
      console.log(`📋 Dry run - would update CI workflow to include docs:verify`);
      return true;
    }
    
    const backupPath = workflowPath + '.backup';
    writeFileSync(backupPath, content, 'utf8');
    writeFileSync(workflowPath, updatedContent, 'utf8');
    console.log(`✅ Updated CI workflow to include docs:verify check`);
    return true;
  }
  
  console.log(`⚠️  Could not find 'construct doctor' in CI workflow to add docs:verify`);
  return false;
}

async function main() {
  console.log(`\n🔍 Checking project structure...`);
  
  // Check for AGENTS.md
  const agentsPath = path.join(cwd, 'AGENTS.md');
  if (!existsSync(agentsPath)) {
    console.log(`❌ AGENTS.md not found. Run 'construct init' first.`);
    process.exit(1);
  }
  
  const existingAgents = readFileSync(agentsPath, 'utf8');
  
  // Get project name from package.json or directory name
  let projectName = path.basename(cwd);
  const packagePath = path.join(cwd, 'package.json');
  if (existsSync(packagePath)) {
    try {
      const pkg = JSON.parse(readFileSync(packagePath, 'utf8'));
      if (pkg.name) projectName = pkg.name;
    } catch (error) {
      console.log(`⚠️  Could not read package.json: ${error.message}`);
    }
  }
  
  const template = await loadAgentsTemplate(projectName);
  
  console.log(`\n📊 Analysis:`);
  console.log(`   • AGENTS.md found (${existingAgents.length} chars)`);
  console.log(`   • Latest template loaded (${template.length} chars)`);
  console.log(`   • Project name: ${projectName}`);
  
  // Check if AGENTS.md has documentation enforcement section
  const hasDocEnforcement = existingAgents.includes('Documentation Rules');
  console.log(`   • Has documentation enforcement: ${hasDocEnforcement ? '✅' : '❌'}`);
  
  // Check for CI workflow
  const ciUpdated = updateCiWorkflow(cwd);
  
  // Update AGENTS.md if it doesn't have the latest sections
  if (!hasDocEnforcement) {
    updateAgentsMd(existingAgents, template);
  } else {
    console.log(`✅ AGENTS.md already has documentation enforcement rules`);
  }
  
  console.log(`\n🎉 Update complete!`);
  console.log(`\nNext steps:`);
  console.log(`   1. Review the updated AGENTS.md`);
  console.log(`   2. Run 'construct docs:verify' to test documentation checks`);
  console.log(`   3. Commit changes: git add AGENTS.md .github/workflows/ci.yml`);
  console.log(`   4. Push and verify CI passes`);
  
  if (dryRun) {
    console.log(`\n⚠️  This was a dry run. Use 'construct init:update' without --dry-run to apply changes.`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error(`❌ Error: ${error.message}`);
    process.exit(1);
  });
}