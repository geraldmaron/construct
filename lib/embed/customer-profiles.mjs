/**
 * lib/embed/customer-profiles.mjs — Global customer profile store.
 *
 * Maintains durable customer/account memory in ~/.cx/knowledge/internal/customer-profiles/.
 * Profiles are additive — history is preserved unless explicitly deleted.
 * Links signals to customers and detects account-level patterns during intake triage.
 *
 * Storage:
 *   ~/.cx/knowledge/internal/customer-profiles/<customer-id>.md
 *   ~/.cx/knowledge/internal/customer-profiles/index.json — quick lookup by name/email
 *
 * Each profile follows templates/docs/customer-profile.md schema.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, appendFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { cxDir } from '../paths.mjs';
import { knowledgeInternalStore } from '../knowledge/layout.mjs';

function migrateLegacyDir(modernDir, legacyDir) {
  if (existsSync(modernDir) || !existsSync(legacyDir)) return;
  mkdirSync(join(modernDir, '..'), { recursive: true });
  try { renameSync(legacyDir, modernDir); } catch { /* compatibility-only */ }
}

function profilePaths({ migrate = false } = {}) {
  const modernDir = join(cxDir(), knowledgeInternalStore('customer-profiles'));
  const legacyDir = join(cxDir(), 'product-intel', 'customer-profiles');
  if (migrate) migrateLegacyDir(modernDir, legacyDir);
  const profilesDir = existsSync(modernDir) || !existsSync(legacyDir) ? modernDir : legacyDir;
  return {
    profilesDir,
    indexFile: join(profilesDir, 'index.json'),
  };
}

/**
 * Ensure profile directory exists.
 */
function ensureDir() {
  const { profilesDir } = profilePaths({ migrate: true });
  if (!existsSync(profilesDir)) {
    mkdirSync(profilesDir, { recursive: true });
  }
}

/**
 * Read the index file (quick lookup by name/email/domain).
 * @returns {{ [key: string]: { id: string, name: string, status: string, updatedAt: string } }}
 */
function readIndex() {
  const { indexFile } = profilePaths();
  if (!existsSync(indexFile)) return {};
  try {
    return JSON.parse(readFileSync(indexFile, 'utf8'));
  } catch (err) {
    process.stderr.write('[customer-profiles.mjs] readIndex: ' + (err?.message ?? String(err)) + '\n');
    return {};
  }
}

/**
 * Write the index file.
 * @param {object} index
 */
function writeIndex(index) {
  const { indexFile } = profilePaths();
  ensureDir();
  writeFileSync(indexFile, JSON.stringify(index, null, 2) + '\n');
}

/**
 * Generate a unique customer ID.
 * @returns {string}
 */
function generateCustomerId() {
  return `cust-${randomUUID().slice(0, 8)}`;
}

/**
 * Slugify a name for filename use.
 * @param {string} name
 * @returns {string}
 */
function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/**
 * Create a new customer profile.
 *
 * @param {object} opts
 * @param {string} opts.name - Customer/account name (required)
 * @param {string} [opts.owner] - PM or owner name
 * @param {string} [opts.workspace] - Workspace assignment
 * @param {string} [opts.status] - 'active' (default), 'inactive', 'archived'
 * @param {string} [opts.domain] - Company domain for email matching
 * @param {string[]} [opts.aliases] - Alternative names/ spellings
 * @returns {{ id: string, path: string, profile: CustomerProfile }}
 */
export function createCustomerProfile({ name, owner, workspace, status = 'active', domain, aliases = [] }) {
  if (!name || typeof name !== 'string' || !name.trim()) {
    throw new Error('name is required');
  }

  ensureDir();

  const id = generateCustomerId();
  const slug = slugify(name);
  const filename = `${slug}-${id}.md`;
  const filePath = join(profilePaths().profilesDir, filename);

  const date = new Date().toISOString().slice(0, 10);
  const profile = {
    id,
    name: name.trim(),
    owner: owner || 'TBD',
    workspace: workspace || 'default',
    status,
    domain,
    aliases,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const content = `---
cx_doc_id: ${randomUUID()}
created_at: ${profile.createdAt}
updated_at: ${profile.updatedAt}
generator: construct/customer-profiles
customer_id: ${id}
---

# Customer Profile: ${profile.name}

- **Updated**: ${date}
- **Owner**: ${profile.owner}
- **Status**: ${profile.status}
- **Workspace**: ${profile.workspace}
${domain ? `- **Domain**: ${domain}` : ''}
${aliases.length ? `- **Aliases**: ${aliases.join(', ')}` : ''}

<!--
Profiles are additive memory. Do not delete history unless the user explicitly
asks for cleanup. Keep facts tied to source evidence.
-->

## Snapshot
<!-- One paragraph. Who this customer is, what they use the product for, and why they matter to the current work. -->

TODO

## Environment
<!-- Stack, tools, integrations, scale, constraints, and relevant operating model. -->

TODO

## Active pain points
<!-- Current friction, with source links or dates. Distinguish severe blockers from preferences. -->

| Date | Pain point | Severity | Source |
|---|---|---|---|
| ${date} | TODO | medium | TODO |

## Open asks
<!-- Table: ask, first raised, times mentioned, source, linked issue, status. -->

| Ask | First raised | Times mentioned | Source | Linked issue | Status |
|---|---|---|---|---|---|
| TODO | ${date} | 1 | TODO | TODO | open |

## Key contacts
<!-- Roles and responsibilities. Avoid unnecessary personal data. -->

| Name | Role | Contact | Notes |
|---|---|---|---|
| TODO | TODO | TODO | TODO |

## Product areas
<!-- Areas of the product this customer touches or influences. -->

| Area | Usage level | Notes |
|---|---|---|
| TODO | low/medium/high | TODO |

## Evidence links
<!-- Notes, tickets, calls, Slack threads, PRDs, or research tied to this customer. -->

| Date | Type | Link | Summary |
|---|---|---|---|
| ${date} | TODO | TODO | TODO |

## Change log
<!-- Dated additions. Preserve history so future synthesis can see how the account evolved. -->

| Date | Change |
|---|---|
| ${date} | Profile created |
`;

  writeFileSync(filePath, content, 'utf8');

  // Update index
  const index = readIndex();
  const indexKey = slugify(name);
  index[indexKey] = {
    id,
    name: profile.name,
    status: profile.status,
    updatedAt: profile.updatedAt,
  };

  // Add aliases to index
  for (const alias of aliases) {
    index[slugify(alias)] = { id, name: profile.name, status: profile.status, updatedAt: profile.updatedAt };
  }

  // Add domain to index
  if (domain) {
    index[slugify(domain)] = { id, name: profile.name, status: profile.status, updatedAt: profile.updatedAt };
  }

  writeIndex(index);

  return { id, path: filePath, profile };
}

/**
 * Get a customer profile by ID.
 * @param {string} customerId
 * @returns {CustomerProfile | null}
 */
export function getCustomerProfile(customerId) {
  ensureDir();
  const { profilesDir } = profilePaths();

  // Try direct lookup by ID in filename
  const files = readdirSync(profilesDir).filter(f => f.endsWith('.md'));
  for (const file of files) {
    if (file.includes(customerId)) {
      const filePath = join(profilesDir, file);
      return parseProfileFile(filePath);
    }
  }

  return null;
}

/**
 * Search for customer profiles by name, domain, or alias.
 * @param {string} query
 * @returns {Array<{ id: string, name: string, status: string, path: string }>}
 */
export function searchCustomerProfiles(query) {
  ensureDir();
  const { profilesDir } = profilePaths();

  const index = readIndex();
  const querySlug = slugify(query);
  const results = [];

  // Exact match in index
  if (index[querySlug]) {
    const entry = index[querySlug];
    const profile = getCustomerProfile(entry.id);
    if (profile) {
      results.push({
        id: entry.id,
        name: entry.name,
        status: entry.status,
        path: join(profilesDir, `${slugify(entry.name)}-${entry.id}.md`),
      });
    }
  }

  // Partial match
  for (const [key, entry] of Object.entries(index)) {
    if (key.includes(querySlug) || entry.name.toLowerCase().includes(query.toLowerCase())) {
      if (!results.find(r => r.id === entry.id)) {
        const profile = getCustomerProfile(entry.id);
        if (profile) {
          results.push({
            id: entry.id,
            name: entry.name,
            status: entry.status,
            path: join(profilesDir, `${slugify(entry.name)}-${entry.id}.md`),
          });
        }
      }
    }
  }

  return results;
}

/**
 * List all customer profiles.
 * @param {object} [opts]
 * @param {string} [opts.status] - Filter by status
 * @param {string} [opts.workspace] - Filter by workspace
 * @returns {Array<{ id: string, name: string, status: string, workspace: string, updatedAt: string }>}
 */
export function listCustomerProfiles(opts = {}) {
  ensureDir();

  const index = readIndex();
  let results = Object.values(index).map(entry => ({
    id: entry.id,
    name: entry.name,
    status: entry.status,
    workspace: getCustomerProfile(entry.id)?.workspace || 'default',
    updatedAt: entry.updatedAt,
  }));

  if (opts.status) {
    results = results.filter(r => r.status === opts.status);
  }

  if (opts.workspace) {
    results = results.filter(r => r.workspace === opts.workspace);
  }

  return results.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/**
 * Update a customer profile (append to change log, update fields).
 *
 * @param {string} customerId
 * @param {object} updates
 * @param {string} [updates.owner]
 * @param {string} [updates.status]
 * @param {string} [updates.workspace]
 * @param {string} [updates.snapshot] - New snapshot text
 * @param {object[]} [updates.painPoints] - Array of { date, pain, severity, source }
 * @param {object[]} [updates.asks] - Array of { ask, firstRaised, timesMentioned, source, linkedIssue, status }
 * @param {string} [updates.changeLogEntry] - Text to append to change log
 * @returns {{ success: boolean, path: string, updatedAt: string }}
 */
export function updateCustomerProfile(customerId, updates) {
  const profile = getCustomerProfile(customerId);
  if (!profile) {
    throw new Error(`Customer profile not found: ${customerId}`);
  }

  const filePath = join(profilePaths().profilesDir, `${slugify(profile.name)}-${customerId}.md`);
  let content = readFileSync(filePath, 'utf8');
  const date = new Date().toISOString().slice(0, 10);

  // Update frontmatter timestamp
  content = content.replace(
    /updated_at: \d{4}-\d{2}-\d{2}T[\d:]+Z/,
    `updated_at: ${new Date().toISOString()}`
  );

  // Update status if provided
  if (updates.status) {
    content = content.replace(
      /\*\*Status\*\*: \w+/,
      `**Status**: ${updates.status}`
    );
    // Update index
    const index = readIndex();
    const key = slugify(profile.name);
    if (index[key]) {
      index[key].status = updates.status;
      index[key].updatedAt = new Date().toISOString();
      writeIndex(index);
    }
  }

  // Update owner if provided
  if (updates.owner) {
    content = content.replace(
      /\*\*Owner\*\*: .+/,
      `**Owner**: ${updates.owner}`
    );
  }

  // Update workspace if provided
  if (updates.workspace) {
    content = content.replace(
      /\*\*Workspace\*\*: .+/,
      `**Workspace**: ${updates.workspace}`
    );
  }

  // Append to change log
  if (updates.changeLogEntry) {
    const changeLogMatch = content.match(/(## Change log[\s\S]*$)/);
    if (changeLogMatch) {
      const newEntry = `| ${date} | ${updates.changeLogEntry} |`;
      content = content.replace(
        changeLogMatch[0],
        `## Change log\n\n${changeLogMatch[0].split('\n').slice(0, 3).join('\n')}\n${newEntry}\n`
      );
    }
  }

  writeFileSync(filePath, content, 'utf8');

  return { success: true, path: filePath, updatedAt: new Date().toISOString() };
}

/**
 * Link a signal/intake to a customer profile.
 * Appends to evidence links and change log.
 *
 * @param {string} customerId
 * @param {object} signal
 * @param {string} signal.id - Signal/intake ID
 * @param {string} signal.type - 'intake' | 'observation' | 'ticket' | etc.
 * @param {string} signal.sourcePath - Path to signal file
 * @param {string} signal.summary - Brief summary
 * @param {string} [signal.date] - Date (default: today)
 * @returns {{ success: boolean, customerId: string, signalId: string }}
 */
export function linkSignalToCustomer(customerId, signal) {
  const date = signal.date || new Date().toISOString().slice(0, 10);

  return updateCustomerProfile(customerId, {
    changeLogEntry: `Linked ${signal.type}: ${signal.id} — ${signal.summary}`,
  });
}

/**
 * Parse a profile markdown file into a structured object.
 * @param {string} filePath
 * @returns {CustomerProfile | null}
 */
function parseProfileFile(filePath) {
  try {
    const content = readFileSync(filePath, 'utf8');

    // Extract frontmatter
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) return null;

    const frontmatter = {};
    for (const line of fmMatch[1].split('\n')) {
      const [key, ...valueParts] = line.split(':');
      if (key && valueParts.length) {
        frontmatter[key.trim()] = valueParts.join(':').trim();
      }
    }

    // Extract key fields from content
    const nameMatch = content.match(/^# Customer Profile: (.+)$/m);
    const statusMatch = content.match(/\*\*Status\*\*: (\w+)/);
    const ownerMatch = content.match(/\*\*Owner\*\*: (.+)$/m);
    const workspaceMatch = content.match(/\*\*Workspace\*\*: (.+)$/m);

    return {
      id: frontmatter.customer_id,
      name: nameMatch?.[1]?.trim() || 'Unknown',
      status: statusMatch?.[1] || 'unknown',
      owner: ownerMatch?.[1]?.trim() || 'TBD',
      workspace: workspaceMatch?.[1]?.trim() || 'default',
      createdAt: frontmatter.created_at,
      updatedAt: frontmatter.updated_at,
      rawContent: content,
    };
  } catch (err) {
    process.stderr.write('[customer-profiles.mjs] parseProfileFile: ' + (err?.message ?? String(err)) + '\n');
    return null;
  }
}

/**
 * Detect customer mentions in text and return matching customer IDs.
 * Uses name, domain, and aliases for matching.
 *
 * @param {string} text - Text to scan
 * @returns {Array<{ customerId: string, name: string, confidence: number }>}
 */
export function detectCustomerMentions(text) {
  const index = readIndex();
  const mentions = [];
  const seen = new Set();

  for (const [key, entry] of Object.entries(index)) {
    // Check for name/alias mentions
    const namePattern = new RegExp(`\\b${key.replace(/-/g, '[- ]')}\\b`, 'i');
    if (namePattern.test(text) && !seen.has(entry.id)) {
      mentions.push({
        customerId: entry.id,
        name: entry.name,
        confidence: 0.8, // High confidence for exact name match
      });
      seen.add(entry.id);
    }
  }

  return mentions;
}
