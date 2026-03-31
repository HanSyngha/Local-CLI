/**
 * Session Manager for Electron Main Process
 * - 세션 저장/로드/삭제
 * - 채팅 히스토리 관리
 * - 자동 저장 기능
 * - Atomic writes (write to .tmp then rename) to prevent corruption on crash
 * - Backup (.bak) before each write for crash recovery
 * - Fallback load: try main file, then .bak if corrupted
 * - Error/abort message cleanup on session load
 *
 * CLI parity: Aligned with CLI's session-manager.ts for feature parity
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { logger } from '../../utils/logger';

// Dynamic electron import for worker_threads compatibility
function getElectronApp(): { getPath(name: string): string } | null {
  try {
    return require('electron').app;
  } catch {
    return null;
  }
}
import { reportError } from '../telemetry/error-reporter';

// =============================================================================
// Atomic Write & Recovery Utilities (CLI parity)
// =============================================================================

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
 * Reconstruct logEntries from messages when logEntries were not saved.
 * Enables session restore to show tool call history for older sessions.
 */
export function reconstructLogEntries(messages: Array<{ role: string; content: string; tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>; tool_call_id?: string; name?: string }>): SessionLogEntry[] {
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
 * Write file atomically: write to .tmp, then rename.
 * Creates .bak backup of existing file before replacing.
 */
async function writeFileAtomic(filePath: string, data: string): Promise<void> {
  const tmpPath = filePath + '.tmp';
  const bakPath = filePath + '.bak';
  const dir = path.dirname(filePath);

  // Ensure directory exists (prevents ENOENT on rename)
  try {
    await fs.promises.access(dir);
  } catch {
    await fs.promises.mkdir(dir, { recursive: true });
  }

  // Write to temp file first
  await fs.promises.writeFile(tmpPath, data, 'utf-8');

  // Backup existing file (best effort)
  try {
    await fs.promises.access(filePath);
    await fs.promises.copyFile(filePath, bakPath);
  } catch {
    // No existing file to backup — that's fine
  }

  // Atomic rename: tmp → target (retry once on ENOENT race condition)
  try {
    await fs.promises.rename(tmpPath, filePath);
  } catch (renameError) {
    const err = renameError as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {
      // Race condition: tmp file was consumed by another save. Retry write + rename.
      logger.warn('writeFileAtomic ENOENT on rename, retrying', { filePath });
      await fs.promises.writeFile(tmpPath, data, 'utf-8');
      await fs.promises.rename(tmpPath, filePath);
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
    const content = await fs.promises.readFile(filePath, 'utf-8');
    JSON.parse(content); // Validate JSON
    return content;
  } catch (mainError) {
    // Main file missing or corrupted — try backup
    const bakPath = filePath + '.bak';
    try {
      const bakContent = await fs.promises.readFile(bakPath, 'utf-8');
      JSON.parse(bakContent); // Validate JSON
      logger.warn('Session file corrupted, restored from backup', { filePath });
      // Restore backup as main file
      await fs.promises.copyFile(bakPath, filePath);
      return bakContent;
    } catch {
      // Both files corrupted or missing — rethrow original error
      throw mainError;
    }
  }
}

// =============================================================================
// Types (CLI parity)
// =============================================================================

// 메시지 타입
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: number;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
  name?: string;
  metadata?: {
    model?: string;
    tokens?: number;
    tool?: string;
    toolResult?: unknown;
  };
}

/**
 * Log entry for session restoration (CLI parity)
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
 * TODO item for session restoration (CLI parity)
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

// 세션 타입
export interface Session {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  workingDirectory?: string;
  messages: ChatMessage[];
  logEntries?: SessionLogEntry[];  // For session restoration
  todos?: SessionTodoItem[];       // Only in-progress/pending todos
  metadata?: {
    model?: string;
    totalTokens?: number;
    messageCount?: number;
  };
}

// 세션 요약 (목록용)
export interface SessionSummary {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  workingDirectory?: string;
  preview?: string;
}

// =============================================================================
// Session Manager Class
// =============================================================================

class SessionManager {
  private sessionsDir: string = '';
  private currentSession: Session | null = null;
  private initialized: boolean = false;
  private autoSaveTimer: NodeJS.Timeout | null = null;
  private autoSaveInterval: number = 30000; // 30초

  // Current log entries and todos for auto-save (CLI parity)
  private currentLogEntries: SessionLogEntry[] = [];
  private currentTodos: SessionTodoItem[] = [];

  constructor() {}

  /**
   * Normalize messages for saving: include tool_calls, tool_call_id, name fields (CLI parity)
   */
  private normalizeMessages(messages: ChatMessage[]): ChatMessage[] {
    return messages.map(msg => {
      const normalized: ChatMessage = {
        id: msg.id,
        role: msg.role,
        content: msg.content,
        timestamp: msg.timestamp,
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
      // metadata가 있으면 포함
      if (msg.metadata) {
        normalized.metadata = msg.metadata;
      }
      return normalized;
    });
  }

  /**
   * Validate tool messages: remove orphaned tool messages (CLI parity)
   */
  private validateToolMessages(messages: ChatMessage[]): ChatMessage[] {
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
   * Remove trailing error/abort messages from session on load (CLI parity).
   * These messages were added during errors but pollute LLM context on resume.
   * Only strips from the tail — stops at first non-error message.
   */
  private cleanErrorMessages(messages: ChatMessage[]): ChatMessage[] {
    if (messages.length === 0) return messages;

    let endIndex = messages.length;
    // Walk backwards and strip trailing error/system messages
    while (endIndex > 0) {
      const msg = messages[endIndex - 1];
      // Strip system messages at the tail (errors from renderer are role:'system')
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
    if (endIndex > 0) {
      const lastMsg = messages[endIndex - 1];
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
   * Repair incomplete tool_call sequences (CLI parity):
   * If an assistant message has tool_calls but not all have matching tool responses,
   * add dummy "[interrupted]" responses to prevent LLM API errors on resume.
   */
  private repairIncompleteToolCalls(messages: ChatMessage[]): ChatMessage[] {
    const result: ChatMessage[] = [];

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      result.push(msg);

      if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
        // Collect tool responses that follow this assistant message
        const responseIds = new Set<string>();
        for (let j = i + 1; j < messages.length; j++) {
          const next = messages[j];
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
              id: `dummy-${tc.id}`,
              role: 'tool' as const,
              tool_call_id: tc.id,
              name: tc.function.name,
              content: '[interrupted — tool execution was not completed]',
              timestamp: Date.now(),
            });
          }
        }
      }
    }

    return result;
  }

  /**
   * Set current log entries for auto-save (CLI parity)
   */
  setLogEntries(logEntries: SessionLogEntry[]): void {
    this.currentLogEntries = logEntries;
  }

  /**
   * Set current todos for auto-save - only saves in-progress/pending todos (CLI parity)
   */
  setTodos(todos: SessionTodoItem[]): void {
    // Only save todos that are not completed (pending or in_progress)
    this.currentTodos = todos.filter(t => t.status === 'pending' || t.status === 'in_progress');
  }

  /**
   * Get current log entries
   */
  getLogEntries(): SessionLogEntry[] {
    return this.currentLogEntries;
  }

  /**
   * Get current todos
   */
  getTodos(): SessionTodoItem[] {
    return this.currentTodos;
  }

  /**
   * 세션 디렉토리 경로 반환
   */
  getSessionsDirectory(): string {
    return this.sessionsDir;
  }

  /**
   * 초기화
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Sessions 디렉토리 경로 설정 (Windows: %APPDATA%\local-bot\sessions)
    const electronApp = getElectronApp();
    const baseDir = process.platform === 'win32'
      ? path.join(process.env.APPDATA || (electronApp?.getPath('userData') ?? path.join(os.homedir(), '.local-bot')), 'local-bot')
      : (electronApp?.getPath('userData') ?? path.join(os.homedir(), '.local-bot'));
    this.sessionsDir = path.join(baseDir, 'sessions');

    logger.info('Session manager initializing', {
      sessionsDir: this.sessionsDir,
    });

    // Sessions 디렉토리 생성
    await this.ensureSessionsDirectory();

    this.initialized = true;
    logger.info('Session manager initialized');
  }

  /**
   * Sessions 디렉토리 생성
   */
  private async ensureSessionsDirectory(): Promise<void> {
    try {
      await fs.promises.mkdir(this.sessionsDir, { recursive: true });
    } catch (error) {
      logger.errorSilent('Failed to create sessions directory', error);
      reportError(error, { type: 'sessionError', method: 'ensureSessionsDirectory' }).catch(() => {});
    }
  }

  /**
   * 세션 파일 경로 생성
   */
  private getSessionPath(sessionId: string): string {
    return path.join(this.sessionsDir, `${sessionId}.json`);
  }

  /**
   * 새 세션 생성
   */
  async createSession(name?: string, workingDirectory?: string): Promise<Session> {
    const id = `session-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const now = Date.now();

    // Clear log entries and todos for new session
    this.currentLogEntries = [];
    this.currentTodos = [];

    const session: Session = {
      id,
      name: name || `Session ${new Date(now).toLocaleString('ko-KR')}`,
      createdAt: now,
      updatedAt: now,
      workingDirectory,
      messages: [],
      metadata: {
        messageCount: 0,
      },
    };

    // 저장
    await this.saveSession(session);

    // 현재 세션으로 설정
    this.currentSession = session;
    this.startAutoSave();

    logger.info('Session created', { sessionId: id, name: session.name });

    return session;
  }

  /**
   * Clear log entries and todos (for new session)
   */
  clearSessionState(): void {
    this.currentLogEntries = [];
    this.currentTodos = [];
  }

  /**
   * 세션 저장
   */
  async saveSession(session: Session): Promise<boolean> {
    try {
      session.updatedAt = Date.now();
      session.metadata = {
        ...session.metadata,
        messageCount: session.messages.length,
      };

      // Normalize messages (include tool_calls, tool_call_id, etc.)
      session.messages = this.normalizeMessages(session.messages);

      // Include log entries and todos for session restoration (CLI parity)
      session.logEntries = this.currentLogEntries.length > 0 ? this.currentLogEntries : undefined;
      session.todos = this.currentTodos.length > 0 ? this.currentTodos : undefined;

      // Atomic write: tmp → backup → rename
      const filePath = this.getSessionPath(session.id);
      await writeFileAtomic(filePath, JSON.stringify(session, null, 2));

      logger.debug('Session saved', {
        sessionId: session.id,
        hasLogEntries: !!session.logEntries,
        hasTodos: !!session.todos,
      });
      return true;
    } catch (error) {
      logger.errorSilent('Failed to save session', { sessionId: session.id, error });
      reportError(error, { type: 'sessionError', method: 'saveSession', sessionId: session.id }).catch(() => {});
      return false;
    }
  }

  /**
   * 세션 로드
   */
  async loadSession(sessionId: string): Promise<Session | null> {
    try {
      const filePath = this.getSessionPath(sessionId);
      const content = await readFileWithFallback(filePath);
      const session = JSON.parse(content) as Session;

      // Validate and clean messages: remove orphaned tool messages (CLI parity)
      session.messages = this.validateToolMessages(session.messages);
      // Strip trailing error/abort messages that pollute LLM context on resume
      session.messages = this.cleanErrorMessages(session.messages);
      // Repair incomplete tool_call sequences (add dummy responses for missing calls)
      session.messages = this.repairIncompleteToolCalls(session.messages);

      // Restore log entries and todos (CLI parity)
      if (session.logEntries) {
        this.currentLogEntries = session.logEntries;
      } else {
        this.currentLogEntries = [];
      }
      if (session.todos) {
        this.currentTodos = session.todos;
      } else {
        this.currentTodos = [];
      }

      // 현재 세션으로 설정
      this.currentSession = session;
      this.startAutoSave();

      logger.info('Session loaded', {
        sessionId,
        messageCount: session.messages.length,
        logEntriesCount: this.currentLogEntries.length,
        todosCount: this.currentTodos.length,
      });
      return session;
    } catch (error) {
      logger.error('Failed to load session', { sessionId, error });
      reportError(error, { type: 'session', method: 'loadSession' }).catch(() => {});
      return null;
    }
  }

  /**
   * 세션 삭제
   */
  async deleteSession(sessionId: string): Promise<boolean> {
    try {
      const filePath = this.getSessionPath(sessionId);
      await fs.promises.unlink(filePath);
      // Also clean up backup file
      await fs.promises.unlink(filePath + '.bak').catch(() => {});

      // 현재 세션이면 해제
      if (this.currentSession?.id === sessionId) {
        this.currentSession = null;
        this.stopAutoSave();
      }

      logger.info('Session deleted', { sessionId });
      return true;
    } catch (error) {
      logger.errorSilent('Failed to delete session', { sessionId, error });
      reportError(error, { type: 'sessionError', method: 'deleteSession', sessionId }).catch(() => {});
      return false;
    }
  }

  /**
   * 모든 세션 목록 가져오기
   */
  async listSessions(): Promise<SessionSummary[]> {
    try {
      const files = await fs.promises.readdir(this.sessionsDir);
      const sessions: SessionSummary[] = [];

      for (const file of files) {
        if (!file.endsWith('.json') || file.endsWith('.bak') || file.endsWith('.tmp')) continue;

        try {
          const filePath = path.join(this.sessionsDir, file);
          const content = await fs.promises.readFile(filePath, 'utf-8');
          const session = JSON.parse(content) as Session;

          // 마지막 메시지 미리보기
          const lastMessage = session.messages[session.messages.length - 1];
          const preview = lastMessage
            ? lastMessage.content.slice(0, 100) + (lastMessage.content.length > 100 ? '...' : '')
            : '';

          sessions.push({
            id: session.id,
            name: session.name,
            createdAt: session.createdAt,
            updatedAt: session.updatedAt,
            messageCount: session.messages.length,
            workingDirectory: session.workingDirectory,
            preview,
          });
        } catch (parseError) {
          logger.warn('Failed to parse session file', { file, error: parseError });
          reportError(parseError, { type: 'sessionError', method: 'listSessions.parse', file }).catch(() => {});
        }
      }

      // 최신순 정렬
      sessions.sort((a, b) => b.updatedAt - a.updatedAt);

      return sessions;
    } catch (error) {
      logger.errorSilent('Failed to list sessions', error);
      reportError(error, { type: 'sessionError', method: 'listSessions' }).catch(() => {});
      return [];
    }
  }

  /**
   * 현재 세션 가져오기
   */
  getCurrentSession(): Session | null {
    return this.currentSession;
  }

  /**
   * 현재 세션 설정
   */
  setCurrentSession(session: Session | null): void {
    this.currentSession = session;
    if (session) {
      this.startAutoSave();
    } else {
      this.stopAutoSave();
    }
  }

  /**
   * 메시지 추가
   */
  async addMessage(message: ChatMessage): Promise<boolean> {
    if (!this.currentSession) {
      logger.warn('No current session to add message');
      return false;
    }

    this.currentSession.messages.push(message);
    this.currentSession.updatedAt = Date.now();

    return true;
  }

  /**
   * 세션 이름 변경
   */
  async renameSession(sessionId: string, newName: string): Promise<boolean> {
    try {
      const session = await this.loadSession(sessionId);
      if (!session) return false;

      session.name = newName;
      return await this.saveSession(session);
    } catch (error) {
      logger.errorSilent('Failed to rename session', { sessionId, newName, error });
      reportError(error, { type: 'sessionError', method: 'renameSession', sessionId }).catch(() => {});
      return false;
    }
  }

  /**
   * 세션 복제
   */
  async duplicateSession(sessionId: string): Promise<Session | null> {
    try {
      const original = await this.loadSession(sessionId);
      if (!original) return null;

      const newSession = await this.createSession(
        `${original.name} (복사본)`,
        original.workingDirectory
      );

      newSession.messages = [...original.messages];
      await this.saveSession(newSession);

      return newSession;
    } catch (error) {
      logger.errorSilent('Failed to duplicate session', { sessionId, error });
      reportError(error, { type: 'sessionError', method: 'duplicateSession', sessionId }).catch(() => {});
      return null;
    }
  }

  /**
   * 세션 내보내기 (JSON)
   */
  async exportSession(sessionId: string): Promise<string | null> {
    try {
      const session = await this.loadSession(sessionId);
      if (!session) return null;

      return JSON.stringify(session, null, 2);
    } catch (error) {
      logger.errorSilent('Failed to export session', { sessionId, error });
      reportError(error, { type: 'sessionError', method: 'exportSession', sessionId }).catch(() => {});
      return null;
    }
  }

  /**
   * 세션 가져오기 (JSON)
   */
  async importSession(jsonData: string): Promise<Session | null> {
    try {
      const data = JSON.parse(jsonData) as Session;

      // 새 ID 생성 (중복 방지)
      data.id = `session-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      data.name = `${data.name} (가져옴)`;
      data.updatedAt = Date.now();

      await this.saveSession(data);
      return data;
    } catch (error) {
      logger.errorSilent('Failed to import session', error);
      reportError(error, { type: 'sessionError', method: 'importSession' }).catch(() => {});
      return null;
    }
  }

  /**
   * 자동 저장 시작
   */
  private startAutoSave(): void {
    this.stopAutoSave();

    this.autoSaveTimer = setInterval(async () => {
      if (this.currentSession && this.currentSession.messages.length > 0) {
        await this.saveSession(this.currentSession);
      }
    }, this.autoSaveInterval);
  }

  /**
   * 자동 저장 중지
   */
  private stopAutoSave(): void {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
  }

  /**
   * 현재 세션 즉시 저장
   */
  async saveCurrentSession(): Promise<boolean> {
    if (!this.currentSession) return false;
    return await this.saveSession(this.currentSession);
  }

  /**
   * 정리 (앱 종료 시)
   */
  async cleanup(): Promise<void> {
    this.stopAutoSave();

    // 현재 세션 저장
    if (this.currentSession) {
      await this.saveSession(this.currentSession);
    }

    logger.info('Session manager cleanup completed');
  }

  /**
   * 세션 검색
   */
  async searchSessions(query: string): Promise<SessionSummary[]> {
    const sessions = await this.listSessions();
    const lowerQuery = query.toLowerCase();

    return sessions.filter(session => {
      return (
        session.name.toLowerCase().includes(lowerQuery) ||
        session.preview?.toLowerCase().includes(lowerQuery) ||
        session.workingDirectory?.toLowerCase().includes(lowerQuery)
      );
    });
  }

  /**
   * UI 상태 저장 (열린 탭 목록 — 앱 재시작 시 복원용)
   */
  async saveUIState(state: { tabs: string[]; activeTabId: string | null }): Promise<void> {
    if (!this.sessionsDir) return;
    const filePath = path.join(path.dirname(this.sessionsDir), 'ui-state.json');
    try {
      await writeFileAtomic(filePath, JSON.stringify(state));
    } catch (error) {
      logger.errorSilent('Failed to save UI state', error);
      reportError(error, { type: 'sessionError', method: 'saveUIState' }).catch(() => {});
    }
  }

  /**
   * UI 상태 로드 (앱 시작 시 이전 탭 복원)
   */
  async loadUIState(): Promise<{ tabs: string[]; activeTabId: string | null } | null> {
    if (!this.sessionsDir) return null;
    const filePath = path.join(path.dirname(this.sessionsDir), 'ui-state.json');
    try {
      const data = await readFileWithFallback(filePath);
      return JSON.parse(data);
    } catch {
      return null;
    }
  }

  /**
   * 오래된 세션 정리 (선택적)
   */
  async cleanupOldSessions(maxAgeDays: number = 30): Promise<number> {
    const sessions = await this.listSessions();
    const cutoffTime = Date.now() - (maxAgeDays * 24 * 60 * 60 * 1000);
    let deletedCount = 0;

    for (const session of sessions) {
      if (session.updatedAt < cutoffTime) {
        const deleted = await this.deleteSession(session.id);
        if (deleted) deletedCount++;
      }
    }

    logger.info('Cleaned up old sessions', { deletedCount, maxAgeDays });
    return deletedCount;
  }
}

// =============================================================================
// Export
// =============================================================================

// 싱글톤 인스턴스
export const sessionManager = new SessionManager();

// Default export for compatibility
export default sessionManager;
