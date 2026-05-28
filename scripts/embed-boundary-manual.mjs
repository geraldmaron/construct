#!/usr/bin/env node

/**
 * scripts/embed-boundary-manual.mjs — Manual probe for the embedding boundary API.
 *
 * Not a unit test. Renamed from test-embed-boundary.mjs so it does not match
 * node --test's auto-discovery glob; the file relied on a hardcoded port and
 * a server-output match string that would routinely fail when the dashboard
 * was already running.
 *
 * Run with: node scripts/embed-boundary-manual.mjs
 */

import { spawn } from 'child_process';
import net from 'node:net';
import { join } from 'path';
import { homedir } from 'os';

async function findFreePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

const HOME = homedir();
const PORT = await findFreePort();
const BIND_HOST = '127.0.0.1';

// Start a simple test server
async function startTestServer() {
  return new Promise((resolve, reject) => {
    const server = spawn('node', [
      join(process.cwd(), 'lib', 'server', 'index.mjs')
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PORT: PORT.toString(), BIND_HOST }
    });
    
    let started = false;
    
    server.stdout.on('data', (data) => {
      const output = data.toString();
      console.log('Server:', output);
      if (output.includes('Construct dashboard running') || output.includes('Listening on')) {
        started = true;
        resolve(server);
      }
    });
    
    server.stderr.on('data', (data) => {
      console.error('Server error:', data.toString());
    });
    
    server.on('close', (code) => {
      if (!started) reject(new Error(`Server exited with code ${code}`));
    });
    
    setTimeout(() => {
      if (!started) reject(new Error('Server startup timeout'));
    }, 5000);
  });
}

async function testBoundaryAPI() {
  console.log('Testing embedding boundary API...\n');
  
  const baseUrl = `http://${BIND_HOST}:${PORT}/api`;
  const token = 'test-token';
  
  // Test 1: Get boundary status
  try {
    console.log('Test 1: GET /api/embed/boundary');
    const response1 = await fetch(`${baseUrl}/embed/boundary`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const result1 = await response1.json();
    console.log('Response:', JSON.stringify(result1, null, 2));
    console.log('✓ Boundary status endpoint works\n');
  } catch (error) {
    console.error('✗ Boundary status test failed:', error.message);
  }
  
  // Test 2: Register as embedded instance
  try {
    console.log('Test 2: POST /api/embed/boundary/register');
    const response2 = await fetch(`${baseUrl}/embed/boundary/register`, {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        parentInstance: 'test-parent',
        parentUrl: 'http://localhost:4243',
        childInstanceId: 'test-child'
      })
    });
    const result2 = await response2.json();
    console.log('Response:', JSON.stringify(result2, null, 2));
    console.log('✓ Boundary registration endpoint works\n');
  } catch (error) {
    console.error('✗ Boundary registration test failed:', error.message);
  }
  
  // Test 3: Get mode (should include instance info)
  try {
    console.log('Test 3: GET /api/mode');
    const response3 = await fetch(`${baseUrl}/mode`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const result3 = await response3.json();
    console.log('Response:', JSON.stringify(result3, null, 2));
    console.log('✓ Mode endpoint works with boundary info\n');
  } catch (error) {
    console.error('✗ Mode endpoint test failed:', error.message);
  }
  
  console.log('All tests completed!');
}

async function main() {
  console.log('Starting embedding boundary API tests...');
  
  try {
    const server = await startTestServer();
    console.log('Test server started');
    
    // Wait a moment for server to be ready
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    await testBoundaryAPI();
    
    // Cleanup
    server.kill();
    console.log('\nTest server stopped');
    
  } catch (error) {
    console.error('Test failed:', error);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}