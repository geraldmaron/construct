#!/usr/bin/env node
/**
 * lib/project-detection.mjs — Shared utilities for detecting project initialization state.
 * 
 * Used by hooks to determine whether to create .cx directories or perform other
 * project-specific operations.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Check if a directory looks like an initialized project.
 * 
 * Criteria (any of the following):
 * 1. Has package.json (npm project)
 * 2. Has .git directory (git repository)
 * 3. Has .claude/settings.json or .codex/settings.json (Claude/OpenCode configured)
 * 4. Has AGENTS.md or plan.md (Construct project)
 * 5. Has .cx directory already (already has Construct context)
 * 
 * @param {string} cwd Directory path to check
 * @returns {boolean} True if this appears to be an initialized project
 */
export function isProjectInitialized(cwd) {
  // Check for package.json (npm project)
  const hasPackageJson = existsSync(join(cwd, 'package.json'));
  
  // Check for .git (git repository)
  const hasGit = existsSync(join(cwd, '.git'));
  
  // Check for Claude/OpenCode configuration
  const hasCliSurface = existsSync(join(cwd, '.claude', 'settings.json')) || 
                        existsSync(join(cwd, '.codex', 'settings.json'));
  
  // Check for Construct project markers
  const hasConstructConfig = existsSync(join(cwd, 'AGENTS.md')) || 
                             existsSync(join(cwd, 'plan.md'));
  
  // Check if .cx already exists (already has Construct context)
  const hasCxDir = existsSync(join(cwd, '.cx'));
  
  // Also check for common project files
  const hasProjectFile = existsSync(join(cwd, 'Cargo.toml')) || // Rust
                         existsSync(join(cwd, 'pyproject.toml')) || // Python
                         existsSync(join(cwd, 'go.mod')) || // Go
                         existsSync(join(cwd, 'pom.xml')) || // Maven
                         existsSync(join(cwd, 'build.gradle')) || // Gradle
                         existsSync(join(cwd, 'composer.json')) || // PHP
                         existsSync(join(cwd, 'Gemfile')) || // Ruby
                         existsSync(join(cwd, 'requirements.txt')); // Python
  
  return hasPackageJson || hasGit || hasCliSurface || hasConstructConfig || hasCxDir || hasProjectFile;
}

/**
 * Check if a directory should have .cx directories created.
 * More restrictive than isProjectInitialized - only creates .cx for:
 * 1. Already has .cx directory
 * 2. Has Construct config (AGENTS.md, plan.md)
 * 3. Has Claude/OpenCode configuration
 * 4. Has package.json AND .git (established npm project)
 * 
 * @param {string} cwd Directory path to check
 * @returns {boolean} True if .cx should be created
 */
export function shouldCreateCx(cwd) {
  // Already has .cx directory
  if (existsSync(join(cwd, '.cx'))) {
    return true;
  }
  
  // Has Construct project markers
  const hasConstructConfig = existsSync(join(cwd, 'AGENTS.md')) || 
                             existsSync(join(cwd, 'plan.md'));
  if (hasConstructConfig) {
    return true;
  }
  
  // Has Claude/OpenCode configuration
  const hasCliSurface = existsSync(join(cwd, '.claude', 'settings.json')) || 
                        existsSync(join(cwd, '.codex', 'settings.json'));
  if (hasCliSurface) {
    return true;
  }
  
  // Has both package.json and .git (established npm project)
  const hasPackageJson = existsSync(join(cwd, 'package.json'));
  const hasGit = existsSync(join(cwd, '.git'));
  if (hasPackageJson && hasGit) {
    return true;
  }
  
  // Default: don't create .cx in uninitialized directories
  return false;
}

/**
 * Check if this is likely a new project setup phase.
 * Returns true if directory looks empty/uninitialized.
 * 
 * @param {string} cwd Directory path to check
 * @returns {boolean} True if this appears to be a new project setup
 */
export function isNewProjectSetup(cwd) {
  // Has no project markers
  const hasPackageJson = existsSync(join(cwd, 'package.json'));
  const hasGit = existsSync(join(cwd, '.git'));
  const hasConstructConfig = existsSync(join(cwd, 'AGENTS.md')) || 
                             existsSync(join(cwd, 'plan.md'));
  const hasCliSurface = existsSync(join(cwd, '.claude', 'settings.json')) || 
                        existsSync(join(cwd, '.codex', 'settings.json'));
  const hasCxDir = existsSync(join(cwd, '.cx'));
  
  return !hasPackageJson && !hasGit && !hasConstructConfig && !hasCliSurface && !hasCxDir;
}

/**
 * Check if this is a Construct project.
 * 
 * @param {string} cwd Directory path to check
 * @returns {boolean} True if this is a Construct project
 */
export function isConstructProject(cwd) {
  return existsSync(join(cwd, 'AGENTS.md')) || 
         existsSync(join(cwd, 'plan.md')) ||
         existsSync(join(cwd, '.cx', 'context.md')) ||
         existsSync(join(cwd, '.cx', 'context.json'));
}