/**
 * lib/mcp/tools/embedded-contract.mjs — MCP surface for the Embedded Contract Layer.
 *
 * Thin adapters that translate MCP tool arguments into the embedded-contract
 * core calls and return the same versioned envelope the CLI-JSON and SDK
 * surfaces emit. No business logic lives here — it delegates to
 * lib/embedded-contract/* so the three surfaces stay structurally identical.
 */

import { wrapContractResult } from '../../embedded-contract/envelope.mjs';
import { resolveEmbeddedModel as resolveModelCore } from '../../embedded-contract/model-resolve.mjs';
import { recommendPlan as recommendPlanCore } from '../../embedded-contract/triage.mjs';
import { invokeWorkflow as invokeWorkflowCore } from '../../embedded-contract/workflow-invoke.mjs';
import { buildCapabilityContract } from '../../embedded-contract/capability.mjs';
import { resolveExecution as resolveExecutionCore } from '../../embedded-contract/execution.mjs';
import { resolveInput } from '../../embedded-contract/ingest.mjs';
import { runArtifactWorkflow as runArtifactWorkflowCore } from '../../artifact-workflow.mjs';

async function ingestArgs(args) {
  if (args.input || !args.file_path) return { input: args.input, ingestion: undefined };
  const resolved = await resolveInput({ filePath: args.file_path, strategy: args.ingest_strategy });
  return { input: resolved.text, ingestion: resolved.error ? { ...(resolved.ingestion || {}), error: resolved.error } : resolved.ingestion };
}

function csv(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) return value.split(',').map((s) => s.trim()).filter(Boolean);
  return undefined;
}

export function modelResolve(args = {}) {
  const request = {
    workflowType: args.workflow_type,
    requestedTier: args.requested_tier,
    host: args.host,
    hostModel: args.host_model,
    hostProvider: args.host_provider,
    capabilities: csv(args.capabilities),
    allowCrossProviderFallback: Boolean(args.allow_cross_provider_fallback),
  };
  return wrapContractResult(resolveModelCore(request), { surface: 'mcp' });
}

export async function triageRecommend(args = {}) {
  const { input, ingestion } = await ingestArgs(args);
  const request = {
    input,
    ingestion,
    sourcePath: args.source_path || args.file_path,
    artifactType: args.artifact_type,
    domain: args.domain,
    desiredOutcome: args.desired_outcome,
    constraints: csv(args.constraints),
    availableRoles: csv(args.available_roles),
  };
  return wrapContractResult(recommendPlanCore(request), { surface: 'mcp' });
}

export async function workflowInvoke(args = {}) {
  const { input, ingestion } = await ingestArgs(args);
  const request = {
    workflowType: args.workflow_type,
    input,
    ingestion,
    context: args.context,
    roleStrategy: args.role_strategy,
    requestedRoles: csv(args.requested_roles),
    approvalMode: args.approval_mode,
    trace: args.trace !== false,
    host: args.host,
    hostModel: args.host_model,
    hostProvider: args.host_provider,
    recruitment: args.recruitment,
  };
  return wrapContractResult(await invokeWorkflowCore(request), { surface: 'mcp' });
}

export function capabilityDescribe(args = {}) {
  return wrapContractResult(buildCapabilityContract({ rootDir: args.root_dir }), { surface: 'mcp' });
}

export function executionResolve(args = {}) {
  const request = {
    workflowType: args.workflow_type,
    requestedStrategy: args.requested_strategy,
    useConstruct: args.use_construct !== false,
    host: args.host,
    hostModel: args.host_model,
    hostProvider: args.host_provider,
    requestedTier: args.requested_tier,
    capabilities: csv(args.capabilities),
    allowCrossProviderFallback: Boolean(args.allow_cross_provider_fallback),
  };
  return wrapContractResult(resolveExecutionCore(request), { surface: 'mcp' });
}

export function artifactWorkflow(args = {}) {
  return wrapContractResult(runArtifactWorkflowCore({
    input: args.input || args.request,
    artifactType: args.artifact_type,
    filePath: args.file_path,
    format: args.format,
    outputPath: args.output_path,
    branding: args.branding,
    overrides: args.overrides,
    approvalMode: args.approval_mode,
  }), { surface: 'mcp' });
}
