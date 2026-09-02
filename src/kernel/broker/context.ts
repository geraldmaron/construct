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
  /** The person's identity as the host reports it, for decisions and promotions. */
  readonly actor: string;
}
