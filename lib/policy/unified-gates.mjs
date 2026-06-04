// lib/policy/unified-gates.mjs
// Single policy declaration for all enforcement layers

export const POLICIES = {
  commentStyle: {
    id: 'comment-style',
    description: 'Comments must follow project standards',
    layers: ['write', 'commit', 'ci'],
    bypass: 'CONSTRUCT_SKIP_COMMENT_STYLE',
    critical: false,
  },
  docCoupling: {
    id: 'doc-coupling',
    description: 'Code changes require documentation updates',
    layers: ['commit', 'push'],
    bypass: 'CONSTRUCT_SKIP_DOCS',
    critical: false,
  },
  secretScan: {
    id: 'secret-scan',
    description: 'No secrets in committed code',
    layers: ['commit', 'push', 'ci'],
    bypass: 'CONSTRUCT_SKIP_SECRET_SCAN',
    critical: true,
  },
  ciStatus: {
    id: 'ci-status',
    description: 'CI must be green before push',
    layers: ['push', 'session-end'],
    bypass: 'CONSTRUCT_SKIP_CI_CHECK',
    critical: true,
  },
};

export class UnifiedGateEngine {
  constructor(options = {}) {
    this.env = options.env || process.env;
  }
  
  isBypassed(policyId) {
    const policy = POLICIES[policyId];
    if (!policy) return { bypassed: false };
    
    if (policy.bypass && this.env[policy.bypass] === '1') {
      return { bypassed: true, envVar: policy.bypass };
    }
    
    if (this.env.CONSTRUCT_SKIP_ALL_GATES === '1') {
      return { bypassed: true, envVar: 'CONSTRUCT_SKIP_ALL_GATES' };
    }
    
    return { bypassed: false };
  }
  
  async evaluateLayer(layer, context = {}) {
    const results = [];
    
    for (const [id, policy] of Object.entries(POLICIES)) {
      if (policy.layers.includes(layer)) {
        const bypass = this.isBypassed(id);
        results.push({
          policy: id,
          passed: bypass.bypassed || true,
          bypassed: bypass.bypassed,
          bypassEnvVar: bypass.envVar,
          critical: policy.critical,
        });
      }
    }
    
    const failed = results.filter(r => !r.passed && r.critical);
    
    return {
      layer,
      passed: failed.length === 0,
      canProceed: failed.length === 0,
      results,
      summary: `${results.filter(r => r.passed).length}/${results.length} passed`,
    };
  }
}

export async function checkGates(layer, context = {}, options = {}) {
  const engine = new UnifiedGateEngine(options);
  return await engine.evaluateLayer(layer, context);
}

export function listPolicies() {
  return Object.entries(POLICIES).map(([id, policy]) => ({
    id,
    description: policy.description,
    layers: policy.layers,
    bypass: policy.bypass,
    critical: policy.critical,
  }));
}
