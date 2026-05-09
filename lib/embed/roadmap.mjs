/**
 * lib/embed/roadmap.mjs — living roadmap document for embed mode.
 *
 * The roadmap is a **running structured document** for a team or project:
 *   - Organized by year → quarter → theme/initiative
 *   - Items tied to work-tracking refs (Jira issues, Linear cycles, GitHub milestones)
 *   - Cross-linked to related docs (ADRs, PRDs, memos)
 *   - Updated incrementally as work progresses (not regenerated from scratch)
 *
 * Construct keeps it current by:
 *   - Reconciling snapshot items against existing roadmap entries
 *   - Advancing status when linked issues close or transition
 *   - Adding new items that appear in tracked sources
 *   - Archiving completed quarters
 *
 * Storage:
 *   docs/roadmap.md in the target docs lane (not hardcoded to .cx/)
 *
 * Format:
 *   # Roadmap
 *   > Last updated: <ISO timestamp>
 *   > Sources: github, jira, linear
 *
 *   ## 2026
 *   ### Q2 (Apr–Jun)
 *   #### Theme: Embed Mode Redesign
 *   - [x] Target resolver — PROJ-123 · ADR-005
 *   - [ ] Docs lifecycle — PROJ-124
 *   - [ ] Dashboard notifications — PROJ-125 · PRD-012
 *
 *   ### Q1 (Jan–Mar) ✓
 *   #### Theme: Core Platform
 *   - [x] MCP server — PROJ-100
 *   - [x] Provider registry — PROJ-101
 */

import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { searchObservations } from '../observation-store.mjs';
import { renderRoleLensSection } from './role-framing.mjs';

// ─── Quarter/Year utilities ──────────────────────────────────────────────────

function currentQuarter() {
  const now = new Date();
  const q = Math.ceil((now.getMonth() + 1) / 3);
  return { year: now.getFullYear(), quarter: q };
}

function quarterLabel(q) {
  const months = ['Jan–Mar', 'Apr–Jun', 'Jul–Sep', 'Oct–Dec'];
  return `Q${q.quarter} (${months[q.quarter - 1]})`;
}

function quarterKey(q) {
  return `${q.year}-Q${q.quarter}`;
}

// ─── Roadmap data model ──────────────────────────────────────────────────────

/**
 * A roadmap entry represents one trackable item.
 * @typedef {object} RoadmapEntry
 * @property {string} title
 * @property {string} status - 'planned' | 'in-progress' | 'done' | 'cancelled'
 * @property {string[]} refs - work-tracking refs (e.g. 'PROJ-123', '#45', 'ENG-100')
 * @property {string[]} docs - linked docs (e.g. 'ADR-005', 'PRD-012')
 * @property {string|null} theme - grouping theme/initiative
 * @property {string} quarter - e.g. '2026-Q2'
 */

/**
 * Parse an existing roadmap.md into a structured model.
 * Returns { meta, entries[] } or null if file doesn't exist.
 */
export function parseRoadmap(filePath) {
  if (!existsSync(filePath)) return null;

  const content = readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const entries = [];
  let currentYear = null;
  let currentQtr = null;
  let currentTheme = null;

  for (const line of lines) {
    // Year header: ## 2026
    const yearMatch = line.match(/^## (\d{4})/);
    if (yearMatch) { currentYear = parseInt(yearMatch[1]); continue; }

    // Quarter header: ### Q2 (Apr–Jun)
    const qtrMatch = line.match(/^### Q(\d)/);
    if (qtrMatch && currentYear) {
      currentQtr = `${currentYear}-Q${qtrMatch[1]}`;
      currentTheme = null;
      continue;
    }

    // Theme header: #### Theme: ...
    const themeMatch = line.match(/^#### (?:Theme: )?(.+)/);
    if (themeMatch) { currentTheme = themeMatch[1].trim(); continue; }

    // Entry: - [x] or - [ ] title — refs · docs
    const entryMatch = line.match(/^- \[([ x])\] (.+)/);
    if (entryMatch && currentQtr) {
      const done = entryMatch[1] === 'x';
      const rest = entryMatch[2];

      // Extract refs (PROJ-123, #45, ENG-100 patterns) and docs (ADR-005, PRD-012)
      const refs = [];
      const docs = [];
      const refPattern = /([A-Z]+-\d+|#\d+)/g;
      const docPattern = /(ADR-\d+|PRD-\d+|RFC-\d+|MEMO-\d+)/g;
      let m;
      while ((m = refPattern.exec(rest)) !== null) {
        if (docPattern.test(m[1])) docs.push(m[1]);
        else refs.push(m[1]);
      }
      // Re-run doc pattern on full string
      const docMatches = rest.match(/(ADR-\d+|PRD-\d+|RFC-\d+|MEMO-\d+)/g) ?? [];
      docs.push(...docMatches.filter((d) => !docs.includes(d)));

      // Title is everything before the first ref separator
      const title = rest.split(/\s+[—·]\s+/)[0].trim();

      entries.push({
        title,
        status: done ? 'done' : 'planned',
        refs,
        docs,
        theme: currentTheme,
        quarter: currentQtr,
      });
    }
  }

  return { entries };
}

/**
 * Reconcile snapshot items against existing roadmap entries.
 * - Items in snapshot that match a roadmap ref: update status
 * - Items in snapshot with no roadmap entry: add to current quarter
 * - Roadmap entries whose refs are now closed: mark done
 *
 * @param {RoadmapEntry[]} existing - Parsed roadmap entries
 * @param {object[]} snapshotItems - Open items from snapshot sections
 * @param {object} [opts]
 * @returns {RoadmapEntry[]} Updated entry list
 */
export function reconcileEntries(existing, snapshotItems, opts = {}) {
  const entries = [...existing];
  const { year, quarter } = currentQuarter();
  const currentQtrKey = quarterKey({ year, quarter });

  // Index existing entries by ref for fast lookup
  const byRef = new Map();
  for (const entry of entries) {
    for (const ref of entry.refs) byRef.set(ref, entry);
  }

  // Track which snapshot items matched
  const matched = new Set();

  for (const item of snapshotItems) {
    const key = item.key ?? (item.number ? `#${item.number}` : null);
    if (!key) continue;

    if (byRef.has(key)) {
      // Update status
      const entry = byRef.get(key);
      const itemStatus = normalizeStatus(item.status);
      if (itemStatus === 'done' && entry.status !== 'done') {
        entry.status = 'done';
      } else if (itemStatus === 'in-progress' && entry.status === 'planned') {
        entry.status = 'in-progress';
      }
      matched.add(key);
    } else {
      // New item — add to current quarter
      const title = item.summary ?? item.title ?? item.subject ?? '(untitled)';
      entries.push({
        title,
        status: normalizeStatus(item.status),
        refs: key ? [key] : [],
        docs: [],
        theme: null,
        quarter: currentQtrKey,
      });
      matched.add(key);
    }
  }

  return entries;
}

function normalizeStatus(raw) {
  const s = String(raw ?? '').toLowerCase();
  if (/done|closed|merged|resolved|completed/.test(s)) return 'done';
  if (/in.?progress|active|doing|started/.test(s)) return 'in-progress';
  if (/cancelled|won.?t|wont/.test(s)) return 'cancelled';
  return 'planned';
}

/**
 * Render entries back to roadmap markdown.
 */
export function renderRoadmap(entries, opts = {}) {
  const { roles, sources } = opts;
  const updatedAt = new Date().toISOString();

  const lines = [
    '# Roadmap',
    `> Last updated: ${updatedAt}`,
  ];
  if (sources?.length) {
    lines.push(`> Sources: ${sources.join(', ')}`);
  }
  lines.push('');

  // Role lens
  if (roles) {
    const roleLens = renderRoleLensSection(roles);
    if (roleLens) lines.push(roleLens);
  }

  // Group by year → quarter → theme
  const byYear = new Map();
  for (const entry of entries) {
    const [yearStr, qtr] = (entry.quarter ?? '').split('-');
    const year = parseInt(yearStr) || currentQuarter().year;
    if (!byYear.has(year)) byYear.set(year, new Map());
    const quarters = byYear.get(year);
    if (!quarters.has(entry.quarter)) quarters.set(entry.quarter, []);
    quarters.get(entry.quarter).push(entry);
  }

  // Sort years descending (current year first)
  const sortedYears = [...byYear.keys()].sort((a, b) => b - a);

  for (const year of sortedYears) {
    lines.push(`## ${year}`, '');
    const quarters = byYear.get(year);
    // Sort quarters descending within year
    const sortedQtrs = [...quarters.keys()].sort().reverse();

    for (const qtrKey of sortedQtrs) {
      const qtrEntries = quarters.get(qtrKey);
      const allDone = qtrEntries.every((e) => e.status === 'done' || e.status === 'cancelled');
      const qNum = parseInt(qtrKey.split('Q')[1]) || 1;
      const label = quarterLabel({ year, quarter: qNum });
      lines.push(`### ${label}${allDone ? ' ✓' : ''}`, '');

      // Group by theme within quarter
      const byTheme = new Map();
      for (const entry of qtrEntries) {
        const theme = entry.theme ?? '_ungrouped';
        if (!byTheme.has(theme)) byTheme.set(theme, []);
        byTheme.get(theme).push(entry);
      }

      for (const [theme, items] of byTheme) {
        if (theme !== '_ungrouped') {
          lines.push(`#### ${theme}`, '');
        }
        for (const item of items) {
          const check = item.status === 'done' ? 'x' : ' ';
          const refStr = item.refs.length ? ` — ${item.refs.join(', ')}` : '';
          const docStr = item.docs.length ? ` · ${item.docs.join(', ')}` : '';
          const statusTag = item.status === 'in-progress' ? ' 🔄' : item.status === 'cancelled' ? ' ~~cancelled~~' : '';
          lines.push(`- [${check}] ${item.title}${statusTag}${refStr}${docStr}`);
        }
        lines.push('');
      }
    }
  }

  if (!entries.length) {
    lines.push('_No roadmap items tracked yet._', '');
  }

  return lines.join('\n');
}

/**
 * Generate or update the roadmap for a target.
 *
 * If a roadmap already exists, parses it and reconciles with snapshot data.
 * If not, creates a new one from snapshot items.
 *
 * @param {object} opts
 * @param {string}   opts.targetPath - Target root path (docs/roadmap.md will be created here)
 * @param {object}   opts.snapshot   - Last snapshot from embed
 * @param {object}   [opts.roles]    - Configured roles for role lens
 * @returns {{ path: string, updatedAt: string, itemCount: number, isNew: boolean }}
 */
export async function generateRoadmap({ targetPath, snapshot, roles }) {
  const updatedAt = new Date().toISOString();

  if (!snapshot) {
    return { path: null, updatedAt, itemCount: 0, skipped: true, reason: 'no snapshot available' };
  }

  const roadmapPath = join(targetPath, 'docs', 'roadmap.md');

  // Parse existing or start fresh
  const existing = parseRoadmap(roadmapPath);
  const isNew = !existing;

  // Extract open items from snapshot
  const snapshotItems = [];
  for (const section of snapshot.sections ?? []) {
    for (const item of section.items ?? []) {
      snapshotItems.push({ ...item, _provider: section.provider });
    }
  }

  // Reconcile
  const entries = reconcileEntries(existing?.entries ?? [], snapshotItems);

  // Determine sources
  const sources = [...new Set((snapshot.sections ?? []).map((s) => s.provider))];

  // Render
  const markdown = renderRoadmap(entries, { roles, sources });

  // Write
  mkdirSync(join(targetPath, 'docs'), { recursive: true });
  writeFileSync(roadmapPath, markdown, 'utf8');

  return { path: roadmapPath, updatedAt, itemCount: entries.length, isNew };
}

/**
 * Produce a short Slack-friendly summary of the roadmap (≤3000 chars).
 */
export async function roadmapSlackSummary({ targetPath, snapshot, roles }) {
  const result = await generateRoadmap({ targetPath, snapshot, roles });
  if (result.skipped) return null;

  const { year, quarter } = currentQuarter();
  const qtrKey = quarterKey({ year, quarter });

  const roadmapPath = join(targetPath, 'docs', 'roadmap.md');
  const parsed = parseRoadmap(roadmapPath);
  const currentItems = (parsed?.entries ?? []).filter((e) => e.quarter === qtrKey);

  const done = currentItems.filter((e) => e.status === 'done').length;
  const total = currentItems.length;

  const lines = [
    `*Roadmap* — ${quarterLabel({ year, quarter })} ${year} — ${done}/${total} done`,
  ];

  const inProgress = currentItems.filter((e) => e.status === 'in-progress').slice(0, 5);
  if (inProgress.length) {
    lines.push('\n*In progress:*');
    inProgress.forEach((item, i) => {
      const refs = item.refs.length ? ` (${item.refs.join(', ')})` : '';
      lines.push(`${i + 1}. ${item.title}${refs}`);
    });
  }

  const planned = currentItems.filter((e) => e.status === 'planned').slice(0, 5);
  if (planned.length) {
    lines.push('\n*Up next:*');
    planned.forEach((item, i) => {
      lines.push(`${i + 1}. ${item.title}`);
    });
  }

  lines.push(`\nFull roadmap: \`docs/roadmap.md\``);
  return lines.join('\n').slice(0, 3000);
}
