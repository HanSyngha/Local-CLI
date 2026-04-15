/**
 * Electron Preload Script
 * - contextBridge   API 
 * -  IPC  
 */

import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

// ============   ============

// PowerShell 
export interface PowerShellResult {
  success: boolean;
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
  error?: string;
  duration?: number;
}

export interface PowerShellOutput {
  type: 'stdout' | 'stderr' | 'error' | 'exit';
  data: string;
  timestamp: number;
}

export interface PowerShellExitEvent {
  code: number | null;
  sessionId: string;
}

export interface PowerShellErrorEvent {
  error: string;
  sessionId: string;
}

export interface SessionInfo {
  id: string;
  state: 'idle' | 'running' | 'busy' | 'error' | 'terminated';
  startTime: number;
  currentDirectory: string;
  lastActivity: number;
}

//   
export interface SystemInfo {
  platform: string;
  arch: string;
  nodeVersion: string;
  electronVersion: string;
  appVersion: string;
  appPath: string;
  userDataPath: string;
  tempPath: string;
}

//  
export interface FileFilter {
  name: string;
  extensions: string[];
}

export interface DialogResult {
  success: boolean;
  canceled: boolean;
  filePath?: string;
  filePaths?: string[];
  error?: string;
}

export interface MessageDialogOptions {
  type?: 'none' | 'info' | 'error' | 'question' | 'warning';
  title?: string;
  message: string;
  detail?: string;
  buttons?: string[];
}

//   
export interface LogFile {
  name: string;
  path: string;
  size: number;
  date: string;
}

//   
export type LogCategory = 'all' | 'chat' | 'tool' | 'http' | 'llm' | 'subagent' | 'ui' | 'system' | 'debug';

//   
export interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  data?: unknown;
  category?: LogCategory; // Computed from message prefix
}

//  
export type Theme = 'dark' | 'light';

// Docs 
export interface DocsSource {
  id: string;
  name: string;
  description: string;
  installed: boolean;
  fileCount?: number;
  size?: string;
}

export interface DocsInfo {
  path: string;
  exists: boolean;
  totalFiles: number;
  totalSize: string;
  sources: DocsSource[];
}

export interface DownloadProgress {
  downloaded: number;
  total: number;
  current?: string;
}

// Config 
export interface AppConfig {
  theme: 'light' | 'dark' | 'system';
  lastOpenedDirectory?: string;
  recentDirectories: string[];
  sidebarWidth: number;
  bottomPanelHeight: number;
  autoFileView?: boolean;
  windowBounds?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

//   
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
  metadata?: {
    model?: string;
    tokens?: number;
    tool?: string;
    toolResult?: unknown;
  };
}

//  
export interface Session {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  workingDirectory?: string;
  messages: ChatMessage[];
  metadata?: {
    model?: string;
    totalTokens?: number;
    messageCount?: number;
  };
}

//    ()
export interface SessionSummary {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  workingDirectory?: string;
  preview?: string;
}

// LLM   
export interface ModelInfo {
  id: string;
  name: string;
  apiModelId?: string;
  maxTokens: number;
  enabled: boolean;
  healthStatus?: 'healthy' | 'degraded' | 'unhealthy';
  lastHealthCheck?: Date;
  supportsVision?: boolean;
}

// LLM Endpoint 
export interface EndpointConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKey?: string;
  models: ModelInfo[];
  createdAt?: Date;
  updatedAt?: Date;
}

// LLM   
export interface LLMStatus {
  version: string;
  sessionId: string;
  workingDir: string;
  endpointUrl: string;
  llmModel: string;
  configPath: string;
}

// Agent 
export interface TodoItem {
  id: string;
  title: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
}

export interface AgentConfig {
  // maxIterations removed - CLI parity: no iteration limit
  enabledToolGroups?: string[];
  workingDirectory?: string;
  isGitRepo?: boolean;
  autoMode?: boolean; // true = allow all permissions, false = supervised mode (ask for approval)
  resumeTodos?: boolean; // true = resume with existing TODOs after pause (skip re-planning)
}

export interface AgentToolCall {
  tool: string;
  args: Record<string, unknown>;
  result: string;
  success: boolean;
}

export interface AgentResult {
  success: boolean;
  response: string;
  messages: Array<{ role: string; content: string; tool_calls?: unknown[]; tool_call_id?: string }>;
  toolCalls: AgentToolCall[];
  iterations: number;
  error?: string;
}

export interface AskUserOption {
  label: string;
  value: string;
}

export interface AskUserRequest {
  question: string;
  options: AskUserOption[];
  allowCustom?: boolean;
}

export interface AskUserResponse {
  selectedOption: AskUserOption;
  customText?: string;
  isOther: boolean;
}

// ============ API  ============

const electronAPI = {
  // ============   ============
  window: {
    minimize: (): void => {
      ipcRenderer.send('window:minimize');
    },

    maximize: (): void => {
      ipcRenderer.send('window:maximize');
    },

    close: (): void => {
      ipcRenderer.send('window:close');
    },

    isMaximized: (): Promise<boolean> => {
      return ipcRenderer.invoke('window:isMaximized');
    },

    onMaximizeChange: (callback: (isMaximized: boolean) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, isMaximized: boolean) => callback(isMaximized);
      ipcRenderer.on('window:maximizeChange', handler);
      return () => ipcRenderer.removeListener('window:maximizeChange', handler);
    },

    onFocusChange: (callback: (isFocused: boolean) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, isFocused: boolean) => callback(isFocused);
      ipcRenderer.on('window:focus', handler);
      return () => ipcRenderer.removeListener('window:focus', handler);
    },

    reload: (): Promise<{ success: boolean }> => {
      return ipcRenderer.invoke('window:reload');
    },

    getWindowType: (): Promise<'chat' | 'task' | 'jarvis'> => {
      return ipcRenderer.invoke('window:getType');
    },
  },

  // ============ Task   ============
  taskWindow: {
    toggle: (): Promise<{ success: boolean; visible?: boolean }> => {
      return ipcRenderer.invoke('task-window:toggle');
    },

    show: (): Promise<{ success: boolean }> => {
      return ipcRenderer.invoke('task-window:show');
    },

    hide: (): Promise<{ success: boolean }> => {
      return ipcRenderer.invoke('task-window:hide');
    },

    isVisible: (): Promise<boolean> => {
      return ipcRenderer.invoke('task-window:isVisible');
    },

    setAlwaysOnTop: (value: boolean): Promise<{ success: boolean; alwaysOnTop?: boolean }> => {
      return ipcRenderer.invoke('task-window:setAlwaysOnTop', value);
    },

    isAlwaysOnTop: (): Promise<boolean> => {
      return ipcRenderer.invoke('task-window:isAlwaysOnTop');
    },

    setActiveSession: (sessionId: string): Promise<{ success: boolean }> => {
      return ipcRenderer.invoke('taskWindow:setActiveSession', sessionId);
    },

    onActiveSessionChanged: (callback: (sessionId: string, todos: unknown[]) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, sessionId: string, todos: unknown[]) => callback(sessionId, todos);
      ipcRenderer.on('taskWindow:activeSessionChanged', handler);
      return () => ipcRenderer.removeListener('taskWindow:activeSessionChanged', handler);
    },
  },

  // ============  ============
  theme: {
    getSystem: (): Promise<Theme> => {
      return ipcRenderer.invoke('theme:getSystem');
    },

    onChange: (callback: (theme: Theme) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, theme: Theme) => callback(theme);
      ipcRenderer.on('theme:change', handler);
      return () => ipcRenderer.removeListener('theme:change', handler);
    },

    onAppearanceChange: (callback: (data: { key: string; value: unknown }) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, data: { key: string; value: unknown }) => callback(data);
      ipcRenderer.on('appearance:change', handler);
      return () => ipcRenderer.removeListener('appearance:change', handler);
    },
  },

  // ============ Config () ============
  config: {
    getAll: (): Promise<AppConfig> => {
      return ipcRenderer.invoke('config:getAll');
    },

    get: <K extends keyof AppConfig>(key: K): Promise<AppConfig[K]> => {
      return ipcRenderer.invoke('config:get', key);
    },

    set: <K extends keyof AppConfig>(key: K, value: AppConfig[K]): Promise<boolean> => {
      return ipcRenderer.invoke('config:set', key, value);
    },

    update: (updates: Partial<AppConfig>): Promise<boolean> => {
      return ipcRenderer.invoke('config:update', updates);
    },

    addRecentDirectory: (directory: string): Promise<{ success: boolean }> => {
      return ipcRenderer.invoke('config:addRecentDirectory', directory);
    },

    setTheme: (theme: 'light' | 'dark' | 'system'): Promise<boolean> => {
      return ipcRenderer.invoke('config:setTheme', theme);
    },

    getTheme: (): Promise<'light' | 'dark' | 'system'> => {
      return ipcRenderer.invoke('config:getTheme');
    },

    getPath: (): Promise<{ configPath: string; configDir: string }> => {
      return ipcRenderer.invoke('config:getPath');
    },
  },

  // ============ Session () ============
  session: {
    create: (name?: string, workingDirectory?: string): Promise<{ success: boolean; session?: Session; error?: string }> => {
      return ipcRenderer.invoke('session:create', name, workingDirectory);
    },

    load: (sessionId: string): Promise<{ success: boolean; session?: Session; error?: string }> => {
      return ipcRenderer.invoke('session:load', sessionId);
    },

    save: (session: Session): Promise<{ success: boolean; error?: string }> => {
      return ipcRenderer.invoke('session:save', session);
    },

    saveCurrent: (): Promise<{ success: boolean; error?: string }> => {
      return ipcRenderer.invoke('session:saveCurrent');
    },

    delete: (sessionId: string): Promise<{ success: boolean; error?: string }> => {
      return ipcRenderer.invoke('session:delete', sessionId);
    },

    list: (): Promise<{ success: boolean; sessions?: SessionSummary[]; error?: string }> => {
      return ipcRenderer.invoke('session:list');
    },

    getCurrent: (): Promise<Session | null> => {
      return ipcRenderer.invoke('session:getCurrent');
    },

    setCurrent: (session: Session | null): Promise<{ success: boolean }> => {
      return ipcRenderer.invoke('session:setCurrent', session);
    },

    addMessage: (message: ChatMessage): Promise<{ success: boolean; error?: string }> => {
      return ipcRenderer.invoke('session:addMessage', message);
    },

    rename: (sessionId: string, newName: string): Promise<{ success: boolean; error?: string }> => {
      return ipcRenderer.invoke('session:rename', sessionId, newName);
    },

    duplicate: (sessionId: string): Promise<{ success: boolean; session?: Session; error?: string }> => {
      return ipcRenderer.invoke('session:duplicate', sessionId);
    },

    export: (sessionId: string): Promise<{ success: boolean; data?: string; error?: string }> => {
      return ipcRenderer.invoke('session:export', sessionId);
    },

    import: (jsonData: string): Promise<{ success: boolean; session?: Session; error?: string }> => {
      return ipcRenderer.invoke('session:import', jsonData);
    },

    search: (query: string): Promise<{ success: boolean; sessions?: SessionSummary[]; error?: string }> => {
      return ipcRenderer.invoke('session:search', query);
    },

    getPath: (): Promise<{ sessionsDir: string }> => {
      return ipcRenderer.invoke('session:getPath');
    },

    saveUIState: (state: { tabs: string[]; activeTabId: string | null }): Promise<{ success: boolean }> => {
      return ipcRenderer.invoke('session:saveUIState', state);
    },

    loadUIState: (): Promise<{ tabs: string[]; activeTabId: string | null } | null> => {
      return ipcRenderer.invoke('session:loadUIState');
    },
  },

  // ============ LLM ============
  llm: {
    getEndpoints: (): Promise<{ success: boolean; endpoints?: EndpointConfig[]; currentEndpointId?: string; currentModelId?: string; error?: string }> => {
      return ipcRenderer.invoke('llm:getEndpoints');
    },

    addEndpoint: (endpointData: Omit<EndpointConfig, 'id' | 'createdAt' | 'updatedAt'>): Promise<{ success: boolean; endpoint?: EndpointConfig; error?: string }> => {
      return ipcRenderer.invoke('llm:addEndpoint', endpointData);
    },

    updateEndpoint: (endpointId: string, updates: Partial<EndpointConfig>): Promise<{ success: boolean; error?: string }> => {
      return ipcRenderer.invoke('llm:updateEndpoint', endpointId, updates);
    },

    removeEndpoint: (endpointId: string): Promise<{ success: boolean; error?: string }> => {
      return ipcRenderer.invoke('llm:removeEndpoint', endpointId);
    },

    setCurrentEndpoint: (endpointId: string): Promise<{ success: boolean; error?: string }> => {
      return ipcRenderer.invoke('llm:setCurrentEndpoint', endpointId);
    },

    setCurrentModel: (modelId: string): Promise<{ success: boolean; error?: string }> => {
      return ipcRenderer.invoke('llm:setCurrentModel', modelId);
    },

    testConnection: (baseUrl: string, apiKey: string | undefined, modelId: string): Promise<{ success: boolean; error?: string; latency?: number }> => {
      return ipcRenderer.invoke('llm:testConnection', baseUrl, apiKey, modelId);
    },

    healthCheckAll: (): Promise<{ success: boolean; error?: string }> => {
      return ipcRenderer.invoke('llm:healthCheckAll');
    },

    getStatus: (): Promise<{ success: boolean; status?: LLMStatus; error?: string }> => {
      return ipcRenderer.invoke('llm:getStatus');
    },
  },

  // ============ Chat (LLM ) ============
  chat: {
    //     (non-streaming)
    send: (messages: Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string }>): Promise<{
      success: boolean;
      content?: string;
      message?: { role: string; content: string };
      error?: string;
    }> => {
      return ipcRenderer.invoke('chat:send', messages);
    },

    //     (streaming)
    sendStream: (messages: Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string }>): Promise<{
      success: boolean;
      content?: string;
      message?: { role: string; content: string };
      error?: string;
    }> => {
      return ipcRenderer.invoke('chat:sendStream', messages);
    },

    //   
    sendMessage: (userMessage: string, systemPrompt?: string, stream?: boolean): Promise<{
      success: boolean;
      content?: string;
      error?: string;
    }> => {
      return ipcRenderer.invoke('chat:sendMessage', userMessage, systemPrompt, stream);
    },

    //  
    abort: (): Promise<{ success: boolean; error?: string }> => {
      return ipcRenderer.invoke('chat:abort');
    },

    //    
    isActive: (): Promise<boolean> => {
      return ipcRenderer.invoke('chat:isActive');
    },

    //    
    onChunk: (callback: (data: { chunk: string; done: boolean; error?: boolean }) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, data: { chunk: string; done: boolean; error?: boolean }) => callback(data);
      ipcRenderer.on('chat:chunk', handler);
      return () => ipcRenderer.removeListener('chat:chunk', handler);
    },
  },

  // ============ Compact ( ) ============
  compact: {
    //   
    execute: (
      messages: Array<{
        role: 'system' | 'user' | 'assistant' | 'tool';
        content: string;
        tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
        tool_call_id?: string;
      }>,
      context: { workingDirectory?: string; currentModel?: string },
      sessionId?: string
    ): Promise<{
      success: boolean;
      originalMessageCount: number;
      newMessageCount: number;
      compactedSummary?: string;
      compactedMessages?: Array<{ role: string; content: string }>;
      error?: string;
    }> => {
      // If sessionId provided, route to worker (new signature: sessionId, messages, context)
      if (sessionId) {
        return ipcRenderer.invoke('compact:execute', sessionId, messages, context);
      }
      return ipcRenderer.invoke('compact:execute', messages, context);
    },

    //    
    canCompact: (messages: Array<{
      role: string;
      content: string;
      tool_calls?: unknown[];
      tool_call_id?: string;
    }>): Promise<{
      canCompact: boolean;
      reason?: string;
    }> => {
      return ipcRenderer.invoke('compact:canCompact', messages);
    },
  },

  // ============ Usage Tracking ( ) ============
  usage: {
    //   
    getSummary: (): Promise<{
      success: boolean;
      summary?: {
        today: { totalTokens: number; requestCount: number } | null;
        thisMonth: { totalTokens: number; totalRequests: number; days: number };
        allTime: {
          totalInputTokens: number;
          totalOutputTokens: number;
          totalTokens: number;
          totalRequests: number;
          firstUsed: string | null;
        };
        currentSession: {
          inputTokens: number;
          outputTokens: number;
          totalTokens: number;
          requestCount: number;
        };
      };
      error?: string;
    }> => {
      return ipcRenderer.invoke('usage:getSummary');
    },

    //   
    getDailyStats: (days?: number): Promise<{
      success: boolean;
      stats?: Array<{
        date: string;
        totalInputTokens: number;
        totalOutputTokens: number;
        totalTokens: number;
        requestCount: number;
      }>;
      error?: string;
    }> => {
      return ipcRenderer.invoke('usage:getDailyStats', days);
    },

    //   
    resetSession: (): Promise<{ success: boolean; error?: string }> => {
      return ipcRenderer.invoke('usage:resetSession');
    },

    //    
    clearData: (): Promise<{ success: boolean; error?: string }> => {
      return ipcRenderer.invoke('usage:clearData');
    },
  },

  // ============ Tools ( ) ============
  tools: {
    //    
    getGroups: (): Promise<{
      success: boolean;
      groups?: Array<{
        id: string;
        name: string;
        description: string;
        toolCount: number;
        enabled: boolean;
        available: boolean;
        requiresWindows?: boolean;
      }>;
      error?: string;
    }> => {
      return ipcRenderer.invoke('tools:getGroups');
    },

    //     
    getAvailable: (): Promise<{
      success: boolean;
      groups?: Array<{
        id: string;
        name: string;
        description: string;
        toolCount: number;
        enabled: boolean;
        available: boolean;
        requiresWindows?: boolean;
      }>;
      error?: string;
    }> => {
      return ipcRenderer.invoke('tools:getAvailable');
    },

    //    
    getEnabled: (): Promise<{
      success: boolean;
      groups?: Array<{
        id: string;
        name: string;
        description: string;
        toolCount: number;
        enabled: boolean;
        available: boolean;
        requiresWindows?: boolean;
      }>;
      error?: string;
    }> => {
      return ipcRenderer.invoke('tools:getEnabled');
    },

    //   
    enable: (groupId: string): Promise<{ success: boolean; error?: string }> => {
      return ipcRenderer.invoke('tools:enable', groupId);
    },

    //   
    disable: (groupId: string): Promise<{ success: boolean; error?: string }> => {
      return ipcRenderer.invoke('tools:disable', groupId);
    },

    //   
    toggle: (groupId: string): Promise<{ success: boolean; enabled?: boolean; error?: string }> => {
      return ipcRenderer.invoke('tools:toggle', groupId);
    },

    //   
    getSummary: (): Promise<{
      success: boolean;
      total?: number;
      available?: number;
      enabled?: number;
      groups?: Array<{
        id: string;
        name: string;
        description: string;
        toolCount: number;
        enabled: boolean;
        available: boolean;
        requiresWindows?: boolean;
      }>;
      error?: string;
    }> => {
      return ipcRenderer.invoke('tools:getSummary');
    },

    //     
    isEnabled: (groupId: string): Promise<boolean> => {
      return ipcRenderer.invoke('tools:isEnabled', groupId);
    },
  },

  // ============ Agent (agent) ============
  agent: {
    // agent  (sessionId optional - for multi-session worker routing)
    run: (
      userMessage: string,
      existingMessages?: Array<{ role: string; content: string }>,
      config?: AgentConfig,
      sessionId?: string
    ): Promise<AgentResult> => {
      return ipcRenderer.invoke('agent:run', userMessage, existingMessages, config, sessionId);
    },

    // agent  — TODO  (sessionId optional)
    pause: (sessionId?: string): Promise<{ success: boolean }> => {
      return ipcRenderer.invoke('agent:pause', sessionId);
    },

    // agent  — TODO   (sessionId optional)
    abort: (sessionId?: string): Promise<{ success: boolean }> => {
      return ipcRenderer.invoke('agent:abort', sessionId);
    },

    // agent    (per-session)
    isRunning: (sessionId?: string): Promise<boolean> => {
      return ipcRenderer.invoke('agent:isRunning', sessionId);
    },

    //  TODO   (per-session)
    getTodos: (sessionId?: string): Promise<TodoItem[]> => {
      return ipcRenderer.invoke('agent:getTodos', sessionId);
    },

    // TODO  
    setTodos: (todos: TodoItem[]): Promise<{ success: boolean }> => {
      return ipcRenderer.invoke('agent:setTodos', todos);
    },

    // agent   (Clear Chat , sessionId optional)
    clearState: (sessionId?: string): Promise<{ success: boolean }> => {
      return ipcRenderer.invoke('agent:clearState', sessionId);
    },

    //   ( )
    simpleChat: (
      userMessage: string,
      existingMessages?: Array<{ role: string; content: string }>,
      systemPrompt?: string
    ): Promise<{ response: string; messages: Array<{ role: string; content: string }> }> => {
      return ipcRenderer.invoke('agent:simpleChat', userMessage, existingMessages, systemPrompt);
    },

    //    (sessionId optional)
    respondToQuestion: (response: AskUserResponse, sessionId?: string): Promise<{ success: boolean }> => {
      return ipcRenderer.invoke('agent:respondToQuestion', response, sessionId);
    },

    //  
    onMessage: (callback: (message: { role: string; content: string; tool_calls?: unknown[] }) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, message: { role: string; content: string; tool_calls?: unknown[] }) => callback(message);
      ipcRenderer.on('agent:message', handler);
      return () => ipcRenderer.removeListener('agent:message', handler);
    },

    onToolCall: (callback: (data: { toolName: string; args: Record<string, unknown> }) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, data: { toolName: string; args: Record<string, unknown> }) => callback(data);
      ipcRenderer.on('agent:toolCall', handler);
      return () => ipcRenderer.removeListener('agent:toolCall', handler);
    },

    onToolResult: (callback: (data: { toolName: string; result: string; success: boolean }) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, data: { toolName: string; result: string; success: boolean }) => callback(data);
      ipcRenderer.on('agent:toolResult', handler);
      return () => ipcRenderer.removeListener('agent:toolResult', handler);
    },

    onSubAgentPhase: (callback: (data: { appName: string; phase: string; detail: string }) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, data: { appName: string; phase: string; detail: string }) => callback(data);
      ipcRenderer.on('agent:subAgentPhase', handler);
      return () => ipcRenderer.removeListener('agent:subAgentPhase', handler);
    },

    onTodoUpdate: (callback: (todos: TodoItem[], sessionId?: string) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, todos: TodoItem[], sessionId?: string) => callback(todos, sessionId);
      ipcRenderer.on('agent:todoUpdate', handler);
      return () => ipcRenderer.removeListener('agent:todoUpdate', handler);
    },

    onSessionTitle: (callback: (title: string, sessionId?: string) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, title: string, sessionId?: string) => callback(title, sessionId);
      ipcRenderer.on('agent:sessionTitle', handler);
      return () => ipcRenderer.removeListener('agent:sessionTitle', handler);
    },

    onTellUser: (callback: (message: string, sessionId?: string) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, message: string, sessionId?: string) => callback(message, sessionId);
      ipcRenderer.on('agent:tellUser', handler);
      return () => ipcRenderer.removeListener('agent:tellUser', handler);
    },

    onAskUser: (callback: (request: AskUserRequest) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, request: AskUserRequest) => callback(request);
      ipcRenderer.on('agent:askUser', handler);
      return () => ipcRenderer.removeListener('agent:askUser', handler);
    },

    onAskUserResolved: (callback: (data?: { sessionId?: string }) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, data?: { sessionId?: string }) => callback(data);
      ipcRenderer.on('agent:askUserResolved', handler);
      return () => ipcRenderer.removeListener('agent:askUserResolved', handler);
    },

    onApprovalResolved: (callback: (data?: { sessionId?: string }) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, data?: { sessionId?: string }) => callback(data);
      ipcRenderer.on('agent:approvalResolved', handler);
      return () => ipcRenderer.removeListener('agent:approvalResolved', handler);
    },

    onContextUpdate: (callback: (data: { usagePercentage: number; currentTokens: number; maxTokens: number }) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, data: { usagePercentage: number; currentTokens: number; maxTokens: number }) => callback(data);
      ipcRenderer.on('agent:contextUpdate', handler);
      return () => ipcRenderer.removeListener('agent:contextUpdate', handler);
    },

    onReasoning: (callback: (data: { content: string; isStreaming: boolean }) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, data: { content: string; isStreaming: boolean }) => callback(data);
      ipcRenderer.on('agent:reasoning', handler);
      return () => ipcRenderer.removeListener('agent:reasoning', handler);
    },

    onComplete: (callback: (data: { response: string }) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, data: { response: string }) => callback(data);
      ipcRenderer.on('agent:complete', handler);
      return () => ipcRenderer.removeListener('agent:complete', handler);
    },

    onError: (callback: (data: { error: string }) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, data: { error: string }) => callback(data);
      ipcRenderer.on('agent:error', handler);
      return () => ipcRenderer.removeListener('agent:error', handler);
    },

    onRetryableError: (callback: (data: { error: string }) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, data: { error: string }) => callback(data);
      ipcRenderer.on('agent:retryableError', handler);
      return () => ipcRenderer.removeListener('agent:retryableError', handler);
    },

    onCountdown: (callback: (data: { seconds: number }) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, data: { seconds: number }) => callback(data);
      ipcRenderer.on('agent:countdown', handler);
      return () => ipcRenderer.removeListener('agent:countdown', handler);
    },

    // Tool approval request event (Supervised Mode)
    onApprovalRequest: (callback: (request: {
      id: string;
      toolName: string;
      args: Record<string, unknown>;
      reason?: string;
    }) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, request: {
        id: string;
        toolName: string;
        args: Record<string, unknown>;
        reason?: string;
      }) => callback(request);
      ipcRenderer.on('agent:approvalRequest', handler);
      return () => ipcRenderer.removeListener('agent:approvalRequest', handler);
    },

    // Respond to tool approval request (sessionId for worker routing)
    respondToApproval: (response: {
      id: string;
      result: 'approve' | 'always' | { reject: true; comment: string };
      sessionId?: string;
    }): Promise<{ success: boolean }> => {
      return ipcRenderer.invoke('agent:respondToApproval', response);
    },

    // File edit event (for diff view)
    onFileEdit: (callback: (data: {
      path: string;
      originalContent: string;
      newContent: string;
      language: string;
    }) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, data: {
        path: string;
        originalContent: string;
        newContent: string;
        language: string;
      }) => callback(data);
      ipcRenderer.on('agent:fileEdit', handler);
      return () => ipcRenderer.removeListener('agent:fileEdit', handler);
    },

    // File create event
    onFileCreate: (callback: (data: {
      path: string;
      content: string;
      language: string;
    }) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, data: {
        path: string;
        content: string;
        language: string;
      }) => callback(data);
      ipcRenderer.on('agent:fileCreate', handler);
      return () => ipcRenderer.removeListener('agent:fileCreate', handler);
    },
  },

  // ============ Worker ( ) ============
  worker: {
    create: (sessionId: string): Promise<{ success: boolean; error?: string }> => {
      return ipcRenderer.invoke('worker:create', sessionId);
    },
    terminate: (sessionId: string): Promise<{ success: boolean; error?: string }> => {
      return ipcRenderer.invoke('worker:terminate', sessionId);
    },
    exists: (sessionId: string): Promise<boolean> => {
      return ipcRenderer.invoke('worker:exists', sessionId);
    },
    count: (): Promise<number> => {
      return ipcRenderer.invoke('worker:count');
    },
  },

  // ============  ============
  dialog: {
    openFile: (options?: {
      title?: string;
      defaultPath?: string;
      filters?: FileFilter[];
      multiSelections?: boolean;
    }): Promise<DialogResult> => {
      return ipcRenderer.invoke('dialog:openFile', options);
    },

    saveFile: (options?: {
      title?: string;
      defaultPath?: string;
      filters?: FileFilter[];
    }): Promise<DialogResult> => {
      return ipcRenderer.invoke('dialog:saveFile', options);
    },

    openFolder: (options?: {
      title?: string;
      defaultPath?: string;
      multiSelections?: boolean;
    }): Promise<DialogResult> => {
      return ipcRenderer.invoke('dialog:openFolder', options);
    },

    showMessage: (options: MessageDialogOptions): Promise<{ success: boolean; response?: number; error?: string }> => {
      return ipcRenderer.invoke('dialog:showMessage', options);
    },
  },

  // ============   ============
  fs: {
    readFile: (filePath: string): Promise<{ success: boolean; content?: string; error?: string }> => {
      return ipcRenderer.invoke('fs:readFile', filePath);
    },

    writeFile: (filePath: string, content: string): Promise<{ success: boolean; error?: string }> => {
      return ipcRenderer.invoke('fs:writeFile', filePath, content);
    },

    exists: (filePath: string): Promise<boolean> => {
      return ipcRenderer.invoke('fs:exists', filePath);
    },

    readDir: (dirPath: string): Promise<{ success: boolean; files?: string[]; error?: string }> => {
      return ipcRenderer.invoke('fs:readDir', dirPath);
    },
  },

  // ============ Shell ============
  shell: {
    showItemInFolder: (filePath: string): Promise<{ success: boolean }> => {
      return ipcRenderer.invoke('shell:showItemInFolder', filePath);
    },

    openPath: (filePath: string): Promise<{ success: boolean; error?: string }> => {
      return ipcRenderer.invoke('shell:openPath', filePath);
    },

    openExternal: (url: string): Promise<{ success: boolean }> => {
      return ipcRenderer.invoke('shell:openExternal', url);
    },
  },

  // ============ Image Attachment ============
  image: {
    saveFromClipboard: (base64Data: string, mimeType: string): Promise<{
      success: boolean; filePath?: string; size?: number; error?: string;
    }> => {
      return ipcRenderer.invoke('image:saveFromClipboard', base64Data, mimeType);
    },
    selectFile: (): Promise<{
      success: boolean; filePath?: string; canceled?: boolean;
    }> => {
      return ipcRenderer.invoke('image:selectFile');
    },
  },

  // ============ VSCode Integration ============
  vscode: {
    isAvailable: (): Promise<{ available: boolean; autoDetected: boolean }> => {
      return ipcRenderer.invoke('vscode:isAvailable');
    },

    openFile: (filePath: string): Promise<{ success: boolean; error?: string; fallback?: boolean }> => {
      return ipcRenderer.invoke('vscode:openFile', filePath);
    },

    openDiff: (originalPath: string, modifiedPath: string, title?: string): Promise<{ success: boolean; error?: string; fallback?: boolean }> => {
      return ipcRenderer.invoke('vscode:openDiff', originalPath, modifiedPath, title);
    },

    openDiffWithContent: (data: {
      filePath: string;
      originalContent: string;
      newContent: string;
    }): Promise<{ success: boolean; error?: string; fallback?: boolean }> => {
      return ipcRenderer.invoke('vscode:openDiffWithContent', data);
    },

    setPath: (vscodePath: string | null): Promise<{ success: boolean; error?: string }> => {
      return ipcRenderer.invoke('vscode:setPath', vscodePath);
    },

    getPath: (): Promise<{ path: string | null }> => {
      return ipcRenderer.invoke('vscode:getPath');
    },
  },

  // ============ PowerShell ============
  powershell: {
    startSession: (): Promise<{ success: boolean; session?: SessionInfo; error?: string }> => {
      return ipcRenderer.invoke('powershell:startSession');
    },

    execute: (command: string): Promise<PowerShellResult> => {
      return ipcRenderer.invoke('powershell:execute', command);
    },

    executeOnce: (command: string, cwd?: string): Promise<PowerShellResult> => {
      return ipcRenderer.invoke('powershell:executeOnce', command, cwd);
    },

    sendInput: (input: string): Promise<{ success: boolean }> => {
      return ipcRenderer.invoke('powershell:sendInput', input);
    },

    interrupt: (): Promise<{ success: boolean }> => {
      return ipcRenderer.invoke('powershell:interrupt');
    },

    terminate: (): Promise<{ success: boolean }> => {
      return ipcRenderer.invoke('powershell:terminate');
    },

    restart: (): Promise<{ success: boolean; session?: SessionInfo; error?: string }> => {
      return ipcRenderer.invoke('powershell:restart');
    },

    getSessionInfo: (): Promise<SessionInfo> => {
      return ipcRenderer.invoke('powershell:getSessionInfo');
    },

    isRunning: (): Promise<boolean> => {
      return ipcRenderer.invoke('powershell:isRunning');
    },

    changeDirectory: (newPath: string): Promise<{ success: boolean }> => {
      return ipcRenderer.invoke('powershell:changeDirectory', newPath);
    },

    getCurrentDirectory: (): Promise<{ success: boolean; directory?: string }> => {
      return ipcRenderer.invoke('powershell:getCurrentDirectory');
    },

    onOutput: (callback: (output: PowerShellOutput) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, output: PowerShellOutput) => callback(output);
      ipcRenderer.on('powershell:output', handler);
      return () => ipcRenderer.removeListener('powershell:output', handler);
    },

    onExit: (callback: (event: PowerShellExitEvent) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, exitEvent: PowerShellExitEvent) => callback(exitEvent);
      ipcRenderer.on('powershell:exit', handler);
      return () => ipcRenderer.removeListener('powershell:exit', handler);
    },

    onError: (callback: (event: PowerShellErrorEvent) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, errorEvent: PowerShellErrorEvent) => callback(errorEvent);
      ipcRenderer.on('powershell:error', handler);
      return () => ipcRenderer.removeListener('powershell:error', handler);
    },
  },

  // ============  ============
  log: {
    // Renderer   (Log Viewer )
    info: (message: string, data?: unknown): void => {
      ipcRenderer.send('log:write', 'info', message, data);
    },

    warn: (message: string, data?: unknown): void => {
      ipcRenderer.send('log:write', 'warn', message, data);
    },

    error: (message: string, data?: unknown): void => {
      ipcRenderer.send('log:write', 'error', message, data);
    },

    debug: (message: string, data?: unknown): void => {
      ipcRenderer.send('log:write', 'debug', message, data);
    },

    getFiles: (): Promise<LogFile[]> => {
      return ipcRenderer.invoke('log:getFiles');
    },

    readFile: (filePath: string): Promise<{ success: boolean; content?: string; error?: string }> => {
      return ipcRenderer.invoke('log:readFile', filePath);
    },

    readEntries: (filePath: string): Promise<{ success: boolean; entries?: LogEntry[]; error?: string }> => {
      return ipcRenderer.invoke('log:readEntries', filePath);
    },

    openInExplorer: (filePath?: string): Promise<{ success: boolean }> => {
      return ipcRenderer.invoke('log:openInExplorer', filePath);
    },

    openDirectory: (): Promise<{ success: boolean }> => {
      return ipcRenderer.invoke('log:openDirectory');
    },

    setLevel: (level: number): Promise<{ success: boolean }> => {
      return ipcRenderer.invoke('log:setLevel', level);
    },

    getLevel: (): Promise<number> => {
      return ipcRenderer.invoke('log:getLevel');
    },

    getCurrentPath: (): Promise<string> => {
      return ipcRenderer.invoke('log:getCurrentPath');
    },

    getDirectory: (): Promise<string> => {
      return ipcRenderer.invoke('log:getDirectory');
    },

    deleteFile: (filePath: string): Promise<{ success: boolean; error?: string }> => {
      return ipcRenderer.invoke('log:deleteFile', filePath);
    },

    clearAll: (): Promise<{ success: boolean; deletedCount?: number; error?: string }> => {
      return ipcRenderer.invoke('log:clearAll');
    },

    onEntry: (callback: (entry: LogEntry) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, entry: LogEntry) => callback(entry);
      ipcRenderer.on('log:entry', handler);
      return () => ipcRenderer.removeListener('log:entry', handler);
    },

    startStreaming: (): Promise<{ success: boolean }> => {
      return ipcRenderer.invoke('log:startStreaming');
    },

    stopStreaming: (): Promise<{ success: boolean }> => {
      return ipcRenderer.invoke('log:stopStreaming');
    },

    // Session log methods
    setSession: (sessionId: string | null): Promise<{ success: boolean }> => {
      return ipcRenderer.invoke('log:setSession', sessionId);
    },

    getSessionFiles: (): Promise<{ success: boolean; files: Array<{ sessionId: string; path: string; size: number; modifiedAt: number }> }> => {
      return ipcRenderer.invoke('log:getSessionFiles');
    },

    readSessionLog: (sessionId: string): Promise<{ success: boolean; entries: Array<{ timestamp: string; level: string; message: string; data?: unknown }> }> => {
      return ipcRenderer.invoke('log:readSessionLog', sessionId);
    },

    deleteSessionLog: (sessionId: string): Promise<{ success: boolean; error?: string }> => {
      return ipcRenderer.invoke('log:deleteSessionLog', sessionId);
    },

    getCurrentSessionId: (): Promise<{ success: boolean; sessionId: string | null }> => {
      return ipcRenderer.invoke('log:getCurrentSessionId');
    },

    // Current Run log methods (  )
    getRunFiles: (): Promise<{ success: boolean; files: Array<{ runId: string; path: string; size: number; modifiedAt: number }> }> => {
      return ipcRenderer.invoke('log:getRunFiles');
    },

    getCurrentRunId: (): Promise<{ success: boolean; runId: string }> => {
      return ipcRenderer.invoke('log:getCurrentRunId');
    },

    readCurrentRunLog: (): Promise<{ success: boolean; entries: Array<{ timestamp: string; level: string; message: string; data?: unknown }> }> => {
      return ipcRenderer.invoke('log:readCurrentRunLog');
    },

    readRunLog: (runId: string): Promise<{ success: boolean; entries: Array<{ timestamp: string; level: string; message: string; data?: unknown }> }> => {
      return ipcRenderer.invoke('log:readRunLog', runId);
    },

    deleteRunLog: (runId: string): Promise<{ success: boolean; error?: string }> => {
      return ipcRenderer.invoke('log:deleteRunLog', runId);
    },
  },

  // ============  ============
  system: {
    info: (): Promise<SystemInfo> => {
      return ipcRenderer.invoke('system:info');
    },
  },

  // ============   ============
  app: {
    restart: (): Promise<void> => {
      return ipcRenderer.invoke('app:restart');
    },

    quit: (): Promise<void> => {
      return ipcRenderer.invoke('app:quit');
    },
  },

  // ============   ============
  update: {
    //   
    getVersion: (): Promise<string> => {
      return ipcRenderer.invoke('update:getVersion');
    },

    //  
    startDownload: (): Promise<{ success: boolean }> => {
      return ipcRenderer.invoke('update:startDownload');
    },

    //  ()
    install: (): Promise<void> => {
      return ipcRenderer.invoke('update:install');
    },

    //   
    onAvailable: (callback: (info: { version: string; releaseNotes?: string | { note?: string | null }[]; releaseDate?: string }) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, info: { version: string; releaseNotes?: string | { note?: string | null }[]; releaseDate?: string }) => callback(info);
      ipcRenderer.on('update:available', handler);
      return () => ipcRenderer.removeListener('update:available', handler);
    },

    //   
    onNotAvailable: (callback: () => void): (() => void) => {
      const handler = () => callback();
      ipcRenderer.on('update:not-available', handler);
      return () => ipcRenderer.removeListener('update:not-available', handler);
    },

    //   
    onDownloadProgress: (callback: (progress: { percent: number; transferred: number; total: number; bytesPerSecond: number }) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, progress: { percent: number; transferred: number; total: number; bytesPerSecond: number }) => callback(progress);
      ipcRenderer.on('update:download-progress', handler);
      return () => ipcRenderer.removeListener('update:download-progress', handler);
    },

    //   
    onDownloaded: (callback: (info: { version: string; releaseNotes?: string | { note?: string | null }[] }) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, info: { version: string; releaseNotes?: string | { note?: string | null }[] }) => callback(info);
      ipcRenderer.on('update:downloaded', handler);
      return () => ipcRenderer.removeListener('update:downloaded', handler);
    },

    //  
    onError: (callback: (error: string) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, error: string) => callback(error);
      ipcRenderer.on('update:error', handler);
      return () => ipcRenderer.removeListener('update:error', handler);
    },
  },

  // ============   ============
  devTools: {
    toggle: (): Promise<{ success: boolean }> => {
      return ipcRenderer.invoke('devTools:toggle');
    },
  },

  // ============ Documentation ============
  docs: {
    // Get documentation info
    getInfo: (): Promise<{ success: boolean; info?: DocsInfo; error?: string }> => {
      return ipcRenderer.invoke('docs:getInfo');
    },

    // Download documentation source
    download: (
      sourceId: string,
      onProgress?: (progress: DownloadProgress) => void
    ): Promise<{
      success: boolean;
      message?: string;
      downloadedFiles?: number;
      targetPath?: string;
      error?: string;
    }> => {
      // Register progress listener
      const progressHandler = (_event: IpcRendererEvent, progress: DownloadProgress) => {
        onProgress?.(progress);
      };

      if (onProgress) {
        ipcRenderer.on('docs:downloadProgress', progressHandler);
      }

      return ipcRenderer.invoke('docs:download', sourceId).finally(() => {
        if (onProgress) {
          ipcRenderer.removeListener('docs:downloadProgress', progressHandler);
        }
      });
    },

    // Delete documentation source
    delete: (sourceId: string): Promise<{ success: boolean; error?: string }> => {
      return ipcRenderer.invoke('docs:delete', sourceId);
    },

    // Open docs folder in explorer
    openFolder: (): Promise<{ success: boolean; error?: string }> => {
      return ipcRenderer.invoke('docs:openFolder');
    },
  },

  // =========================================================================
  // Jarvis Mode
  // =========================================================================
  jarvis: {
    // Jarvis  
    showWindow: (): Promise<void> => {
      return ipcRenderer.invoke('jarvis:showWindow');
    },

    //   
    sendMessage: (message: string): Promise<void> => {
      return ipcRenderer.invoke('jarvis:sendMessage', message);
    },

    //   
    pollNow: (): Promise<void> => {
      return ipcRenderer.invoke('jarvis:pollNow');
    },

    //  /
    getConfig: (): Promise<{ enabled: boolean; pollIntervalMinutes: number; autoStartOnBoot: boolean; modelId?: string; endpointId?: string }> => {
      return ipcRenderer.invoke('jarvis:getConfig');
    },
    setConfig: (config: Partial<{ enabled: boolean; pollIntervalMinutes: number; autoStartOnBoot: boolean; modelId: string; endpointId: string }>): Promise<void> => {
      return ipcRenderer.invoke('jarvis:setConfig', config);
    },

    //  
    getState: (): Promise<{ status: string; isRunning: boolean; lastPollTime: string | null }> => {
      return ipcRenderer.invoke('jarvis:getState');
    },

    //    (   won)
    getChatHistory: (): Promise<unknown[]> => {
      return ipcRenderer.invoke('jarvis:getChatHistory');
    },

    //  
    respondToApproval: (requestId: string, approved: boolean): Promise<void> => {
      return ipcRenderer.invoke('jarvis:respondToApproval', requestId, approved);
    },

    //  
    respondToQuestion: (requestId: string, answer: string): Promise<void> => {
      return ipcRenderer.invoke('jarvis:respondToQuestion', requestId, answer);
    },

    //  
    onMessage: (callback: (message: unknown) => void): (() => void) => {
      const handler = (_event: unknown, message: unknown) => callback(message);
      ipcRenderer.on('jarvis:message', handler);
      return () => ipcRenderer.removeListener('jarvis:message', handler);
    },

    onStatusChange: (callback: (status: string) => void): (() => void) => {
      const handler = (_event: unknown, status: string) => callback(status);
      ipcRenderer.on('jarvis:statusChange', handler);
      return () => ipcRenderer.removeListener('jarvis:statusChange', handler);
    },
  },

  // App auto-start settings
  autoStart: {
    getChat(): Promise<boolean> {
      return ipcRenderer.invoke('app:getAutoStartChat');
    },
    setChat(enabled: boolean): Promise<void> {
      return ipcRenderer.invoke('app:setAutoStartChat', enabled);
    },
  },
};

// API  
export type ElectronAPI = typeof electronAPI;

// contextBridge   API 
contextBridge.exposeInMainWorld('electronAPI', electronAPI);

//    
if (process.env.NODE_ENV === 'development') {
  console.log('[Preload] Electron API exposed to renderer');
}
