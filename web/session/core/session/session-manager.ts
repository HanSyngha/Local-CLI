/**
 * Session Manager
 *
 * 대화 세션을 파일로 저장하고 복구하는 기능
 * - Atomic writes (write to .tmp then rename) to prevent corruption on crash
 * - Backup (.bak) before each write for crash recovery
 * - Fallback load: try main file, then .bak if corrupted
 * - Pending save queue instead of dropping saves while isSaving
 * - Error/abort message cleanup on session load
 */

import fs from 'fs/promises';
import path from 'path';
import { Message } from '../../types/index.js';
import { configManager } from '../config/config-manager.js';
import { PROJECTS_DIR } from '../../constants.js';
import { initializeJsonStreamLogger } from '../../utils/json-stream-logger.js';
import { logger } from '../../utils/logger.js';
import { reportError } from '../telemetry/error-reporter.js';

/**
 * 세션 메타데이터 인터페이스
 */
export interface SessionMetadata {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  model: string;
  endpoint: string;
}

/**
 * Log entry for session restoration (matches PlanExecuteApp.tsx LogEntry)
 */
export interface SessionLogEntry {
  id: string;
  type: string;
  content: string;
  details?: string;
  toolArgs?: Record<string, unknown>;
  success?: boolean;
  items?: string[];
  diff?: string[];
}

/**
 * TODO item for session restoration
 */
export interface SessionTodoItem {
  id: string;
  title: string;
  description?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  result?: string;
  error?: string;
  dependencies?: string[];
}

/**
 * 세션 데이터 인터페이스
 */
export interface SessionData {
  metadata: SessionMetadata;
  messages: Message[];
  logEntries?: SessionLogEntry[];  // Optional for backward compatibility
  todos?: SessionTodoItem[];       // Only in-progress todos are saved
}

/**
 * 세션 요약 인터페이스 (목록 표시용)
 */
export interface SessionSummary {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  model: string;
  firstMessage?: string;
}

/**
 * Reconstruct logEntries from messages when logEntries were not saved.
 * This enables session restore to show tool call history even for older sessions
 * that didn't save logEntries (race condition between React useEffect and autoSave).
 */
export function reconstructLogEntries(messages: Message[]): SessionLogEntry[] {
  const entries: SessionLogEntry[] = [];
  let idx = 0;

  for (const msg of messages) {
    if (msg.role === 'user') {
      entries.push({
        id: `log-r-${idx++}`,
        type: 'user_input',
        content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
      });
    } else if (msg.role === 'assistant') {
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        for (const tc of msg.tool_calls) {
          let args: Record<string, unknown> = {};
          try { args = JSON.parse(tc.function.arguments); } catch { /* ignore */ }
          entries.push({
            id: `log-r-${idx++}`,
            type: 'tool_start',
            content: tc.function.name,
            toolArgs: args,
          });
        }
      } else if (msg.content) {
        const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
        // Skip internal plan messages
        if (!content.startsWith('📋 Created ')) {
          entries.push({
            id: `log-r-${idx++}`,
            type: 'agent_response',
            content,
          });
        }
      }
    } else if (msg.role === 'tool') {
      const resultContent = typeof msg.content === 'string' ? msg.content : '';
      entries.push({
        id: `log-r-${idx++}`,
        type: 'tool_result',
        content: msg.name || 'tool',
        details: resultContent.length > 500 ? resultContent.substring(0, 500) + '...' : resultContent,
        success: !resultContent.startsWith('[interrupted'),
      });
    }
  }

  return entries;
}

/**
 * Error/abort message patterns to strip from session on load.
 * These are appended during errors but pollute LLM context on resume.
 */
const ERROR_MESSAGE_PATTERNS = [
  /^\[ABORTED BY USER\]$/,
  /^LLM 서버가 응답하지 않습니다/,
  /^Execution error:\n/,
  /^⚠️.*error/i,
  /^Error:/i,
];

/**
 * Write file atomically: write to .tmp, then rename.
 * Creates .bak backup of existing file before replacing.
 */
async function writeFileAtomic(filePath: string, data: string): Promise<void> {
  const tmpPath = filePath + '.tmp';
  const bakPath = filePath + '.bak';
  const dir = path.dirname(filePath);

  // Ensure directory exists (prevents ENOENT on rename)
  try {
    await fs.access(dir);
  } catch {
    await fs.mkdir(dir, { recursive: true });
  }

  // Write to temp file first
  await fs.writeFile(tmpPath, data, 'utf-8');

  // Backup existing file (best effort)
  try {
    await fs.access(filePath);
    await fs.copyFile(filePath, bakPath);
  } catch {
    // No existing file to backup — that's fine
  }

  // Atomic rename: tmp → target (retry once on ENOENT race condition)
  try {
    await fs.rename(tmpPath, filePath);
  } catch (renameError) {
    const err = renameError as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {
      // Race condition: tmp file was consumed by another save. Retry write + rename.
      logger.warn('writeFileAtomic ENOENT on rename, retrying', { filePath });
      await fs.writeFile(tmpPath, data, 'utf-8');
      await fs.rename(tmpPath, filePath);
    } else {
      throw renameError;
    }
  }
}

/**
 * Read session file with fallback to .bak if main file is corrupted.
 */
async function readFileWithFallback(filePath: string): Promise<string> {
  // Try main file first
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    JSON.parse(content); // Validate JSON
    return content;
  } catch (mainError) {
    // Main file missing or corrupted — try backup
    const bakPath = filePath + '.bak';
    try {
      const bakContent = await fs.readFile(bakPath, 'utf-8');
      JSON.parse(bakContent); // Validate JSON
      logger.warn('Session file corrupted, restored from backup', { filePath });
      // Restore backup as main file
      await fs.copyFile(bakPath, filePath);
      return bakContent;
    } catch {
      // Both files corrupted or missing — rethrow original error
      throw mainError;
    }
  }
}

/**
 * Session Manager 클래스
 */
export class SessionManager {
  private currentSessionId: string | null = null;
  private currentSessionCreatedAt: string | null = null;
  private currentSessionName: string | null = null;
  private isSaving: boolean = false;
  private pendingSaveMessages: Message[] | null = null;

  constructor() {
    // Generate a new session ID for this runtime instance
    this.currentSessionId = `session-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    this.currentSessionCreatedAt = new Date().toISOString();
  }

  /**
   * Get project-specific sessions directory based on current working directory
   */
  private getSessionsDir(): string {
    // Get current working directory and sanitize it for use in path
    // Replace '/' with '-' and remove leading '-' if present (for absolute paths)
    const cwd = process.cwd().replace(/\//g, '-').replace(/^-/, '');
    return path.join(PROJECTS_DIR, cwd);
  }

  /**
   * Normalize messages for saving: include tool_calls, tool_call_id, name fields
   */
  private normalizeMessages(messages: Message[]): Message[] {
    return messages.map(msg => {
      const normalized: Message = {
        role: msg.role,
        content: msg.content,
      };
      // tool_calls가 있으면 포함 (assistant 메시지)
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        normalized.tool_calls = msg.tool_calls;
      }
      // tool_call_id가 있으면 포함 (tool 메시지)
      if (msg.tool_call_id) {
        normalized.tool_call_id = msg.tool_call_id;
      }
      // name이 있으면 포함 (tool 메시지)
      if (msg.name) {
        normalized.name = msg.name;
      }
      return normalized;
    });
  }

  /**
   * Validate tool messages: remove orphaned tool messages that have no matching tool_calls
   * This fixes sessions saved before tool_calls were properly persisted
   */
  private validateToolMessages(messages: Message[]): Message[] {
    // Collect all valid tool_call_ids from assistant messages with tool_calls
    const validToolCallIds = new Set<string>();
    for (const msg of messages) {
      if (msg.role === 'assistant' && msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          validToolCallIds.add(tc.id);
        }
      }
    }

    // Filter out tool messages with invalid tool_call_ids
    const validated = messages.filter(msg => {
      // Keep non-tool messages
      if (msg.role !== 'tool') {
        return true;
      }
      // For tool messages, check if tool_call_id exists and is valid
      if (msg.tool_call_id && validToolCallIds.has(msg.tool_call_id)) {
        return true;
      }
      // Remove orphaned tool messages
      logger.warn('Removing orphaned tool message', { tool_call_id: msg.tool_call_id });
      return false;
    });

    return validated;
  }

  /**
   * Remove trailing error/abort messages from session on load.
   * These messages were added during errors but pollute LLM context on resume.
   * Only strips from the tail — stops at first non-error message.
   */
  private cleanErrorMessages(messages: Message[]): Message[] {
    if (messages.length === 0) return messages;

    let endIndex = messages.length;
    // Walk backwards and strip trailing error/system messages
    while (endIndex > 0) {
      const msg = messages[endIndex - 1]!;
      // Strip system messages at the tail (Electron adds errors as role:'system')
      if (msg.role === 'system') {
        logger.warn('Stripping trailing system message from session on load', { content: (typeof msg.content === 'string' ? msg.content : '').substring(0, 80) });
        endIndex--;
        continue;
      }
      if (msg.role !== 'assistant' || !msg.content) break;

      const content = typeof msg.content === 'string' ? msg.content : '';
      const isError = ERROR_MESSAGE_PATTERNS.some(pattern => pattern.test(content));
      if (!isError) break;

      logger.warn('Stripping error message from session on load', { content: content.substring(0, 80) });
      endIndex--;
    }

    // Also remove any trailing orphaned tool_calls assistant message without matching tool response
    // (happens when error occurs mid-tool-execution)
    if (endIndex > 0) {
      const lastMsg = messages[endIndex - 1]!;
      if (lastMsg.role === 'assistant' && lastMsg.tool_calls && lastMsg.tool_calls.length > 0) {
        const hasAllResponses = lastMsg.tool_calls.every(tc =>
          messages.slice(endIndex).some(m => m.role === 'tool' && m.tool_call_id === tc.id)
        );
        if (!hasAllResponses) {
          logger.warn('Stripping incomplete tool_calls message from session on load');
          endIndex--;
        }
      }
    }

    return endIndex === messages.length ? messages : messages.slice(0, endIndex);
  }

  /**
   * Repair incomplete tool_call sequences: if an assistant message has tool_calls
   * but not all calls have matching tool responses, add dummy "[interrupted]" responses.
   * This prevents LLM API errors on session resume (API requires all tool_calls to have responses).
   */
  private repairIncompleteToolCalls(messages: Message[]): Message[] {
    const result: Message[] = [];

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]!;
      result.push(msg);

      if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
        // Collect tool responses that follow this assistant message (up to next non-tool message)
        const responseIds = new Set<string>();
        for (let j = i + 1; j < messages.length; j++) {
          const next = messages[j]!;
          if (next.role === 'tool' && next.tool_call_id) {
            responseIds.add(next.tool_call_id);
          } else if (next.role !== 'tool') {
            break;
          }
        }

        // Add dummy responses for missing tool_calls
        for (const tc of msg.tool_calls) {
          if (!responseIds.has(tc.id)) {
            logger.warn('Adding dummy response for interrupted tool_call', { toolCallId: tc.id, toolName: tc.function.name });
            result.push({
              role: 'tool' as const,
              tool_call_id: tc.id,
              name: tc.function.name,
              content: '[interrupted — tool execution was not completed]',
            });
          }
        }
      }
    }

    return result;
  }

  /**
   * 세션 디렉토리 초기화
   */
  async ensureSessionsDir(): Promise<void> {
    const sessionsDir = this.getSessionsDir();
    try {
      await fs.access(sessionsDir);
    } catch {
      await fs.mkdir(sessionsDir, { recursive: true });
    }
  }

  /**
   * 세션 저장
   */
  async saveSession(name: string, messages: Message[]): Promise<string> {
    logger.enter('saveSession', { name, messageCount: messages.length });
    await this.ensureSessionsDir();

    // 세션 ID 생성
    const sessionId = `session-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    // 현재 모델 정보 가져오기
    const endpoint = configManager.getCurrentEndpoint();
    const model = configManager.getCurrentModel();

    // 메시지 정규화 (tool_calls, tool_call_id 포함)
    const normalizedMessages = this.normalizeMessages(messages);

    // 세션 데이터 생성
    const sessionData: SessionData = {
      metadata: {
        id: sessionId,
        name: name,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messageCount: messages.length,
        model: model?.id || 'unknown',
        endpoint: endpoint?.baseUrl || 'unknown',
      },
      messages: normalizedMessages,
    };

    // 파일로 저장 (atomic write)
    const sessionsDir = this.getSessionsDir();
    const filePath = path.join(sessionsDir, `${sessionId}.json`);
    await writeFileAtomic(filePath, JSON.stringify(sessionData, null, 2));

    logger.exit('saveSession', { sessionId, filePath });
    return sessionId;
  }

  /**
   * 세션 로드
   */
  async loadSession(sessionId: string): Promise<SessionData | null> {
    logger.enter('loadSession', { sessionId });
    await this.ensureSessionsDir();

    const sessionsDir = this.getSessionsDir();
    const filePath = path.join(sessionsDir, `${sessionId}.json`);

    try {
      const content = await readFileWithFallback(filePath);
      const sessionData = JSON.parse(content) as SessionData;

      // Validate and clean messages: remove orphaned tool messages (tool_call_id without matching tool_calls)
      let cleanedMessages = this.validateToolMessages(sessionData.messages);
      // Strip trailing error/abort messages that pollute LLM context on resume
      cleanedMessages = this.cleanErrorMessages(cleanedMessages);
      // Repair incomplete tool_call sequences (add dummy responses for missing calls)
      cleanedMessages = this.repairIncompleteToolCalls(cleanedMessages);
      sessionData.messages = cleanedMessages;
      sessionData.metadata.messageCount = cleanedMessages.length;

      // updatedAt 갱신
      sessionData.metadata.updatedAt = new Date().toISOString();
      await writeFileAtomic(filePath, JSON.stringify(sessionData, null, 2));

      // 현재 세션 ID를 로드된 세션으로 설정 (이후 대화가 이 세션에 저장되도록)
      this.currentSessionId = sessionData.metadata.id;
      this.currentSessionCreatedAt = sessionData.metadata.createdAt;
      this.currentSessionName = sessionData.metadata.name || null;

      // 로거를 해당 세션의 로그 파일로 재초기화 (append 모드)
      await initializeJsonStreamLogger(sessionData.metadata.id, true);

      logger.exit('loadSession', { sessionId, messageCount: sessionData.messages.length });
      return sessionData;
    } catch (error) {
      logger.errorSilent('Failed to load session', { sessionId, error } as any);
      reportError(error, { type: 'session', method: 'loadSession', sessionId }).catch(() => {});
      return null;
    }
  }

  /**
   * 모든 세션 목록 가져오기
   */
  async listSessions(): Promise<SessionSummary[]> {
    logger.enter('listSessions', { sessionsDir: this.getSessionsDir() });
    await this.ensureSessionsDir();

    try {
      const sessionsDir = this.getSessionsDir();
      const files = await fs.readdir(sessionsDir);
      // 세션 파일만 필터링 (_log.json, _error.json, .bak, .tmp 제외)
      const sessionFiles = files.filter((f) =>
        f.endsWith('.json') &&
        !f.endsWith('_log.json') &&
        !f.endsWith('_error.json') &&
        !f.endsWith('.bak') &&
        !f.endsWith('.tmp')
      );

      const sessions: SessionSummary[] = [];

      for (const file of sessionFiles) {
        try {
          const filePath = path.join(sessionsDir, file);
          const content = await fs.readFile(filePath, 'utf-8');
          const sessionData = JSON.parse(content) as SessionData;

          // 첫 번째 사용자 메시지 찾기
          const firstUserMessage = sessionData.messages.find((m) => m.role === 'user');

          sessions.push({
            id: sessionData.metadata.id,
            name: sessionData.metadata.name,
            createdAt: sessionData.metadata.createdAt,
            updatedAt: sessionData.metadata.updatedAt,
            messageCount: sessionData.metadata.messageCount,
            model: sessionData.metadata.model,
            firstMessage: firstUserMessage?.content?.substring(0, 50),
          });
        } catch (parseError) {
          // Skip invalid session files
          logger.warn(`Failed to parse session file ${file}:`, parseError);
          reportError(parseError, { type: 'sessionError', method: 'listSessions.parse', file }).catch(() => {});
        }
      }

      // 최근 업데이트 순으로 정렬
      sessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

      logger.exit('listSessions', { sessionCount: sessions.length });
      return sessions;
    } catch (error) {
      logger.errorSilent('Failed to list sessions', error as Error);
      reportError(error, { type: 'sessionError', method: 'listSessions' }).catch(() => {});
      return [];
    }
  }

  /**
   * 세션 삭제
   */
  async deleteSession(sessionId: string): Promise<boolean> {
    logger.enter('deleteSession', { sessionId });
    await this.ensureSessionsDir();

    const sessionsDir = this.getSessionsDir();
    const filePath = path.join(sessionsDir, `${sessionId}.json`);

    try {
      await fs.unlink(filePath);
      // Also clean up backup file
      await fs.unlink(filePath + '.bak').catch(() => {});
      logger.exit('deleteSession', { sessionId, success: true });
      return true;
    } catch (error) {
      logger.errorSilent('Failed to delete session', { sessionId, error } as any);
      reportError(error, { type: 'sessionError', method: 'deleteSession', sessionId }).catch(() => {});
      return false;
    }
  }

  /**
   * 이름으로 세션 찾기
   */
  async findSessionByName(name: string): Promise<SessionSummary | null> {
    const sessions = await this.listSessions();
    return sessions.find((s) => s.name === name) || null;
  }

  /**
   * 세션 갱신 (메시지 추가)
   */
  async updateSession(sessionId: string, messages: Message[]): Promise<boolean> {
    logger.enter('updateSession', { sessionId, messageCount: messages.length });
    await this.ensureSessionsDir();

    const sessionData = await this.loadSession(sessionId);
    if (!sessionData) {
      logger.warn('Session not found for update', { sessionId });
      return false;
    }

    // 메시지 정규화 (tool_calls, tool_call_id 포함)
    const normalizedMessages = this.normalizeMessages(messages);

    sessionData.messages = normalizedMessages;
    sessionData.metadata.messageCount = messages.length;
    sessionData.metadata.updatedAt = new Date().toISOString();

    const sessionsDir = this.getSessionsDir();
    const filePath = path.join(sessionsDir, `${sessionId}.json`);
    await writeFileAtomic(filePath, JSON.stringify(sessionData, null, 2));

    logger.exit('updateSession', { sessionId, messageCount: messages.length });
    return true;
  }

  // Current log entries for auto-save (set by UI)
  private currentLogEntries: SessionLogEntry[] = [];
  // Current todos for auto-save (set by UI)
  private currentTodos: SessionTodoItem[] = [];

  /**
   * Set current log entries for auto-save
   */
  setLogEntries(logEntries: SessionLogEntry[]): void {
    this.currentLogEntries = logEntries;
  }

  /**
   * Set current todos for auto-save (only saves in-progress/pending todos)
   */
  setTodos(todos: SessionTodoItem[]): void {
    // Only save todos that are not completed (pending or in_progress)
    this.currentTodos = todos.filter(t => t.status === 'pending' || t.status === 'in_progress');
  }

  /**
   * 현재 세션 자동 저장 (메시지가 추가될 때마다 호출)
   * Fire-and-forget 방식으로 비동기 저장 (블로킹 없음)
   * If a save is already in progress, queues the latest messages for a follow-up save.
   */
  autoSaveCurrentSession(messages: Message[], logEntries?: SessionLogEntry[]): void {
    if (!this.currentSessionId || messages.length === 0) {
      return;
    }

    // Update log entries if provided
    if (logEntries) {
      this.currentLogEntries = logEntries;
    }

    if (this.isSaving) {
      // Queue latest messages — will be saved after current save finishes
      this.pendingSaveMessages = [...messages];
      return;
    }

    // Fire-and-forget: 비동기 저장을 백그라운드에서 실행
    this.performAutoSave(messages).catch((err: unknown) => {
      // Silently log errors without blocking
      const error = err as Error;
      logger.warn('Auto-save failed:', { error: error.message || 'Unknown error' });
    });
  }

  /**
   * 실제 저장 작업 수행 (내부 메서드)
   * After completing, checks for queued (pending) save and runs it.
   */
  private async performAutoSave(messages: Message[]): Promise<void> {
    this.isSaving = true;
    logger.flow('Auto-saving session', { sessionId: this.currentSessionId, messageCount: messages.length });

    try {
      await this.ensureSessionsDir();

      // 현재 모델 정보 가져오기
      const endpoint = configManager.getCurrentEndpoint();
      const model = configManager.getCurrentModel();

      // 메시지 정규화 (tool_calls, tool_call_id 포함)
      const normalizedMessages = this.normalizeMessages(messages);

      // 세션 데이터 생성/업데이트
      const sessionData: SessionData = {
        metadata: {
          id: this.currentSessionId!,
          name: this.currentSessionName || `${this.currentSessionId}`,
          createdAt: this.currentSessionCreatedAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          messageCount: messages.length,
          model: model?.id || 'unknown',
          endpoint: endpoint?.baseUrl || 'unknown',
        },
        messages: normalizedMessages,
        // Reconstruct logEntries from messages if React useEffect hasn't synced yet (race condition fix)
        logEntries: this.currentLogEntries.length > 0
          ? this.currentLogEntries
          : reconstructLogEntries(normalizedMessages),
        todos: this.currentTodos.length > 0 ? this.currentTodos : undefined,  // Only include if there are pending/in-progress todos
      };

      // Atomic write: tmp → backup → rename
      const sessionsDir = this.getSessionsDir();
      const filePath = path.join(sessionsDir, `${this.currentSessionId!}.json`);
      await writeFileAtomic(filePath, JSON.stringify(sessionData, null, 2));
    } finally {
      this.isSaving = false;

      // Process queued save if any
      if (this.pendingSaveMessages) {
        const pending = this.pendingSaveMessages;
        this.pendingSaveMessages = null;
        this.performAutoSave(pending).catch((err: unknown) => {
          const error = err as Error;
          logger.warn('Queued auto-save failed:', { error: error.message || 'Unknown error' });
        });
      }
    }
  }

  /**
   * 현재 세션 ID 가져오기
   */
  getCurrentSessionId(): string | null {
    return this.currentSessionId;
  }

  /**
   * 현재 세션 ID 설정
   */
  setCurrentSessionId(sessionId: string): void {
    this.currentSessionId = sessionId;
  }

  /**
   * 현재 세션 이름 가져오기
   */
  getCurrentSessionName(): string | null {
    return this.currentSessionName;
  }

  /**
   * 현재 세션 이름 설정 (Planning LLM 타이틀 → 세션 이름)
   */
  setCurrentSessionName(name: string): void {
    this.currentSessionName = name;
  }
}

/**
 * SessionManager 싱글톤 인스턴스
 */
export const sessionManager = new SessionManager();
