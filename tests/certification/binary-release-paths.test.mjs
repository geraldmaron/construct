/**
 * tests/certification/binary-release-paths.test.mjs
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  BINARY_RELEASE_PATHS,
  buildBinaryReleaseCertificationEvidence,
} from '../../lib/certification/binary-release-paths.mjs';

describe('binary-release-path certification evidence', () => {
  it('states Node SEA is release-integrated production evidence', () => {
    const sea = BINARY_RELEASE_PATHS.NODE_SEA;
    assert.equal(sea.gatesRelease, true);
    assert.match(sea.workflow, /release\.yml/);
    assert.match(sea.buildSteps.join(' '), /SEA blob/);
    assert.match(sea.buildSteps.join(' '), /postject/);
  });

  it('states Bun path is non-gating smoke per bun-binary-smoke.yml header intent', () => {
    const bun = BINARY_RELEASE_PATHS.BUN_COMPILE;
    assert.equal(bun.gatesRelease, false);
    assert.match(bun.workflow, /bun-binary-smoke\.yml/);
    assert.match(bun.notes, /never gate/);
  });

  it('buildBinaryReleaseCertificationEvidence discloses asymmetry explicitly', () => {
    const evidence = buildBinaryReleaseCertificationEvidence();
    assert.equal(evidence.parityImplied, false);
    assert.match(evidence.asymmetryDisclosure, /Node SEA/);
    assert.match(evidence.asymmetryDisclosure, /Bun/);
    assert.ok(evidence.generatedAt);
  });
});
