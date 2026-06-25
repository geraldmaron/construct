/**
 * lib/config/source-targets.mjs — typed integration source targets in construct.config.json.
 *
 * Validates GitHub, Jira, Linear, and Slack selector records, merges legacy env
 * target lists additively, deduplicates by provider+selector signature, and
 * converts resolved targets into embed provider source records for auto-discovery.
 */

export const SOURCE_PROVIDERS = Object.freeze(['github', 'jira', 'linear', 'slack']);

export const SLACK_INTENTS = Object.freeze(['internal', 'risk', 'decision', 'external', 'how-to']);

const ID_RE = /^[a-z][a-z0-9_-]{0,63}$/i;
const GITHUB_REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const JIRA_PROJECT_RE = /^[A-Z][A-Z0-9]{1,9}$/;

export function validateSourceTarget(target, index = 0) {
  const errors = [];
  const at = `sources.targets[${index}]`;

  if (!target || typeof target !== 'object' || Array.isArray(target)) {
    return [`${at}: must be an object`];
  }

  if (typeof target.id !== 'string' || !ID_RE.test(target.id)) {
    errors.push(`${at}.id: required stable id (letters, numbers, hyphens, underscores; max 64 chars)`);
  }

  if (!SOURCE_PROVIDERS.includes(target.provider)) {
    errors.push(`${at}.provider: must be one of ${SOURCE_PROVIDERS.join(', ')}`);
  }

  if (!target.selector || typeof target.selector !== 'object' || Array.isArray(target.selector)) {
    errors.push(`${at}.selector: required object`);
    return errors;
  }

  const sel = target.selector;
  switch (target.provider) {
    case 'github':
      if (typeof sel.repo !== 'string' || !GITHUB_REPO_RE.test(sel.repo.trim())) {
        errors.push(`${at}.selector.repo: required owner/repo slug`);
      }
      break;
    case 'jira':
      if (typeof sel.project !== 'string' || !JIRA_PROJECT_RE.test(sel.project.trim().toUpperCase())) {
        errors.push(`${at}.selector.project: required Jira project key (2–10 uppercase letters/digits)`);
      }
      break;
    case 'linear':
      if (typeof sel.team !== 'string' || !sel.team.trim()) {
        errors.push(`${at}.selector.team: required Linear team key or name`);
      }
      break;
    case 'slack': {
      if (typeof sel.channel !== 'string' || !sel.channel.trim()) {
        errors.push(`${at}.selector.channel: required Slack channel name or ID`);
      }
      if (sel.intent !== undefined && !SLACK_INTENTS.includes(sel.intent)) {
        errors.push(`${at}.selector.intent: must be one of ${SLACK_INTENTS.join(', ')}`);
      }
      break;
    }
    default:
      break;
  }

  return errors;
}

export function validateSourceTargets(targets) {
  const errors = [];
  if (targets === undefined) return errors;
  if (!Array.isArray(targets)) {
    return ['sources.targets: must be an array'];
  }

  const seenIds = new Set();
  for (let i = 0; i < targets.length; i++) {
    errors.push(...validateSourceTarget(targets[i], i));
    const id = targets[i]?.id;
    if (typeof id === 'string') {
      const key = id.toLowerCase();
      if (seenIds.has(key)) {
        errors.push(`sources.targets[${i}].id: duplicate id "${id}"`);
      }
      seenIds.add(key);
    }
  }
  return errors;
}

function parseCsv(value) {
  return String(value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function slugId(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function parseSlackChannelEntry(raw) {
  const trimmed = String(raw).trim().replace(/^#/, '');
  const colon = trimmed.indexOf(':');
  if (colon === -1) {
    return { channel: trimmed, intent: 'internal' };
  }
  return { channel: trimmed.slice(0, colon), intent: trimmed.slice(colon + 1) || 'internal' };
}

export function legacyEnvSourceTargets(env = process.env) {
  const targets = [];

  for (const repo of parseCsv(env.GITHUB_REPOS ?? env.GITHUB_REPO)) {
    targets.push({
      id: `env-github-${slugId(repo)}`,
      provider: 'github',
      selector: { repo },
      provenance: 'env:GITHUB_REPOS',
    });
  }

  for (const project of parseCsv(env.JIRA_PROJECTS)) {
    const key = project.toUpperCase();
    targets.push({
      id: `env-jira-${slugId(key)}`,
      provider: 'jira',
      selector: { project: key },
      provenance: 'env:JIRA_PROJECTS',
    });
  }

  for (const team of parseCsv(env.LINEAR_TEAMS)) {
    targets.push({
      id: `env-linear-${slugId(team)}`,
      provider: 'linear',
      selector: { team },
      provenance: 'env:LINEAR_TEAMS',
    });
  }

  for (const entry of parseCsv(env.SLACK_CHANNELS ?? env.SLACK_CHANNEL)) {
    const { channel, intent } = parseSlackChannelEntry(entry);
    targets.push({
      id: `env-slack-${slugId(channel)}`,
      provider: 'slack',
      selector: { channel, intent: SLACK_INTENTS.includes(intent) ? intent : 'internal' },
      provenance: 'env:SLACK_CHANNELS',
    });
  }

  return targets;
}

export function targetSignature(target) {
  const sel = target.selector ?? {};
  switch (target.provider) {
    case 'github':
      return `github:repo:${sel.repo?.trim().toLowerCase()}`;
    case 'jira':
      return `jira:project:${String(sel.project ?? '').trim().toUpperCase()}`;
    case 'linear':
      return `linear:team:${String(sel.team ?? '').trim().toLowerCase()}`;
    case 'slack':
      return `slack:channel:${String(sel.channel ?? '').trim().toLowerCase()}:intent:${sel.intent ?? 'internal'}`;
    default:
      return `${target.provider}:${JSON.stringify(sel)}`;
  }
}

export function mergeSourceTargets(configTargets = [], envTargets = []) {
  const merged = [];
  const seen = new Set();

  for (const target of [...configTargets, ...envTargets]) {
    const sig = targetSignature(target);
    if (seen.has(sig)) continue;
    seen.add(sig);
    merged.push(target);
  }
  return merged;
}

export function normalizeConfigTarget(raw) {
  const out = {
    id: String(raw.id).trim(),
    provider: raw.provider,
    selector: { ...raw.selector },
    provenance: raw.provenance ?? 'config',
  };

  if (out.provider === 'jira' && out.selector.project) {
    out.selector.project = String(out.selector.project).trim().toUpperCase();
  }
  if (out.provider === 'github' && out.selector.repo) {
    out.selector.repo = String(out.selector.repo).trim();
  }
  if (out.provider === 'linear' && out.selector.team) {
    out.selector.team = String(out.selector.team).trim();
  }
  if (out.provider === 'slack' && out.selector.channel) {
    out.selector.channel = String(out.selector.channel).trim().replace(/^#/, '');
    if (!out.selector.intent) out.selector.intent = 'internal';
  }
  return out;
}

export function resolveEffectiveSourceTargetsFromConfig(config, env = process.env) {
  const configTargets = (config?.sources?.targets ?? []).map(normalizeConfigTarget);
  const envTargets = legacyEnvSourceTargets(env);
  return mergeSourceTargets(configTargets, envTargets);
}

export function targetsToEmbedSources(targets) {
  const sources = [];
  const githubRepos = targets.filter((t) => t.provider === 'github').map((t) => t.selector.repo);
  if (githubRepos.length) {
    sources.push({
      provider: 'github',
      repos: githubRepos,
      refs: ['prs', 'issues', 'commits'],
      limit: 25,
    });
    sources.push({
      provider: 'github',
      repos: githubRepos,
      refs: ['meta', 'readme', 'docs'],
      limit: 25,
    });
  }

  for (const target of targets.filter((t) => t.provider === 'jira')) {
    sources.push({
      provider: 'jira',
      project: target.selector.project,
      refs: ['issues'],
      limit: 50,
    });
  }

  for (const target of targets.filter((t) => t.provider === 'linear')) {
    sources.push({
      provider: 'linear',
      team: target.selector.team,
      refs: ['issues'],
      limit: 50,
    });
  }

  const slackByIntent = new Map();
  for (const target of targets.filter((t) => t.provider === 'slack')) {
    const intent = target.selector.intent ?? 'internal';
    if (!slackByIntent.has(intent)) slackByIntent.set(intent, []);
    slackByIntent.get(intent).push(target.selector.channel);
  }
  for (const [intent, channels] of slackByIntent) {
    sources.push({
      provider: 'slack',
      channels,
      intent,
      refs: ['messages'],
      oldest: 86400,
      limit: 50,
    });
  }

  return sources;
}

export function resolveKnownSourcesFromTargets(targets) {
  const sources = [];

  for (const target of targets) {
    const sel = target.selector ?? {};
    if (target.provider === 'github' && sel.repo) {
      const repo = sel.repo;
      const short = repo.split('/').pop();
      sources.push({ id: repo.toLowerCase(), provider: 'github', ref: repo, display: repo, targetId: target.id });
      sources.push({ id: short.toLowerCase(), provider: 'github', ref: repo, display: repo, targetId: target.id });
      sources.push({ id: short.replace(/-/g, '').toLowerCase(), provider: 'github', ref: repo, display: repo, targetId: target.id });
      const words = short.split('-');
      if (words.length > 1) {
        sources.push({ id: words[words.length - 1].toLowerCase(), provider: 'github', ref: repo, display: repo, targetId: target.id });
      }
    }
    if (target.provider === 'jira' && sel.project) {
      const key = sel.project;
      sources.push({ id: key.toLowerCase(), provider: 'jira', ref: key, display: `Jira/${key}`, targetId: target.id });
    }
    if (target.provider === 'linear' && sel.team) {
      const team = sel.team;
      sources.push({ id: team.toLowerCase(), provider: 'linear', ref: team, display: `Linear/${team}`, targetId: target.id });
    }
    if (target.provider === 'slack' && sel.channel) {
      const ch = sel.channel;
      sources.push({ id: ch.toLowerCase(), provider: 'slack', ref: ch, display: `Slack/${ch}`, targetId: target.id });
    }
  }

  const providers = new Set(targets.map((t) => t.provider));
  if (providers.has('jira')) {
    sources.push({ id: 'jira', provider: 'jira', ref: null, display: 'Jira' });
  }
  if (providers.has('linear')) {
    sources.push({ id: 'linear', provider: 'linear', ref: null, display: 'Linear' });
  }

  return sources;
}

// Team bindings take precedence over project config, which takes precedence over
// legacy env. Resolution is by typed selector signature — no substring guessing —
// so a team's effective sources are stable and conflict-free.

export function resolveTeamSources(teamId, { registry, config, env = process.env } = {}) {
  const team = registry?.teams?.[teamId];
  const teamTargets = Array.isArray(team?.sources)
    ? team.sources.map((s) => ({
        ...normalizeConfigTarget(s),
        provenance: `team:${teamId}`,
        ...(s.filters && typeof s.filters === 'object' ? { filters: s.filters } : {}),
      }))
    : [];
  const configTargets = (config?.sources?.targets ?? []).map(normalizeConfigTarget);
  const envTargets = legacyEnvSourceTargets(env);
  return mergeSourceTargets(teamTargets, mergeSourceTargets(configTargets, envTargets));
}

// Per-target embed records that honor each target's own filters (jira jql,
// github refs/limit, slack oldest) and tag the record with the owning teamId and
// targetId so observations stay retrievable by team scope rather than a global
// pool. Falls back to the same defaults as targetsToEmbedSources when a target
// declares no filters.

export function targetsToEmbedSourcesWithFilters(targets, { teamId = null } = {}) {
  const sources = [];
  const tag = (rec, target) => ({
    ...rec,
    ...(teamId ? { teamId } : {}),
    targetId: target.id,
  });

  for (const target of targets) {
    const f = target.filters ?? {};
    const sel = target.selector ?? {};
    switch (target.provider) {
      case 'github':
        sources.push(tag({
          provider: 'github',
          repos: [sel.repo],
          refs: Array.isArray(f.refs) ? f.refs : ['prs', 'issues', 'commits'],
          limit: Number.isInteger(f.limit) ? f.limit : 25,
        }, target));
        break;
      case 'jira':
        sources.push(tag({
          provider: 'jira',
          project: sel.project,
          refs: ['issues'],
          ...(typeof f.jql === 'string' ? { jql: f.jql } : {}),
          limit: Number.isInteger(f.limit) ? f.limit : 50,
        }, target));
        break;
      case 'linear':
        sources.push(tag({
          provider: 'linear',
          team: sel.team,
          refs: ['issues'],
          ...(Array.isArray(f.states) ? { states: f.states } : {}),
          limit: Number.isInteger(f.limit) ? f.limit : 50,
        }, target));
        break;
      case 'slack':
        sources.push(tag({
          provider: 'slack',
          channels: [sel.channel],
          intent: sel.intent ?? 'internal',
          refs: ['messages'],
          oldest: Number.isInteger(f.oldest) ? f.oldest : 86400,
          limit: Number.isInteger(f.limit) ? f.limit : 50,
        }, target));
        break;
      default:
        break;
    }
  }

  return sources;
}
