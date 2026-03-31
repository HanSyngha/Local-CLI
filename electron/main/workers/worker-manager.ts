/**
 * Worker Manager - Manages worker thread lifecycle for multi-session support
 *
 * Responsibilities:
 * - Create/terminate worker threads per session tab
 * - Route IPC messages between renderer ↔ worker
 * - Handle worker crashes with error recovery
 * - Manage shared resource delegation (browser, office, dialog)
 */

import { Worker } from 'worker_threads';
import { BrowserWindow } from 'electron';
import * as path from 'path';
import { logger } from '../utils/logger';
import type { AgentConfig, AgentResult } from '../orchestration/agent-engine';
import type { Message } from '../core/llm';
import type { ToolApprovalResult } from '../tools/llm/simple/simple-tool-executor';
import type { AskUserResponse } from '../orchestration/types';
import type { MainToWorkerMessage, WorkerToMainMessage, WorkerInitData } from './worker-protocol';
import { sessionManager } from '../core/session';
import { configManager } from '../core/config';

// =============================================================================
// Types
// =============================================================================

interface WorkerEntry {
  worker: Worker;
  sessionId: string;
  isRunning: boolean;
  isReady: boolean;
  enabledToolGroups: string[];
  crashCount: number;
  intentionalTerminate: boolean;
}

// =============================================================================
// Worker Manager Class
// =============================================================================

export class WorkerManager {
  private workers = new Map<string, WorkerEntry>();
  private pendingRuns = new Map<string, { resolve: (result: AgentResult) => void; reject: (error: Error) => void; runId: number }>();
  private runIdCounter = new Map<string, number>();
  private chatWindow: BrowserWindow | null = null;
  private taskWindow: BrowserWindow | null = null;

  // Max concurrent workers (tabs)
  private readonly MAX_WORKERS = 8;

  // Per-session TODO cache (updated from worker broadcasts)
  private sessionTodos = new Map<string, unknown[]>();

  // ==========================================================================
  // Window Management
  // ==========================================================================

  setChatWindow(window: BrowserWindow | null): void {
    this.chatWindow = window;
  }

  setTaskWindow(window: BrowserWindow | null): void {
    this.taskWindow = window;
  }

  // ==========================================================================
  // Worker Lifecycle
  // ==========================================================================

  /**
   * Create a new worker for a session tab
   */
  createWorker(sessionId: string, enabledToolGroups: string[] = []): void {
    if (this.workers.has(sessionId)) {
      logger.warn('[WorkerManager] Worker already exists for session', { sessionId });
      return;
    }

    if (this.workers.size >= this.MAX_WORKERS) {
      throw new Error(`Maximum worker limit (${this.MAX_WORKERS}) reached`);
    }

    // Vite bundles worker-manager into chunks/ subfolder, but agent-worker.cjs is at main/ level
    let workerPath = path.join(__dirname, 'agent-worker.cjs');
    if (!require('fs').existsSync(workerPath)) {
      workerPath = path.join(__dirname, '..', 'agent-worker.cjs');
    }
    const initData: WorkerInitData = { sessionId, enabledToolGroups };

    const worker = new Worker(workerPath, {
      workerData: initData,
    });

    const entry: WorkerEntry = {
      worker,
      sessionId,
      isRunning: false,
      isReady: false,
      enabledToolGroups,
      crashCount: 0,
      intentionalTerminate: false,
    };

    worker.on('message', (msg: WorkerToMainMessage) => {
      this.handleWorkerMessage(sessionId, msg);
    });

    worker.on('error', (err: Error) => {
      this.handleWorkerError(sessionId, err);
    });

    worker.on('exit', (code: number) => {
      this.handleWorkerExit(sessionId, code);
    });

    this.workers.set(sessionId, entry);
    logger.info('[WorkerManager] Worker created', { sessionId, workerCount: this.workers.size });
  }

  /**
   * Check if a worker exists for the given session
   */
  hasWorker(sessionId: string): boolean {
    return this.workers.has(sessionId);
  }

  /**
   * Get count of active workers
   */
  getWorkerCount(): number {
    return this.workers.size;
  }

  /**
   * Check if a worker session is running an agent
   */
  isSessionRunning(sessionId: string): boolean {
    return this.workers.get(sessionId)?.isRunning ?? false;
  }

  // ==========================================================================
  // Agent Execution
  // ==========================================================================

  /**
   * Run agent in a worker (preserves ChatPanel's await pattern)
   */
  async runAgent(
    sessionId: string,
    userMessage: string,
    existingMessages: Message[],
    config: AgentConfig,
  ): Promise<AgentResult> {
    const entry = this.workers.get(sessionId);
    if (!entry) {
      throw new Error(`No worker found for session ${sessionId}`);
    }

    if (!entry.isReady) {
      // Wait for worker to be ready (max 10 seconds)
      await this.waitForReady(sessionId, 10_000);
    }

    if (entry.isRunning) {
      throw new Error(`Worker for session ${sessionId} is already running`);
    }

    const runId = (this.runIdCounter.get(sessionId) || 0) + 1;
    this.runIdCounter.set(sessionId, runId);

    // Dismiss stale askUser/approval modals from previous run
    // (user sent new message without answering → old modal must go)
    this.dismissPendingModals(sessionId);

    return new Promise((resolve, reject) => {
      entry.isRunning = true;
      // Resolve any existing pending run (e.g. paused run) so old sendMessage Promise settles
      const existing = this.pendingRuns.get(sessionId);
      if (existing) {
        existing.resolve({ success: true, response: '', messages: [], toolCalls: [], iterations: 0 });
      }
      this.pendingRuns.set(sessionId, { resolve, reject, runId });

      this.sendToWorker(sessionId, {
        type: 'run',
        userMessage,
        existingMessages,
        config,
        runId,
      });
    });
  }

  /**
   * Pause agent in a worker (cancel LLM call but keep TODOs for resume)
   */
  pauseAgent(sessionId: string): void {
    const entry = this.workers.get(sessionId);
    if (entry) entry.isRunning = false;
    this.sendToWorker(sessionId, { type: 'pause' });
    this.dismissPendingModals(sessionId);
  }

  /**
   * Abort agent in a worker (full stop, clear TODOs)
   */
  abortAgent(sessionId: string): void {
    const entry = this.workers.get(sessionId);
    if (entry) entry.isRunning = false;

    this.sendToWorker(sessionId, { type: 'abort' });

    // Resolve pending run immediately so old sendMessage Promise settles
    // (stale error from worker will be ignored due to runId mismatch)
    const pending = this.pendingRuns.get(sessionId);
    if (pending) {
      pending.resolve({ success: true, response: '', messages: [], toolCalls: [], iterations: 0 });
      this.pendingRuns.delete(sessionId);
    }

    this.dismissPendingModals(sessionId);
  }

  /**
   * Clear agent state in a worker
   */
  clearState(sessionId: string): void {
    this.sendToWorker(sessionId, { type: 'clearState' });
    // Clear cached todos and broadcast empty state to task window
    this.sessionTodos.delete(sessionId);
    if (this.taskWindow && !this.taskWindow.isDestroyed()) {
      this.taskWindow.webContents.send('agent:todoUpdate', [], sessionId);
    }
  }

  // ==========================================================================
  // Message Forwarding (Renderer → Worker)
  // ==========================================================================

  /**
   * Forward approval response from renderer to worker
   */
  forwardApprovalResponse(sessionId: string, requestId: string, result: ToolApprovalResult | null): void {
    this.sendToWorker(sessionId, {
      type: 'approvalResponse',
      requestId,
      result: result as ToolApprovalResult,
    });
  }

  /**
   * Forward ask-user response from renderer to worker
   */
  forwardAskUserResponse(sessionId: string, reqId: string, response: AskUserResponse): void {
    this.sendToWorker(sessionId, {
      type: 'askUserResponse',
      reqId,
      response,
    });
  }

  /**
   * Broadcast config change to all workers
   */
  broadcastConfigChange(config: { endpoints?: unknown[]; currentEndpoint?: string; currentModel?: string }): void {
    for (const { worker } of this.workers.values()) {
      worker.postMessage({ type: 'setConfig', ...config });
    }
  }

  /**
   * Broadcast tool group enable/disable to all workers
   */
  broadcastToolGroupChange(groupId: string, enabled: boolean): void {
    for (const { worker } of this.workers.values()) {
      worker.postMessage({ type: 'toolGroupChanged', groupId, enabled });
    }
    logger.info('[WorkerManager] Tool group change broadcast', { groupId, enabled, workerCount: this.workers.size });
  }

  /**
   * Get cached TODOs for a session (for task window session switching)
   */
  getSessionTodos(sessionId: string): unknown[] {
    return this.sessionTodos.get(sessionId) || [];
  }

  /**
   * Execute compact in a worker (uses worker's own llmClient/contextTracker)
   */
  async compactInWorker(sessionId: string, messages: unknown[], context: { workingDirectory?: string; todos?: unknown[] }): Promise<unknown> {
    const entry = this.workers.get(sessionId);
    if (!entry) return null;

    return new Promise((resolve) => {
      // Listen for one-time compactResult
      const handler = (msg: WorkerToMainMessage) => {
        if (msg.type === 'compactResult') {
          entry.worker.removeListener('message', handler);
          resolve((msg as { type: 'compactResult'; result: unknown }).result);
        }
      };
      entry.worker.on('message', handler);

      entry.worker.postMessage({
        type: 'compact',
        messages,
        context,
      });

      // Timeout after 60 seconds
      setTimeout(() => {
        entry.worker.removeListener('message', handler);
        resolve({ success: false, error: 'Compact timeout' });
      }, 60_000);
    });
  }

  // ==========================================================================
  // Worker Message Handler
  // ==========================================================================

  private handleWorkerMessage(sessionId: string, msg: WorkerToMainMessage): void {
    switch (msg.type) {
      case 'log': {
        // Forward worker log to main process logger (so LogViewer can display it)
        const { entry } = msg;
        const level = entry.level?.toUpperCase?.() || 'INFO';
        if (level === 'ERROR') {
          logger.error(entry.message, entry.data);
        } else if (level === 'WARN') {
          logger.warn(entry.message, entry.data);
        } else if (level === 'DEBUG') {
          logger.debug(entry.message, entry.data);
        } else {
          logger.info(entry.message, entry.data);
        }
        break;
      }

      case 'ready': {
        const entry = this.workers.get(sessionId);
        if (entry) {
          entry.isReady = true;
          // Send current config to worker immediately on ready
          const config = configManager.getAll();
          if (config.endpoints && config.endpoints.length > 0) {
            entry.worker.postMessage({
              type: 'setConfig',
              endpoints: config.endpoints,
              currentEndpoint: config.currentEndpoint,
              currentModel: config.currentModel,
            });
          }
        }
        logger.info('[WorkerManager] Worker ready', { sessionId });
        break;
      }

      case 'broadcast': {
        // Cache TODOs per session for task window session switching
        if (msg.channel === 'agent:todoUpdate' && Array.isArray(msg.data[0])) {
          this.sessionTodos.set(sessionId, msg.data[0]);
        }

        // Auto-rename session when Planning LLM provides a title
        if (msg.channel === 'agent:sessionTitle' && typeof msg.data[0] === 'string') {
          sessionManager.renameSession(sessionId, msg.data[0]).catch(() => {});
        }

        // Forward to renderer with sessionId attached
        const firstArg = msg.data[0];

        if (firstArg !== null && typeof firstArg === 'object' && !Array.isArray(firstArg)) {
          // Plain object: spread sessionId in
          const enriched = { ...firstArg as Record<string, unknown>, sessionId };
          if (this.chatWindow && !this.chatWindow.isDestroyed()) {
            this.chatWindow.webContents.send(msg.channel, enriched);
          }
          if (this.taskWindow && !this.taskWindow.isDestroyed()) {
            this.taskWindow.webContents.send(msg.channel, enriched);
          }
        } else {
          // Array, string, etc: send data AND sessionId as separate args
          // Renderer handlers accept optional second arg for sessionId routing
          if (this.chatWindow && !this.chatWindow.isDestroyed()) {
            this.chatWindow.webContents.send(msg.channel, ...msg.data, sessionId);
          }
          if (this.taskWindow && !this.taskWindow.isDestroyed()) {
            this.taskWindow.webContents.send(msg.channel, ...msg.data, sessionId);
          }
        }
        break;
      }

      case 'complete': {
        const pending = this.pendingRuns.get(sessionId);
        // Only resolve if runId matches — stale complete from an aborted run
        // must not resolve the new run's promise (would lose the new result)
        if (pending && pending.runId === msg.runId) {
          const entry = this.workers.get(sessionId);
          if (entry) entry.isRunning = false;
          pending.resolve(msg.result);
          this.pendingRuns.delete(sessionId);
        }
        break;
      }

      case 'error': {
        const pending = this.pendingRuns.get(sessionId);
        // Only reject if runId matches — stale error from an aborted run
        // must not reject the new run's promise (would kill the new run)
        if (pending && pending.runId === msg.runId) {
          const entry = this.workers.get(sessionId);
          if (entry) entry.isRunning = false;
          pending.reject(new Error(msg.error));
          this.pendingRuns.delete(sessionId);

          if (this.chatWindow && !this.chatWindow.isDestroyed()) {
            this.chatWindow.webContents.send('agent:error', { sessionId, error: msg.error });
          }
        }
        break;
      }

      case 'approvalRequest': {
        if (this.chatWindow && !this.chatWindow.isDestroyed()) {
          this.chatWindow.webContents.send('agent:approvalRequest', {
            sessionId,
            id: msg.reqId,
            toolName: msg.toolName,
            args: msg.args,
            reason: msg.reason,
          });
        }
        break;
      }

      case 'askUser': {
        // Flatten request into top-level so renderer sees { question, options, ..., sessionId, reqId }
        // Legacy path sends AskUserRequest directly; worker path adds sessionId + reqId
        if (this.chatWindow && !this.chatWindow.isDestroyed()) {
          this.chatWindow.webContents.send('agent:askUser', {
            ...(msg.request as Record<string, unknown>),
            sessionId,
            reqId: msg.reqId,
          });
        }
        break;
      }

      case 'fileEdit': {
        if (this.chatWindow && !this.chatWindow.isDestroyed()) {
          this.chatWindow.webContents.send('agent:fileEdit', {
            sessionId,
            ...msg.data,
          });
        }
        break;
      }

      case 'showTaskWindow': {
        if (this.taskWindow && !this.taskWindow.isDestroyed()) {
          this.taskWindow.show();
        }
        break;
      }

      case 'flashWindows': {
        if (this.chatWindow && !this.chatWindow.isDestroyed() && !this.chatWindow.isFocused()) {
          this.chatWindow.flashFrame(true);
        }
        if (this.taskWindow && !this.taskWindow.isDestroyed() && !this.taskWindow.isFocused()) {
          this.taskWindow.flashFrame(true);
        }
        break;
      }

      case 'delegation': {
        void this.handleDelegation(sessionId, msg).catch(err => {
          logger.error('[WorkerManager] Delegation error', { sessionId, error: err?.message });
        });
        break;
      }
    }
  }

  // ==========================================================================
  // Worker Error/Exit Handling
  // ==========================================================================

  private handleWorkerError(sessionId: string, error: Error): void {
    logger.error('[WorkerManager] Worker error', { sessionId, error: error.message });

    const entry = this.workers.get(sessionId);
    if (entry) {
      entry.isRunning = false;
    }

    // Reject pending run
    const pending = this.pendingRuns.get(sessionId);
    if (pending) {
      pending.reject(error);
      this.pendingRuns.delete(sessionId);
    }

    // Dismiss any pending modals in renderer (askUser/approval)
    this.dismissPendingModals(sessionId);

    // Notify renderer
    if (this.chatWindow && !this.chatWindow.isDestroyed()) {
      this.chatWindow.webContents.send('agent:error', {
        sessionId,
        error: `Worker error: ${error.message}`,
      });
    }
  }

  private handleWorkerExit(sessionId: string, code: number): void {
    logger.info('[WorkerManager] Worker exited', { sessionId, code });

    // Save info before deleting entry
    const entry = this.workers.get(sessionId);
    const savedToolGroups = entry?.enabledToolGroups ?? [];
    const prevCrashCount = entry?.crashCount ?? 0;
    const wasIntentional = entry?.intentionalTerminate ?? false;

    if (code !== 0 && !wasIntentional) {
      // Abnormal exit - dismiss pending modals and notify renderer
      this.dismissPendingModals(sessionId);

      if (this.chatWindow && !this.chatWindow.isDestroyed()) {
        this.chatWindow.webContents.send('agent:error', {
          sessionId,
          error: `Worker crashed (exit code: ${code})`,
        });
      }

      // Reject pending run
      const pending = this.pendingRuns.get(sessionId);
      if (pending) {
        pending.reject(new Error(`Worker crashed (exit code: ${code})`));
        this.pendingRuns.delete(sessionId);
      }
    }

    this.workers.delete(sessionId);
    this.sessionTodos.delete(sessionId);

    // Auto-recreate worker on abnormal exit (tab may still be open)
    // Skip if intentionally terminated (tab close) — prevents race with terminateWorker
    // Limit retries to prevent infinite crash loops
    const MAX_AUTO_RECREATE = 2;
    if (code !== 0 && !wasIntentional && prevCrashCount < MAX_AUTO_RECREATE) {
      try {
        this.createWorker(sessionId, savedToolGroups);
        // Carry over crash count
        const newEntry = this.workers.get(sessionId);
        if (newEntry) newEntry.crashCount = prevCrashCount + 1;
        logger.info('[WorkerManager] Worker auto-recreated after crash', { sessionId, crashCount: prevCrashCount + 1 });
      } catch (err) {
        logger.errorSilent('[WorkerManager] Failed to auto-recreate worker', { sessionId, error: (err as Error)?.message });
      }
    } else if (code !== 0) {
      logger.warn('[WorkerManager] Worker crashed too many times, not recreating', { sessionId, crashCount: prevCrashCount });
    }
  }

  // ==========================================================================
  // Shared Resource Delegation
  // ==========================================================================

  private async handleDelegation(sessionId: string, msg: WorkerToMainMessage & { type: 'delegation' }): Promise<void> {
    // TODO Phase 3+: Implement browser/office/dialog delegation from worker to main
    // For now, return error indicating delegation is not yet implemented
    const entry = this.workers.get(sessionId);
    if (entry) {
      entry.worker.postMessage({
        type: 'delegationResult',
        requestId: msg.requestId,
        result: null,
        error: 'Delegation not yet implemented',
      });
    }
  }

  // ==========================================================================
  // Worker Cleanup
  // ==========================================================================

  /**
   * Terminate a specific worker (tab close)
   */
  async terminateWorker(sessionId: string): Promise<void> {
    const entry = this.workers.get(sessionId);
    if (!entry) return;

    // Abort if running
    if (entry.isRunning) {
      this.sendToWorker(sessionId, { type: 'abort' });
      // Give it a moment to clean up
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Dismiss any pending modals in renderer before termination
    this.dismissPendingModals(sessionId);

    // Mark as intentional so handleWorkerExit skips auto-recreate
    entry.intentionalTerminate = true;
    await entry.worker.terminate();
    this.workers.delete(sessionId);
    this.sessionTodos.delete(sessionId);

    // Reject any pending run
    const pending = this.pendingRuns.get(sessionId);
    if (pending) {
      pending.reject(new Error('Worker terminated'));
      this.pendingRuns.delete(sessionId);
    }

    logger.info('[WorkerManager] Worker terminated', { sessionId, remainingWorkers: this.workers.size });
  }

  /**
   * Terminate all workers (app quit)
   */
  async terminateAll(): Promise<void> {
    const sessionIds = [...this.workers.keys()];
    await Promise.all(sessionIds.map(id => this.terminateWorker(id)));
    logger.info('[WorkerManager] All workers terminated');
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  /**
   * Dismiss any pending askUser/approval modals in renderer for a given session.
   * Called when worker crashes, errors, or is terminated to prevent orphaned modals.
   */
  private dismissPendingModals(sessionId: string): void {
    if (this.chatWindow && !this.chatWindow.isDestroyed()) {
      this.chatWindow.webContents.send('agent:askUserResolved', { sessionId });
      this.chatWindow.webContents.send('agent:approvalResolved', { sessionId });
    }
  }

  private sendToWorker(sessionId: string, msg: MainToWorkerMessage): void {
    const entry = this.workers.get(sessionId);
    if (entry) {
      entry.worker.postMessage(msg);
    } else {
      logger.warn('[WorkerManager] Cannot send to non-existent worker', { sessionId, msgType: msg.type });
    }
  }

  private waitForReady(sessionId: string, timeout: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const entry = this.workers.get(sessionId);
      if (!entry) {
        reject(new Error(`No worker found for session ${sessionId}`));
        return;
      }

      if (entry.isReady) {
        resolve();
        return;
      }

      const timer = setTimeout(() => {
        reject(new Error(`Worker for session ${sessionId} failed to initialize within ${timeout}ms`));
      }, timeout);

      const checkReady = () => {
        if (entry.isReady) {
          clearTimeout(timer);
          resolve();
        } else {
          setTimeout(checkReady, 100);
        }
      };

      checkReady();
    });
  }
}

// Singleton instance
export const workerManager = new WorkerManager();
