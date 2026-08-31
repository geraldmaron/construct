/**
 * kernel/services/ — application façades over format-v1 state.
 *
 * Store modules own persistence; services own product operations and keep
 * CLI/MCP thin. Interactive execution must not reach resource selection.
 */

export { createProjectService, type ProjectService } from './project.ts';
export { createRunService, type RunService } from './run.ts';
export { createTaskService, type TaskService } from './task.ts';
export { createStaffService, type StaffService } from './staff.ts';
export { createSourceService, type SourceService } from './source.ts';
export { createRoutineService, type RoutineService } from './routine.ts';
export { createDecisionService, type DecisionService } from './decision.ts';
export {
  createInteractiveRunService,
  type InteractiveRunService,
  type InteractiveSession,
} from './interactive-run.ts';
export {
  createHeadlessRunService,
  type HeadlessRunService,
  type HeadlessExecutionPolicy,
} from './headless-run.ts';
