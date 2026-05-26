/**
 * lib/knowledge/research-store.mjs — Persist research findings into the knowledge base.
 *
 * Wraps the existing document-ingest pipeline so research output written via
 * `construct knowledge add --source=research` lands in
 * `.cx/knowledge/external/research/<slug>.md` with research-specific frontmatter
 * (topic, confidence, sources, expiresAt, profile). The file is then synced into
 * the SQL/vector index via the standard `syncFileStateToSql` path.
 *
 * Schema (frontmatter):
 *   kind: research-finding
 *   topic: string
 *   confidence: confirmed | inferred | weak
 *   sources: [{ url, accessedAt, span? }]
 *   expiresAt: ISO date (default +90d)
 *   profile: <profile-id>
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { syncFileStateToSql } from '../storage/sync.mjs';
import { resolveActiveProfile } from '../profiles/loader.mjs';
import { ensureCxDir } from '../project-init-shared.mjs';

const ROOT = '.cx/knowledge/external/research';
const MAX_BYTES = 50 * 1024;
const DEFAULT_TTL_DAYS = 90;

const VALID_CONFIDENCE = new Set(['confirmed', 'inferred', 'weak']);

/**
 * @param {object} args
 * @param {string} args.cwd - project root
 * @param {string} args.slug - filename slug (lowercase, hyphenated)
 * @param {string} args.topic - human-readable topic line
 * @param {string} args.body - the FINDINGS / INFERENCES / GAPS / RECOMMENDATION block
 * @param {string} [args.confidence] - confirmed | inferred | weak
 * @param {Array<{url:string,accessedAt?:string,span?:string}>} [args.sources]
 * @param {number} [args.ttlDays] - override default expiry
 * @returns {Promise<{path:string,bytes:number}>}
 */
export async function addResearchFinding({
  cwd,
  slug,
  topic,
  body,
  confidence = 'inferred',
  sources = [],
  ttlDays = DEFAULT_TTL_DAYS,
}) {
  if (!cwd) throw new Error('addResearchFinding: cwd is required');
  if (!slug || !/^[a-z0-9][a-z0-9-]{0,60}$/.test(slug)) {
    throw new Error('addResearchFinding: slug must be lowercase, hyphenated, max 60 chars');
  }
  if (!topic || typeof topic !== 'string') {
    throw new Error('addResearchFinding: topic is required');
  }
  if (!body || typeof body !== 'string') {
    throw new Error('addResearchFinding: body is required');
  }
  if (!VALID_CONFIDENCE.has(confidence)) {
    throw new Error(`addResearchFinding: confidence must be one of ${Array.from(VALID_CONFIDENCE).join(', ')}`);
  }
  if (confidence === 'confirmed' && (!Array.isArray(sources) || sources.length === 0)) {
    throw new Error('addResearchFinding: confidence=confirmed requires at least one source');
  }

  const profile = resolveActiveProfile(cwd);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000).toISOString();

  const outDir = join(cwd, ROOT);
  ensureCxDir(cwd);
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `${slug}.md`);

  const fmSources = (Array.isArray(sources) ? sources : [])
    .filter((s) => s && typeof s.url === 'string')
    .map((s) => ({
      url: s.url,
      accessedAt: s.accessedAt || now.toISOString(),
      ...(s.span ? { span: String(s.span).slice(0, 200) } : {}),
    }));

  const frontmatter = [
    '---',
    'kind: research-finding',
    `topic: ${JSON.stringify(topic)}`,
    `confidence: ${confidence}`,
    `sources: ${JSON.stringify(fmSources)}`,
    `created: ${now.toISOString()}`,
    `expiresAt: ${expiresAt}`,
    `profile: ${profile?.id ?? 'rnd'}`,
    '---',
    '',
  ].join('\n');

  const fullText = frontmatter + body.trim() + '\n';
  if (Buffer.byteLength(fullText, 'utf8') > MAX_BYTES) {
    throw new Error(`addResearchFinding: file exceeds ${MAX_BYTES} bytes`);
  }

  writeFileSync(outPath, fullText);

  // Best-effort sync into SQL/vector index. The file is the source of truth;
  // index lag never blocks the operator.
  try {
    await syncFileStateToSql(cwd, { project: profile?.id ?? 'rnd' });
  } catch { /* best effort */ }

  return { path: outPath, bytes: Buffer.byteLength(fullText, 'utf8') };
}
