#!/usr/bin/env node
/**
 * lib/eval-harness.mjs — <one-line purpose>
 *
 * <2–6 line summary.>
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

/**
 * Basic evaluation harness for Construct agents.
 * This script runs "dry runs" or simulated interactions against agent prompts
 * to verify they would call the right tools or produce the right outcomes.
 */

export async function runEval(agentName, input, expectedPatterns = []) {
  const registry = JSON.parse(fs.readFileSync(path.join(root, "agents", "registry.json"), "utf8"));
  const agent = registry.agents.find(a => a.name === agentName) || 
                registry.personas.find(p => p.name === agentName);
  
  if (!agent) throw new Error(`Agent ${agentName} not found in registry`);

  // In a real production setup, this would call the LLM.
  // For this harness, we are checking the "Static Intent" — 
  // can the agent logically fulfill the request based on its prompt?
  
  const results = {
    agent: agentName,
    input,
    passed: true,
    findings: []
  };

  for (const pattern of expectedPatterns) {
    const regex = new RegExp(pattern, "i");
    const foundInPrompt = regex.test(agent.prompt || "");
    const foundInShared = (registry.sharedGuidance || []).some(g => regex.test(g));
    
    if (!foundInPrompt && !foundInShared) {
      results.passed = false;
      results.findings.push(`MISSING: Pattern "${pattern}" not supported by agent prompt or shared guidance`);
    } else {
      results.findings.push(`OK: Pattern "${pattern}" is supported`);
    }
  }

  return results;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  // Simple example run
  const testAgent = process.argv[2] || "engineer";
  const result = await runEval(testAgent, "Fix the bug", ["Edit", "Read", "Bash"]);
  console.log(JSON.stringify(result, null, 2));
}
