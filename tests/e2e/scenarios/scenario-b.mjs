/**
 * tests/e2e/scenarios/scenario-b.mjs — Established noisy project scenario executor.
 *
 * Clones a real mid-size OSS TypeScript repo (honojs/hono, MIT) into a sterile
 * env, pre-seeds the host noise an earlier tool would have left — a non-Construct
 * AGENTS.md, a .cursor/rules entry, a stub .claude/agents/foo.md, and extra
 * .gitignore lines — and commits it all BEFORE `construct init` runs. The point
 * of the scenario is the non-destructive scaffolding contract: init
 * must inject its marker blocks and ignore patterns without clobbering content it
 * does not own.
 *
 * Generic tiers (install/init UX, command sweep, embedder probes) are reused from
 * scenario-a; this module owns the fixture, the disposition capture, and the
 * Tier-3 PRD (driven by the host product-manager chain, like scenario-a's ADR).
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { makeSterileEnv, timedRun, gitInit } from '../lib/sterile-env.mjs';

export const FIXTURE_REPO = { url: 'https://github.com/honojs/hono.git', name: 'hono', license: 'MIT' };

// The host noise seeded before init: each file carries a sentinel line so the
// post-init disposition check can prove the original content survived byte-for-
// byte alongside whatever Construct injects.

const NOISE = {
  'AGENTS.md': '# Project Agents\n\nSENTINEL-AGENTS: this project already documented a custom agent workflow before Construct.\nUse the `legacy-bot` for triage.\n',
  '.cursor/rules/legacy.mdc': '---\ndescription: legacy cursor rule\n---\nSENTINEL-CURSOR: prefer composition over inheritance.\n',
  '.claude/agents/foo.md': '---\nname: foo\ndescription: stub agent from an earlier tool\n---\nSENTINEL-FOO: do foo things.\n',
};

const GITIGNORE_POLLUTION = '\n# SENTINEL-GITIGNORE custom entries\ncustom-build-dir/\n*.localcache\n';

function sha(content) {
  let h = 0;
  for (let i = 0; i < content.length; i++) { h = (h * 31 + content.charCodeAt(i)) >>> 0; }
  return `${content.length}:${h}`;
}

export function seedNoise(projectDir) {
  const seeded = {};
  for (const [rel, content] of Object.entries(NOISE)) {
    const full = join(projectDir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
    seeded[rel] = sha(content);
  }
  // Pollute the repo's existing .gitignore (hono ships one) by appending.
  const gi = join(projectDir, '.gitignore');
  const existing = existsSync(gi) ? readFileSync(gi, 'utf8') : '';
  writeFileSync(gi, existing + GITIGNORE_POLLUTION);
  seeded['.gitignore.sentinel'] = GITIGNORE_POLLUTION.trim();
  return seeded;
}

export function setup({ repoRoot }) {
  const sterile = makeSterileEnv({ repoRoot, prefix: 'cx-e2e-b-' });
  const clone = timedRun({
    bin: 'git', args: ['clone', '--depth', '1', FIXTURE_REPO.url, sterile.project], cwd: sterile.root, env: sterile.env, timeoutMs: 300_000,
  });
  let cloneSha = null;
  try { cloneSha = readFileSync(join(sterile.project, '.git', 'HEAD'), 'utf8').trim(); } catch { /* shallow */ }
  const seeded = seedNoise(sterile.project);
  // Commit the noise so init acts on a real working tree with history.
  gitInit({ cwd: sterile.project, env: sterile.env });
  timedRun({ bin: 'git', args: ['add', '-A'], cwd: sterile.project, env: sterile.env });
  timedRun({ bin: 'git', args: ['commit', '-q', '-m', 'seed host noise'], cwd: sterile.project, env: sterile.env });
  return { sterile, clone, cloneSha, seeded };
}

// The heart of scenario B: prove init preserved every seeded sentinel and that
// Construct injected its marker block into AGENTS.md without removing the prior
// content, and appended ignore patterns without dropping the polluted lines.

export function captureDisposition({ projectDir, seeded }) {
  const read = (rel) => { try { return readFileSync(join(projectDir, rel), 'utf8'); } catch { return null; } };
  const agents = read('AGENTS.md') || '';
  const gitignore = read('.gitignore') || '';
  const foo = read('.claude/agents/foo.md') || '';
  const cursor = read('.cursor/rules/legacy.mdc') || '';

  return {
    agentsExistingPreserved: agents.includes('SENTINEL-AGENTS'),
    agentsMarkerInjected: /BEGIN CONSTRUCT INTEGRATION/.test(agents) || /CONSTRUCT INTEGRATION/.test(agents),
    fooPreserved: foo.includes('SENTINEL-FOO'),
    cursorPreserved: cursor.includes('SENTINEL-CURSOR'),
    gitignoreExistingPreserved: gitignore.includes('SENTINEL-GITIGNORE') && gitignore.includes('custom-build-dir/'),
    gitignoreConstructAppended: /\.construct\//.test(gitignore),
  };
}
