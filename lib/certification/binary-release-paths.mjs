/**
 * lib/certification/binary-release-paths.mjs — compiled binary release certification
 * evidence (construct-tsyfe.10.5).
 *
 * Records the asymmetric certification posture between the Node SEA release
 * pipeline (release.yml, production) and the Bun-compiled smoke track
 * (bun-binary-smoke.yml, non-gating). Consumable by release go/no-go gates.
 */

export const BINARY_RELEASE_PATHS = Object.freeze({
  NODE_SEA: Object.freeze({
    id: 'node-sea',
    certificationLevel: 'production-release-integrated',
    workflow: '.github/workflows/release.yml',
    buildSteps: Object.freeze([
      'Build SEA blob (esbuild bundle + node --experimental-sea-config)',
      'postject NODE_SEA_BLOB with sentinel fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
    ]),
    matrix: Object.freeze(['linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64', 'windows-x64']),
    gatesRelease: true,
    notes:
      'Primary shipped binary path. SEA artifacts attach to GitHub Releases on every v* tag.',
  }),
  BUN_COMPILE: Object.freeze({
    id: 'bun-compile',
    certificationLevel: 'workflow-dispatch-and-path-triggered-smoke',
    workflow: '.github/workflows/bun-binary-smoke.yml',
    buildScript: 'scripts/build-binary.mjs',
    matrix: Object.freeze(['linux-x64', 'darwin-arm64']),
    gatesRelease: false,
    notes:
      'Standalone smoke only. Header comment in bun-binary-smoke.yml states this track must never gate release.yml.',
    smokeChecks: Object.freeze([
      'construct doctor prints Results: N passed line',
      'construct sandbox create/list/delete lifecycle with stdout assertions',
    ]),
  }),
});

/**
 * @returns {object} certification evidence artifact for release decision-makers
 */
export function buildBinaryReleaseCertificationEvidence({
  nodeSeaWorkflowGreen = null,
  bunSmokeWorkflowGreen = null,
  bunBinaryAdvertisedInDocs = false,
} = {}) {
  return Object.freeze({
    artifact: 'binary-release-path-certification',
    generatedAt: new Date().toISOString(),
    asymmetryDisclosure:
      'Node SEA is release-integrated production evidence; Bun compile is opportunistic smoke and does not gate releases.',
    paths: BINARY_RELEASE_PATHS,
    workflowStatus: Object.freeze({
      nodeSea: nodeSeaWorkflowGreen,
      bunSmoke: bunSmokeWorkflowGreen,
    }),
    bunBinaryAdvertisedInDocs,
    parityImplied: false,
  });
}
