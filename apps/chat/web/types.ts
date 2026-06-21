/**
 * apps/chat/web/types.ts — shared types for dashboard terminal cockpit chat.
 */

export type RouteOverlay = {
  intent?: string | null;
  workCategory?: string | null;
  track?: string | null;
  specialists?: string[];
  externalResearch?: { required?: boolean; reason?: string; shape?: string } | null;
  riskFlags?: Record<string, boolean> | null;
  contractChain?: Array<{ id?: string; producer: string; consumer: string; stage?: string }>;
  framingChallenge?: { required?: boolean } | null;
  dispatchSummary?: string | null;
  dispatchReasons?: Record<string, string> | null;
  triggers?: Array<{ specialist: string; reason: string; watcher?: string }>;
  docAuthoring?: { docType?: string; owner?: string } | null;
  artifactReview?: { requiredReviewers?: string[]; optionalReviewers?: string[] } | null;
  sessionTurnIndex?: number;
  priorIntent?: string | null;
  workingBranch?: string | null;
};

export type ChatTool = {
  id: string;
  title: string;
  status: string;
  input?: Record<string, unknown> | null;
};

export type ChatTurn = {
  id: string;
  createdAt?: number;
  userText: string;
  assistant: string;
  thinking: string;
  tools: ChatTool[];
  overlay: RouteOverlay | null;
  sources: string[];
  usage: Record<string, unknown> | null;
  resolvedModel?: string | null;
  unverified?: boolean;
  evidence?: { schemaVersion: number; status: string; records: Array<{ recordId: string; turnId: string | null; toolId: string; tool: string; requestedTarget: string; target: string; sourceId: string; completion: string; result: string }>; citations: string[]; reasonCodes: string[] } | null;
  working: boolean;
  system?: boolean;
};

export type SessionMeta = {
  model?: string | null;
  modelMode?: string;
  sandbox?: string | null;
  permissionMode?: string | null;
  layers?: Record<string, boolean>;
  workingBranch?: string | null;
  ctx?: { used: number; size: number } | null;
  oracle?: {
    visible: boolean;
    summary: string;
    topGaps: Array<{ id: string; detail: string }>;
  } | null;
  usage?: {
    turns: number;
    tokens: Record<string, number>;
    cost?: { amount: number; currency?: string } | null;
  } | null;
};

export type PendingPermission = {
  requestId: string;
  title: string;
  options: string[];
};

export const LAYER_KEYS = ['thinking', 'path', 'specialists', 'tools', 'observability'] as const;

export type LayerKey = typeof LAYER_KEYS[number];
