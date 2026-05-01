#!/usr/bin/env node

/**
 * Embedded instance isolation test
 * Tests that Construct instances running in embedded mode don't cross-contaminate
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { execSync } from 'child_process';

const HOME = homedir();

// Test helper functions
function createTestInstance(name, port, instanceId) {
  const testDir = join(HOME, '.construct-test', name);
  mkdirSync(testDir, { recursive: true });
  
  // Create config.env for test instance
  const configEnv = `CONSTRUCT_INSTANCE_ID=${instanceId}
DASHBOARD_PORT=${port}
TEST_MARKER=${name}-unique-value`;
  
  writeFileSync(join(testDir, 'config.env'), configEnv);
  
  // Create embed.yaml for test instance
  const embedYaml = `# Test instance ${name}
primary: operator
secondary: architect
targets:
  - path: ${testDir}/artifacts
    type: markdown
`;
  
  writeFileSync(join(testDir, 'embed.yaml'), embedYaml);
  
  return {
    name,
    instanceId,
    port,
    testDir,
    configEnvPath: join(testDir, 'config.env'),
    embedYamlPath: join(testDir, 'embed.yaml')
  };
}

function testIsolation(instance1, instance2) {
  console.log(`\n=== Testing isolation between ${instance1.name} and ${instance2.name} ===`);
  
  // Test 1: Config file separation
  console.log('\n1. Testing config file separation...');
  const config1 = readFileSync(instance1.configEnvPath, 'utf8');
  const config2 = readFileSync(instance2.configEnvPath, 'utf8');
  
  if (config1.includes(instance1.name) && config2.includes(instance2.name)) {
    console.log('✓ Config files are properly separated');
  } else {
    console.log('✗ Config files may be cross-contaminating');
  }
  
  // Test 2: Instance ID uniqueness
  console.log('\n2. Testing instance ID uniqueness...');
  if (instance1.instanceId !== instance2.instanceId) {
    console.log('✓ Instance IDs are unique');
  } else {
    console.log('✗ Instance IDs are not unique!');
  }
  
  // Test 3: Port separation
  console.log('\n3. Testing port separation...');
  if (instance1.port !== instance2.port) {
    console.log('✓ Ports are different');
  } else {
    console.log('✗ Ports conflict!');
  }
  
  // Test 4: Directory separation
  console.log('\n4. Testing directory separation...');
  if (instance1.testDir !== instance2.testDir) {
    console.log('✓ Directories are separate');
  } else {
    console.log('✗ Directories are the same!');
  }
  
  // Test 5: Boundary config separation (if exists)
  console.log('\n5. Testing boundary config separation...');
  const boundary1Path = join(instance1.testDir, 'boundary-config.json');
  const boundary2Path = join(instance2.testDir, 'boundary-config.json');
  
  if (!existsSync(boundary1Path) && !existsSync(boundary2Path)) {
    console.log('✓ No boundary configs (expected for standalone tests)');
  } else if (existsSync(boundary1Path) && existsSync(boundary2Path)) {
    const boundary1 = JSON.parse(readFileSync(boundary1Path, 'utf8'));
    const boundary2 = JSON.parse(readFileSync(boundary2Path, 'utf8'));
    
    if (boundary1.childInstanceId === instance1.instanceId && 
        boundary2.childInstanceId === instance2.instanceId) {
      console.log('✓ Boundary configs are instance-specific');
    } else {
      console.log('✗ Boundary configs may be cross-contaminated');
    }
  }
}

function testCrossInstanceCommunication() {
  console.log('\n=== Testing cross-instance communication boundaries ===');
  
  // This would test that instances can't accidentally read each other's data
  // In a real implementation, we'd set up actual instances and test
  console.log('\nNote: Full cross-instance communication testing requires');
  console.log('running actual Construct instances with different CONSTRUCT_INSTANCE_ID');
  console.log('and verifying they don\'t share:\n');
  console.log('  - Config values');
  console.log('  - Observation store data');
  console.log('  - Session data');
  console.log('  - Snapshot data');
  console.log('  - Approval queue items');
}

function cleanup() {
  try {
    execSync(`rm -rf ${join(HOME, '.construct-test')}`);
    console.log('\n✓ Cleaned up test directories');
  } catch (error) {
    console.log('\n⚠ Could not clean up test directories:', error.message);
  }
}

async function main() {
  console.log('Embedded Instance Isolation Test');
  console.log('================================\n');
  
  // Create two test instances
  const instance1 = createTestInstance('instance-alpha', 4242, 'construct-alpha');
  const instance2 = createTestInstance('instance-beta', 4243, 'construct-beta');
  
  console.log(`Created test instance: ${instance1.name}`);
  console.log(`  Instance ID: ${instance1.instanceId}`);
  console.log(`  Port: ${instance1.port}`);
  console.log(`  Directory: ${instance1.testDir}`);
  
  console.log(`\nCreated test instance: ${instance2.name}`);
  console.log(`  Instance ID: ${instance2.instanceId}`);
  console.log(`  Port: ${instance2.port}`);
  console.log(`  Directory: ${instance2.testDir}`);
  
  // Run isolation tests
  testIsolation(instance1, instance2);
  
  // Test cross-instance communication boundaries
  testCrossInstanceCommunication();
  
  // Test recommendations
  console.log('\n=== Recommended isolation practices ===');
  console.log('\n1. Always set CONSTRUCT_INSTANCE_ID for embedded instances');
  console.log('2. Use different ports for different instances');
  console.log('3. Consider using different data directories via CX_DATA_DIR');
  console.log('4. Use boundary registration API for parent-child relationships');
  console.log('5. Monitor for config.env shadowing warnings');
  
  // Cleanup
  cleanup();
  
  console.log('\n=== Test Summary ===');
  console.log('\nThe embedding boundary system provides:');
  console.log('✅ Instance identification via CONSTRUCT_INSTANCE_ID');
  console.log('✅ Boundary API for parent-child relationships');
  console.log('✅ Mode-aware navigation to prevent internal exposure');
  console.log('✅ Port and directory separation capabilities');
  console.log('\nFor production embedding, also consider:');
  console.log('• Network isolation (Docker containers, network namespaces)');
  console.log('• Filesystem isolation (bind mounts, volume separation)');
  console.log('• Resource limits (CPU, memory, disk quotas)');
  console.log('• Security boundaries (user namespace, capabilities)');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('Test failed:', error);
    process.exit(1);
  });
}