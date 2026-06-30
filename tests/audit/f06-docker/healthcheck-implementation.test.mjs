/**
 * tests/audit/f06-docker/healthcheck-implementation.red.mjs — F06 [R23] HEALTHCHECK targets an unimplemented route.
 *
 * RED fixture (must FAIL against the current repo). The Dockerfile HEALTHCHECK
 * curls `http://localhost:4242/api/auth/status`. The same path is wired into the
 * ECS container health check and the ALB target group (deploy/terraform/modules/
 * ecs/main.tf). But no server in the repo registers that route: the only matches
 * for the path string are in the Dockerfile, Terraform, deploy docs, deploy
 * smoke workflows, and a PRD that explicitly calls it a future "stub" — never a
 * handler. With lib/server/ deleted (ADR-0039, 2026-06-25), nothing serves it,
 * so the health check can never return 200 and every task is killed as unhealthy.
 *
 * Extracts the HEALTHCHECK URL path from the real Dockerfile, then scans the
 * shipped source roots (lib/, bin/) for any module that both contains that path
 * string and stands up an HTTP server (createServer / .listen). None exists
 * today.
 *
 * Turns GREEN once a real handler implementing the health path ships (or the
 * health check is repointed at an implemented endpoint), per
 * CX-AUDIT-DOCKER-002 / -004.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../');
const dockerfile = path.join(repoRoot, 'Dockerfile');

// HEALTHCHECK form: `CMD curl -fs http://localhost:PORT/PATH || exit 1`. Path
// component extracted from the curl URL so the assertion follows the Dockerfile
// rather than a hardcoded route.

function readHealthcheckPath(dockerfileText) {
  const m = dockerfileText.match(/HEALTHCHECK[\s\S]*?https?:\/\/[^/\s]+(\/[^\s"'|]*)/);
  return m ? m[1] : null;
}

// Walk the shipped source roots and collect every .mjs/.js file that stands up
// an HTTP server. A health route only counts if something actually listens.

function collectServerFiles(roots) {
  const out = [];
  const stack = [...roots];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === 'node_modules') continue;
        stack.push(full);
      } else if (/\.(mjs|js)$/.test(ent.name)) {
        out.push(full);
      }
    }
  }
  return out;
}

test('[R23] Dockerfile HEALTHCHECK path must be implemented by a server in the repo', () => {
  // ADR-0039 degate: if the Dockerfile was removed, no health check can reference an
  // unimplemented route — the requirement is satisfied.
  if (!fs.existsSync(dockerfile)) return;

  const text = fs.readFileSync(dockerfile, 'utf8');
  const healthPath = readHealthcheckPath(text);

  assert.ok(healthPath, 'could not parse a HEALTHCHECK URL path from the Dockerfile');

  const roots = [path.join(repoRoot, 'lib'), path.join(repoRoot, 'bin')];
  const files = collectServerFiles(roots);

  const implementing = files.filter((f) => {
    const src = fs.readFileSync(f, 'utf8');
    const registersPath = src.includes(healthPath);
    const isServer = /createServer\s*\(|\.listen\s*\(/.test(src);
    return registersPath && isServer;
  });

  assert.ok(
    implementing.length > 0,
    `Dockerfile HEALTHCHECK targets ${healthPath}, but no shipped server (lib/ or bin/) ` +
      `both references that path and listens on a socket — the health check can never pass. ` +
      `The path appears only in deploy config/docs (Dockerfile, Terraform, RUNBOOK, PRD stub).`,
  );
});
