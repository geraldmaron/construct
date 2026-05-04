#!/usr/bin/env node
/**
 * lib/hooks/persona-validator.mjs — Persona validation hook — tests optimized personas.
 *
 * Runs after optimization to validate that persona improvements work correctly.
 * Creates a test task for the optimized agent and evaluates the result.
 *
 * @p95ms 600
 * @maxBlockingScope PostToolUse (async)
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname, basename } from 'path';
import { homedir } from 'os';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONSTRUCT_BIN = join(__dirname, '..', '..', 'bin', 'construct');

const VALIDATION_TASKS = {
  'cx-engineer': 'Implement a function that calculates Fibonacci numbers up to n',
  'cx-architect': 'Design a simple REST API for a todo app with authentication',
  'cx-reviewer': 'Review this code for potential issues: function add(a,b){return a+b}',
  'cx-qa': 'Write test cases for a login form with email and password fields',
  'cx-security': 'Identify security issues in this code: eval(userInput)',
  'cx-debugger': 'Debug why this function might fail: function divide(a,b){return a/b}',
  'cx-researcher': 'Research best practices for React state management in 2025',
  'cx-designer': 'Design a user-friendly settings page for a mobile app',
  'cx-product-manager': 'Create user stories for a file upload feature',
  'cx-data-analyst': 'Analyze metrics for a SaaS subscription business model'
};

// Default task for unknown agents
const DEFAULT_TASK = 'Explain your role and capabilities as an AI specialist';

let input = {};
try { input = JSON.parse(readFileSync(0, 'utf8')); } catch { process.exit(0); }

// Check if this is triggered after optimization
const toolName = input?.tool_name || '';
const toolResult = input?.tool_result || {};
const resultText = toolResult?.result || '';

// Look for optimization keywords in result
const optimizationKeywords = ['optimize', 'optimization', 'improved', 'patched', 'updated persona'];
const isOptimizationResult = optimizationKeywords.some(keyword => 
  resultText.toLowerCase().includes(keyword)
);

if (!isOptimizationResult) {
  process.exit(0);
}

// Try to extract which agent was optimized
function extractOptimizedAgent(resultText) {
  const agentMatch = resultText.match(/optimiz(?:e|ing)\s+(cx-[a-z-]+|construct)/i);
  if (agentMatch) return agentMatch[1].toLowerCase();
  
  // Fallback: check for agent mentions
  const agentPattern = /(cx-[a-z-]+|construct)/g;
  const agents = [...new Set(resultText.match(agentPattern) || [])].map(a => a.toLowerCase());
  
  // If only one agent mentioned, assume it's the optimized one
  if (agents.length === 1) return agents[0];
  
  return null;
}

const agentName = extractOptimizedAgent(resultText);
if (!agentName) {
  console.log('🔍 Could not determine which agent was optimized from result');
  process.exit(0);
}

console.log(`🧪 Validating optimized persona: ${agentName}`);

// Create validation test
const validationTask = VALIDATION_TASKS[agentName] || DEFAULT_TASK;
const validationDir = join(homedir(), '.cx', 'validation-tests');
mkdirSync(validationDir, { recursive: true });

const testId = `${Date.now()}-${agentName}`;
const testFile = join(validationDir, `${testId}.json`);

// Run validation test
function runValidationTest() {
  console.log(`📝 Validation task: ${validationTask}`);
  
  const startTime = Date.now();
  
  try {
    // Use construct to dispatch the task to the agent
    const result = spawnSync(CONSTRUCT_BIN, ['--silent'], {
      input: `${validationTask}\n\nPlease complete this task as ${agentName}.`,
      encoding: 'utf8',
      timeout: 180000, // 3 minutes for validation
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    const duration = Date.now() - startTime;
    const output = result.stdout || '';
    const error = result.stderr || '';
    
    // Evaluate the result
    const evaluation = evaluateAgentOutput(agentName, output, duration);
    
    // Save validation result
    const validationResult = {
      testId,
      timestamp: new Date().toISOString(),
      agent: agentName,
      task: validationTask,
      durationMs: duration,
      outputLength: output.length,
      errorLength: error.length,
      success: result.status === 0,
      exitCode: result.status,
      evaluation,
      rawOutput: output.slice(0, 1000) // Store first 1000 chars
    };
    
    writeFileSync(testFile, JSON.stringify(validationResult, null, 2) + '\n');
    
    console.log(`📊 Validation complete:`);
    console.log(`   • Duration: ${duration}ms`);
    console.log(`   • Success: ${result.status === 0 ? '✅' : '❌'}`);
    console.log(`   • Output length: ${output.length} chars`);
    console.log(`   • Evaluation: ${evaluation.score}/10`);
    console.log(`   • Feedback: ${evaluation.feedback}`);
    
    // Record observation about validation
    recordValidationObservation(agentName, validationResult);
    
    return validationResult;
    
  } catch (error) {
    console.error(`❌ Validation test failed: ${error.message}`);
    
    const validationResult = {
      testId,
      timestamp: new Date().toISOString(),
      agent: agentName,
      task: validationTask,
      error: error.message,
      success: false
    };
    
    writeFileSync(testFile, JSON.stringify(validationResult, null, 2) + '\n');
    return validationResult;
  }
}

// Evaluate agent output based on role
function evaluateAgentOutput(agentName, output, duration) {
  const outputLower = output.toLowerCase();
  let score = 5; // Base score
  
  // Role-specific evaluation criteria
  const criteria = {
    'cx-engineer': {
      keywords: ['function', 'return', 'code', 'implementation', 'fibonacci', 'recursive', 'iterative'],
      minLength: 100,
      maxDuration: 120000 // 2 minutes
    },
    'cx-architect': {
      keywords: ['api', 'endpoint', 'authentication', 'rest', 'design', 'architecture'],
      minLength: 200,
      maxDuration: 180000 // 3 minutes
    },
    'cx-reviewer': {
      keywords: ['issue', 'problem', 'security', 'improvement', 'suggestion', 'feedback'],
      minLength: 150,
      maxDuration: 90000 // 1.5 minutes
    },
    'cx-qa': {
      keywords: ['test', 'case', 'scenario', 'assert', 'expect', 'coverage'],
      minLength: 150,
      maxDuration: 120000
    },
    'cx-security': {
      keywords: ['vulnerability', 'risk', 'injection', 'xss', 'secure', 'mitigation'],
      minLength: 100,
      maxDuration: 90000
    }
  };
  
  const agentCriteria = criteria[agentName] || {
    keywords: [],
    minLength: 50,
    maxDuration: 120000
  };
  
  // Check output length
  if (output.length >= agentCriteria.minLength) {
    score += 2;
  } else if (output.length > 10) {
    score += 1;
  }
  
  // Check for role-specific keywords
  const matchingKeywords = agentCriteria.keywords.filter(keyword => 
    outputLower.includes(keyword)
  );
  
  if (matchingKeywords.length > 0) {
    score += Math.min(3, matchingKeywords.length);
  }
  
  // Check response time
  if (duration <= agentCriteria.maxDuration) {
    score += 1;
  }
  
  // Check for structure (has multiple paragraphs or bullet points)
  const paraCount = (output.match(/\n\s*\n/g) || []).length;
  const bulletCount = (output.match(/[-*•]\s/g) || []).length;
  
  if (paraCount >= 2 || bulletCount >= 3) {
    score += 1;
  }
  
  // Cap score at 10
  score = Math.min(10, Math.max(0, score));
  
  // Generate feedback
  let feedback = '';
  if (score >= 8) {
    feedback = 'Excellent response - comprehensive and role-appropriate';
  } else if (score >= 6) {
    feedback = 'Good response - covers key aspects of the role';
  } else if (score >= 4) {
    feedback = 'Adequate response - could be more detailed';
  } else {
    feedback = 'Basic response - needs improvement for this role';
  }
  
  return {
    score,
    feedback,
    details: {
      outputLength: output.length,
      keywordMatches: matchingKeywords.length,
      paragraphs: paraCount,
      bulletPoints: bulletCount,
      durationMs: duration
    }
  };
}

// Record validation observation
function recordValidationObservation(agentName, validationResult) {
  const observation = {
    role: 'persona-validator',
    category: validationResult.success ? 'pattern' : 'anti-pattern',
    summary: validationResult.success 
      ? `Validated ${agentName} persona with score ${validationResult.evaluation.score}/10`
      : `Validation failed for ${agentName} persona`,
    content: `Persona validation test for ${agentName}:\n` +
      `Task: ${validationResult.task}\n` +
      `Duration: ${validationResult.durationMs}ms\n` +
      `Success: ${validationResult.success}\n` +
      `Evaluation: ${validationResult.evaluation?.feedback || 'N/A'}\n` +
      `Score: ${validationResult.evaluation?.score || 'N/A'}/10`,
    tags: ['persona-validation', agentName, validationResult.success ? 'validated' : 'failed'],
    confidence: 0.9,
    timestamp: new Date().toISOString()
  };
  
  try {
    const observationsDir = join(homedir(), '.cx', 'observations', 'validations');
    mkdirSync(observationsDir, { recursive: true });
    
    const observationFile = join(observationsDir, `${Date.now()}-${agentName}-validation.json`);
    writeFileSync(observationFile, JSON.stringify(observation, null, 2) + '\n');
  } catch (error) {
    console.error(`Failed to record validation observation: ${error.message}`);
  }
}

// Run validation
runValidationTest();
process.exit(0);