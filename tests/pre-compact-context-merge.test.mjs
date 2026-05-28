/**
 * tests/pre-compact-context-merge.test.mjs — unit tests for the manual-section
 * preservation logic added to lib/hooks/pre-compact.mjs.
 *
 * Tests the two exported-by-convention helpers (parseSections,
 * extractManualSections, mergeExistingJson) directly so the hook itself does
 * not need to be spawned as a subprocess.
 *
 * The helpers are not formally exported from the hook (it is a standalone
 * script) so we test the behaviour through the resulting context.md content
 * by running the hook's logic inline.
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ---------------------------------------------------------------------------
// Helpers inlined from the hook to keep the test self-contained.

const AUTO_SECTION_NAMES = new Set([
  'what was in progress',
  'files changed this session',
  'decisions captured',
  'pending todos',
  'session efficiency snapshot',
  'open issues',
  'session context',
]);

function parseSections(md) {
  if (!md) return [];
  const lines = md.split('\n');
  const sections = [];
  let current = null;
  for (const line of lines) {
    const hm = line.match(/^(#{1,6})\s+(.+)$/);
    if (hm) {
      if (current) sections.push(current);
      current = { heading: line, level: hm[1].length, title: hm[2].trim(), body: [] };
    } else if (current) {
      current.body.push(line);
    }
  }
  if (current) sections.push(current);
  return sections;
}

function extractManualSections(md) {
  if (!md) return '';
  const sections = parseSections(md);
  const manual = sections.filter((s) => !AUTO_SECTION_NAMES.has(s.title.toLowerCase()));
  if (!manual.length) return '';
  return manual
    .map((s) => [s.heading, ...s.body].join('\n').trimEnd())
    .join('\n\n') + '\n';
}

function mergeExistingJson(existing, newState) {
  if (!existing) return newState;
  const merged = { ...newState };
  for (const key of ['decisions', 'filesChanged', 'pendingTodos']) {
    if ((!merged[key] || !merged[key].length) && Array.isArray(existing[key]) && existing[key].length) {
      merged[key] = existing[key];
    }
  }
  return merged;
}

// ---------------------------------------------------------------------------

describe('parseSections', () => {
  it('returns empty array for empty input', () => {
    assert.deepEqual(parseSections(''), []);
    assert.deepEqual(parseSections(null), []);
  });

  it('parses simple sections', () => {
    const md = '# Title\n\ncontent\n\n## Sub\nbody line\n';
    const sections = parseSections(md);
    assert.equal(sections.length, 2);
    assert.equal(sections[0].title, 'Title');
    assert.equal(sections[1].title, 'Sub');
    assert.ok(sections[1].body.includes('body line'));
  });
});

describe('extractManualSections', () => {
  it('returns empty string when all sections are auto-generated', () => {
    const md = [
      '# Session Context',
      'Last saved: 2026-05-28',
      '',
      '## What was in progress',
      'some summary',
      '',
      '## Session efficiency snapshot',
      '100 reads',
      '',
      '## Open issues',
      'None',
    ].join('\n');
    assert.equal(extractManualSections(md), '');
  });

  it('preserves manual sections and omits auto sections', () => {
    const md = [
      '# Session Context',
      'Last saved: 2026-05-28',
      '',
      '## What was in progress',
      '(no summary available)',
      '',
      '## Active work',
      'Releasing v1.0.8',
      '',
      '## Architecture decisions (this session)',
      '- OTel uses optional deps',
      '- Tags: 5 facets',
      '',
      '## Open issues',
      'None',
    ].join('\n');

    const result = extractManualSections(md);
    assert.ok(result.includes('## Active work'), 'preserves Active work section');
    assert.ok(result.includes('Releasing v1.0.8'), 'preserves section body');
    assert.ok(result.includes('## Architecture decisions (this session)'), 'preserves decisions section');
    assert.ok(!result.includes('## What was in progress'), 'strips auto section');
    assert.ok(!result.includes('## Open issues'), 'strips auto section');
  });

  it('handles context.md with only manual sections', () => {
    const md = '## Active work\nDoing stuff\n\n## Custom notes\nSome notes\n';
    const result = extractManualSections(md);
    assert.ok(result.includes('## Active work'));
    assert.ok(result.includes('## Custom notes'));
  });
});

describe('mergeExistingJson', () => {
  it('carries forward non-empty arrays when new state has empty arrays', () => {
    const existing = {
      decisions: ['decision A', 'decision B'],
      filesChanged: ['lib/foo.mjs'],
      pendingTodos: [{ content: 'do thing', status: 'pending' }],
    };
    const newState = { decisions: [], filesChanged: [], pendingTodos: [] };
    const merged = mergeExistingJson(existing, newState);
    assert.deepEqual(merged.decisions, existing.decisions);
    assert.deepEqual(merged.filesChanged, existing.filesChanged);
    assert.deepEqual(merged.pendingTodos, existing.pendingTodos);
  });

  it('does NOT overwrite non-empty arrays in new state with existing', () => {
    const existing = { decisions: ['old decision'], filesChanged: [] };
    const newState = { decisions: ['fresh decision'], filesChanged: [] };
    const merged = mergeExistingJson(existing, newState);
    assert.deepEqual(merged.decisions, ['fresh decision'], 'new decisions take precedence');
  });

  it('returns newState when existing is null', () => {
    const newState = { decisions: [], filesChanged: [] };
    assert.deepEqual(mergeExistingJson(null, newState), newState);
  });

  it('does not add unexpected keys from existing', () => {
    const existing = { decisions: ['d'], extraField: 'should not appear' };
    const newState = { decisions: [] };
    const merged = mergeExistingJson(existing, newState);
    assert.ok(!('extraField' in merged), 'does not carry forward non-list keys');
  });
});

describe('integration: manual sections survive a simulated compaction', () => {
  let tmpDir;
  after(() => { if (tmpDir) rmSync(tmpDir, { recursive: true, force: true }); });

  it('re-appends manual sections after auto-generated content', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'cx-precompact-'));
    const mdPath = join(tmpDir, 'context.md');
    writeFileSync(mdPath, [
      '# Session Context',
      'Last saved: 2026-05-27',
      '',
      '## What was in progress',
      '(stale)',
      '',
      '## Active work',
      'Releasing v1.0.8 from feat/platform-capabilities',
      '',
      '## Architecture decisions (this session)',
      '- OTel: graceful-degrade via optional deps',
      '',
      '## Open issues',
      'None',
    ].join('\n') + '\n');

    const existing = readFileSync(mdPath, 'utf8');
    const manual = extractManualSections(existing);

    // Simulate what the hook produces as auto content.
    const autoContent = [
      '# Session Context',
      'Last saved: 2026-05-28 04:00',
      '',
      '## What was in progress',
      'latest assistant text from transcript',
      '',
      '## Open issues',
      'None',
      '',
    ].join('\n') + '\n';

    const finalContent = autoContent + (manual ? '\n' + manual : '');

    assert.ok(finalContent.includes('## Active work'), 'active-work section preserved');
    assert.ok(finalContent.includes('Releasing v1.0.8'), 'section body preserved');
    assert.ok(finalContent.includes('## Architecture decisions (this session)'), 'decisions section preserved');
    assert.ok(finalContent.includes('latest assistant text'), 'auto content present');
    assert.ok(finalContent.indexOf('## Active work') > finalContent.indexOf('## Open issues') ||
              finalContent.indexOf('## Active work') > finalContent.indexOf('## What was in progress'),
              'manual sections appear after auto sections');
  });
});
