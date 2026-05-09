#!/usr/bin/env node
/**
 * lib/hooks/agent-tracker.mjs — Agent task lifecycle hook — tracks task start, completion, and handoffs.
 *
 * Runs as PostToolUse after Agent tool calls. Records agent invocations and their outcomes to ~/.cx/agent-log.json for telemetry and performance review.
 * Also records observations for learning system to identify patterns/anti-patterns.
 *
 * @p95ms 10
 * @maxBlockingScope none (PostToolUse, non-blocking)
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

let input = {};
try { input = JSON.parse(readFileSync(0, 'utf8')); } catch { process.exit(0); }

const toolName = input?.tool_name || '';
if (toolName !== 'Task') process.exit(0);

const toolInput = input?.tool_input || {};
const toolResult = input?.tool_result || {};

// Extract agent identity from the Task tool input.
// Claude Code passes subagent_type or description in tool_input.
const agentType = toolInput?.subagent_type || toolInput?.agent || null;
const description = toolInput?.description || toolInput?.prompt || '';

// Prefer subagent_type (e.g. "cx-engineer"), fall back to first cx-* token in description.
let agentName = agentType;
if (!agentName) {
  const descMatch = /^(cx-[a-z-]+|construct)/i.exec(description.trim());
  agentName = descMatch ? descMatch[1].toLowerCase() : 'subagent';
}

// Extract success/failure indicators from result
const resultText = toolResult?.result || '';
const successIndicators = ['success', 'completed', 'finished', 'done', '✅', '✔'];
const errorIndicators = ['error', 'failed', 'failure', '❌', '✗', 'exception', 'timed out'];
const warningIndicators = ['warning', 'warn', '⚠', 'note:', 'attention'];

let outcome = 'unknown';
let success = null;

const lowerResult = resultText.toLowerCase();
if (errorIndicators.some(ind => lowerResult.includes(ind))) {
  outcome = 'error';
  success = false;
} else if (warningIndicators.some(ind => lowerResult.includes(ind))) {
  outcome = 'warning';
  success = null;
} else if (successIndicators.some(ind => lowerResult.includes(ind))) {
  outcome = 'success';
  success = true;
}

// Record agent invocation
try {
  const home = homedir();
  const cxDir = join(home, '.cx');
  mkdirSync(cxDir, { recursive: true });
  
  // Update last-agent file for coordination
  writeFileSync(
    join(cxDir, 'last-agent.json'),
    JSON.stringify({ 
      agent: agentName, 
      coordination: 'tracker-plus-plan', 
      ts: new Date().toISOString(),
      outcome,
      description: description.slice(0, 200)
    }),
  );
  
  // Append to agent log for telemetry
  const agentLogFile = join(cxDir, 'agent-log.jsonl');
  const logEntry = {
    timestamp: new Date().toISOString(),
    agent: agentName,
    outcome,
    success,
    description: description.slice(0, 500),
    resultLength: resultText.length,
    toolInputKeys: Object.keys(toolInput).filter(k => !k.includes('secret') && !k.includes('password') && !k.includes('token'))
  };
  
  appendFileSync(agentLogFile, JSON.stringify(logEntry) + '\n');
  
  // Record observation for pattern learning (only if we have meaningful outcome)
  if (outcome !== 'unknown' && description.length > 10) {
    const observationsDir = join(cxDir, 'observations', 'agent-outcomes');
    mkdirSync(observationsDir, { recursive: true });
    
    const observationFile = join(observationsDir, `${Date.now()}-${agentName}.json`);
    
    // Categorize as pattern or anti-pattern based on outcome
    const category = success === true ? 'pattern' : 
                    success === false ? 'anti-pattern' : 'observation';
    
    const summary = success === true 
      ? `${agentName} successfully completed: ${description.slice(0, 100)}`
      : success === false
      ? `${agentName} failed: ${description.slice(0, 100)}`
      : `${agentName} executed with warnings: ${description.slice(0, 100)}`;
    
    const observation = {
      role: 'agent-tracker',
      category,
      summary,
      content: `${agentName} was invoked with description: "${description.slice(0, 500)}"\n\nOutcome: ${outcome}\nResult length: ${resultText.length} chars`,
      tags: ['agent-invocation', agentName, outcome],
      confidence: 0.8,
      timestamp: new Date().toISOString()
    };
    
    writeFileSync(observationFile, JSON.stringify(observation, null, 2) + '\n');
    
    // Also record in vector-ready format for learning system
    if (success !== null) {
      const learningDir = join(cxDir, 'learning', agentName);
      mkdirSync(learningDir, { recursive: true });
      
      const learningFile = join(learningDir, `${Date.now()}-${success ? 'success' : 'failure'}.json`);
      const learningEntry = {
        agent: agentName,
        success,
        description,
        outcome,
        timestamp: new Date().toISOString(),
        // Extract potential patterns from description
        keywords: extractKeywords(description),
        taskType: classifyTaskType(description)
      };
      
      writeFileSync(learningFile, JSON.stringify(learningEntry, null, 2) + '\n');
    }
  }
  
} catch (error) { 
  // Non-critical - best effort tracking
  console.error(`Agent tracker error: ${error.message}`);
}

// Helper functions for learning system
function extractKeywords(text) {
  const commonStop = ['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by'];
  const words = text.toLowerCase().split(/[\s\.,;!?]+/).filter(word => 
    word.length > 2 && !commonStop.includes(word) && /^[a-z]+$/.test(word)
  );
  
  // Count frequency
  const freq = {};
  words.forEach(word => freq[word] = (freq[word] || 0) + 1);
  
  // Return top 5 keywords
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([word]) => word);
}

function classifyTaskType(description) {
  const lower = description.toLowerCase();
  if (lower.includes('fix') || lower.includes('bug') || lower.includes('error')) return 'bug-fix';
  if (lower.includes('implement') || lower.includes('create') || lower.includes('add')) return 'implementation';
  if (lower.includes('refactor') || lower.includes('improve') || lower.includes('optimize')) return 'refactoring';
  if (lower.includes('review') || lower.includes('audit') || lower.includes('check')) return 'review';
  if (lower.includes('test') || lower.includes('verify') || lower.includes('validate')) return 'testing';
  if (lower.includes('document') || lower.includes('write') || lower.includes('readme')) return 'documentation';
  if (lower.includes('research') || lower.includes('analyze') || lower.includes('investigate')) return 'research';
  return 'other';
}

process.exit(0);
