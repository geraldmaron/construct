/**
 * tests/helpers/sterile-env.mjs — Bootstraps sterile, isolated test environments.
 *
 * Each test gets a fresh Git repo and a clean Construct configuration,
 * with global environment variables explicitly neutralized.
 */
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

/**
 * Creates a sterile test environment.
 * @param {object} options
 * @param {string} options.prefix - Prefix for the temp directory.
 * @param {object} options.env - Environment variable overrides.
 * @returns {object} { path, cleanup, run }
 */
export function createSterileEnv({ prefix = "construct-test-", env = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  
  // Initialize sterile Git repo
  spawnSync("git", ["init"], { cwd: root });
  spawnSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  spawnSync("git", ["config", "user.name", "Test User"], { cwd: root });

  const cleanup = () => {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch (e) {
      console.error(`Cleanup failed for ${root}: ${e.message}`);
    }
  };

  /**
   * Runs a command in the sterile environment with controlled env vars.
   */
  const run = (cmd, args = [], options = {}) => {
    // Neutralize global Construct/AI env vars
    const sterileEnv = {
      ...process.env,
      ANTHROPIC_API_KEY: "",
      OPENAI_API_KEY: "",
      OPENROUTER_API_KEY: "",
      CONSTRUCT_TELEMETRY_URL: "",
      ...env,
      HOME: root, // Redirect home to sterile root
      CX_TOOLKIT_DIR: process.cwd(), // Path to real toolkit
    };

    return spawnSync(cmd, args, {
      cwd: root,
      env: sterileEnv,
      encoding: "utf8",
      ...options
    });
  };

  return { path: root, cleanup, run };
}

/**
 * Evaluates the quality of a test outcome using a rubric.
 * Returns a score between 0.0 and 1.0.
 */
export async function evaluateOutcome(output, rubric) {
  // TODO (geraldmaron): Implement cx-evaluator logic or LLM-as-a-judge call.
  // A basic rule-based heuristic stands in for the boilerplate.
  let score = 0;
  let totalWeight = 0;

  for (const [criterion, { weight, match }] of Object.entries(rubric)) {
    totalWeight += weight;
    if (match.test(output)) {
      score += weight;
    }
  }

  return totalWeight > 0 ? score / totalWeight : 1.0;
}
