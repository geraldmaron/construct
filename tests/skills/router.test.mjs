/**
 * tests/skills/router.test.mjs — skill route matching and suggestion.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { suggestSkills } from '../../lib/skills/router.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const REPO = new URL('../..', import.meta.url).pathname;

test('legacy routes still resolve their intended skill', () => {
  const cases = [
    ['explore repo', 'exploration/repo-map'],
    ['security scan', 'quality-gates/verify-security'],
    ['code quality', 'quality-gates/verify-quality'],
    ['change impact', 'quality-gates/verify-change'],
    ['write a prd', 'docs/prd-workflow'],
    ['architecture decision', 'docs/adr-workflow'],
    ['user research', 'docs/research-workflow'],
    ['strategic bets', 'docs/strategy-workflow'],
    ['retrieval augmented generation', 'ai/rag-system'],
    ['handoff contract', 'ai/orchestration-workflow'],
    ['owasp', 'security/pentest'],
  ];
  for (const [intent, expectedPath] of cases) {
    const { suggestions } = suggestSkills({ intent, rootDir: REPO, limit: 5 });
    const paths = suggestions.map((s) => s.path);
    assert.ok(paths.includes(expectedPath), `"${intent}" → expected ${expectedPath} in ${JSON.stringify(paths)}`);
  }
});

test('the bidirectional-substring false positives no longer fire', () => {
  // Each probe contains the literal substring "rag" inside an unrelated word
  // and nothing that is a genuine keyword of ai/rag-system in its own right
  // ("vector"/"retrieval"/"embedding" would be a true positive, not a probe).
  const probes = ['average latency dashboard', 'drag and drop ui', 'the fragrance of this release'];
  for (const intent of probes) {
    const { suggestions } = suggestSkills({ intent, rootDir: REPO, limit: 10 });
    const paths = suggestions.map((s) => s.path);
    assert.ok(!paths.includes('ai/rag-system'), `"${intent}" must not match ai/rag-system via "rag" substring; got ${JSON.stringify(paths)}`);
  }
});

test('previously-unreachable skills are now suggestible via their derived fallback keywords', () => {
  const { suggestions } = suggestSkills({ intent: 'designing a rest api', rootDir: REPO, limit: 5 });
  assert.ok(suggestions.some((s) => s.path === 'architecture/api-design'), JSON.stringify(suggestions));
});

test('a keyword part under 5 chars requires an exact token match, not a prefix', () => {
  // "rag" (3 chars) must not match "ragged"/"raggedy"-style tokens via prefix either.
  const { suggestions } = suggestSkills({ intent: 'a raggedy old blanket', rootDir: REPO, limit: 10 });
  assert.ok(!suggestions.some((s) => s.path === 'ai/rag-system'), JSON.stringify(suggestions));
});

test('a keyword part >=5 chars matches an inflected token via prefix', () => {
  const { suggestions } = suggestSkills({ intent: 'auditing our secrets management', rootDir: REPO, limit: 10 });
  assert.ok(suggestions.some((s) => s.path === 'quality-gates/verify-security'), JSON.stringify(suggestions));
});

test('a stopword shared between a keyword phrase and an unrelated intent does not misfire', () => {
  // exploration/repo-map's authored trigger "how is this structured" is 3/4
  // stopwords; brand/output-vibe's "write a prd" contains the stopword "a".
  // Neither intent below shares a single significant word with either
  // skill's real triggers — only the stopword overlaps.
  const probes = [
    ['feeling codependent in this relationship', 'exploration/repo-map'],
    ['a raggedy old blanket', 'brand/output-vibe'],
  ];
  for (const [intent, mustNotMatch] of probes) {
    const { suggestions } = suggestSkills({ intent, rootDir: REPO, limit: 10 });
    const paths = suggestions.map((s) => s.path);
    assert.ok(!paths.includes(mustNotMatch), `"${intent}" must not match ${mustNotMatch} via a shared stopword; got ${JSON.stringify(paths)}`);
  }
});

test('workflow-skill boost requires an exact prd/adr token, not a substring', () => {
  const { suggestions: withAdr } = suggestSkills({ intent: 'write an adr for this decision', rootDir: REPO, limit: 10 });
  assert.ok(withAdr.length > 0);
  const { suggestions: withoutAdr } = suggestSkills({ intent: 'my address changed recently', rootDir: REPO, limit: 10 });
  const paths = withoutAdr.map((s) => s.path);
  assert.ok(!paths.some((p) => p.endsWith('adr-workflow')), `"address" must not trigger the adr workflow boost; got ${JSON.stringify(paths)}`);
});

test('unknown intent returns no suggestions rather than a low-confidence guess', () => {
  const { suggestions } = suggestSkills({ intent: 'zzz qqq nonsense gibberish', rootDir: REPO, limit: 5 });
  assert.deepEqual(suggestions, []);
});

test('entitlement is annotated per worker profile, not enforced', () => {
  const { suggestions } = suggestSkills({ intent: 'write a prd', workerProfileId: 'product-manager', rootDir: REPO, limit: 5 });
  const prd = suggestions.find((s) => s.path === 'docs/prd-workflow');
  assert.ok(prd, JSON.stringify(suggestions));
  assert.equal(typeof prd.entitled, 'boolean');
});

test('the route cache invalidates when routing.json changes on disk, not just on first load', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'router-cache-test-'));
  const skillsDir = join(tmp, 'skills');
  mkdirSync(skillsDir, { recursive: true });
  const routingPath = join(skillsDir, 'routing.json');

  // Explicit, deterministic mtimes (not the real clock) so the test cannot
  // flake on a filesystem with coarse mtime resolution: T1 is unambiguously
  // after T0 regardless of how fast the two writes actually execute.
  const T0 = new Date('2020-01-01T00:00:00Z');
  const T1 = new Date('2020-01-02T00:00:00Z');

  writeFileSync(routingPath, JSON.stringify({ version: 2, routes: [{ domain: 'test', keywords: ['alpha'], path: 'test/alpha', priority: 10 }] }));
  utimesSync(routingPath, T0, T0);
  const first = suggestSkills({ intent: 'alpha', rootDir: tmp, limit: 5 });
  assert.ok(first.suggestions.some((s) => s.path === 'test/alpha'));

  writeFileSync(routingPath, JSON.stringify({ version: 2, routes: [{ domain: 'test', keywords: ['beta'], path: 'test/beta', priority: 10 }] }));
  utimesSync(routingPath, T1, T1);

  const second = suggestSkills({ intent: 'alpha', rootDir: tmp, limit: 5 });
  assert.ok(!second.suggestions.some((s) => s.path === 'test/alpha'), 'stale cached route must not survive a routing.json change');
  const third = suggestSkills({ intent: 'beta', rootDir: tmp, limit: 5 });
  assert.ok(third.suggestions.some((s) => s.path === 'test/beta'), 'the new route must be visible after the cache invalidates');

  rmTmpDir(tmp);
});
