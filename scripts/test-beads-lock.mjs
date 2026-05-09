#!/usr/bin/env node
/**
 * scripts/test-beads-lock.mjs — Test the beads lock manager.
 * Run via: node scripts/test-beads-lock.mjs
 */

import { runBd } from '../lib/beads-client.mjs';

async function testConcurrentOperations() {
  const cwd = process.cwd();
  const actor = 'test';

  console.error('[test] Testing concurrent access...');
  
  // Test 1: Simple command
  try {
    console.error('[test] Running bd ready via beads client');
    const result1 = await runBd(['ready'], { cwd, actor, silent: false });
    console.error('[test] Success:', result1.output?.slice(0, 100) + '...');
  } catch (error) {
    console.error('[test] Failed:', error.message);
  }

  // Test 2: Another command
  try {
    console.error('[test] Running bd list');
    const result2 = await runBd(['list', '--limit', '3'], { cwd, actor, silent: false });
    console.error('[test] Success:', result2.output?.slice(0, 100) + '...');
  } catch (error) {
    console.error('[test] Failed:', error.message);
  }

  // Test 3: Check lock status via construct beads
  console.error('[test] Checking lock status');
  const { execSync } = await import('node:child_process');
  try {
    const output = execSync(`${process.execPath} bin/construct beads status`, { cwd, encoding: 'utf8' });
    console.error('[test] Lock status output:', output);
  } catch (error) {
    console.error('[test] Error checking lock status:', error.message);
  }

  console.error('[test] Test completed');
}

async function testQueue() {
  const cwd = process.cwd();
  const actor = 'test-queue';

  console.error('[queue] Testing queue functionality...');
  
  // Manually create a lock
  const { writeLockSilently } = await import('../lib/beads-lock.mjs');
  const fakeLock = {
    pid: 99999,
    actor: 'fake-process',
    command: 'test lock',
    timestamp: new Date().toISOString(),
    startedAt: new Date().toISOString(),
  };
  writeLockSilently?.(fakeLock, cwd);
  
  console.error('[queue] Fake lock created');

  // Try to run a command (should be queued)
  const runPromise = runBd(['ready'], { cwd, actor, timeoutSeconds: 5, silent: false })
    .then(result => {
      console.error('[queue] Command completed:', result.output?.slice(0, 50));
    })
    .catch(error => {
      console.error('[queue] Command failed:', error.message);
    });

  // Check queue
  const { readQueue } = await import('../lib/beads-lock.mjs');
  const queue = readQueue({ cwd });
  console.error('[queue] Queue contents:', JSON.stringify(queue, null, 2));

  // Clean up
  const { cleanupStaleLock } = await import('../lib/beads-lock.mjs');
  cleanupStaleLock({ cwd });
  
  console.error('[queue] Test completed');
}

async function main() {
  const testType = process.argv[2] || 'basic';
  
  if (testType === 'basic' || testType === 'all') {
    await testConcurrentOperations();
  }
  
  if (testType === 'queue' || testType === 'all') {
    await testQueue();
  }
}

main().catch(error => {
  console.error('[test] Fatal error:', error);
  process.exit(1);
});
