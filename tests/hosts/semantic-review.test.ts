import { test } from 'node:test';
import assert from 'node:assert/strict';
import { disableReviewMcp, pinSemanticReviewer, reviewerIdentityProblems } from '../../src/hosts/semantic-review.ts';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sandbox } from '../cli/support.ts';
test('startup does not pin a workspace PATH script; a changed frozen executable is unavailable', () => {
  const b = sandbox();
  try {
    const bin = join(b.cwd, 'bin');
    mkdirSync(bin);
    const fake = join(bin, 'codex');
    writeFileSync(fake, '#!/bin/sh\necho codex-cli 0.163.0\n', { mode: 0o755 });
    assert.equal(pinSemanticReviewer('codex', { PATH: bin, HOME: b.home }, b.cwd), null);
    assert.equal(pinSemanticReviewer('cursor', { PATH: bin, HOME: b.home }, b.cwd), null);
    assert.match(
      reviewerIdentityProblems({
        host: 'codex',
        binary: fake,
        digest: 'wrong',
        version: 'codex-cli 0.163.0',
        profile: 'codex-held-text-v1',
      }).join(),
      /changed/,
    );
  } finally {
    b.cleanup();
  }
});

test('MCP overrides use the native CLI key syntax and reject ambiguous names', () => {
  assert.deepEqual(disableReviewMcp(['construct', 'source_api']), [
    '-c',
    'mcp_servers.construct.enabled=false',
    '-c',
    'mcp_servers.source_api.enabled=false',
  ]);
  assert.throws(() => disableReviewMcp(['source.with.dot']), /cannot safely override/);
});
