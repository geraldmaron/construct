/**
 * kernel/broker/context.ts — what a broker call has in hand: the project, its
 * state, the registries, the services, and who is calling.
 */

import type { StateStore } from '../state/open.ts';
import type { ProjectLayout } from '../project/layout.ts';
import type { readProjectFiles } from '../project/initialize.ts';
import type { SkillRegistry } from '../registry/skill-registry.ts';
import type { WorkflowRegistry } from '../registry/workflow-registry.ts';
import type { HostCapabilities } from '../registry/capability-registry.ts';
import type { WorkflowService } from '../workflow/service.ts';
import type { TriggerService } from '../workflow/triggers.ts';
import type { SourceService } from '../source/service.ts';

export interface BrokerContext {
  readonly version: string;
  readonly root: string;
  /** The git worktree this session works in, when it is not the project's main checkout. */
  readonly lane: { readonly root: string; readonly checkout: string; readonly branch: string | null; readonly head: string | null } | null;
  /** The session Construct minted for this server process; null when a caller has none. */
  readonly sessionId: string | null;
  readonly layout: ProjectLayout;
  readonly files: ReturnType<typeof readProjectFiles>;
  readonly store: StateStore;
  readonly skills: SkillRegistry;
  readonly workflows: WorkflowRegistry;
  readonly host: HostCapabilities;
  readonly workflow: WorkflowService;
  readonly triggers: TriggerService;
  readonly sources: SourceService;
  readonly now: () => string;
  readonly nextId: (prefix: string) => string;
  /** Who acts, for the record: the model via its host on an interactive surface, the runner on a headless one. Never the person. */
  readonly actor: string;
}
