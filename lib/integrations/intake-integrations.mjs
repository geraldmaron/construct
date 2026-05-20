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
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';

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

// ── GitHub Issues ────────────────────────────────────────────────────────

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
 * @returns {Promise<{ ok: boolean, externalUrl: string|null, externalId: string|null, error?: string }>}
 */
export async function createGitHubIssue(packet, { repo, token, apiUrl, host, fetchImpl = globalThis.fetch } = {}) {
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
 * Create a Jira ticket from an intake packet.
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

  if (!resolvedHost) return { ok: false, externalUrl: null, externalId: null, error: 'JIRA_HOST not set (e.g. https://your-domain.atlassian.net). Check ~/.construct/config.env or shell rc.' };
  if (!resolvedEmail || !resolvedToken) return { ok: false, externalUrl: null, externalId: null, error: 'JIRA_USER and JIRA_API_TOKEN required. Check ~/.construct/config.env, ~/.env, or 1Password.' };
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

    // We don't have the browse URL directly from the create response,
    // so construct it from the host + issue key
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

  if (!resolvedHost) return { ok: false, externalUrl: null, externalId: null, error: 'CONFLUENCE_HOST not set (e.g. https://your-domain.atlassian.net/wiki). Check ~/.construct/config.env or shell rc.' };
  if (!resolvedEmail || !resolvedToken) return { ok: false, externalUrl: null, externalId: null, error: 'CONFLUENCE_USER and CONFLUENCE_API_TOKEN required. Check ~/.construct/config.env, ~/.env, or 1Password.' };
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
 * Minimal markdown to Confluence storage format conversion.
 * Handles the subset of markdown used by Construct artifacts.
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
  const pendingDir = join(rootDir, '.cx', 'intake', 'pending');
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
 * Synchronous credential resolver for use in constructors and sync contexts.
 * Mirrors the async resolveCredential above. Checks env → .env → config.env → shell rc.
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
    const cfgPath = join(homeDir, '.construct', 'config.env');
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
          const result = spawnSync('op', ['read', opMatch[1]], { encoding: 'utf8', timeout: 5000 });
          if (result.status === 0) return result.stdout.trim();
        } catch { /* op read failed */ }
      }
    }
  } catch { /* skip */ }
  return null;
}

// ── Configuration detection ──────────────────────────────────────────────

/**
 * Check which integrations are configured.
 * Scopes environment, .env files, ~/.construct/config.env, and shell rc
 * files (including 1Password op:// refs).
 *
 * @param {object} [opts]
 * @param {string} [opts.homeDir]
 * @returns {{ github: boolean, jira: boolean, confluence: boolean, githubToken: boolean, jiraToken: boolean, confluenceToken: boolean }}
 */
export function detectIntegrationConfig({ homeDir } = {}) {
  const hd = homeDir || homedir();

  // GitHub — try gh CLI first, then env vars
  const ghAuth = resolveGitHubAuth(hd);

  // Jira
  const jiraHost = resolveCredentialSync('JIRA_HOST', hd);
  const jiraUser = resolveCredentialSync('JIRA_USER', hd);
  const jiraToken = resolveCredentialSync('JIRA_API_TOKEN', hd);
  const jiraProject = resolveCredentialSync('JIRA_PROJECT', hd);

  // Confluence
  const confHost = resolveCredentialSync('CONFLUENCE_HOST', hd);
  const confUser = resolveCredentialSync('CONFLUENCE_USER', hd);
  const confToken = resolveCredentialSync('CONFLUENCE_API_TOKEN', hd);
  const confSpace = resolveCredentialSync('CONFLUENCE_SPACE', hd);

  return {
    github: ghAuth.method === 'gh' || Boolean(ghAuth.token && ghAuth.repo),
    githubMethod: ghAuth.method || null,
    githubRepo: ghAuth.repo || null,
    jira: Boolean(jiraHost && jiraUser && jiraToken && jiraProject),
    jiraHost: jiraHost || null,
    confluence: Boolean(confHost && confUser && confToken && confSpace),
    confluenceSpace: confSpace || null,
  };
}

/**
 * Resolve a credential from env, .env files, config.env, or shell rc files.
 * Mirrors the approach in lib/health-check.mjs.
 */
function resolveCredential(varName, homeDir) {
  if (process.env[varName]) return process.env[varName];

  // Project .env
  try {
    const projectEnv = join(process.cwd(), '.env');
    if (existsSync(projectEnv)) {
      const content = readFileSync(projectEnv, 'utf8');
      const m = content.match(new RegExp(`^${varName}=["']?(.+?)["']?$`, 'm'));
      if (m) return m[1].trim();
    }
  } catch { /* skip */ }

  // ~/.env
  try {
    const homeEnv = join(homeDir, '.env');
    if (existsSync(homeEnv)) {
      const content = readFileSync(homeEnv, 'utf8');
      const m = content.match(new RegExp(`^${varName}=["']?(.+?)["']?$`, 'm'));
      if (m) return m[1].trim();
    }
  } catch { /* skip */ }

  // ~/.construct/config.env
  try {
    const cfgPath = join(homeDir, '.construct', 'config.env');
    if (existsSync(cfgPath)) {
      const content = readFileSync(cfgPath, 'utf8');
      const m = content.match(new RegExp(`^${varName}=(.+)$`, 'm'));
      if (m) return m[1].trim();
    }
  } catch { /* skip */ }

  // Shell rc files (including 1Password op:// refs and command substitutions)
  try {
    const shellFiles = [join(homeDir, '.zshrc'), join(homeDir, '.bashrc'), join(homeDir, '.bash_profile'), join(homeDir, '.profile')];
    for (const rcPath of shellFiles) {
      if (!existsSync(rcPath)) continue;
      try {
        const content = readFileSync(rcPath, 'utf8');
        // Direct export (simple values only, not command substitutions)
        const directRe = new RegExp(`^\\s*export\\s+${varName}="?([^"'\\$\\(]+)"?$`, 'm');
        const directMatch = content.match(directRe);
        if (directMatch) return directMatch[1].trim();

        // op:// ref — try 1Password CLI
        const opRe = new RegExp(`export\\s+${varName}=["']?\\$\\(op read '([^']+)'\\)["']?`, 'm');
        const opMatch = content.match(opRe);
        if (opMatch) {
          try {
            const result = spawnSync('op', ['read', opMatch[1]], { encoding: 'utf8', timeout: 5000 });
            if (result.status === 0) return result.stdout.trim();
            // Log op read failures — often the field name in the rc file
            // doesn't match the actual 1Password item field name.
            const errMsg = (result.stderr || '').trim().slice(0, 200);
            if (errMsg && process.env.CONSTRUCT_DEBUG_CREDENTIALS === '1') {
              process.stderr.write(`[credentials] op read failed for ${varName}: ${errMsg}\n`);
            }
          } catch { /* op read failed */ }
        }

        // If the value uses command substitution ($(...)), try evaluating via
        // a shell that sources the rc file. This catches any $(...) pattern
        // including op read with different field names or other secret managers.
        const cmdSubRe = new RegExp(`^export\\s+${varName}="?\\$\\((.+)\\)"?`, 'm');
        const cmdMatch = content.match(cmdSubRe);
        if (cmdMatch) {
          try {
            const shellResult = spawnSync('zsh', ['-c', `source "${rcPath}" 2>/dev/null; echo "\${${varName}}"`], {
              encoding: 'utf8', timeout: 5000,
            });
            if (shellResult.status === 0 && shellResult.stdout?.trim()) {
              const val = shellResult.stdout.trim().split('\n').pop()?.trim();
              if (val && !val.includes('ERROR') && !val.includes('could not read')) return val;
            }
          } catch { /* shell eval failed */ }
        }
      } catch { /* skip unreadable */ }
    }
  } catch { /* skip */ }

  return null;
}
