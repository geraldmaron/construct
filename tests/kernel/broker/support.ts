/**
 * tests/kernel/broker/support.ts — a broker context over an initialized
 * project in a sandbox, with a deterministic clock and ids.
 */

import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { initializeProject } from '../../../src/kernel/project/initialize.ts';
import { createSkillRegistry } from '../../../src/kernel/registry/skill-registry.ts';
import { createWorkflowRegistry } from '../../../src/kernel/registry/workflow-registry.ts';
import { updateLock } from '../../../src/kernel/registry/lockfile.ts';
import { writeJsonFile } from '../../../src/kernel/project/files.ts';
import { readProjectFiles } from '../../../src/kernel/project/initialize.ts';
import { createBrokerContext, type BrokerBinding } from '../../../src/cli/broker-context.ts';
import { createContext, type CliContext } from '../../../src/cli/context.ts';
import type { BrokerContext } from '../../../src/kernel/broker/context.ts';
import { sandbox, type Sandbox } from '../../cli/support.ts';

export interface BrokerFixture {
  readonly box: Sandbox;
  readonly ctx: CliContext;
  readonly broker: BrokerContext;
  readonly binding: BrokerBinding;
  cleanup(): void;
}

export function brokerFixture(surface: 'interactive' | 'headless' = 'interactive'): BrokerFixture {
  const box = sandbox();
  const at = '2026-09-02T12:00:00.000Z';
  const init = initializeProject({ root: box.cwd, projectId: 'proj-test', name: 'demo', at });
  const skills = createSkillRegistry({ projectDir: init.layout.skillsDir });
  const workflows = createWorkflowRegistry({ projectDir: init.layout.workflowsDir });
  writeJsonFile(init.layout.lockFile, updateLock(init.lock, skills.list(), workflows.list()).lock);
  mkdirSync(join(box.cwd, 'docs'));
  writeFileSync(join(box.cwd, 'docs', 'design.md'), '# Design\n\n- Keep the kernel host-agnostic\n', 'utf8');
  const project = { root: box.cwd, layout: init.layout, files: readProjectFiles(box.cwd), store: init.store };
  const binding: BrokerBinding = surface === 'interactive'
    ? { client: 'claude-code', surface: 'interactive', executorId: 'session:claude-code', actor: 'person via claude-code' }
    : { client: 'unknown', surface: 'headless', executorId: 'runner:ci', actor: 'runner:ci' };
  const ctx = box.ctx;
  const broker = createBrokerContext(ctx, project, binding);
  return { box, ctx, broker, binding, cleanup: () => { init.store.close(); box.cleanup(); } };
}

export { createContext };
