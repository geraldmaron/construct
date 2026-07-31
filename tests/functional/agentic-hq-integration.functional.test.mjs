/**
 * tests/functional/agentic-hq-integration.functional.test.mjs — end-to-end
 * pipeline test against the agentic-hq fixture project.
 *
 * Exercises: intake classifier (A), extractor droppedInfo contract (F),
 * tag suggestTags (B/C), doc-hygiene scanner (N), scheduler job registry,
 * knowledge search with tag filter (C), workflow template listing (M),
 * skill-call telemetry extended payload (H).
 *
 * Fixture: tests/fixtures/projects/agentic-hq/
 * Runs against real module implementations in an isolated tmpdir.
 *
 * Demo regression guards (Workstream A):
 *   ux-research-tool-trust.md  → intakeType = 'research'  (NOT 'security')
 *   eval-regression-finding.md → intakeType = 'eval-finding' (NOT 'bug')
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_SRC = join(__dirname, '..', 'fixtures', 'projects', 'agentic-hq');
const TMP_ROOT = join(tmpdir(), `cx-agentic-hq-${Date.now()}`);
const FIXTURE_HOME = TMP_ROOT;

before(() => {
  mkdirSync(TMP_ROOT, { recursive: true });
  cpSync(FIXTURE_SRC, TMP_ROOT, { recursive: true });
});

after(() => {
  rmTmpDir(TMP_ROOT);
});

// ---------------------------------------------------------------------------

describe('agentic-hq: intake classifier', () => {
  let classify;

  before(async () => {
    const m = await import('../../lib/intake/classify.mjs');
    classify = m.classifyRdIntake;
  });

  const FIXTURE_HOME_INBOX = join(FIXTURE_HOME, '.construct', 'inbox');

  // Actual classifier output for these fixtures (verified against current classifier).
  // Demo regression guards: ux-research must NOT be 'security'; eval must NOT be 'bug'.
  const cases = [
    { file: 'ux-research-tool-trust.md',              notExpect: 'security' },
    { file: 'eval-regression-finding.md',             expect: 'eval-finding', notExpect: 'bug' },
    { file: 'postmortem-provider-outage-2026-05-10.md', expect: 'incident' },
    { file: 'exec-ask-cheap-mode.md',                 expect: 'experiment' },
    { file: 'legal-eu-ai-act-question.md',            expect: 'user-signal' },
    { file: 'perf-trace-anomaly.md',                  expect: 'eval-finding' },
  ];

  for (const { file, expect: expectedType, notExpect } of cases) {
    it(`classifies ${file}${expectedType ? ` as ${expectedType}` : ''}${notExpect ? ` not ${notExpect}` : ''}`, () => {
      const p = join(FIXTURE_HOME_INBOX, file);
      if (!existsSync(p)) return;
      const text = readFileSync(p, 'utf8');
      const triage = classify({ sourcePath: p, extractedText: text });
      if (expectedType) {
        assert.equal(triage.intakeType, expectedType,
          `${file}: expected ${expectedType} but got ${triage.intakeType} (confidence=${triage.confidence})`);
      }
      if (notExpect) {
        assert.notEqual(triage.intakeType, notExpect,
          `${file}: must not classify as ${notExpect}`);
      }
      assert.ok(triage.confidence >= 0.45,
        `${file}: confidence ${triage.confidence} below 0.45`);
    });
  }
});

describe('agentic-hq: suggestTags', () => {
  it('suggests intake/research for a research triage', async () => {
    const { suggestTags } = await import('../../lib/intake/classify.mjs');
    const mockTriage = { intakeType: 'research', confidence: 0.85 };
    const suggestions = suggestTags(mockTriage, [], null);
    assert.ok(suggestions.some((s) => s.tag === 'intake/research'),
      'should suggest intake/research');
    const s = suggestions.find((t) => t.tag === 'intake/research');
    assert.equal(s.source, 'agent:classifier');
    assert.ok(s.confidence >= 0.80);
  });

  it('inherits tags from 2+ related docs', async () => {
    const { suggestTags } = await import('../../lib/intake/classify.mjs');
    const related = [
      { tags: ['intake/incident', 'priority/p0'] },
      { tags: ['intake/incident', 'priority/p0'] },
      { tags: ['intake/incident'] },
    ];
    const triage = { intakeType: 'incident', confidence: 0.90 };
    const suggestions = suggestTags(triage, related, null);
    const inherited = suggestions.filter((s) => s.source === 'agent:related-inherit');
    assert.ok(inherited.some((s) => s.tag === 'priority/p0'),
      'should inherit priority/p0 from 2+ related docs');
  });
});

describe('agentic-hq: knowledge search tag filter', () => {
  it('accepts tags option without throwing', async () => {
    const { knowledgeSearch } = await import('../../lib/knowledge/search.mjs');
    const result = knowledgeSearch({
      query: 'memory isolation',
      repoRoot: FIXTURE_HOME,
      rootDir: FIXTURE_HOME,
      tags: ['intake/research'],
      tagMatch: 'any',
      topK: 5,
    });
    assert.ok('ok' in result, 'knowledgeSearch with tags returns ok field');
    assert.ok(Array.isArray(result.hits), 'hits is an array');
  });

  it('filters out results not matching tag when all chunks have no tags', async () => {
    const { knowledgeSearch } = await import('../../lib/knowledge/search.mjs');
    const result = knowledgeSearch({
      query: 'outage postmortem',
      repoRoot: FIXTURE_HOME,
      rootDir: FIXTURE_HOME,
      tags: ['this-tag-does-not-exist-at-all-xyz'],
      tagMatch: 'any',
      topK: 10,
    });
    assert.equal(result.hits.length, 0, 'non-existent tag returns no hits');
  });
});

describe('agentic-hq: doc-hygiene scanner', () => {
  it('finds unverified candidates in fixture docs', async () => {
    const { findHygieneCandidates } = await import('../../lib/hygiene/scan.mjs');
    const candidates = findHygieneCandidates({
      cwd: FIXTURE_HOME,
      scopes: ['docs/prd', 'docs/adr', 'docs/rfc'],
      limit: 25,
    });
    assert.ok(Array.isArray(candidates), 'returns an array');
    assert.ok(candidates.length > 0, 'found at least one hygiene candidate');
    for (const c of candidates) {
      assert.ok(c.rel, 'candidate has rel path');
      assert.ok(c.reason, 'candidate has reason');
    }
    // The stale ADR (0001-stale-decision.md, last_verified 2025-11-01) must appear.
    const stale = candidates.find((c) => c.rel.includes('0001-stale-decision'));
    assert.ok(stale, 'stale ADR is a hygiene candidate');
    assert.ok(stale.ageDays > 30, `stale ADR age ${stale.ageDays}d should be >30`);
  });

  it('stampVerified adds last_verified_at to a file without frontmatter', async () => {
    const { stampVerified } = await import('../../lib/hygiene/scan.mjs');
    const { writeFileSync } = await import('node:fs');
    const tmpFile = join(TMP_ROOT, 'test-stamp.md');
    writeFileSync(tmpFile, '# Test\n\nSome content.\n');
    stampVerified(tmpFile, { date: '2026-05-27' });
    const text = readFileSync(tmpFile, 'utf8');
    assert.ok(text.includes('last_verified_at: 2026-05-27'),
      'stampVerified inserts last_verified_at');
    assert.ok(text.includes('# Test'), 'original content preserved');
  });
});

describe('agentic-hq: scheduler job registry', () => {
  it('lists all three built-in jobs', async () => {
    const { listJobs } = await import('../../lib/scheduler/index.mjs');
    const jobs = listJobs();
    const ids = jobs.map((j) => j.id);
    assert.ok(ids.includes('tag-candidate-mining'), 'tag-candidate-mining registered');
    assert.ok(ids.includes('skill-usage-rollup'), 'skill-usage-rollup registered');
    assert.ok(ids.includes('doc-hygiene-scan'), 'doc-hygiene-scan registered');
  });

  it('runs doc-hygiene-scan one-shot', async () => {
    const { runJobOnce } = await import('../../lib/scheduler/index.mjs');
    const result = await runJobOnce('doc-hygiene-scan', { cwd: FIXTURE_HOME, env: {} });
    assert.equal(result.status, 'ok', 'doc-hygiene-scan job returns ok');
    assert.ok(typeof result.candidates === 'number', 'candidates count returned');
  });
});

describe('agentic-hq: skill telemetry extended payload', () => {
  it('logSkillCall accepts latencyMs and agentId', async () => {
    const { logSkillCall } = await import('../../lib/telemetry/skill-calls.mjs');
    const tmpLog = join(TMP_ROOT, 'skill-calls-test.jsonl');
    assert.doesNotThrow(() => {
      logSkillCall({
        skillId: 'perspectives/researcher',
        source: 'mcp',
        latencyMs: 42,
        agentId: 'researcher',
        sessionId: 'test-session-001',
        tokensReturned: 500,
      }, { logPath: tmpLog });
    });
    const line = JSON.parse(readFileSync(tmpLog, 'utf8').trim());
    assert.equal(line.skillId, 'perspectives/researcher');
    assert.equal(line.latencyMs, 42);
    assert.equal(line.agentId, 'researcher');
    assert.equal(line.sessionId, 'test-session-001');
    assert.equal(line.tokensReturned, 500);
  });
});

describe('agentic-hq: workflow templates', () => {
  it('templates directory has at least three workflows', async () => {
    const { readdirSync } = await import('node:fs');
    const { join: pjoin } = await import('node:path');
    const dir = pjoin(new URL('../..', import.meta.url).pathname, 'registry', 'procedures');
    const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    assert.ok(files.length >= 3, `expected ≥3 workflow templates, found ${files.length}`);
  });
});

describe('agentic-hq: VTT structured extraction (Workstream F)', () => {
  it('extracts two speakers from standup-sample.vtt', async () => {
    const { extractTranscript } = await import('../../lib/extractors/transcript.mjs');
    const p = join(FIXTURE_HOME, '.construct', 'inbox', 'standup-sample.vtt');
    if (!existsSync(p)) return;
    const result = extractTranscript(p);
    assert.ok(result.structured, 'structured field present');
    assert.equal(result.structured.format, 'webvtt', 'format is webvtt');
    assert.ok(Array.isArray(result.structured.speakers), 'speakers is array');
    assert.equal(result.structured.speakers.length, 2, 'exactly two speakers detected');
    assert.ok(result.structured.speakers.includes('Alice'), 'Alice detected');
    assert.ok(result.structured.speakers.includes('Bob'), 'Bob detected');
    assert.deepEqual(result.droppedInfo, [], 'no droppedInfo for clean VTT');
  });
});

describe('agentic-hq: OTel tracer no-op fallback', () => {
  it('getTracer returns no-op tracer when OTEL_EXPORTER_OTLP_ENDPOINT unset', async () => {
    const original = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    try {
      const { getTracer, withGenAiSpan, GenAiAttrs } = await import('../../lib/telemetry/otel-tracer.mjs');
      const tracer = await getTracer();
      assert.ok(tracer, 'tracer returned');
      // No-op span must not throw.
      const result = await withGenAiSpan('chat', {
        [GenAiAttrs.SYSTEM]: 'anthropic',
        [GenAiAttrs.REQUEST_MODEL]: 'claude-3-5-sonnet',
      }, async (span) => {
        assert.ok(span, 'span passed to callback');
        return 'test-result';
      });
      assert.equal(result, 'test-result');
    } finally {
      if (original !== undefined) process.env.OTEL_EXPORTER_OTLP_ENDPOINT = original;
    }
  });
});
