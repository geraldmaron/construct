/**
 * kernel/services/project.ts — project status projection for doctor / MCP.
 */

import type { StateStore } from '../state-v1/open.ts';
import type { ProjectContext } from '../project-v1/context.ts';
import { listIntegrations } from '../state-v1/integrations.ts';
import { listOpenDecisions } from '../state-v1/decisions.ts';
import { listStaffMembers } from '../state-v1/staff.ts';
import { listRoutines } from '../state-v1/routines.ts';
import { listSources } from '../state-v1/sources.ts';
import { STATE_FORMAT_ID, STATE_FORMAT_VERSION } from '../state-v1/format.ts';

export interface ProjectService {
  status(): {
    readonly root: string;
    readonly rootSource: ProjectContext['rootSource'];
    readonly format: typeof STATE_FORMAT_ID;
    readonly formatVersion: typeof STATE_FORMAT_VERSION;
    readonly integrations: ReturnType<typeof listIntegrations>;
    readonly staff: ReturnType<typeof listStaffMembers>;
    readonly sources: ReturnType<typeof listSources>;
    readonly routines: ReturnType<typeof listRoutines>;
    readonly openDecisions: ReturnType<typeof listOpenDecisions>;
  };
}

export function createProjectService(
  store: StateStore,
  ctx: ProjectContext,
): ProjectService {
  return {
    status() {
      return {
        root: ctx.root,
        rootSource: ctx.rootSource,
        format: STATE_FORMAT_ID,
        formatVersion: STATE_FORMAT_VERSION,
        integrations: listIntegrations(store),
        staff: listStaffMembers(store),
        sources: listSources(store),
        routines: listRoutines(store),
        openDecisions: listOpenDecisions(store),
      };
    },
  };
}
