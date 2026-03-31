/**
 * Worker Protocol - Message types for Main ↔ Worker communication
 *
 * All messages use discriminated unions for type safety.
 */

import type { AgentConfig, AgentResult } from '../orchestration/agent-engine';
import type { Message } from '../core/llm';
import type { ToolApprovalResult } from '../tools/llm/simple/simple-tool-executor';
import type { AskUserResponse } from '../orchestration/types';

// =============================================================================
// Main → Worker Messages
// =============================================================================

export type MainToWorkerMessage =
  | { type: 'run'; userMessage: string; existingMessages: Message[]; config: AgentConfig; runId: number }
  | { type: 'abort' }
  | { type: 'pause' }
  | { type: 'clearState' }
  | { type: 'askUserResponse'; reqId: string; response: AskUserResponse }
  | { type: 'approvalResponse'; requestId: string; result: ToolApprovalResult | null }
  | { type: 'delegationResult'; requestId: string; result: unknown; error?: string }
  | { type: 'setConfig'; endpoints?: unknown[]; currentEndpoint?: string; currentModel?: string }
  | { type: 'setWorkingDirectory'; directory: string }
  | { type: 'toolGroupChanged'; groupId: string; enabled: boolean }
  | { type: 'compact'; messages: Message[]; context: { workingDirectory?: string; todos?: unknown[] } };

// =============================================================================
// Worker → Main Messages
// =============================================================================

export type WorkerToMainMessage =
  | { type: 'ready' }
  | { type: 'broadcast'; channel: string; data: unknown[] }
  | { type: 'complete'; result: AgentResult; runId: number }
  | { type: 'error'; error: string; runId: number }
  | { type: 'approvalRequest'; reqId: string; toolName: string; args: Record<string, unknown>; reason?: string }
  | { type: 'askUser'; reqId: string; request: unknown }
  | { type: 'fileEdit'; data: { path: string; originalContent: string; newContent: string; language: string } }
  | { type: 'showTaskWindow' }
  | { type: 'flashWindows' }
  | { type: 'isTaskWindowVisible'; reqId: string }
  | { type: 'delegation'; requestId: string; delegationType: 'browser' | 'office' | 'dialog'; action: string; args: unknown }
  | { type: 'compactResult'; result: unknown }
  | { type: 'log'; entry: { timestamp: string; level: string; message: string; data?: unknown } };

// =============================================================================
// Worker Init Data (passed via workerData)
// =============================================================================

export interface WorkerInitData {
  sessionId: string;
  enabledToolGroups: string[];
}
