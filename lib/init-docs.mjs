#!/usr/bin/env node
/**
 * lib/init-docs.mjs — AI-powered doc structure scaffolding
 *
 * Uses a fast model (Haiku) to analyze the project, ask 2-3 clarifying
 * questions, then generate a tailored documentation structure.
 * Falls back to a minimal static scaffold if no API key is available.
 *
 * Usage:
 *   node lib/init-docs.mjs [target-path] [--yes]
 *   construct init-docs [path] [--yes]
 */

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { defaultWorkflow } from "./workflow-state.mjs";
import { readOpenRouterApiKeyFromOpenCodeConfig } from "./model-router.mjs";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT_DIR = path.join(__dirname, "..");

const args = process.argv.slice(2);
const skipInteractive = args.includes("--yes") || !process.stdin.isTTY;
const targetArg = args.find((a) => !a.startsWith("--"));
const target = path.resolve(targetArg ?? process.cwd());

const FAST_MODEL = "claude-haiku-4-5-20251001";

// ─── .env loader ──────────────────────────────────────────────────────────────

function loadEnv(envPath) {
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnv(path.join(ROOT_DIR, ".env"));

// ─── API caller ───────────────────────────────────────────────────────────────

async function callModel(messages, system) {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({ model: FAST_MODEL, max_tokens: 4096, system, messages }),
    });
    if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return data.content[0].text;
  }

  const orKey = process.env.OPENROUTER_API_KEY || readOpenRouterApiKeyFromOpenCodeConfig();
  if (orKey) {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${orKey}`,
        "content-type": "application/json",
        "HTTP-Referer": "https://github.com/construct",
      },
      body: JSON.stringify({
        model: `anthropic/${FAST_MODEL}`,
        max_tokens: 4096,
        messages: [{ role: "system", content: system }, ...messages],
      }),
    });
    if (!res.ok) throw new Error(`OpenRouter API ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return data.choices[0].message.content;
  }

  return null;
}

// ─── Project context ──────────────────────────────────────────────────────────

function dirTree(dir, depth = 0, maxDepth = 2) {
  if (depth > maxDepth) return [];
  const skip = new Set(["node_modules", ".git", ".next", "dist", "build", "out",
    "__pycache__", ".venv", "vendor", "target", ".turbo", "coverage"]);
  let items;
  try { items = fs.readdirSync(dir); } catch { return []; }
  const entries = [];
  for (const item of items.sort()) {
    if (skip.has(item) || (item.startsWith(".") && depth === 0 && item !== ".cx")) continue;
    const full = path.join(dir, item);
    let stat;
    try { stat = fs.statSync(full); } catch { continue; }
    if (stat.isDirectory()) {
      entries.push(`${"  ".repeat(depth)}${item}/`);
      entries.push(...dirTree(full, depth + 1, maxDepth));
    } else {
      entries.push(`${"  ".repeat(depth)}${item}`);
    }
  }
  return entries;
}

function gatherContext(targetPath) {
  const ctx = { name: path.basename(targetPath) };

  for (const name of ["package.json", "pyproject.toml", "Cargo.toml", "go.mod", "build.gradle", "composer.json"]) {
    const p = path.join(targetPath, name);
    if (!fs.existsSync(p)) continue;
    if (name === "package.json") {
      try {
        const pkg = JSON.parse(fs.readFileSync(p, "utf8"));
        ctx.name = pkg.name ?? ctx.name;
        ctx.description = pkg.description;
        const deps = Object.keys({ ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) });
        ctx.dependencies = deps.slice(0, 40);
        ctx.scripts = Object.keys(pkg.scripts ?? {});
      } catch {}
    } else {
      ctx.manifest = fs.readFileSync(p, "utf8").slice(0, 600);
    }
    ctx.manifestFile = name;
    break;
  }

  for (const name of ["README.md", "readme.md", "README.txt"]) {
    const p = path.join(targetPath, name);
    if (fs.existsSync(p)) {
      ctx.readme = fs.readFileSync(p, "utf8").slice(0, 2000);
      break;
    }
  }

  ctx.structure = dirTree(targetPath).join("\n");

  const docsPath = path.join(targetPath, "docs");
  if (fs.existsSync(docsPath)) {
    ctx.existingDocs = fs.readdirSync(docsPath).slice(0, 20).join(", ");
  }

  try {
    ctx.gitRemote = execSync("git remote get-url origin", { cwd: targetPath, timeout: 3000, stdio: ["pipe", "pipe", "pipe"] })
      .toString().trim();
  } catch {}

  return ctx;
}

function contextToText(ctx) {
  const parts = [`Project: ${ctx.name}`];
  if (ctx.description) parts.push(`Description: ${ctx.description}`);
  if (ctx.gitRemote) parts.push(`Git remote: ${ctx.gitRemote}`);
  if (ctx.manifestFile) parts.push(`Manifest: ${ctx.manifestFile}`);
  if (ctx.dependencies?.length) parts.push(`Dependencies: ${ctx.dependencies.join(", ")}`);
  if (ctx.scripts?.length) parts.push(`npm scripts: ${ctx.scripts.join(", ")}`);
  if (ctx.manifest) parts.push(`\nManifest content:\n${ctx.manifest}`);
  if (ctx.readme) parts.push(`\nREADME:\n${ctx.readme}`);
  if (ctx.structure) parts.push(`\nDirectory structure:\n${ctx.structure}`);
  if (ctx.existingDocs) parts.push(`\nExisting docs/: ${ctx.existingDocs}`);
  return parts.join("\n");
}

// ─── JSON extraction ──────────────────────────────────────────────────────────

function extractJson(text) {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (fence ? fence[1] : text).trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON object found in response");
  return JSON.parse(raw.slice(start, end + 1));
}

// ─── File writing ─────────────────────────────────────────────────────────────

const created = [];
const skipped = [];

function writeIfMissing(filePath, content) {
  if (fs.existsSync(filePath)) {
    skipped.push(path.relative(target, filePath));
    return;
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
  created.push(path.relative(target, filePath));
}

// ─── Static fallback ──────────────────────────────────────────────────────────

function scaffoldStatic(projectName, workflowJson) {
  writeIfMissing(path.join(target, ".cx", "context.json"),
    `${JSON.stringify({ format: "json", savedAt: new Date().toISOString(), source: "init-docs", projectName, activeWork: [], recentDecisions: [], architectureNotes: [], openQuestions: [] }, null, 2)}\n`);
  writeIfMissing(path.join(target, ".cx", "context.md"),
    `# Project Context\n\n> Required project state. Keep this file updated. All LLMs working in this repo, including Construct, read it at session start and must keep it current. Keep under 100 lines.\n\n## Active Work\n\n## Recent Decisions\n\n## Architecture Notes\n\n## Open Questions\n`);
  writeIfMissing(path.join(target, ".cx", "workflow.json"), workflowJson);
  writeIfMissing(path.join(target, ".cx", "decisions", "_template.md"),
    `# ADR-{NNN}: {title}\n\nDate: {YYYY-MM-DD}\nStatus: proposed | accepted | deprecated\n\n## Context\n\n## Decision\n\n## Consequences\n`);
  writeIfMissing(path.join(target, "docs", "README.md"),
    `# ${projectName} — Documentation

> Required project state. All LLMs working in this repo, including Construct, must keep the core documents below current.

## Required core documents

| File | Purpose | Update when |
|---|---|---|
| .cx/context.md | Session-resumable human summary | Active work, decisions, architecture assumptions, or open questions change |
| .cx/context.json | Machine-readable resumable context | Context state needs to stay in sync with .cx/context.md |
| .cx/workflow.json | Canonical workflow/task state | Non-trivial work starts, changes phase, or completes |
| docs/README.md | Docs index and documentation contract | Core docs set or maintenance expectations change |
| docs/architecture.md | Canonical architecture and invariants | Runtime shape, contracts, boundaries, or major dependencies change |

## Contents

- [Architecture](./architecture.md)
- [Runbooks](./runbooks/)
- [ADRs](../.cx/decisions/)

## Maintenance rule

If work changes project reality, update the affected core document before calling it done.
`);
  writeIfMissing(path.join(target, "docs", "architecture.md"),
    `# ${projectName} Architecture\n\n> Required project state. Keep this file updated when system shape, contracts, boundaries, or dependencies materially change. All LLMs working in this repo should treat it as canonical architecture context.\n\n## System overview\n\nDescribe the main runtime shape, primary modules, and external dependencies.\n\n## Core layers\n\n- CLI / entrypoints\n- Application/runtime modules\n- State, data, and storage\n- External integrations\n\n## Key invariants\n\n- Public surface and ownership boundaries\n- Data/contract expectations\n- Safety or review gates\n`);
  writeIfMissing(path.join(target, "docs", "runbooks", "README.md"),
    `# Runbooks\n\n## Contents\n\n- Local development startup\n- Verification / health checks\n- Incident recovery\n- Release checklist\n`);
}

// ─── Prompts ──────────────────────────────────────────────────────────────────

const SYSTEM_QUESTIONS = `You are a documentation architect. You've been given context about a software project.

Ask 2–3 targeted clarifying questions to fill gaps that will materially affect the doc structure.
Good questions cover things like: team collaboration style, external consumers, operational complexity,
compliance needs, or release cadence — only when these aren't clear from the context.

Do NOT ask about things already obvious from the code. Do NOT ask open-ended questions.
Each question should have a short, specific answer (a few words or a sentence).

Output ONLY valid JSON:
{
  "questions": [
    { "id": "q1", "question": "..." },
    { "id": "q2", "question": "..." }
  ]
}`;

const SYSTEM_GENERATE = `You are a documentation architect generating a tailored doc structure.

Generate complete, project-specific files — not generic templates. Use real section headings,
meaningful placeholder content, and examples that match the actual tech stack and project type.

Rules:
- Always include .cx/context.md, .cx/context.json, .cx/workflow.json, docs/README.md, and docs/architecture.md
- Treat these files as required, maintained project state for all LLMs working in the repo, including Construct
- .cx/context.md should stay under 100 lines and contain real project sections
- Use the provided .cx/workflow.json verbatim
- Only include docs that make sense for THIS project — skip what doesn't apply
- Prefer fewer, higher-quality files over many hollow ones
- For template files (e.g. ADR template), use the filename _template.md inside the relevant folder

Output ONLY valid JSON:
{
  "summary": "One sentence: what was generated and why",
  "files": [
    { "path": "relative/path/file.md", "content": "complete file content" }
  ]
}`;

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\nConstruct init-docs → ${target}\n`);

  const ctx = gatherContext(target);
  const contextText = contextToText(ctx);
  const workflowJson = JSON.stringify(defaultWorkflow(target, ctx.name), null, 2) + "\n";

  // Attempt AI path
  let questionsResponse = null;
  try {
    process.stdout.write("  Analyzing project...");
    questionsResponse = await callModel([{ role: "user", content: contextText }], SYSTEM_QUESTIONS);
    process.stdout.write(" done\n\n");
  } catch (err) {
    process.stdout.write(` failed (${err.message})\n`);
  }

  if (!questionsResponse) {
    console.log("  No API key found — using static scaffold.\n");
    console.log("  Set ANTHROPIC_API_KEY or OPENROUTER_API_KEY in .env for AI-tailored output.\n");
    scaffoldStatic(ctx.name, workflowJson);
    printSummary();
    return;
  }

  // Parse and ask questions
  let questions = [];
  try {
    questions = extractJson(questionsResponse).questions ?? [];
  } catch {
    // skip questions if parse fails, go straight to generation
  }

  const answers = {};
  if (questions.length && !skipInteractive) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    console.log("A few questions to tailor the structure:\n");
    for (const q of questions) {
      const answer = await new Promise((resolve) => rl.question(`  ${q.question}\n  > `, resolve));
      answers[q.id] = answer.trim();
      console.log();
    }
    rl.close();
  }

  // Build generation prompt
  const qaText = questions.length && Object.keys(answers).length
    ? "\n\nAnswers to clarifying questions:\n" +
      questions.filter((q) => answers[q.id]).map((q) => `Q: ${q.question}\nA: ${answers[q.id]}`).join("\n\n")
    : "";

  const genPrompt = `${contextText}${qaText}\n\n---\n.cx/workflow.json (use verbatim):\n${workflowJson}`;

  let genResponse = null;
  try {
    process.stdout.write("  Generating doc structure...");
    genResponse = await callModel([{ role: "user", content: genPrompt }], SYSTEM_GENERATE);
    process.stdout.write(" done\n\n");
  } catch (err) {
    process.stdout.write(` failed (${err.message})\n`);
    console.log("  Falling back to static scaffold.\n");
    scaffoldStatic(ctx.name, workflowJson);
    printSummary();
    return;
  }

  try {
    const plan = extractJson(genResponse);
    if (plan.summary) console.log(`  ${plan.summary}\n`);
    for (const file of plan.files ?? []) {
      if (file.path && file.content) {
        writeIfMissing(path.join(target, file.path), file.content);
      }
    }
  } catch (err) {
    console.warn(`  Could not parse model output (${err.message}). Falling back to static scaffold.\n`);
    scaffoldStatic(ctx.name, workflowJson);
  }

  printSummary();
}

function printSummary() {
  console.log(`Doc structure initialized at: ${target}\n`);
  if (created.length) {
    console.log("Created:");
    for (const f of created) console.log(`  + ${f}`);
  }
  if (skipped.length) {
    console.log("\nSkipped (already exist):");
    for (const f of skipped) console.log(`  ~ ${f}`);
  }
  console.log(`\n${created.length} created, ${skipped.length} skipped.`);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
