/**
 * lib/integrations/intake-integrations.mjs — External system integrations
 * for intake packets and artifacts.
 *
 * Creates GitHub Issues, Jira tickets, and Confluence pages from intake
 * packets and Construct artifacts. Each integration is optional and
 * configured via env vars or embed.yaml.
 *
 * Integrations:
 *   - GitHub Issues: requires GITHUB_TOKEN + GITHUB_REPO (owner/repo)
 *   - Jira: requires JIRA_HOST + JIRA_USER + JIRA_API_TOKEN + JIRA_PROJECT
 *   - Confluence: requires CONFLUENCE_HOST + CONFLUENCE_USER + CONFLUENCE_API_TOKEN + CONFLUENCE_SPACE
 *
 * All operations return { ok, externalUrl, externalId, error? }.
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { configPath, CONFIG_DIR_NAME } from '../config-dir.mjs';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { configDir } from '../config/xdg.mjs';
import { resolveOpRef, hasSecret, hasAnySecret, peekRawCredential } from '../providers/secret-resolver.mjs';

// ── Multi-method auth helpers ────────────────────────────────────────────

/**
 * Resolve GitHub credentials using multiple methods (in priority order):
 *   1. `gh` CLI (already authenticated via gh auth)
 *   2. GITHUB_TOKEN env var / .env / config.env / shell rc
 *   3. 1Password op:// refs in shell rc files
 *
 * Returns { token, repo, method } or { token: null }.
 */
function resolveGitHubAuth(homeDir) {
  // Method 1: gh CLI
  try {
    const status = spawnSync('gh', ['auth', 'status'], { encoding: 'utf8', timeout: 5000 });
    if (status.status === 0) {
      // gh is authenticated — resolve the repo from env or gh itself
      let repo = process.env.GITHUB_REPO || resolveCredentialSync('GITHUB_REPO', homeDir);
      if (!repo) {
        // Try to get the default remote from gh
        const remote = spawnSync('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'], { encoding: 'utf8', timeout: 5000 });
        if (remote.status === 0 && remote.stdout?.trim()) {
          repo = remote.stdout.trim();
        }
      }
      return { token: 'gh-cli', repo, method: 'gh' };
    }
  } catch { /* gh not available */ }

  // Method 2: Env vars (includes .env, config.env, shell rc via resolveCredentialSync)
  const envToken = resolveCredentialSync('GITHUB_TOKEN', homeDir) || resolveCredentialSync('GH_TOKEN', homeDir);
  const envRepo = process.env.GITHUB_REPO || resolveCredentialSync('GITHUB_REPO', homeDir);
  if (envToken && envRepo) {
    return { token: envToken, repo: envRepo, method: 'env' };
  }

  // Token found but no repo
  if (envToken) {
    return { token: envToken, repo: null, method: 'env' };
  }

  return { token: null, repo: null, method: null };
}

/**
 * Resolve Jira credentials (env → .env → config.env → shell rc → 1Password).
 */
function resolveJiraAuth(homeDir) {
  return {
    host: resolveCredentialSync('JIRA_HOST', homeDir) || process.env.JIRA_HOST,
    email: resolveCredentialSync('JIRA_USER', homeDir) || process.env.JIRA_USER,
    token: resolveCredentialSync('JIRA_API_TOKEN', homeDir),
    project: resolveCredentialSync('JIRA_PROJECT', homeDir) || process.env.JIRA_PROJECT,
  };
}

/**
 * Resolve Confluence credentials (env → .env → config.env → shell rc → 1Password).
 */
function resolveConfluenceAuth(homeDir) {
  return {
    host: resolveCredentialSync('CONFLUENCE_HOST', homeDir) || process.env.CONFLUENCE_HOST,
    email: resolveCredentialSync('CONFLUENCE_USER', homeDir) || process.env.CONFLUENCE_USER,
    token: resolveCredentialSync('CONFLUENCE_API_TOKEN', homeDir),
    space: resolveCredentialSync('CONFLUENCE_SPACE', homeDir) || process.env.CONFLUENCE_SPACE,
  };
}

/**
 * Resolve Linear credentials (env → .env → config.env → shell rc → 1Password).
 */
function resolveLinearAuth(homeDir) {
  return {
    token: resolveCredentialSync('LINEAR_API_TOKEN', homeDir),
    teamId: resolveCredentialSync('LINEAR_TEAM_ID', homeDir) || process.env.LINEAR_TEAM_ID,
  };
}

/**
 * Resolve Slack credentials (env → .env → config.env → shell rc → 1Password).
 */
function resolveSlackAuth(homeDir) {
  return {
    token: resolveCredentialSync('SLACK_BOT_TOKEN', homeDir),
    channel: resolveCredentialSync('SLACK_CHANNEL', homeDir) || process.env.SLACK_CHANNEL,
  };
}

// ── GitHub Issues ────────────────────────────────────────────────────────

// A packet that originated from a demo/fixture/inbox-test source must not
// be published to a real GitHub repo. The caller can override via
// `publishDemo: true` when the demo run is intentional (e.g. an explicit
// integration test that creates and then deletes the issue). Default-safe.

export function isDemoIntakePacket(packet) {
  if (process.env.CONSTRUCT_DEMO === '1') return true;
  if (process.env.CONSTRUCT_INTAKE_DEMO === '1') return true;
  const sourcePath = String(packet?.intake?.sourcePath || packet?.sourcePath || '');
  if (!sourcePath) return false;
  if (sourcePath.includes('/tests/fixtures/')) return true;
  if (sourcePath.includes(`/${CONFIG_DIR_NAME}/intake/demo/`)) return true;
  if (sourcePath.includes('/cx-intake-demo')) return true;
  return false;
}

/**
 * Create a GitHub issue from an intake packet.
 *
 * @param {object} packet - Intake packet with triage, excerpt
 * @param {object} [opts]
 * @param {string} [opts.repo] - owner/repo (default: GITHUB_REPO env)
 * @param {string} [opts.token] - GitHub PAT (default: GITHUB_TOKEN env)
 * @param {string} [opts.apiUrl] - GitHub API URL (default: api.github.com)
 * @param {string} [opts.host] - GitHub host (default: github.com)
 * @param {object} [opts.fetchImpl]
 * @param {boolean} [opts.publishDemo] - Override the demo-source gate
 * @returns {Promise<{ ok: boolean, externalUrl: string|null, externalId: string|null, error?: string, skipped?: string }>}
 */
export async function createGitHubIssue(packet, { repo, token, apiUrl, host, fetchImpl = globalThis.fetch, publishDemo = false } = {}) {
  if (!publishDemo && isDemoIntakePacket(packet)) {
    return {
      ok: false,
      externalUrl: null,
      externalId: null,
      skipped: 'demo-source',
      error: 'Refused to publish: packet originated from a demo/fixture path (set CONSTRUCT_DEMO=0 and re-run with --publish-issues to override).',
    };
  }
  const hd = homedir();
  const auth = resolveGitHubAuth(hd);
  const resolvedRepo = repo || auth.repo || process.env.GITHUB_REPO;
  const resolvedToken = token || (auth.method === 'env' ? auth.token : null);
  const useGhCli = auth.method === 'gh';
  const resolvedApi = apiUrl || process.env.GITHUB_API_URL || 'https://api.github.com';

  if (!resolvedRepo) return { ok: false, externalUrl: null, externalId: null, error: 'No repo found. Set GITHUB_REPO or run `gh repo view` to detect.' };
  if (!resolvedToken && !useGhCli) return { ok: false, externalUrl: null, externalId: null, error: 'No GitHub auth found. Try: gh auth login, or set GITHUB_TOKEN.' };

  const t = packet?.triage || {};
  const title = buildGitHubTitle(packet);
  const body = buildGitHubBody(packet);
  const labels = buildLabels(t);

  // Method 1: gh CLI (no token needed, labels skipped to avoid missing-label errors)
  if (useGhCli) {
    try {
      const result = spawnSync('gh', [
        'issue', 'create',
        '--repo', resolvedRepo,
        '--title', title,
        '--body', body,
      ], { encoding: 'utf8', timeout: 15000 });

      if (result.status === 0) {
        const url = result.stdout?.trim();
        const number = url?.split('/').pop();
        return {
          ok: true,
          externalUrl: url,
          externalId: number || url,
        };
      }
      // gh failed — fall through to API method
      const stderr = (result.stderr || '').slice(0, 200);
      if (stderr) process.stderr.write(`[integrations] gh issue create failed: ${stderr}\n`);
    } catch (err) {
      process.stderr.write(`[integrations] gh CLI error: ${err.message}\n`);
    }
  }

  // Method 2: REST API with token
  if (resolvedToken) {
    try {
      const res = await fetchImpl(`${resolvedApi}/repos/${resolvedRepo}/issues`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resolvedToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/vnd.github.v3+json',
        },
        body: JSON.stringify({ title, body, labels }),
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        return { ok: false, externalUrl: null, externalId: null, error: `GitHub API ${res.status}: ${detail.slice(0, 200)}` };
      }

      const json = await res.json();
      return { ok: true, externalUrl: json.html_url, externalId: String(json.number) };
    } catch (err) {
      return { ok: false, externalUrl: null, externalId: null, error: err.message };
    }
  }

  return { ok: false, externalUrl: null, externalId: null, error: 'All auth methods exhausted' };
}

function buildGitHubTitle(packet) {
  const t = packet?.triage || {};
  const prefix = t.intakeType ? `[${t.intakeType}] ` : '';
  const source = packet?.intake?.sourcePath?.split('/')?.pop() || 'intake signal';
  const excerpt = packet?.excerpt?.slice(0, 80)?.replace(/\n/g, ' ')?.trim() || '';
  return `${prefix}${excerpt || source}`.slice(0, 256);
}

function buildGitHubBody(packet) {
  const lines = [];
  lines.push('<!-- Auto-created from Construct intake -->');
  lines.push('');
  if (packet?.id) lines.push(`**Intake ID:** \`${packet.id}\``);
  if (packet?.intake?.sourcePath) lines.push(`**Source:** \`${packet.intake.sourcePath}\``);
  lines.push('');

  const t = packet?.triage || {};
  if (t.intakeType) lines.push(`**Type:** ${t.intakeType}`);
  if (t.rdStage) lines.push(`**Stage:** ${t.rdStage}`);
  if (t.primaryOwner) lines.push(`**Owner:** ${t.primaryOwner}`);
  if (t.recommendedAction) lines.push(`**Recommended action:** ${t.recommendedAction}`);
  if (t.risk) lines.push(`**Risk:** ${t.risk}`);
  lines.push('');

  if (packet?.excerpt) {
    lines.push('## Signal content');
    lines.push('');
    lines.push(packet.excerpt.slice(0, 3000));
    lines.push('');
  }

  if (packet?.related?.length) {
    lines.push('## Related artifacts');
    for (const r of packet.related) {
      lines.push(`- ${r.path || r.title}${r.score ? ` (score: ${r.score.toFixed(2)})` : ''}`);
    }
  }

  return lines.join('\n');
}

function buildLabels(t) {
  const labels = ['construct-intake'];
  if (t.intakeType) labels.push(t.intakeType);
  if (t.risk) labels.push(`risk-${t.risk}`);
  return labels;
}

// ── Jira ─────────────────────────────────────────────────────────────────

/**
 * Create a Jira work item from an intake packet.
 *
 * @param {object} packet - Intake packet with triage, excerpt
 * @param {object} [opts]
 * @param {string} [opts.host] - Jira host (default: JIRA_HOST env)
 * @param {string} [opts.email] - Jira user email (default: JIRA_USER env)
 * @param {string} [opts.token] - Jira API token (default: JIRA_API_TOKEN env)
 * @param {string} [opts.project] - Jira project key (default: JIRA_PROJECT env)
 * @param {string} [opts.issueType] - Issue type (default: Task)
 * @param {object} [opts.fetchImpl]
 * @returns {Promise<{ ok: boolean, externalUrl: string|null, externalId: string|null, error?: string }>}
 */
export async function createJiraTicket(packet, { host, email, token, project, issueType = 'Task', fetchImpl = globalThis.fetch } = {}) {
  const hd = homedir();
  const auth = resolveJiraAuth(hd);
  const resolvedHost = host || auth.host || process.env.JIRA_HOST;
  const resolvedEmail = email || auth.email || process.env.JIRA_USER;
  const resolvedToken = token || auth.token || process.env.JIRA_API_TOKEN;
  const resolvedProject = project || auth.project || process.env.JIRA_PROJECT;

  if (!resolvedHost) return { ok: false, externalUrl: null, externalId: null, error: 'JIRA_HOST not set (e.g. https://your-domain.atlassian.net). Check ~/.config/construct/config.env or shell rc.' };
  if (!resolvedEmail || !resolvedToken) return { ok: false, externalUrl: null, externalId: null, error: 'JIRA_USER and JIRA_API_TOKEN required. Check ~/.config/construct/config.env, ~/.env, or 1Password.' };
  if (!resolvedProject) return { ok: false, externalUrl: null, externalId: null, error: 'JIRA_PROJECT not set (e.g. PROJ)' };

  const t = packet?.triage || {};
  const jiraAuthHeader = Buffer.from(`${resolvedEmail}:${resolvedToken}`).toString('base64');
  const summary = buildJiraSummary(packet);
  const description = buildJiraDescription(packet);

  try {
    const res = await fetchImpl(`${resolvedHost.replace(/\/$/, '')}/rest/api/2/issue`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${jiraAuthHeader}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fields: {
          project: { key: resolvedProject },
          summary: summary.slice(0, 255),
          description,
          issuetype: { name: issueType },
          labels: buildLabels(t),
        },
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return { ok: false, externalUrl: null, externalId: null, error: `Jira API ${res.status}: ${detail.slice(0, 200)}` };
    }

    const json = await res.json();

    // Browse URL is absent from the create response — construct from host + issue key
    const issueKey = json.key;
    const browseUrl = `${resolvedHost.replace(/\/$/, '')}/browse/${issueKey}`;

    return {
      ok: true,
      externalUrl: browseUrl,
      externalId: issueKey,
    };
  } catch (err) {
    return { ok: false, externalUrl: null, externalId: null, error: err.message };
  }
}

function buildJiraSummary(packet) {
  const t = packet?.triage || {};
  const prefix = t.intakeType ? `[${t.intakeType}] ` : '';
  const excerpt = packet?.excerpt?.slice(0, 80)?.replace(/\n/g, ' ')?.trim() || packet?.id || 'Intake signal';
  return `${prefix}${excerpt}`.slice(0, 255);
}

function buildJiraDescription(packet) {
  const lines = [];
  lines.push('h3. Auto-created from Construct intake');
  lines.push('');

  if (packet?.id) lines.push(`* Intake ID: ${packet.id}`);
  if (packet?.intake?.sourcePath) lines.push(`* Source: ${packet.intake.sourcePath}`);
  lines.push('');

  const t = packet?.triage || {};
  if (t.intakeType) lines.push(`* Type: ${t.intakeType}`);
  if (t.rdStage) lines.push(`* Stage: ${t.rdStage}`);
  if (t.primaryOwner) lines.push(`* Owner: ${t.primaryOwner}`);
  if (t.recommendedAction) lines.push(`* Recommended action: ${t.recommendedAction}`);
  if (t.rationale) lines.push(`* Rationale: ${t.rationale}`);
  lines.push('');

  if (packet?.excerpt) {
    lines.push('h3. Signal content');
    lines.push('{noformat}');
    lines.push(packet.excerpt.slice(0, 3000));
    lines.push('{noformat}');
  }

  if (packet?.related?.length) {
    lines.push('h3. Related artifacts');
    for (const r of packet.related) {
      lines.push(`* ${r.path || r.title}`);
    }
  }

  return lines.join('\n');
}

// ── Confluence ───────────────────────────────────────────────────────────

/**
 * Publish a Construct artifact (PRD/ADR/RFC) as a Confluence page.
 *
 * @param {object} artifact - Artifact metadata + content
 * @param {string} artifact.type - 'prd' | 'adr' | 'rfc'
 * @param {number} artifact.number - Artifact sequence number
 * @param {string} artifact.title - Artifact title
 * @param {string} artifact.content - Full markdown content
 * @param {string} [artifact.path] - File path for source ref
 * @param {object} [opts]
 * @param {string} [opts.host] - Confluence host (default: CONFLUENCE_HOST env)
 * @param {string} [opts.email] - Confluence user (default: CONFLUENCE_USER env)
 * @param {string} [opts.token] - Confluence API token (default: CONFLUENCE_API_TOKEN env)
 * @param {string} [opts.space] - Confluence space key (default: CONFLUENCE_SPACE env)
 * @param {string} [opts.parentId] - Optional parent page ID
 * @param {object} [opts.fetchImpl]
 * @returns {Promise<{ ok: boolean, externalUrl: string|null, externalId: string|null, error?: string }>}
 */
export async function publishArtifactToConfluence(artifact, { host, email, token, space, parentId, fetchImpl = globalThis.fetch } = {}) {
  const hd = homedir();
  const auth = resolveConfluenceAuth(hd);
  const resolvedHost = host || auth.host || process.env.CONFLUENCE_HOST;
  const resolvedEmail = email || auth.email || process.env.CONFLUENCE_USER;
  const resolvedToken = token || auth.token || process.env.CONFLUENCE_API_TOKEN;
  const resolvedSpace = space || auth.space || process.env.CONFLUENCE_SPACE;

  if (!resolvedHost) return { ok: false, externalUrl: null, externalId: null, error: 'CONFLUENCE_HOST not set (e.g. https://your-domain.atlassian.net/wiki). Check ~/.config/construct/config.env or shell rc.' };
  if (!resolvedEmail || !resolvedToken) return { ok: false, externalUrl: null, externalId: null, error: 'CONFLUENCE_USER and CONFLUENCE_API_TOKEN required. Check ~/.config/construct/config.env, ~/.env, or 1Password.' };
  if (!resolvedSpace) return { ok: false, externalUrl: null, externalId: null, error: 'CONFLUENCE_SPACE not set (e.g. PROD)' };

  const prefix = { prd: 'PRD', adr: 'ADR', rfc: 'RFC' }[artifact.type] || artifact.type.toUpperCase();
  const pageTitle = `${prefix}-${String(artifact.number).padStart(4, '0')}: ${artifact.title}`;

  // Convert basic markdown to Confluence storage format
  const storage = markdownToConfluenceStorage(artifact.content);

  try {
    const res = await fetchImpl(`${resolvedHost.replace(/\/$/, '')}/rest/api/content`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${resolvedEmail}:${resolvedToken}`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'page',
        title: pageTitle,
        space: { key: resolvedSpace },
        ...(parentId ? { ancestors: [{ id: parentId }] } : {}),
        body: {
          storage: {
            value: storage,
            representation: 'storage',
          },
        },
        metadata: {
          labels: [{ prefix: 'construct', name: `artifact-${artifact.type}` }],
        },
      }),
    });

    if (!res.ok) {
      // Check if page already exists (409 = conflict)
      if (res.status === 409) {
        return await updateConfluencePage(artifact, { host: resolvedHost, email: resolvedEmail, token: resolvedToken, space: resolvedSpace, fetchImpl });
      }
      const detail = await res.text().catch(() => '');
      return { ok: false, externalUrl: null, externalId: null, error: `Confluence API ${res.status}: ${detail.slice(0, 200)}` };
    }

    const json = await res.json();
    return {
      ok: true,
      externalUrl: `${resolvedHost.replace(/\/$/, '')}/spaces/${resolvedSpace}/pages/${json.id}`,
      externalId: json.id,
    };
  } catch (err) {
    return { ok: false, externalUrl: null, externalId: null, error: err.message };
  }
}

async function updateConfluencePage(artifact, { host, email, token, space, fetchImpl }) {
  const prefix = { prd: 'PRD', adr: 'ADR', rfc: 'RFC' }[artifact.type] || artifact.type.toUpperCase();
  const pageTitle = `${prefix}-${String(artifact.number).padStart(4, '0')}: ${artifact.title}`;
  const auth = Buffer.from(`${email}:${token}`).toString('base64');
  const baseUrl = host.replace(/\/$/, '');

  try {
    // Find existing page by title
    const searchRes = await fetchImpl(`${baseUrl}/rest/api/content?title=${encodeURIComponent(pageTitle)}&spaceKey=${space}`, {
      headers: { Authorization: `Basic ${auth}` },
    });
    if (!searchRes.ok) {
      return { ok: false, externalUrl: null, externalId: null, error: `Confluence search failed: ${searchRes.status}` };
    }
    const searchJson = await searchRes.json();
    const existing = searchJson.results?.[0];
    if (!existing) {
      return { ok: false, externalUrl: null, externalId: null, error: 'Page creation conflict but could not find existing page' };
    }

    // Update the existing page
    const storage = markdownToConfluenceStorage(artifact.content);
    const updateRes = await fetchImpl(`${baseUrl}/rest/api/content/${existing.id}`, {
      method: 'PUT',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        id: existing.id,
        type: 'page',
        title: pageTitle,
        version: { number: existing.version.number + 1 },
        body: {
          storage: {
            value: storage,
            representation: 'storage',
          },
        },
      }),
    });

    if (!updateRes.ok) {
      const detail = await updateRes.text().catch(() => '');
      return { ok: false, externalUrl: null, externalId: null, error: `Confluence update ${updateRes.status}: ${detail.slice(0, 200)}` };
    }

    const json = await updateRes.json();
    return {
      ok: true,
      externalUrl: `${baseUrl}/spaces/${space}/pages/${json.id}`,
      externalId: json.id,
      updated: true,
    };
  } catch (err) {
    return { ok: false, externalUrl: null, externalId: null, error: err.message };
  }
}

/**
 * Converts the subset of markdown common to Construct artifacts into
 * Confluence storage format.
 */
function markdownToConfluenceStorage(md) {
  if (!md) return '';

  let html = md
    // Headers
    .replace(/^###### (.+)$/gm, '<h6>$1</h6>')
    .replace(/^##### (.+)$/gm, '<h5>$1</h5>')
    .replace(/^#### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    // Bold and italic
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Inline code
    .replace(/`(.+?)`/g, '<code>$1</code>')
    // Horizontal rule
    .replace(/^---$/gm, '<hr/>')
    // Tables (simplified)
    .replace(/^\|(.+)\|$/gm, (match) => {
      const cells = match.split('|').filter(c => c.trim()).map(c => `<td>${c.trim()}</td>`).join('');
      // Check if this is a header row (next row has ---)
      return `<tr>${cells}</tr>`;
    })
    // Unordered lists
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    // Paragraphs (double newlines)
    .replace(/\n\n/g, '</p><p>')
    // Line breaks within paragraphs
    .replace(/\n/g, '<br/>');

  // Wrap consecutive <li> in <ul>
  html = html.replace(/(<li>.*?<\/li>)(\s*<li>.*?<\/li>)*/g, (match) => {
    return `<ul>${match}</ul>`;
  });

  // Wrap tables
  const tableRows = html.match(/(<tr>.*?<\/tr>\s*)+/g);
  if (tableRows) {
    for (const rows of tableRows) {
      const headerClass = rows.includes('**') ? ' class="confluenceTable"' : '';
      html = html.replace(rows, `<table${headerClass}>${rows}</table>`);
    }
  }

  // Code blocks
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<ac:structured-macro ac:name="code"><ac:parameter ac:name="language">$1</ac:parameter><ac:plain-text-body><![CDATA[$2]]></ac:plain-text-body></ac:structured-macro>');

  // Front-matter (remove)
  html = html.replace(/^---[\s\S]*?---\n*/, '');

  return `<p>${html}</p>`;
}

// ── Linear ───────────────────────────────────────────────────────────────

/**
 * Create a Linear issue from an intake packet.
 *
 * @param {object} packet - Intake packet with triage, excerpt
 * @param {object} [opts]
 * @param {string} [opts.token] - Linear API token (default: LINEAR_API_TOKEN env)
 * @param {string} [opts.teamId] - Linear team ID (default: LINEAR_TEAM_ID env)
 * @param {object} [opts.fetchImpl]
 * @param {boolean} [opts.publishDemo] - Override the demo-source gate
 * @returns {Promise<{ ok: boolean, externalUrl: string|null, externalId: string|null, error?: string, skipped?: string }>}
 */
export async function createLinearIssue(packet, { token, teamId, fetchImpl = globalThis.fetch, publishDemo = false } = {}) {
  if (process.env.CONSTRUCT_LINEAR_WRITES !== '1') {
    return {
      ok: false,
      externalUrl: null,
      externalId: null,
      skipped: 'disabled',
      error: 'Linear writes are disabled by default. Set CONSTRUCT_LINEAR_WRITES=1 to enable.',
    };
  }
  if (!publishDemo && isDemoIntakePacket(packet)) {
    return {
      ok: false,
      externalUrl: null,
      externalId: null,
      skipped: 'demo-source',
      error: 'Refused to publish: packet originated from a demo/fixture path (set CONSTRUCT_DEMO=0 and re-run with --publish-issues to override).',
    };
  }
  const hd = homedir();
  const auth = resolveLinearAuth(hd);
  const resolvedToken = token || auth.token;
  const resolvedTeamId = teamId || auth.teamId;

  if (!resolvedToken) return { ok: false, externalUrl: null, externalId: null, error: 'LINEAR_API_TOKEN not set. Check ~/.config/construct/config.env, ~/.env, or 1Password.' };
  if (!resolvedTeamId) return { ok: false, externalUrl: null, externalId: null, error: 'LINEAR_TEAM_ID not set. Set LINEAR_TEAM_ID env or in ~/.config/construct/config.env.' };

  const title = buildLinearTitle(packet);
  const description = buildLinearDescription(packet);

  const query = `
    mutation CreateIssue($input: IssueCreateInput!) {
      issueCreate(input: $input) {
        issue {
          id
          identifier
          url
        }
      }
    }
  `;

  // IssueCreateInput.labelIds requires label UUIDs, which would need an extra
  // API lookup to resolve; the intake type is already surfaced in the title
  // prefix (buildLinearTitle) and the description (buildLinearDescription),
  // so no labelIds field is sent.

  const variables = {
    input: {
      teamId: resolvedTeamId,
      title: title.slice(0, 255),
      description,
    },
  };

  // Linear accepts two token forms: personal API keys (prefix `lin_api_`)
  // are sent bare in the Authorization header, while OAuth access tokens
  // use the standard `Bearer` scheme.

  const authHeader = resolvedToken.startsWith('lin_api_') ? resolvedToken : `Bearer ${resolvedToken}`;

  try {
    const res = await fetchImpl('https://api.linear.app/graphql', {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return { ok: false, externalUrl: null, externalId: null, error: `Linear API ${res.status}: ${detail.slice(0, 200)}` };
    }

    const json = await res.json();
    if (json.errors) {
      const errorMsg = json.errors[0]?.message || 'Unknown Linear error';
      return { ok: false, externalUrl: null, externalId: null, error: `Linear: ${errorMsg}` };
    }

    const issue = json.data?.issueCreate?.issue;
    if (!issue) {
      return { ok: false, externalUrl: null, externalId: null, error: 'Linear: No issue returned from creation' };
    }

    return {
      ok: true,
      externalUrl: issue.url,
      externalId: issue.identifier,
    };
  } catch (err) {
    return { ok: false, externalUrl: null, externalId: null, error: err.message };
  }
}

function buildLinearTitle(packet) {
  const t = packet?.triage || {};
  const prefix = t.intakeType ? `[${t.intakeType}] ` : '';
  const source = packet?.intake?.sourcePath?.split('/')?.pop() || 'intake signal';
  const excerpt = packet?.excerpt?.slice(0, 80)?.replace(/\n/g, ' ')?.trim() || '';
  return `${prefix}${excerpt || source}`.slice(0, 256);
}

function buildLinearDescription(packet) {
  const lines = [];
  lines.push('_Auto-created from Construct intake_');
  lines.push('');

  if (packet?.id) lines.push(`**Intake ID:** \`${packet.id}\``);
  if (packet?.intake?.sourcePath) lines.push(`**Source:** \`${packet.intake.sourcePath}\``);
  lines.push('');

  const t = packet?.triage || {};
  if (t.intakeType) lines.push(`**Type:** ${t.intakeType}`);
  if (t.rdStage) lines.push(`**Stage:** ${t.rdStage}`);
  if (t.primaryOwner) lines.push(`**Owner:** ${t.primaryOwner}`);
  if (t.recommendedAction) lines.push(`**Recommended action:** ${t.recommendedAction}`);
  if (t.risk) lines.push(`**Risk:** ${t.risk}`);
  lines.push('');

  if (packet?.excerpt) {
    lines.push('## Signal content');
    lines.push(packet.excerpt.slice(0, 3000));
  }

  return lines.join('\n');
}

// ── Slack ────────────────────────────────────────────────────────────────

/**
 * Post a Slack message with intake packet information.
 *
 * @param {object} packet - Intake packet with triage, excerpt
 * @param {object} [opts]
 * @param {string} [opts.token] - Slack bot token (default: SLACK_BOT_TOKEN env)
 * @param {string} [opts.channel] - Slack channel ID or name (default: SLACK_CHANNEL env)
 * @param {object} [opts.fetchImpl]
 * @param {boolean} [opts.publishDemo] - Override the demo-source gate
 * @returns {Promise<{ ok: boolean, externalUrl: string|null, externalId: string|null, error?: string, skipped?: string }>}
 */
export async function postSlackMessage(packet, { token, channel, fetchImpl = globalThis.fetch, publishDemo = false } = {}) {
  if (process.env.CONSTRUCT_SLACK_WRITES !== '1') {
    return {
      ok: false,
      externalUrl: null,
      externalId: null,
      skipped: 'disabled',
      error: 'Slack writes are disabled by default. Set CONSTRUCT_SLACK_WRITES=1 to enable.',
    };
  }
  if (!publishDemo && isDemoIntakePacket(packet)) {
    return {
      ok: false,
      externalUrl: null,
      externalId: null,
      skipped: 'demo-source',
      error: 'Refused to publish: packet originated from a demo/fixture path (set CONSTRUCT_DEMO=0 and re-run with --publish-issues to override).',
    };
  }
  const hd = homedir();
  const auth = resolveSlackAuth(hd);
  const resolvedToken = token || auth.token;
  const resolvedChannel = channel || auth.channel;

  if (!resolvedToken) return { ok: false, externalUrl: null, externalId: null, error: 'SLACK_BOT_TOKEN not set. Check ~/.config/construct/config.env, ~/.env, or 1Password.' };
  if (!resolvedChannel) return { ok: false, externalUrl: null, externalId: null, error: 'SLACK_CHANNEL not set. Set SLACK_CHANNEL env or in ~/.config/construct/config.env.' };

  const text = buildSlackText(packet);
  const blocks = buildSlackBlocks(packet);

  try {
    const res = await fetchImpl('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resolvedToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ channel: resolvedChannel, text, blocks }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return { ok: false, externalUrl: null, externalId: null, error: `Slack API ${res.status}: ${detail.slice(0, 200)}` };
    }

    const json = await res.json();
    if (!json.ok) {
      return { ok: false, externalUrl: null, externalId: null, error: `Slack: ${json.error || 'Unknown error'}` };
    }

    // chat.postMessage returns only channel + ts; a canonical permalink needs
    // the workspace domain (chat.getPermalink is the authoritative source).
    // The slack.com/archives form below is an approximation that Slack
    // redirects to the right workspace for a signed-in user.

    const messageUrl = `https://slack.com/archives/${json.channel}/p${json.ts?.replace('.', '')}`;
    return {
      ok: true,
      externalUrl: messageUrl,
      externalId: json.ts,
    };
  } catch (err) {
    return { ok: false, externalUrl: null, externalId: null, error: err.message };
  }
}

function buildSlackText(packet) {
  const t = packet?.triage || {};
  const intakeType = t.intakeType ? `[${t.intakeType}] ` : '';
  const excerpt = packet?.excerpt?.slice(0, 100)?.replace(/\n/g, ' ')?.trim() || 'Intake signal';
  return `${intakeType}${excerpt}`;
}

function buildSlackBlocks(packet) {
  const t = packet?.triage || {};
  const blocks = [];

  const title = buildLinearTitle(packet);
  blocks.push({
    type: 'header',
    text: {
      type: 'plain_text',
      text: title.slice(0, 100),
    },
  });

  const fields = [];
  if (t.intakeType) fields.push({ type: 'mrkdwn', text: `*Type:*\n${t.intakeType}` });
  if (t.primaryOwner) fields.push({ type: 'mrkdwn', text: `*Owner:*\n${t.primaryOwner}` });
  if (t.risk) fields.push({ type: 'mrkdwn', text: `*Risk:*\n${t.risk}` });
  if (t.rdStage) fields.push({ type: 'mrkdwn', text: `*Stage:*\n${t.rdStage}` });

  if (fields.length > 0) {
    blocks.push({
      type: 'section',
      fields: fields.slice(0, 4),
    });
  }

  if (packet?.excerpt) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Signal:*\n\`\`\`${packet.excerpt.slice(0, 500)}\`\`\``,
      },
    });
  }

  if (packet?.id) {
    blocks.push({
      type: 'context',
      elements: [
        { type: 'mrkdwn', text: `Intake ID: \`${packet.id}\`` },
      ],
    });
  }

  return blocks;
}

// ── Update intake packet with external reference ─────────────────────────

/**
 * Write an external reference into an intake packet's queue entry.
 * Updates the JSON file for filesystem-backed queues.
 *
 * @param {string} rootDir - Project root
 * @param {string} intakeId - Intake packet ID
 * @param {string} system - 'github' | 'jira' | 'confluence'
 * @param {string} externalUrl - URL to the external item
 * @param {string} externalId - External system's ID
 */
export function tagIntakeWithExternalRef(rootDir, intakeId, system, externalUrl, externalId) {
  const pendingDir = configPath(rootDir, 'intake', 'pending');
  if (!existsSync(pendingDir)) return;

  const files = readdirSync(pendingDir).filter(f => f.endsWith('.json'));
  for (const file of files) {
    if (!file.includes(intakeId)) continue;
    try {
      const filePath = join(pendingDir, file);
      const entry = JSON.parse(readFileSync(filePath, 'utf8'));
      entry.externalRefs = entry.externalRefs || {};
      entry.externalRefs[system] = { url: externalUrl, id: externalId, createdAt: new Date().toISOString() };
      writeFileSync(filePath, JSON.stringify(entry, null, 2) + '\n');
    } catch { /* non-fatal */ }
  }
}

/**
 * Credential resolver for the actual publish paths (createGitHubIssue,
 * createJiraTicket, publishArtifactToConfluence) that need a real, materialized
 * value to make an API call. Checks env → .env → config.env → shell rc,
 * resolving a 1Password op:// reference through resolveOpRef when the rc tier
 * carries one. Not for status/detection — detectIntegrationConfig below uses
 * hasSecret/hasAnySecret/peekRawCredential instead, which never resolve op:// or
 * source a shell rc file (ADR-0049 §2: presence-first in short-lived paths).
 */
function resolveCredentialSync(varName, homeDir) {
  if (process.env[varName]) return process.env[varName];
  try {
    const projectEnv = join(process.cwd(), '.env');
    if (existsSync(projectEnv)) {
      const content = readFileSync(projectEnv, 'utf8');
      const m = content.match(new RegExp(`^${varName}=["']?(.+?)["']?$`, 'm'));
      if (m) return m[1].trim();
    }
  } catch { /* skip */ }
  try {
    const homeEnv = join(homeDir, '.env');
    if (existsSync(homeEnv)) {
      const content = readFileSync(homeEnv, 'utf8');
      const m = content.match(new RegExp(`^${varName}=["']?(.+?)["']?$`, 'm'));
      if (m) return m[1].trim();
    }
  } catch { /* skip */ }
  try {
    const cfgPath = join(configDir(homeDir), 'config.env');
    if (existsSync(cfgPath)) {
      const content = readFileSync(cfgPath, 'utf8');
      const m = content.match(new RegExp(`^${varName}=(.+)$`, 'm'));
      if (m) return m[1].trim();
    }
  } catch { /* skip */ }
  try {
    const shellFiles = [join(homeDir, '.zshrc'), join(homeDir, '.bashrc'), join(homeDir, '.bash_profile'), join(homeDir, '.profile')];
    for (const rcPath of shellFiles) {
      if (!existsSync(rcPath)) continue;
      const content = readFileSync(rcPath, 'utf8');
      const directRe = new RegExp(`export\\s+${varName}=["']?(.+?)["']?$`, 'm');
      const directMatch = content.match(directRe);
      if (directMatch) return directMatch[1].trim();
      const opRe = new RegExp(`export\\s+${varName}=["']?\\$\\(op read '([^']+)'\\)["']?`, 'm');
      const opMatch = content.match(opRe);
      if (opMatch) {
        try {
          return resolveOpRef(opMatch[1]);
        } catch { /* op read failed */ }
      }
    }
  } catch { /* skip */ }
  return null;
}

// ── Configuration detection ──────────────────────────────────────────────

/**
 * Check which integrations are configured. A status/detection surface must
 * never materialize a credential (ADR-0049 §2: "never to merely list or
 * check") — this reports presence by shape only: env var set, a project/config/
 * home .env entry exists, or a shell rc `export VAR=...` line matches. It never
 * calls resolveOpRef and never sources a shell rc file (contrast
 * resolveCredentialSync above, used only when an actual API call needs the
 * real value). `gh auth status` / `gh repo view` are read-only CLI queries,
 * not secret materialization — gh manages its own token internally and never
 * hands Construct a plaintext value here.
 *
 * @param {object} [opts]
 * @param {string} [opts.homeDir]
 * @returns {{ github: boolean, jira: boolean, confluence: boolean, linear: boolean, slack: boolean, githubMethod: string|null, githubRepo: string|null, jiraHost: string|null, confluenceSpace: string|null, linearTeamId: string|null, slackChannel: string|null, linearWritesEnabled: boolean, slackWritesEnabled: boolean }}
 */
export function detectIntegrationConfig({ homeDir } = {}) {
  const hd = homeDir || homedir();

  // GitHub
  let ghCliAuthenticated = false;
  try {
    const status = spawnSync('gh', ['auth', 'status'], { encoding: 'utf8', timeout: 5000 });
    ghCliAuthenticated = status.status === 0;
  } catch { /* gh not available */ }

  const githubTokenPresent = hasAnySecret(['GITHUB_TOKEN', 'GH_TOKEN'], { home: hd });
  let githubRepo = process.env.GITHUB_REPO || peekRawCredential('GITHUB_REPO', { home: hd })?.raw || null;
  let githubMethod = null;

  if (ghCliAuthenticated) {
    githubMethod = 'gh';
    if (!githubRepo) {
      try {
        const remote = spawnSync('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'], { encoding: 'utf8', timeout: 5000 });
        if (remote.status === 0 && remote.stdout?.trim()) githubRepo = remote.stdout.trim();
      } catch { /* gh not available */ }
    }
  } else if (githubTokenPresent) {
    githubMethod = 'env';
  }

  // Jira
  const jiraConfigured = Boolean(
    hasSecret('JIRA_HOST', { home: hd })
    && hasSecret('JIRA_USER', { home: hd })
    && hasSecret('JIRA_API_TOKEN', { home: hd })
    && hasSecret('JIRA_PROJECT', { home: hd }),
  );
  const jiraHost = peekRawCredential('JIRA_HOST', { home: hd })?.raw || null;

  // Confluence
  const confluenceConfigured = Boolean(
    hasSecret('CONFLUENCE_HOST', { home: hd })
    && hasSecret('CONFLUENCE_USER', { home: hd })
    && hasSecret('CONFLUENCE_API_TOKEN', { home: hd })
    && hasSecret('CONFLUENCE_SPACE', { home: hd }),
  );
  const confluenceSpace = peekRawCredential('CONFLUENCE_SPACE', { home: hd })?.raw || null;

  // Linear
  const linearConfigured = Boolean(
    hasSecret('LINEAR_API_TOKEN', { home: hd })
    && hasSecret('LINEAR_TEAM_ID', { home: hd }),
  );
  const linearTeamId = peekRawCredential('LINEAR_TEAM_ID', { home: hd })?.raw || null;

  // Slack
  const slackConfigured = Boolean(
    hasSecret('SLACK_BOT_TOKEN', { home: hd })
    && hasSecret('SLACK_CHANNEL', { home: hd }),
  );
  const slackChannel = peekRawCredential('SLACK_CHANNEL', { home: hd })?.raw || null;

  return {
    github: ghCliAuthenticated || Boolean(githubTokenPresent && githubRepo),
    githubMethod,
    githubRepo,
    jira: jiraConfigured,
    jiraHost,
    confluence: confluenceConfigured,
    confluenceSpace,
    linear: linearConfigured,
    linearTeamId,
    linearWritesEnabled: process.env.CONSTRUCT_LINEAR_WRITES === '1',
    slack: slackConfigured,
    slackChannel,
    slackWritesEnabled: process.env.CONSTRUCT_SLACK_WRITES === '1',
  };
}
