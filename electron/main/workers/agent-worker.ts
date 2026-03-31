/**
 * Agent Worker - Worker thread entry point for per-session agent execution
 *
 * Each worker thread runs an independent agent with its own:
 * - llmClient, contextTracker, toolRegistry (module-level isolation)
 * - PowerShellManager, workingDirectory, todos
 * - All tool callbacks
 *
 * Communication with main process via parentPort messages.
 */

import { parentPort, workerData } from 'worker_threads';
import { runAgentCore, AgentIO, AgentRunState } from '../orchestration/agent-engine';
import type { AgentCallbacks } from '../orchestration/agent-engine';
import type { ToolApprovalResult } from '../tools/llm/simple/simple-tool-executor';
import type { AskUserResponse } from '../orchestration/types';
import type { MainToWorkerMessage, WorkerInitData } from './worker-protocol';
import { logger } from '../utils/logger';
import { toolRegistry } from '../tools/registry';
import {
  setWorkingDirectory as setFileToolsWorkingDirectory,
  setPowerShellWorkingDirectory,
} from '../tools';
import { configManager } from '../core/config';
import { llmClient } from '../core/llm';
import { compactConversation } from '../core/compact';

if (!parentPort) {
  throw new Error('agent-worker must be run as a worker thread');
}

const port = parentPort;

// Prevent unhandled rejections from crashing the worker thread (exit code 1).
// Node.js >= 15 terminates on unhandled rejections by default.
// Background async operations (reportError, handleTodoCompleteAutoSync) can produce
// rejections after abort — these should not kill the worker.
process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  logger.warn('[Worker] Unhandled rejection (suppressed)', { reason: msg, stack: reason instanceof Error ? reason.stack?.split('\n').slice(0, 3).join('\n') : undefined });
});

process.on('uncaughtException', (error) => {
  logger.error('[Worker] Uncaught exception', { error: error.message, stack: error.stack?.split('\n').slice(0, 5).join('\n') });
  // Notify main process so the renderer can show an error.
  // Wrap in try-catch: if the exception corrupted state, postMessage itself could throw.
  try {
    port.postMessage({ type: 'error', error: `Worker uncaught exception: ${error.message}` });
  } catch { /* port may be unusable — worker will be auto-recreated on exit */ }
});

const initData = workerData as WorkerInitData;
const sessionId = initData.sessionId;

// =============================================================================
// Per-Worker Agent State
// =============================================================================

const agentState: AgentRunState = {
  isRunning: false,
  runId: 0,
  abortController: null,
  currentTodos: [],
  alwaysApprovedTools: new Set(),
  currentSessionId: sessionId,
};

// =============================================================================
// Pending Promise Maps (for async round-trips with main process)
// =============================================================================

// Monotonic run counter — guards catch/finally of old runs from corrupting new run state.
// Incremented on each 'run' message. Old run's catch/finally checks myRunId === workerRunId
// before posting complete/error or resetting agentState.isRunning.
let workerRunId = 0;

const pendingAskUser = new Map<string, { resolve: (response: AskUserResponse) => void; timer: NodeJS.Timeout }>();
const pendingApprovals = new Map<string, { resolve: (result: ToolApprovalResult) => void; timer: NodeJS.Timeout }>();

const ASK_USER_TIMEOUT = 300_000; // 5 minutes for user questions
const APPROVAL_TIMEOUT = 300_000; // 5 minutes for tool approvals

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

// =============================================================================
// Worker IO Implementation (parentPort-based)
// =============================================================================

const workerIO: AgentIO = {
  broadcast: (channel: string, ...data: unknown[]) => {
    port.postMessage({ type: 'broadcast', channel, data });
  },

  flashWindows: () => {
    port.postMessage({ type: 'flashWindows' });
  },

  showTaskWindow: () => {
    port.postMessage({ type: 'showTaskWindow' });
  },

  isTaskWindowVisible: () => {
    // Worker can't synchronously query main process window state
    // Default: always show (conservative approach)
    return false;
  },

  requestApproval: (toolName: string, args: Record<string, unknown>, reason?: string): Promise<ToolApprovalResult> => {
    return new Promise((resolve) => {
      const reqId = generateId();
      const timer = setTimeout(() => {
        pendingApprovals.delete(reqId);
        logger.warn(`[Worker] Approval timeout for ${toolName}`, { reqId });
        resolve({ reject: true, comment: 'Approval timeout - no response from user' });
      }, APPROVAL_TIMEOUT);

      pendingApprovals.set(reqId, { resolve, timer });
      port.postMessage({ type: 'approvalRequest', reqId, toolName, args, reason });
    });
  },

  sendFileEdit: (data: { path: string; originalContent: string; newContent: string; language: string }) => {
    port.postMessage({ type: 'fileEdit', data });
  },
};

// =============================================================================
// Message Handler
// =============================================================================

port.on('message', async (msg: MainToWorkerMessage) => {
  switch (msg.type) {
    case 'run': {
      // Capture run ID to detect stale catch/finally when a new run starts
      // before this one's async cleanup completes (e.g. pause → new message).
      workerRunId++;
      const myRunId = workerRunId;

      try {
        agentState.isRunning = true;

        // Provide callbacks for interactive features that need round-trip with main process
        const callbacks: AgentCallbacks = {
          onAskUser: async (request) => {
            return new Promise<AskUserResponse>((resolve) => {
              const reqId = generateId();
              const timer = setTimeout(() => {
                pendingAskUser.delete(reqId);
                logger.warn(`[Worker] AskUser timeout`, { reqId, sessionId });
                resolve({
                  selectedOption: request.options?.[0] || '',
                  isOther: false,
                });
              }, ASK_USER_TIMEOUT);

              pendingAskUser.set(reqId, { resolve, timer });
              port.postMessage({ type: 'askUser', reqId, request });
            });
          },
        };

        const result = await runAgentCore(
          msg.userMessage,
          msg.existingMessages,
          msg.config,
          callbacks,
          workerIO,
          agentState,
        );
        // Only post result if this is still the current run
        if (myRunId === workerRunId) {
          port.postMessage({ type: 'complete', result, runId: msg.runId });
        }
      } catch (error) {
        // Only post error if this is still the current run — stale errors
        // from aborted runs must not reach worker-manager (they'd reject the new run's promise)
        if (myRunId === workerRunId) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          port.postMessage({ type: 'error', error: errorMessage, runId: msg.runId });
        }
      } finally {
        // Only reset running state if this is still the current run — otherwise
        // we'd clobber the new run's isRunning=true set by its 'run' handler
        if (myRunId === workerRunId) {
          agentState.isRunning = false;
        }
      }
      break;
    }

    case 'pause': {
      try {
        // Pause: cancel current LLM call but KEEP todos for resume
        llmClient.abort();

        if (agentState.abortController) {
          agentState.abortController.abort();
          agentState.abortController = null;
        }
        agentState.isRunning = false;
        // NOTE: currentTodos intentionally NOT cleared — user can resume

        // Reject pending approvals/askUser
        for (const [, { resolve, timer }] of pendingApprovals) {
          clearTimeout(timer);
          resolve({ reject: true, comment: 'Agent paused' });
        }
        pendingApprovals.clear();

        for (const [, { resolve, timer }] of pendingAskUser) {
          clearTimeout(timer);
          resolve({ selectedOption: '', isOther: false });
        }
        pendingAskUser.clear();
      } catch (error) {
        logger.errorSilent('[Worker] Error during pause cleanup', { error: (error as Error)?.message, sessionId });
      }
      break;
    }

    case 'abort': {
      try {
        // Full abort: cancel LLM + clear all state
        llmClient.abort();

        if (agentState.abortController) {
          agentState.abortController.abort();
          agentState.abortController = null;
        }
        agentState.isRunning = false;
        agentState.currentTodos = [];
        agentState.pausedMessages = undefined;

        // Reject all pending approvals/askUser
        for (const [, { resolve, timer }] of pendingApprovals) {
          clearTimeout(timer);
          resolve({ reject: true, comment: 'Agent aborted' });
        }
        pendingApprovals.clear();

        for (const [, { resolve, timer }] of pendingAskUser) {
          clearTimeout(timer);
          resolve({ selectedOption: '', isOther: false });
        }
        pendingAskUser.clear();
      } catch (error) {
        logger.errorSilent('[Worker] Error during abort cleanup', { error: (error as Error)?.message, sessionId });
      }
      break;
    }

    case 'clearState': {
      agentState.currentTodos = [];
      agentState.alwaysApprovedTools.clear();
      agentState.runId = 0;
      agentState.isRunning = false;
      agentState.pausedMessages = undefined;
      break;
    }

    case 'askUserResponse': {
      const pending = pendingAskUser.get(msg.reqId);
      if (pending) {
        clearTimeout(pending.timer);
        pending.resolve(msg.response);
        pendingAskUser.delete(msg.reqId);
      }
      break;
    }

    case 'approvalResponse': {
      const pending = pendingApprovals.get(msg.requestId);
      if (pending) {
        clearTimeout(pending.timer);
        pending.resolve(msg.result as ToolApprovalResult);
        pendingApprovals.delete(msg.requestId);
      }
      break;
    }

    case 'setConfig': {
      // Hot-reload config: update configManager for this worker
      // Must update endpoints array FIRST so setCurrentEndpoint can find the endpoint by ID
      try {
        if (msg.endpoints && Array.isArray(msg.endpoints)) {
          await configManager.update({ endpoints: msg.endpoints as any[] });
        }
        if (msg.currentEndpoint) {
          await configManager.setCurrentEndpoint(msg.currentEndpoint);
        }
        if (msg.currentModel) {
          await configManager.setCurrentModel(msg.currentModel);
        }
        logger.info('[Worker] Config updated', { sessionId, endpoint: msg.currentEndpoint, model: msg.currentModel });
      } catch (error) {
        logger.errorSilent('[Worker] Failed to update config', { error, sessionId });
      }
      break;
    }

    case 'setWorkingDirectory': {
      // Dynamic working directory change for this worker's tools
      setFileToolsWorkingDirectory(msg.directory);
      setPowerShellWorkingDirectory(msg.directory);
      logger.info('[Worker] Working directory changed', { directory: msg.directory, sessionId });
      break;
    }

    case 'compact': {
      // Manual compact execution within this worker's llmClient/contextTracker
      try {
        const result = await compactConversation(msg.messages, msg.context as any);
        port.postMessage({ type: 'compactResult', result });
      } catch (error) {
        port.postMessage({ type: 'compactResult', result: {
          success: false,
          originalMessageCount: msg.messages.length,
          newMessageCount: msg.messages.length,
          error: error instanceof Error ? error.message : String(error),
        }});
      }
      break;
    }

    case 'toolGroupChanged': {
      // Sync tool group enable/disable from main process
      try {
        if (msg.enabled) {
          await toolRegistry.enableToolGroup(msg.groupId, false, true);
        } else {
          await toolRegistry.disableToolGroup(msg.groupId, false);
        }
        logger.info('[Worker] Tool group changed', { groupId: msg.groupId, enabled: msg.enabled, sessionId });
      } catch (error) {
        logger.errorSilent('[Worker] Failed to change tool group', { groupId: msg.groupId, error });
      }
      break;
    }
  }
});

// =============================================================================
// Initialize and signal ready
// =============================================================================

async function initialize() {
  try {
    await logger.initialize();

    // Forward all worker logs to main process via parentPort
    logger.onLogEntry((entry) => {
      try {
        port.postMessage({ type: 'log', entry });
      } catch { /* port may be closed */ }
    });

    // Enable tool groups that were active at worker creation time
    if (initData.enabledToolGroups && initData.enabledToolGroups.length > 0) {
      for (const groupId of initData.enabledToolGroups) {
        try {
          await toolRegistry.enableToolGroup(groupId, false, true);
        } catch (err) {
          logger.errorSilent(`[Worker] Failed to enable tool group: ${groupId}`, err);
        }
      }
      logger.info('[Worker] Tool groups initialized', {
        sessionId,
        enabledGroups: initData.enabledToolGroups,
      });
    }

    logger.info('[Worker] Agent worker initialized', { sessionId });
    port.postMessage({ type: 'ready' });
  } catch (error) {
    logger.error('[Worker] Failed to initialize', error);
    port.postMessage({ type: 'error', error: `Worker init failed: ${error}` });
  }
}

initialize();
