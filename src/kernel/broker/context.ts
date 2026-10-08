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
import type { AskPerson } from '../policy/channels.ts';
import type { DelegationService } from '../delegation/types.ts';
import type { ProjectWorktree } from '../work/lanes.ts';

export interface BrokerContext {
  readonly delegation?: DelegationService;
  readonly version: string;
  readonly root: string;
  /** The git worktree this session works in, when it is not the project's main checkout. */
  readonly lane: { readonly root: string; readonly checkout: string; readonly branch: string | null; readonly head: string | null } | null;
  /**
   * The project's git checkouts as they stand now, main checkout first, read
   * by the adapter from the repository's files: what a claim may name as the
   * worktree it edits in. Absent when the caller cannot read them.
   */
  readonly worktrees?: () => readonly ProjectWorktree[];
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
  /**
   * Whether a process on `machine` still runs, when this caller can tell (it
   * is the same machine); null when it cannot. Supplied by the adapter.
   */
  readonly processAlive?: (pid: number, machine: string) => boolean | null;
  /**
   * Put a question to the person directly, through the host, when the host
   * can and nothing answers it for them. Absent otherwise; an answer then
   * waits in the inbox for the person's own terminal.
   */
  readonly askPerson?: AskPerson;
  /** Effective policy settings the tools apply. */
  readonly policy?: { readonly hostReads: 'require' | 'accept'; readonly answerCheck: 'nudge' | 'off' };
}
