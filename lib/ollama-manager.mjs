#!/usr/bin/env node
/**
 * lib/ollama-manager.mjs — Ollama local LLM management.
 *
 * Provides commands for checking Ollama status, listing models,
 * pulling new models, and configuring Ollama as a provider.
 */

import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

// argv-array form for every shell-out: no shell interpolation, model names and
// JSON bodies are passed as discrete arguments / stdin so user-supplied values
// cannot break out of the command.

function curlGet(url, { timeout } = {}) {
  return execFileSync('curl', ['-s', url], { encoding: 'utf8', timeout });
}

function curlPost(url, body, { timeout } = {}) {
  return execFileSync('curl', ['-s', url, '--data-binary', '@-'], {
    encoding: 'utf8',
    timeout,
    input: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || process.env.OLLAMA_HOST || 'http://localhost:11434';

/**
 * Check if Ollama is installed and running
 */
export function checkOllamaStatus() {
  try {
    execFileSync('which', ['ollama'], { stdio: 'pipe' });
    const installed = true;

    try {
      const response = curlGet(`${OLLAMA_BASE_URL}/api/tags`, { timeout: 3000 });
      const data = JSON.parse(response);
      return {
        installed,
        running: true,
        models: data.models || [],
        baseUrl: OLLAMA_BASE_URL
      };
    } catch (e) {
      return {
        installed,
        running: false,
        error: 'Ollama server not responding',
        baseUrl: OLLAMA_BASE_URL
      };
    }
  } catch (e) {
    return {
      installed: false,
      running: false,
      error: 'Ollama not installed'
    };
  }
}

/**
 * List available Ollama models
 */
export function listModels() {
  try {
    const response = curlGet(`${OLLAMA_BASE_URL}/api/tags`, { timeout: 5000 });
    const data = JSON.parse(response);
    return data.models || [];
  } catch (e) {
    throw new Error(`Failed to fetch models: ${e.message}`);
  }
}

/**
 * Pull a model from Ollama registry
 */
export function pullModel(modelName, { verbose = false } = {}) {
  console.log(`Pulling ${modelName}...`);
  try {
    const output = execFileSync('ollama', ['pull', modelName], {
      encoding: 'utf8',
      stdio: verbose ? 'inherit' : 'pipe'
    });
    return { success: true, output };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Remove a model
 */
export function removeModel(modelName) {
  try {
    execFileSync('ollama', ['rm', modelName], { encoding: 'utf8' });
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Show model details
 */
export function showModel(modelName) {
  try {
    const response = curlPost(`${OLLAMA_BASE_URL}/api/show`, { name: modelName }, { timeout: 5000 });
    return JSON.parse(response);
  } catch (e) {
    throw new Error(`Failed to fetch model details: ${e.message}`);
  }
}

/**
 * Run a quick inference test
 */
export function testModel(modelName, prompt = 'Say hello in one sentence.') {
  try {
    const response = curlPost(
      `${OLLAMA_BASE_URL}/api/generate`,
      { model: modelName, prompt, stream: false },
      { timeout: 30000 },
    );
    const data = JSON.parse(response);
    return {
      success: true,
      response: data.response,
      duration: data.total_duration ? `${(data.total_duration / 1e9).toFixed(2)}s` : 'unknown'
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * CLI entry point
 */
export async function cmdOllama(argv = process.argv.slice(2)) {
  const command = argv[0];
  const args = argv.slice(1);
  
  if (!command || command === '--help' || command === '-h') {
    printHelp();
    return;
  }
  
  switch (command) {
    case 'status':
      await cmdOllamaStatus();
      break;
    case 'list':
    case 'ls':
      await cmdOllamaList(args);
      break;
    case 'pull':
      await cmdOllamaPull(args);
      break;
    case 'rm':
    case 'remove':
      await cmdOllamaRemove(args);
      break;
    case 'show':
      await cmdOllamaShow(args);
      break;
    case 'test':
      await cmdOllamaTest(args);
      break;
    case 'setup':
      await cmdOllamaSetup(args);
      break;
    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exit(1);
  }
}

function printHelp() {
  console.log(`
Usage: construct ollama <command> [options]

Commands:
  status              Check if Ollama is installed and running
  list, ls            List available local models
  pull <model>        Pull a model from Ollama registry
  rm <model>          Remove a local model
  show <model>        Show model details (architecture, parameters)
  test <model>        Run a quick inference test
  setup               Interactive setup: install, start service, pull default model

Options:
  --verbose           Show detailed output (for pull)
  --help, -h          Show this help message

Examples:
  construct ollama status
  construct ollama list
  construct ollama pull llama3.2
  construct ollama test llama3.2
  construct ollama setup --yes
`);
}

async function cmdOllamaStatus() {
  const status = checkOllamaStatus();
  
  if (!status.installed) {
    console.log('❌ Ollama is not installed');
    console.log('   Install with: brew install ollama');
    process.exit(1);
  }
  
  if (!status.running) {
    console.log('⚠️  Ollama is installed but not running');
    console.log('   Start with: brew services start ollama');
    console.log(`   Base URL: ${status.baseUrl}`);
    process.exit(1);
  }
  
  console.log('✅ Ollama is running');
  console.log(`   Base URL: ${status.baseUrl}`);
  console.log(`   Models: ${status.models.length}`);
  
  if (status.models.length > 0) {
    console.log('\n   Available models:');
    status.models.forEach(m => {
      console.log(`   - ${m.name} (${formatSize(m.size)})`);
    });
  }
}

async function cmdOllamaList(args) {
  const status = checkOllamaStatus();
  if (!status.running) {
    console.error('Error: Ollama is not running. Start with: brew services start ollama');
    process.exit(1);
  }
  
  const models = listModels();
  if (models.length === 0) {
    console.log('No models installed. Pull one with: construct ollama pull <model>');
    console.log('\nPopular models:');
    console.log('  - llama3.2 (3B, fast)');
    console.log('  - llama3.1:8b (8B, balanced)');
    console.log('  - llama3.1:70b (70B, reasoning)');
    console.log('  - qwen2.5:7b (7B, balanced)');
    console.log('  - mistral:7b (7B, fast)');
    return;
  }
  
  console.log('NAME'.padEnd(25), 'SIZE'.padEnd(12), 'MODIFIED');
  console.log('─'.repeat(50));
  models.forEach(m => {
    const name = m.name.padEnd(25);
    const size = formatSize(m.size).padEnd(12);
    const modified = new Date(m.modified_at).toLocaleDateString();
    console.log(name, size, modified);
  });
}

async function cmdOllamaPull(args) {
  const modelName = args[0];
  const verbose = args.includes('--verbose') || args.includes('-v');
  
  if (!modelName) {
    console.error('Error: Model name required');
    console.log('Usage: construct ollama pull <model>');
    console.log('\nPopular models:');
    console.log('  - llama3.2 (3B, fast)');
    console.log('  - llama3.1:8b (8B, balanced)');
    console.log('  - llama3.1:70b (70B, reasoning)');
    process.exit(1);
  }
  
  const result = pullModel(modelName, { verbose });
  if (result.success) {
    console.log(`✅ Successfully pulled ${modelName}`);
  } else {
    console.error(`❌ Failed to pull ${modelName}: ${result.error}`);
    process.exit(1);
  }
}

async function cmdOllamaRemove(args) {
  const modelName = args[0];
  
  if (!modelName) {
    console.error('Error: Model name required');
    console.log('Usage: construct ollama rm <model>');
    process.exit(1);
  }
  
  const result = removeModel(modelName);
  if (result.success) {
    console.log(`✅ Removed ${modelName}`);
  } else {
    console.error(`❌ Failed to remove ${modelName}: ${result.error}`);
    process.exit(1);
  }
}

async function cmdOllamaShow(args) {
  const modelName = args[0];
  
  if (!modelName) {
    console.error('Error: Model name required');
    console.log('Usage: construct ollama show <model>');
    process.exit(1);
  }
  
  try {
    const details = showModel(modelName);
    console.log(`Model: ${modelName}`);
    console.log('─'.repeat(50));
    
    if (details.details) {
      console.log(`  Format: ${details.details.format || 'unknown'}`);
      console.log(`  Family: ${details.details.family || 'unknown'}`);
      console.log(`  Parameters: ${details.details.parameter_size || 'unknown'}`);
      console.log(`  Quantization: ${details.details.quantization_level || 'unknown'}`);
    }
    
    if (details.model_info) {
      const keys = Object.keys(details.model_info);
      if (keys.length > 0) {
        console.log('\n  Info:');
        keys.slice(0, 5).forEach(key => {
          console.log(`    ${key}: ${details.model_info[key]}`);
        });
      }
    }
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}

async function cmdOllamaTest(args) {
  const modelName = args[0];
  
  if (!modelName) {
    console.error('Error: Model name required');
    console.log('Usage: construct ollama test <model>');
    process.exit(1);
  }
  
  console.log(`Testing ${modelName}...`);
  const result = testModel(modelName);
  
  if (result.success) {
    console.log(`✅ Response (${result.duration}):`);
    console.log('─'.repeat(50));
    console.log(result.response);
  } else {
    console.error(`❌ Test failed: ${result.error}`);
    process.exit(1);
  }
}

async function cmdOllamaSetup(args) {
  const autoYes = args.includes('--yes') || args.includes('-y');
  
  console.log('Ollama Setup');
  console.log('─'.repeat(50));
  
  // Check installation
  const status = checkOllamaStatus();
  
  if (!status.installed) {
    console.log('❌ Ollama is not installed');
    if (autoYes || process.platform === 'darwin') {
      console.log('Installing via Homebrew...');
      try {
        execFileSync('brew', ['install', 'ollama'], { stdio: 'inherit' });
        console.log('✅ Ollama installed');
      } catch (e) {
        console.error('❌ Installation failed. Please install manually: https://ollama.com');
        process.exit(1);
      }
    } else {
      console.log('Install with: brew install ollama');
      process.exit(1);
    }
  } else {
    console.log('✅ Ollama is installed');
  }
  
  // Check if running
  if (!status.running) {
    console.log('⚠️  Ollama is not running');
    console.log('Starting Ollama service...');
    try {
      execFileSync('brew', ['services', 'start', 'ollama'], { stdio: 'pipe' });
      console.log('✅ Ollama service started');
      // Wait for it to be ready
      console.log('Waiting for Ollama to be ready...');
      execFileSync('sleep', ['3']);
    } catch (e) {
      console.log('You can start it manually with: ollama serve');
    }
  } else {
    console.log('✅ Ollama is running');
  }
  
  // Pull default model
  console.log('\nPulling default model (llama3.2)...');
  const pullResult = pullModel('llama3.2', { verbose: false });
  if (pullResult.success) {
    console.log('✅ llama3.2 ready');
  } else {
    console.log('⚠️  Could not pull llama3.2, you can pull it later with: construct ollama pull llama3.2');
  }
  
  console.log('\n─'.repeat(50));
  console.log('Setup complete!');
  console.log('\nUsage:');
  console.log('  construct ollama list     # List available models');
  console.log('  construct ollama test llama3.2  # Test a model');
  console.log('  construct models set --tier=standard --model=ollama/llama3.2');
}

function formatSize(bytes) {
  if (!bytes) return 'unknown';
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(0)} MB`;
}
