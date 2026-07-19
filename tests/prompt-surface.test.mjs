/**
 * tests/prompt-surface.test.mjs — prompt surface policy enforcement tests
 *
 * Tests that key prompt files (construct persona, orchestrator, work/drive, work/plan)
 * delegate routing policy to code rather than restating it inline. Ensures prompt
 * surfaces stay lean and do not drift from the policy module.
 *
 * The anti-restatement block below enforces the prompt-density rule across the
 * full prompt corpus: prompts must reference code authorities (intent classes,
 * risk flags, MCP tool names) rather than enumerate them inline. Every new
 * assertion here names the code authority it pairs with so a future reader can
 * trace why the gate exists.
 *
 * Run via npm test.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { getRegistry, getContracts } from './test-registry-fixtures.mjs';
import { loadRegistry } from '../lib/registry/loader.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

// Glob-free recursive .md walk — keeps the test free of external deps and
// runs in well under the suite's per-test latency budget on this repo size.

function walkMarkdown(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkMarkdown(p));
    else if (entry.isFile() && p.endsWith('.md')) out.push(p);
  }
  return out;
}

function wordCount(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function readKeysOfConst(source, name) {
  const m = source.match(new RegExp(`export const ${name}\\s*=\\s*\\{([\\s\\S]*?)\\};`));
  if (!m) throw new Error(`could not locate export const ${name} in source`);
  return Array.from(m[1].matchAll(/^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:/gm)).map((x) => x[1]);
}

test('construct persona delegates routing policy to code', () => {
  const text = fs.readFileSync(path.join(root, 'personas/construct.md'), 'utf8');
  assert.match(text, /code-backed orchestration policy/);
  assert.doesNotMatch(text, /\*\*Focused\*\* — dispatch one specialist/);
});

test('prompt surface architecture states Construct is the sole public persona', () => {
  const text = fs.readFileSync(path.join(root, 'docs/guides/concepts/prompt-surfaces.mdx'), 'utf8');
  assert.match(text, /sole public persona/);
  assert.match(text, /internal specialist prompts/);
  assert.match(text, /offline-only regression surfaces/);
});

test('designer prompt covers visual deliverables beyond implemented UI', () => {
  const text = fs.readFileSync(path.join(root, 'registry/worker-profiles/prompts/designer.md'), 'utf8');
  assert.match(text, /slide decks and presentations/);
  assert.match(text, /walkthroughs and demo videos/);
  assert.match(text, /construct wireframe/);
});

test('orchestrator prompt no longer embeds a dispatch map', () => {
  const text = fs.readFileSync(path.join(root, 'registry/worker-profiles/prompts/orchestrator.md'), 'utf8');
  assert.match(text, /code-backed orchestration policy/);
  assert.doesNotMatch(text, /Dispatch map/);
});

test('drive and plan commands refer to policy instead of restating routing rules', () => {
  const drive = fs.readFileSync(path.join(root, 'commands/work/drive.md'), 'utf8');
  const plan = fs.readFileSync(path.join(root, 'commands/plan/feature.md'), 'utf8');
  assert.match(drive, /code-backed orchestration policy/);
  assert.match(plan, /code-backed orchestration policy/);
});

test('context command treats context.json as canonical', () => {
  const text = fs.readFileSync(path.join(root, 'commands/remember/context.md'), 'utf8');
  assert.match(text, /context\.json/);
});

// Anti-restatement gates — prompts must reference the code authority, not
// enumerate it inline. Adding a key to the authority must not require touching
// every prompt; conversely, a future contributor must not be able to silently
// re-introduce a code-restated list in a prompt.
//
// Authority: lib/orchestration-policy.mjs (INTENT_CLASSES, WORK_CATEGORIES,
//            detectRiskFlags keys), lib/mcp/server.mjs (tool names).
// Trigger pattern: bulleted definition row — `- \`name\`:` or `- **name**:`
//            — i.e. a row that *defines* the key, not a casual mention.

// INTENT_CLASSES/WORK_CATEGORIES live in policy-constants.mjs (construct-rf26.10
// split the enums out of orchestration-policy.mjs, which now just re-exports).
const POLICY_SOURCE_PATH = path.join(root, 'lib/orchestration/policy-constants.mjs');
const ANTIRESTATEMENT_ALLOWLIST = new Set([
  // Routing IS the orchestrator's job and the policy file IS the authority —
  // both legitimately enumerate the keys.
  'registry/worker-profiles/prompts/orchestrator.md',
  'lib/orchestration-policy.mjs',
]);

function relPath(p) {
  return path.relative(root, p).split(path.sep).join('/');
}

function countDefinitionRows(text, keys) {
  let hits = 0;
  for (const key of keys) {
    const re = new RegExp(`^\\s*[-*]\\s*(?:\\*\\*|\`)?${key}(?:\\*\\*|\`)?\\s*[:\\-]`, 'm');
    if (re.test(text)) hits += 1;
  }
  return hits;
}

test('no prompt enumerates ≥4 intent classes inline (authority: lib/orchestration-policy.mjs:INTENT_CLASSES)', () => {
  const policySource = fs.readFileSync(POLICY_SOURCE_PATH, 'utf8');
  const keys = readKeysOfConst(policySource, 'INTENT_CLASSES');
  assert.ok(keys.length >= 4, `INTENT_CLASSES must have at least 4 keys; got ${keys.length}`);

  const candidates = [
    ...walkMarkdown(path.join(root, 'registry/worker-profiles/prompts')),
    ...walkMarkdown(path.join(root, 'skills')),
    ...walkMarkdown(path.join(root, 'personas')),
  ];
  for (const file of candidates) {
    const rel = relPath(file);
    if (ANTIRESTATEMENT_ALLOWLIST.has(rel)) continue;
    const text = fs.readFileSync(file, 'utf8');
    const hits = countDefinitionRows(text, keys);
    assert.ok(
      hits < 4,
      `${rel} enumerates ${hits} INTENT_CLASSES as definition rows — reference lib/orchestration-policy.mjs:INTENT_CLASSES instead`,
    );
  }
});

test('no prompt outside the persona enumerates ≥3 detectRiskFlags keys inline (authority: lib/orchestration-policy.mjs:detectRiskFlags)', () => {
  const keys = ['architecture', 'security', 'dataIntegrity', 'ui', 'docs', 'ai'];
  const candidates = [
    ...walkMarkdown(path.join(root, 'registry/worker-profiles/prompts')),
    ...walkMarkdown(path.join(root, 'skills')),
  ];
  for (const file of candidates) {
    const rel = relPath(file);
    if (ANTIRESTATEMENT_ALLOWLIST.has(rel)) continue;
    const text = fs.readFileSync(file, 'utf8');
    const hits = countDefinitionRows(text, keys);
    assert.ok(
      hits < 3,
      `${rel} enumerates ${hits} detectRiskFlags keys as definition rows — reference lib/orchestration-policy.mjs:detectRiskFlags instead`,
    );
  }
});

test('every MCP-tool name in sharedGuidance is registered in lib/mcp/server.mjs', () => {
  const registry = loadRegistry({ rootDir: root });
  const guidance = (registry.sharedGuidance || []).join('\n');
  const server = fs.readFileSync(path.join(root, 'lib/mcp/server.mjs'), 'utf8');

  // MCP tool names follow snake_case with at least one underscore (e.g.
  // construct_trace, agent_contract, memory_search). Restrict to that shape so a
  // bare backticked word like `specialists` (a field name) is not flagged as
  // a missing tool. Backtick contexts with `/` or spaces are filtered by the
  // character class.
  const candidates = new Set(
    Array.from(guidance.matchAll(/`([a-z][a-z0-9_]*_[a-z0-9_]+)`/g)).map((m) => m[1]),
  );
  for (const tok of candidates) {
    const re = new RegExp(`["']${tok}["']`);
    assert.ok(
      re.test(server),
      `sharedGuidance names \`${tok}\` but it is not registered as a tool in lib/mcp/server.mjs — rename in code or remove the reference`,
    );
  }
});

test('no specialist source prompt restates fence JSON (manifest is the source of truth)', () => {
  // Phase C extracted the Fence + Handoff section into a renderer in
  // scripts/sync-worker-profiles.mjs that reads specialists/org.
  // The source prompts must not regrow the inline restatement; the renderer
  // produces the synced output. Allowed: discussion of the fence concept in
  // prose; banned: the literal structural markers below.
  const candidates = walkMarkdown(path.join(root, 'registry/worker-profiles/prompts'));
  const bannedLines = [
    /^\s*-\s*Allowed paths:/m,
    /^\s*-\s*Allowed bd labels:/m,
    /^\s*-\s*Approval required:/m,
    /^\*\*Fence\*\*\s*\(.*specialists\/unified-registry\.json/m,
  ];
  for (const file of candidates) {
    const rel = relPath(file);
    if (ANTIRESTATEMENT_ALLOWLIST.has(rel)) continue;
    const text = fs.readFileSync(file, 'utf8');
    for (const re of bannedLines) {
      assert.ok(
        !re.test(text),
        `${rel} restates fence JSON (matched ${re}). The renderer in scripts/sync-worker-profiles.mjs reads specialists/org — do not duplicate the JSON in the prompt`,
      );
    }
  }
});

test('renderWorkerProfilePolicySection renders the canonical policy fence', async () => {
  const { renderWorkerProfilePolicySection } = await import('../scripts/sync-worker-profiles.mjs');
  const registry = getRegistry();
  const rendered = renderWorkerProfilePolicySection(registry.workerProfiles.engineer);
  assert.match(rendered, /## Worker Profile policy/);
  assert.match(rendered, /registry\/worker-profiles\/engineer\.json/);
  assert.match(rendered, /`commit`/);
  assert.match(rendered, /`push`/);
});

test('renderWorkerProfilePolicySection returns empty for an invalid profile', async () => {
  const { renderWorkerProfilePolicySection } = await import('../scripts/sync-worker-profiles.mjs');
  assert.equal(renderWorkerProfilePolicySection({ id: '' }), '');
  assert.equal(renderWorkerProfilePolicySection({}), '');
});

test('every specialist prompt sits at or below 90% of the 1200-word cap (headroom rule)', () => {
  const registry = getRegistry();
  const cap = 1200;
  const headroom = Math.floor(cap * 0.9);
  // Named exceptions: each must have a written reason. orchestrator's job
  // IS routing, so the routing surface legitimately consumes more words.
  const exceptions = new Map([
    ['registry/worker-profiles/prompts/orchestrator.md', 'routing/handoff rules are the orchestrator\'s responsibility'],
  ]);
  for (const agent of Object.values(registry.specialists || {})) {
    if (!agent.promptFile) continue;
    if (exceptions.has(agent.promptFile)) continue;
    const text = fs.readFileSync(path.join(root, agent.promptFile), 'utf8');
    const wc = wordCount(text);
    assert.ok(
      wc <= headroom,
      `${agent.promptFile} is ${wc} words — exceeds ${headroom} (90% of ${cap}). Compress restated boilerplate (fence, anti-fabrication spine, learning capture) before adding new content`,
    );
  }
});

// Phase D — template wiring gates. SPECIALIST_TEMPLATES is the canonical
// owner→template map; the gates here keep prompts, templates, and tool
// grants in sync.

async function loadTemplateRegistry() {
  return import('../lib/template-registry.mjs');
}

test('every (specialist, template) pair in SPECIALIST_TEMPLATES is referenced by the specialist prompt', async () => {
  const { SPECIALIST_TEMPLATES } = await loadTemplateRegistry();
  const registry = getRegistry();
  for (const [specialist, templates] of Object.entries(SPECIALIST_TEMPLATES)) {
    const bare = specialist.replace(/^cx-/, '');
    const agent = Object.values(registry.specialists).find((a) => a.name === bare || a.name === specialist);
    assert.ok(agent, `SPECIALIST_TEMPLATES names ${specialist} but no such specialist in registry`);
    if (!agent.promptFile) continue;
    const text = fs.readFileSync(path.join(root, agent.promptFile), 'utf8');
    for (const template of templates) {
      const re = new RegExp(`get_template\\(['"\`]${template}['"\`]\\)`);
      assert.ok(
        re.test(text),
        `${agent.promptFile} produces \`${template}\` per SPECIALIST_TEMPLATES, but the prompt does not call \`get_template("${template}")\`. Replace inline output structure with a template pointer.`,
      );
    }
  }
});

test('every template named in SPECIALIST_TEMPLATES resolves to a file in templates/docs/', async () => {
  const { SPECIALIST_TEMPLATES } = await loadTemplateRegistry();
  const named = new Set();
  for (const templates of Object.values(SPECIALIST_TEMPLATES)) {
    for (const t of templates) named.add(t);
  }
  for (const t of named) {
    const file = path.join(root, 'templates/docs', `${t}.md`);
    assert.ok(fs.existsSync(file), `SPECIALIST_TEMPLATES references \`${t}\` but templates/docs/${t}.md does not exist — author the template before wiring the prompt`);
  }
});

test('every specialist in SPECIALIST_TEMPLATES has get_template + list_templates in claudeTools', async () => {
  const { SPECIALIST_TEMPLATES } = await loadTemplateRegistry();
  const registry = getRegistry();
  for (const specialist of Object.keys(SPECIALIST_TEMPLATES)) {
    const bare = specialist.replace(/^cx-/, '');
    const agent = Object.values(registry.specialists || {}).find((a) => a.name === bare || a.name === specialist);
    if (!agent) continue;
    const tools = String(agent.claudeTools || '').split(',').map((t) => t.trim());
    assert.ok(tools.includes('get_template'), `${specialist} references templates but lacks \`get_template\` in claudeTools — add it to specialists/org`);
    assert.ok(tools.includes('list_templates'), `${specialist} references templates but lacks \`list_templates\` in claudeTools — add it to specialists/org`);
  }
});

test('every shipped template is owned by a specialist or carries an ownership exemption', async () => {
  const { SPECIALIST_TEMPLATES, TEMPLATE_OWNERSHIP_EXEMPTIONS, SHARED_TEMPLATES } = await loadTemplateRegistry();
  const owned = new Set();
  for (const templates of Object.values(SPECIALIST_TEMPLATES)) {
    for (const t of templates) owned.add(t);
  }
  const shared = SHARED_TEMPLATES || new Set();
  const shipped = fs.readdirSync(path.join(root, 'templates/docs'))
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.replace(/\.md$/, ''));
  for (const t of shipped) {
    if (owned.has(t) || TEMPLATE_OWNERSHIP_EXEMPTIONS.has(t) || shared.has(t)) continue;
    assert.fail(`templates/docs/${t}.md ships but no specialist owns it in SPECIALIST_TEMPLATES, and it is not in TEMPLATE_OWNERSHIP_EXEMPTIONS or SHARED_TEMPLATES — wire it into a specialist or list it as an exemption with a reason`);
  }
});

test('construct persona enumerates every field the construct-to-orchestrator contract requires', () => {
  const persona = fs.readFileSync(path.join(root, 'personas/construct.md'), 'utf8');
  const contracts = getContracts();
  const c2o = contracts.contracts.find((c) => c.id === 'construct-to-orchestrator');
  assert.ok(c2o, 'construct-to-orchestrator contract must exist');
  // Persona must reference every mustContain field by name. Without this,
  // dispatched packets would fail validateHandoff and the orchestrator's
  // input check would BLOCKED_CONTRACT.
  for (const field of c2o.input.mustContain) {
    assert.match(persona, new RegExp(`\\b${field}\\b`), `persona must reference field '${field}'`);
  }
});
