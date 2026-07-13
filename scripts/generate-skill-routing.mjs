/**
 * scripts/generate-skill-routing.mjs — derives skills/routing.json (and its
 * skills/routing.md render) from every skill file's own frontmatter, so the
 * route table covers the full skill corpus rather than a small hand-curated
 * subset, keeping every skill reachable via suggestSkills.
 *
 * A skill with authored `triggers:` frontmatter contributes those verbatim
 * at AUTHORED_PRIORITY. A skill without one gets a lower-priority
 * FALLBACK_PRIORITY entry derived from its own name and description, so
 * every skill is reachable before anyone hand-tunes its triggers.
 * `roles/*` skills are excluded — they load via role-directive preload and
 * registry entitlement, never via intent-based routing (the same exclusion
 * lib/skills/composition-graph.mjs already applies to reachability checks).
 *
 * --write regenerates both files. --check compares the freshly derived
 * output against what is on disk and exits 1 on drift, for the release gate.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { load as loadYaml } from 'js-yaml';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS_DIR = path.join(ROOT, 'skills');
const ROUTING_JSON_PATH = path.join(SKILLS_DIR, 'routing.json');
const ROUTING_MD_PATH = path.join(SKILLS_DIR, 'routing.md');

const AUTHORED_PRIORITY = 10;
const FALLBACK_PRIORITY = 5;
const MAX_FALLBACK_KEYWORDS = 6;

const STOPWORDS = new Set([
  'the', 'this', 'that', 'with', 'when', 'from', 'into', 'onto', 'over', 'under', 'their', 'about',
  'after', 'before', 'while', 'where', 'which', 'what', 'then', 'than', 'have', 'has', 'had', 'will',
  'shall', 'should', 'would', 'could', 'skill', 'skills', 'using', 'used', 'use', 'uses', 'for', 'and',
  'or', 'a', 'an', 'to', 'of', 'in', 'on', 'at', 'is', 'are', 'be', 'it', 'its', 'as', 'by', 'you', 'your',
]);

function* walkSkillFiles(dir, prefix = '') {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkSkillFiles(full, prefix ? `${prefix}/${entry.name}` : entry.name);
    } else if (entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'routing.md') {
      const rel = prefix ? `${prefix}/${entry.name.replace(/\.md$/, '')}` : entry.name.replace(/\.md$/, '');
      yield { rel, full };
    }
  }
}

function parseFrontmatter(raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return {};
  try { return loadYaml(m[1]) || {}; } catch { return {}; }
}

// Strip the "Use when:"/"Use this skill when..." boilerplate, then keep the
// first few content words over 3 chars that are not stopwords — a plain,
// deterministic derivation that needs no NLP dependency and stays inspectable
// in the generated routing.md render.

function fallbackKeywords(rel, frontmatter) {
  const basename = rel.split('/').pop();
  const keywords = [basename.replace(/-/g, ' ')];

  const desc = String(frontmatter.description || '');
  const withoutTrigger = desc
    .replace(/^use\s+(?:this\s+(?:skill\s+)?)?(?:when|to|for|if)\b[:\s]*/i, '')
    .replace(/^use\s+when\s*:\s*/i, '');
  const words = withoutTrigger
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOPWORDS.has(w));

  const seen = new Set(keywords);
  for (const w of words) {
    if (seen.has(w)) continue;
    seen.add(w);
    keywords.push(w);
    if (keywords.length >= MAX_FALLBACK_KEYWORDS) break;
  }
  return keywords;
}

function buildRoutes() {
  const routes = [];
  for (const { rel, full } of walkSkillFiles(SKILLS_DIR)) {
    if (rel.startsWith('roles/')) continue;
    const frontmatter = parseFrontmatter(fs.readFileSync(full, 'utf8'));
    const domain = rel.includes('/') ? rel.split('/')[0] : 'utility';
    const authored = Array.isArray(frontmatter.triggers) && frontmatter.triggers.length > 0;
    routes.push({
      domain,
      keywords: authored ? frontmatter.triggers : fallbackKeywords(rel, frontmatter),
      path: rel,
      priority: authored ? AUTHORED_PRIORITY : FALLBACK_PRIORITY,
    });
  }
  return routes.sort((a, b) => a.path.localeCompare(b.path));
}

function renderMarkdown(routes) {
  const byDomain = new Map();
  for (const r of routes) {
    if (!byDomain.has(r.domain)) byDomain.set(r.domain, []);
    byDomain.get(r.domain).push(r);
  }
  const lines = [
    '<!--',
    'skills/routing.md — generated render of skills/routing.json. Do not hand-edit: run',
    '`node scripts/generate-skill-routing.mjs --write` (or `construct skills:routes --write`).',
    '-->',
    '',
    '# Skill routing',
    '',
    'One row per skill reachable via `suggest_skills`/`search_skills`. A skill with authored',
    '`triggers:` frontmatter is marked **authored**; everything else gets a lower-priority',
    '**derived** entry from its own name/description so it stays reachable regardless.',
    '',
  ];
  for (const domain of [...byDomain.keys()].sort()) {
    lines.push(`## ${domain}`, '', '| Skill | Keywords | Source |', '|---|---|---|');
    for (const r of [...byDomain.get(domain)].sort((a, b) => a.path.localeCompare(b.path))) {
      lines.push(`| \`${r.path}\` | ${r.keywords.join(', ')} | ${r.priority === AUTHORED_PRIORITY ? 'authored' : 'derived'} |`);
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

function main() {
  const check = process.argv.includes('--check');
  const write = process.argv.includes('--write');
  if (!check && !write) {
    console.error('usage: node scripts/generate-skill-routing.mjs --write|--check');
    process.exit(2);
  }

  const routes = buildRoutes();
  const json = `${JSON.stringify({ version: 2, routes }, null, 2)}\n`;
  const md = renderMarkdown(routes);

  if (check) {
    const currentJson = fs.existsSync(ROUTING_JSON_PATH) ? fs.readFileSync(ROUTING_JSON_PATH, 'utf8') : '';
    const currentMd = fs.existsSync(ROUTING_MD_PATH) ? fs.readFileSync(ROUTING_MD_PATH, 'utf8') : '';
    if (currentJson !== json || currentMd !== md) {
      console.error('skills/routing.json or skills/routing.md is out of date — run: node scripts/generate-skill-routing.mjs --write');
      process.exit(1);
    }
    console.log(`skill routing up to date (${routes.length} routes)`);
    return;
  }

  fs.writeFileSync(ROUTING_JSON_PATH, json);
  fs.writeFileSync(ROUTING_MD_PATH, md);
  console.log(`wrote ${routes.length} routes to skills/routing.json and skills/routing.md`);
}

main();
