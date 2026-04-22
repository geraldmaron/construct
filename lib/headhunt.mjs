#!/usr/bin/env node
/**
 * lib/headhunt.mjs — <one-line purpose>
 *
 * <2–6 line summary.>
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';

import { loadWorkflow, updateTask } from './workflow-state.mjs';

const OVERLAY_DIRNAME = 'domain-overlays';
const PROMOTION_DIRNAME = 'promotion-requests';
const TEAMS_FILE = 'agents/teams.json';

function loadTeamTemplates(root) {
  try {
    const teamsPath = path.join(root, TEAMS_FILE);
    return JSON.parse(fs.readFileSync(teamsPath, 'utf8'));
  } catch {
    return null;
  }
}

export function listTeamTemplates(cwd = process.cwd()) {
  const root = findConstructRoot(cwd);
  const teams = loadTeamTemplates(root);
  if (!teams) { process.stdout.write('No teams.json found.\n'); return; }
  process.stdout.write('Available team templates:\n');
  for (const [name, tpl] of Object.entries(teams.templates)) {
    process.stdout.write(`  ${name.padEnd(20)} ${tpl.description}\n`);
    process.stdout.write(`    Members: ${tpl.members.join(', ')}\n`);
  }
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'overlay';
}

function parseArgs(args = []) {
  const flags = {};
  const positional = [];
  for (const arg of args) {
    if (arg.startsWith('--')) {
      const [key, ...rest] = arg.slice(2).split('=');
      flags[key] = rest.length ? rest.join('=') : true;
    } else {
      positional.push(arg);
    }
  }
  return { flags, positional };
}

function promptQuestion(rl, question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

function classifyOverlay(objective = '', explicitTeam = '') {
  if (explicitTeam) {
    return {
      focus: 'custom',
      attachTo: explicitTeam.split(',').map((value) => value.trim()).filter(Boolean),
    };
  }

  const text = objective.toLowerCase();
  if (/security|policy|compliance|secrets|iam|threat|audit/.test(text)) {
    return { focus: 'security', attachTo: ['cx-security', 'cx-architect'] };
  }
  if (/implement|build|module|deploy|pipeline|ci\/cd|apply|code/.test(text)) {
    return { focus: 'implementation', attachTo: ['cx-engineer', 'cx-architect'] };
  }
  if (/runbook|docs|documentation|guide|onboard/.test(text)) {
    return { focus: 'documentation', attachTo: ['cx-docs-keeper', 'cx-researcher'] };
  }
  if (/research|compare|recent|latest|best practices|upgrade|migration/.test(text)) {
    return { focus: 'research', attachTo: ['cx-researcher', 'cx-architect'] };
  }
  return { focus: 'architecture', attachTo: ['cx-architect', 'cx-researcher'] };
}

function buildOverlayPrompt({ domain, objective, scope, permanence, focus, freshness }) {
  return [
    `Domain overlay: ${domain}`,
    `Objective: ${objective}`,
    scope ? `Scope: ${scope}` : null,
    `Permanence: ${permanence}`,
    `Primary focus: ${focus}`,
    `Freshness requirement: ${freshness}`,
    'Rules:',
    '- Treat this as an internal Construct overlay, not a permanent public role.',
    '- Start research-first and citation-first using primary sources.',
    '- Prefer official docs, release notes, provider docs, tracked issues, then ecosystem references.',
    '- Separate confirmed facts from inference.',
    '- Respect existing Construct workflow, security, and validation boundaries.',
    '- Do not broaden tool permissions just because the domain is specialized.',
  ].filter(Boolean).join('\n');
}

function buildPromotionGates() {
  return [
    'Explicit user request to save/promote capability',
    'Demonstrated reuse beyond a one-off task',
    'Clear scope, non-goals, and maintainer owner',
    'Fits existing Construct routing without exposing internals',
    'Security/risk review passes if domain touches infra/auth/data',
    'Docs and validation plan exist before any persistent registry changes',
  ];
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${value.trim()}\n`);
}

function readJsonIfExists(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function findConstructRoot(startPath = process.cwd()) {
  let current = path.resolve(startPath);
  while (true) {
    if (fs.existsSync(path.join(current, '.cx'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(startPath);
    current = parent;
  }
}

function listJsonFiles(dir) {
  try {
    return fs.readdirSync(dir)
      .filter((file) => file.endsWith('.json'))
      .sort()
      .map((file) => path.join(dir, file));
  } catch {
    return [];
  }
}

function getOverlayDir(cwd) {
  return path.join(cwd, '.cx', OVERLAY_DIRNAME);
}

function getPromotionDir(cwd) {
  return path.join(cwd, '.cx', PROMOTION_DIRNAME);
}

function loadOverlayRecords(cwd) {
  return listJsonFiles(getOverlayDir(cwd))
    .map((filePath) => ({ filePath, record: readJsonIfExists(filePath) }))
    .filter((entry) => entry.record && entry.record.type === 'domain-overlay');
}

function loadPromotionRecords(cwd) {
  return listJsonFiles(getPromotionDir(cwd))
    .map((filePath) => ({ filePath, record: readJsonIfExists(filePath) }))
    .filter((entry) => entry.record && entry.record.type === 'promotion-request');
}

function unique(values = []) {
  return [...new Set((values || []).filter(Boolean))];
}

function findWorkflowTaskForOverlay(workflow, overlayId = null) {
  const tasks = workflow?.tasks || [];
  if (overlayId) {
    const linkedTask = tasks.find((task) => Array.isArray(task.overlays) && task.overlays.includes(overlayId));
    if (linkedTask) return linkedTask;
  }
  if (workflow?.currentTaskKey) {
    const currentTask = tasks.find((task) => task.key === workflow.currentTaskKey);
    if (currentTask) return currentTask;
  }
  return tasks.find((task) => task.status === 'in-progress' || task.status === 'blocked_needs_user') || null;
}

function attachOverlayToWorkflow(root, overlay, { challengeRequired = false, challengeStatus = null } = {}) {
  const workflow = loadWorkflow(root);
  const task = findWorkflowTaskForOverlay(workflow);
  if (!task) return null;

  updateTask(root, task.key, {
    overlays: unique([...(task.overlays || []), overlay.id]),
    challengeRequired: challengeRequired || task.challengeRequired,
    challengeStatus: challengeStatus ?? task.challengeStatus,
    note: `Attached domain overlay ${overlay.id} (${overlay.domain}).`,
  });
  return task.key;
}

function syncPromotionToWorkflow(root, request) {
  const workflow = loadWorkflow(root);
  const task = findWorkflowTaskForOverlay(workflow, request.id);
  if (!task) return null;

  updateTask(root, task.key, {
    overlays: unique([...(task.overlays || []), request.id]),
    challengeRequired: true,
    challengeStatus: request.challenge?.status || task.challengeStatus || 'pending',
    note: `Updated promotion request ${request.id} challenge status to ${request.challenge?.status || 'pending'}.`,
  });
  return task.key;
}

function isExpired(record) {
  return Boolean(record?.expiresAt && new Date(record.expiresAt).getTime() <= Date.now());
}

export function getActiveOverlays(cwd = process.cwd()) {
  const root = findConstructRoot(cwd);
  return loadOverlayRecords(root)
    .map((entry) => entry.record)
    .filter((record) => !isExpired(record) && record.status !== 'archived');
}

export function getPromotionRequests(cwd = process.cwd()) {
  const root = findConstructRoot(cwd);
  return loadPromotionRecords(root)
    .map((entry) => entry.record)
    .filter((record) => record.status !== 'archived');
}

function formatOverlayLine(record) {
  const mode = record.permanence === 'temporary' ? 'temp' : 'promotion';
  const expiry = record.expiresAt ? ` · expires ${record.expiresAt}` : '';
  return `- ${record.id} · ${record.domain} · ${mode} · ${record.focus} · ${record.attachTo.join(', ')}${expiry}`;
}

export function printHeadhuntList(cwd = process.cwd()) {
  const root = findConstructRoot(cwd);
  const overlays = loadOverlayRecords(root);
  const promotions = loadPromotionRecords(root);
  process.stdout.write('Headhunt overlays\n');
  if (overlays.length === 0) process.stdout.write('- none\n');
  for (const { record } of overlays) {
    process.stdout.write(`${formatOverlayLine(record)}\n`);
  }
  process.stdout.write('\nPromotion requests\n');
  if (promotions.length === 0) process.stdout.write('- none\n');
  for (const { record } of promotions) {
    process.stdout.write(`- ${record.id} · ${record.domain} · ${record.status} · ${record.attachTo.join(', ')}\n`);
  }
}

export function promoteHeadhunt(id, { cwd = process.cwd(), owner = null } = {}) {
  const root = findConstructRoot(cwd);
  const overlayEntry = loadOverlayRecords(root).find((entry) => entry.record.id === id);
  if (!overlayEntry) throw new Error(`Unknown overlay: ${id}`);

  const existingRequest = loadPromotionRecords(root).find((entry) => entry.record.id === id);
  if (existingRequest) {
    process.stdout.write(`Promotion request already exists: ${path.relative(root, existingRequest.filePath)}\n`);
    return existingRequest.record;
  }

  const request = {
    id,
    type: 'promotion-request',
    domain: overlayEntry.record.domain,
    objective: overlayEntry.record.objective,
    scope: overlayEntry.record.scope,
    requestedAt: new Date().toISOString(),
    status: 'pending_review',
    owner,
    attachTo: overlayEntry.record.attachTo,
    focus: overlayEntry.record.focus,
    sourceOverlay: overlayEntry.filePath,
    reviewFlow: ['cx-architect', 'cx-devil-advocate', 'cx-docs-keeper'],
    challenge: {
      required: true,
      owner: 'cx-devil-advocate',
      status: 'pending',
      reason: 'Persistent capabilities must be challenged before promotion.',
    },
    promotionGates: buildPromotionGates(),
  };
  const promotionPath = path.join(getPromotionDir(root), `${id}.json`);
  writeJson(promotionPath, request);
  syncPromotionToWorkflow(root, request);
  process.stdout.write(`Created promotion request: ${path.relative(root, promotionPath)}\n`);
  return request;
}

export function updatePromotionChallenge(id, { cwd = process.cwd(), status, note = null } = {}) {
  const root = findConstructRoot(cwd);
  const requestPath = path.join(getPromotionDir(root), `${id}.json`);
  const request = readJsonIfExists(requestPath);
  if (!request) throw new Error(`Unknown promotion request: ${id}`);
  request.challenge = request.challenge || { required: true, owner: 'cx-devil-advocate', status: 'pending' };
  if (status) request.challenge.status = status;
  if (note) request.challenge.note = note;
  request.updatedAt = new Date().toISOString();
  writeJson(requestPath, request);
  syncPromotionToWorkflow(root, request);
  return request;
}

export function cleanupHeadhunt({ cwd = process.cwd(), now = new Date() } = {}) {
  const root = findConstructRoot(cwd);
  const overlays = loadOverlayRecords(root);
  let removed = 0;
  for (const { filePath, record } of overlays) {
    if (record.expiresAt && new Date(record.expiresAt).getTime() <= now.getTime()) {
      fs.rmSync(filePath, { force: true });
      const markdownPath = filePath.replace(/\.json$/, '.md');
      fs.rmSync(markdownPath, { force: true });
      removed += 1;
    }
  }
  process.stdout.write(`Removed ${removed} expired overlay(s).\n`);
  return removed;
}

function parseSubcommand(positional) {
  const first = positional[0];
  if (['list', 'promote', 'challenge', 'cleanup', 'template'].includes(first)) {
    return { subcommand: first, rest: positional.slice(1) };
  }
  return { subcommand: 'create', rest: positional };
}

export async function runHeadhunt({ args = [], cwd = process.cwd(), homeDir = os.homedir() } = {}) {
  const { flags, positional } = parseArgs(args);
  const { subcommand, rest } = parseSubcommand(positional);
  if (flags.help || flags.h) {
    process.stdout.write('Usage:\n  construct headhunt <domain> [--for=OBJECTIVE] [--scope=TEXT] [--temp|--save] [--team=a,b] [--freshness=current|stable]\n  construct headhunt list\n  construct headhunt promote <overlay-id> [--owner=NAME]\n  construct headhunt cleanup\n');
    return;
  }

  if (subcommand === 'list') {
    printHeadhuntList(cwd);
    return;
  }

  if (subcommand === 'promote') {
    const id = rest[0];
    if (!id) throw new Error('Usage: construct headhunt promote <overlay-id> [--owner=NAME]');
    return promoteHeadhunt(id, { cwd, owner: typeof flags.owner === 'string' ? flags.owner : null });
  }

  if (subcommand === 'challenge') {
    const id = rest[0];
    if (!id) throw new Error('Usage: construct headhunt challenge <overlay-id> --status=pending|approved|rejected [--note=TEXT]');
    return updatePromotionChallenge(id, { cwd, status: typeof flags.status === 'string' ? flags.status : null, note: typeof flags.note === 'string' ? flags.note : null });
  }

  if (subcommand === 'cleanup') {
    return cleanupHeadhunt({ cwd });
  }

  if (subcommand === 'template') {
    const templateName = rest[0];
    if (!templateName) { listTeamTemplates(cwd); return; }
    const root = findConstructRoot(cwd);
    const teams = loadTeamTemplates(root);
    if (!teams) throw new Error('agents/teams.json not found. Run from the Construct root.');
    const tpl = teams.templates[templateName];
    if (!tpl) throw new Error(`Unknown template: ${templateName}. Run 'construct headhunt template' to list available templates.`);
    const objective = typeof flags.for === 'string' ? flags.for.trim() : rest.slice(1).join(' ').trim();
    if (!objective) throw new Error(`Usage: construct headhunt template ${templateName} --for="<objective>"`);
    const permanence = flags.save ? 'permanent_request' : 'temporary';
    const freshness = typeof flags.freshness === 'string' ? flags.freshness : 'current';
    const now = new Date();
    const overlayId = `${slugify(templateName)}-team-${now.toISOString().replace(/[:.]/g, '-')}`;
    const overlayDir = getOverlayDir(root);
    const expiresAt = permanence === 'temporary' ? new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString() : null;
    const workflow = loadWorkflow(root);

    const overlay = {
      id: overlayId,
      type: 'domain-overlay',
      domain: templateName,
      objective,
      scope: typeof flags.scope === 'string' ? flags.scope.trim() : null,
      permanence,
      focus: tpl.focus,
      attachTo: tpl.members,
      freshness,
      teamTemplate: templateName,
      teamId: overlayId,
      createdAt: now.toISOString(),
      expiresAt,
      project: path.basename(root),
      workflowId: workflow?.id || null,
      taskKey: workflow?.currentTaskKey || null,
      status: 'active',
      prompt: buildOverlayPrompt({ domain: templateName, objective, scope: typeof flags.scope === 'string' ? flags.scope : '', permanence, focus: tpl.focus, freshness }),
      skills: tpl.skills ?? [],
      promotionGates: tpl.promotionGates ?? buildPromotionGates(),
      challenge: null,
    };

    const overlayJsonPath = path.join(overlayDir, `${overlayId}.json`);
    const overlayMdPath = path.join(overlayDir, `${overlayId}.md`);
    writeJson(overlayJsonPath, overlay);
    writeText(overlayMdPath, [
      `# Team: ${templateName}`,
      '',
      `- objective: ${objective}`,
      `- focus: ${tpl.focus}`,
      `- members: ${tpl.members.join(', ')}`,
      tpl.skills?.length ? `- skills: ${tpl.skills.join(', ')}` : null,
      expiresAt ? `- expiresAt: ${expiresAt}` : null,
      '',
      '## Promotion Gates',
      ...overlay.promotionGates.map((g) => `- ${g}`),
    ].filter(Boolean).join('\n'));

    const attachedTaskKey = attachOverlayToWorkflow(root, overlay, {});
    if (attachedTaskKey) { overlay.taskKey = attachedTaskKey; writeJson(overlayJsonPath, overlay); }

    const lines = [
      `Construct activated team template: ${templateName}`,
      `Objective: ${objective}`,
      `Members: ${tpl.members.join(', ')}`,
      `Overlay ID (teamId): ${overlayId}`,
      `Overlay: ${path.relative(cwd, overlayJsonPath)}`,
    ];
    if (expiresAt) lines.push(`Expires: ${expiresAt}`);
    process.stdout.write(`${lines.join('\n')}\n`);
    return { overlay, overlayJsonPath, overlayMdPath };
  }

  const domain = rest[0];
  if (!domain) throw new Error('Usage: construct headhunt <domain> [--for=OBJECTIVE] [--scope=TEXT] [--temp|--save]');
  if (flags.temp && flags.save) throw new Error('Use either --temp or --save, not both.');

  const interactive = process.stdin.isTTY;
  const rl = interactive ? createInterface({ input: process.stdin, output: process.stdout }) : null;
  try {
    let permanence = flags.save ? 'permanent_request' : 'temporary';
    if (!flags.temp && !flags.save && interactive) {
      const answer = (await promptQuestion(rl, 'Use this expertise temporarily for the current task, or save it as a promotion request? [temp/save]: ')).trim().toLowerCase();
      permanence = answer === 'save' ? 'permanent_request' : 'temporary';
    }

    let objective = typeof flags.for === 'string' ? flags.for.trim() : rest.slice(1).join(' ').trim();
    if (!objective && interactive) {
      objective = (await promptQuestion(rl, `What should the ${domain} expertise help with? `)).trim();
    }
    if (!objective) throw new Error('A task objective is required. Use --for="..." or provide a trailing goal.');

    let scope = typeof flags.scope === 'string' ? flags.scope.trim() : '';
    if (!scope && interactive) {
      scope = (await promptQuestion(rl, 'Optional scope boundary (press enter to skip): ')).trim();
    }

    const freshness = typeof flags.freshness === 'string' ? flags.freshness : 'current';
    const classification = classifyOverlay(objective, typeof flags.team === 'string' ? flags.team : '');
    const now = new Date();
    const root = findConstructRoot(cwd);
    const workflow = loadWorkflow(root);
    const overlayId = `${slugify(domain)}-${now.toISOString().replace(/[:.]/g, '-')}`;
    const overlayDir = getOverlayDir(root);
    const promotionDir = getPromotionDir(root);
    const expiresAt = permanence === 'temporary' ? new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString() : null;

    const overlay = {
      id: overlayId,
      type: 'domain-overlay',
      domain,
      objective,
      scope: scope || null,
      permanence,
      focus: classification.focus,
      attachTo: classification.attachTo,
      freshness,
      createdAt: now.toISOString(),
      expiresAt,
      project: path.basename(root),
      workflowId: workflow?.id || null,
      taskKey: workflow?.currentTaskKey || null,
      status: permanence === 'temporary' ? 'active' : 'promotion_requested',
      teamId: overlayId,
      sourceStrategy: [
        'official docs',
        'release notes/changelogs',
        'provider docs',
        'tracked issues',
        'ecosystem references',
      ],
      toolBoundary: 'research-first; no automatic registry mutation or expanded write authority',
      prompt: buildOverlayPrompt({
        domain,
        objective,
        scope,
        permanence,
        focus: classification.focus,
        freshness,
      }),
      promotionGates: buildPromotionGates(),
      challenge: permanence === 'temporary' ? null : {
        required: true,
        owner: 'cx-devil-advocate',
        status: 'pending',
        reason: 'Promotion requests must be challenged before any persistent capability is added.',
      },
    };

    const overlayJsonPath = path.join(overlayDir, `${overlayId}.json`);
    const overlayMdPath = path.join(overlayDir, `${overlayId}.md`);
    writeJson(overlayJsonPath, overlay);
    writeText(overlayMdPath, [
      `# ${domain} overlay`,
      '',
      `- objective: ${objective}`,
      `- permanence: ${permanence}`,
      `- focus: ${classification.focus}`,
      `- attachTo: ${classification.attachTo.join(', ')}`,
      scope ? `- scope: ${scope}` : null,
      `- freshness: ${freshness}`,
      expiresAt ? `- expiresAt: ${expiresAt}` : null,
      '',
      '## Prompt',
      '',
      overlay.prompt,
    ].filter(Boolean).join('\n'));

    const attachedTaskKey = attachOverlayToWorkflow(root, overlay, {
      challengeRequired: permanence === 'permanent_request',
      challengeStatus: permanence === 'permanent_request' ? 'pending' : null,
    });
    if (attachedTaskKey) {
      overlay.taskKey = attachedTaskKey;
      writeJson(overlayJsonPath, overlay);
    }

    let promotionPath = null;
    if (permanence === 'permanent_request') {
      const request = {
        id: overlayId,
        type: 'promotion-request',
        domain,
        objective,
        scope: scope || null,
        requestedAt: now.toISOString(),
        status: 'pending_review',
        owner: typeof flags.owner === 'string' ? flags.owner : null,
        attachTo: classification.attachTo,
        focus: classification.focus,
        sourceOverlay: overlayJsonPath,
        reviewFlow: ['cx-architect', 'cx-devil-advocate', 'cx-docs-keeper'],
        challenge: {
          required: true,
          owner: 'cx-devil-advocate',
          status: 'pending',
          reason: 'Promotion requests must be challenged before any persistent capability is added.',
        },
        promotionGates: buildPromotionGates(),
      };
      promotionPath = path.join(promotionDir, `${overlayId}.json`);
      writeJson(promotionPath, request);
      syncPromotionToWorkflow(root, request);
    }

    const lines = [];
    lines.push(`Construct activated ${domain} expertise for this request.`);
    lines.push(`Mode: ${permanence === 'temporary' ? 'temporary overlay' : 'promotion request + temporary overlay'}`);
    lines.push(`Attach to: ${classification.attachTo.join(', ')}`);
    lines.push(`Overlay: ${path.relative(cwd, overlayJsonPath)}`);
    if (attachedTaskKey) lines.push(`Workflow task: ${attachedTaskKey}`);
    if (promotionPath) lines.push(`Promotion request: ${path.relative(cwd, promotionPath)}`);
    if (expiresAt) lines.push(`Expires: ${expiresAt}`);
    process.stdout.write(`${lines.join('\n')}\n`);

    return { overlay, overlayJsonPath, overlayMdPath, promotionPath };
  } finally {
    rl?.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runHeadhunt({ args: process.argv.slice(2) }).catch((error) => {
    process.stderr.write(`Error: ${error.message}\n`);
    process.exit(1);
  });
}
