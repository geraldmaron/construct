export const EXECUTORS = ['claude', 'codex', 'cursor'] as const;
export type Executor = typeof EXECUTORS[number];
export type Role = 'implement' | 'review';
export type ExecutionState = 'queued' | 'running' | 'succeeded' | 'blocked' | 'failed' | 'cancelled' | 'timed_out' | 'orphaned' | 'integrating' | 'integrated' | 'integration_failed';

export interface Assignment {
  readonly workId: string;
  readonly requestKey: string;
  readonly executor: Executor;
  readonly role: Role;
  readonly instructions: string;
  readonly acceptance: readonly string[];
  readonly paths: readonly string[];
  readonly couplingKeys: readonly string[];
  readonly timeoutMs: number;
  readonly runId?: string;
  readonly subject?: string;
  readonly repairOf?: string;
}

export interface Finding {
  readonly id: string;
  readonly path: string;
  readonly requirement: string;
  readonly evidence: string;
  readonly blocking: boolean;
}

export interface Disposition {
  readonly findingId: string;
  readonly decision: 'accepted' | 'rejected' | 'deferred';
  readonly rationale: string;
}

export interface WorkerResult {
  readonly patch?: string;
  readonly state: 'succeeded' | 'blocked' | 'failed' | 'cancelled' | 'timed_out';
  readonly summary: string;
  readonly findings: readonly Finding[];
  readonly usage: Readonly<Record<string, number>> | null;
}

export interface Snapshot {
  readonly directory: string;
  readonly baseRevision: string;
  readonly baselineTree: string;
  readonly targetFingerprint: string;
  readonly gitMarker?: string;
}

export interface Artifact {
  readonly tree: string;
  readonly patch: string;
  readonly digest: string;
  readonly paths: readonly string[];
}

export interface Execution {
  readonly integrationStarted?: boolean;
  readonly repairRoot?: string;
  readonly version: 1;
  readonly id: string;
  readonly childWorkId: string;
  readonly leadSession: string;
  readonly workerSession: string;
  readonly target: string;
  readonly machine: string;
  readonly model: string;
  readonly signature: string;
  readonly assignment: Assignment;
  readonly repairCycle: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly state: ExecutionState;
  readonly supervisorPid: number | null;
  readonly groupPid: number | null;
  readonly snapshot: Snapshot | null;
  readonly artifact: Artifact | null;
  readonly result: WorkerResult | null;
  readonly dispositions: readonly Disposition[];
  readonly reason: string | null;
  readonly validation: readonly ValidationResult[];
}

export interface ExecutorStatus {
  readonly executor: Executor;
  readonly installed: boolean;
  readonly authenticated: 'subscription' | 'missing' | 'unknown' | 'api';
  readonly configured: boolean;
  readonly liveVerified: boolean;
  readonly model: string | null;
  readonly reason: string;
}

export interface ValidationResult {
  readonly command: readonly string[];
  readonly passed: boolean;
}

export interface DelegationDriver {
  readonly machine: string;
  readonly maxWorkers: number;
  readonly maxRepairCycles: number;
  readonly maxTimeoutMs: number;
  status(executor: Executor, role: Role): Promise<ExecutorStatus>;
  prepare(execution: Execution, subject: Execution | null): Promise<Snapshot>;
  launch(execution: Execution, onProcess: (supervisorPid: number, groupPid: number | null) => void): Promise<WorkerResult>;
  cancel(id: string): Promise<void>;
  collect(execution: Execution): Promise<Artifact>;
  integrate(execution: Execution): Promise<void>;
  validate(execution: Execution, stage: 'worker' | 'integrated', onProcess?: (supervisorPid: number, groupPid: number | null) => void): Promise<readonly ValidationResult[]>;
  alive(execution: Execution): boolean | null;
}

export interface DelegationService {
  start(assignment: Assignment): Promise<Execution>;
  status(id?: string): Promise<unknown>;
  result(id: string): Execution;
  cancel(id: string): Promise<Execution>;
  triage(id: string, dispositions: readonly Disposition[]): Execution;
  integrate(id: string): Promise<Execution>;
  close(): Promise<void>;
}
