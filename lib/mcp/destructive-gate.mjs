/**
 * lib/mcp/destructive-gate.mjs — unified gate for destructive-class MCP tools.
 *
 * Replaces per-tool confirm:true booleans: a tool classified destructive in
 * TOOL_SAFETY requires a valid out-of-band approval token (consumeApprovalToken)
 * before the broker will dispatch it. Single choke point for all destructive tools;
 * consumeApprovalToken itself appends the decision to the shared authority ledger
 * (lib/writes/authority-ledger.mjs, construct-b0nny.15) that lib/writes/control-plane.mjs
 * writes provider-write approvals to.
 */

import { TOOL_SAFETY } from './tool-safety.mjs';
import { consumeApprovalToken } from './destructive-approval.mjs';

const DESTRUCTIVE_CLASS = 'destructive';

export function checkDestructiveGate(toolName, toolArgs, opts = {}) {
  const safety = TOOL_SAFETY[toolName];
  if (!safety || safety.class !== DESTRUCTIVE_CLASS) {
    return { gated: false, allowed: true };
  }

  const token = toolArgs?.approval_token;
  if (!consumeApprovalToken(toolName, token, opts)) {
    return {
      gated: true,
      allowed: false,
      reason: `${toolName} requires a valid out-of-band approval token (destructive tool; confirm=true alone is not authorization). Use 'construct tokens issue ${toolName}' or set approval_token.`,
    };
  }

  return { gated: true, allowed: true };
}