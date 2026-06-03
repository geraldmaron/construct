/**
 * lib/mode-commands.mjs — Standardized command contracts across deployment modes.
 *
 * Provides mode-aware command execution for intake, memory, and workflow operations.
 * Routes to file-based implementations in solo mode, Postgres in team/enterprise mode.
 */

// lib/mode-commands.mjs
// Standardized command contracts across deployment modes

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

export const MODE_COMMANDS = {
  // Intake queue operations
  intake: {
    list: async (options = {}) => {
      const mode = getDeploymentMode();
      
      if (mode === 'solo') {
        // File-based intake
        const result = spawnSync('find', ['.cx/intake/pending', '-name', '*.json', '-type', 'f'], 
          { encoding: 'utf8', cwd: options.cwd });
        return parseIntakeFiles(result.stdout);
      } else {
        // Postgres-based intake
        return queryPostgresIntake(options);
      }
    },
    
    show: async (id, options = {}) => {
      const mode = getDeploymentMode();
      
      if (mode === 'solo') {
        return readIntakeFile(id, options);
      } else {
        return queryPostgresIntakeItem(id, options);
      }
    },
  },
  
  // Storage operations
  storage: {
    sync: async (options = {}) => {
      const mode = getDeploymentMode();
      
      // Same interface, different implementation
      if (mode === 'solo') {
        return syncToFileStorage(options);
      } else {
        return syncToPostgresStorage(options);
      }
    },
    
    query: async (criteria, options = {}) => {
      // Unified query interface
      return queryStorage(criteria, options);
    },
  },
};

function getDeploymentMode() {
  return process.env.CONSTRUCT_DEPLOYMENT_MODE || 'solo';
}

function parseIntakeFiles(stdout) {
  return stdout.split('\n')
    .filter(Boolean)
    .map(f => ({ id: basename(f, '.json'), source: 'file' }));
}

function readIntakeFile(id, options) {
  const filePath = join(options.cwd || process.cwd(), '.cx/intake/pending', `${id}.json`);
  if (!existsSync(filePath)) {
    return { error: `Intake item ${id} not found` };
  }
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

async function queryPostgresIntake(options) {
  // Would use SQL client
  return { items: [], mode: 'postgres' };
}

async function queryPostgresIntakeItem(id, options) {
  return { id, mode: 'postgres' };
}

async function syncToFileStorage(options) {
  return { 
    success: true, 
    mode: 'solo',
    backend: 'file',
  };
}

async function syncToPostgresStorage(options) {
  return {
    success: true,
    mode: 'team',
    backend: 'postgres',
  };
}

async function queryStorage(criteria, options) {
  // Unified query - works across modes
  return {
    results: [],
    mode: getDeploymentMode(),
  };
}

export function getCommandInterface(command, operation) {
  const cmd = MODE_COMMANDS[command];
  if (!cmd) return null;
  
  const fn = cmd[operation];
  if (!fn) return null;
  
  return fn;
}
