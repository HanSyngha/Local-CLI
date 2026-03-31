/**
 * Hanseol Web Session Server
 *
 * WebSocket server that bridges the API server to the PlanExecutor engine.
 * Equivalent of src/cli.ts for the web Docker session container.
 *
 * Accepts commands from the API, runs PlanExecutor, and streams events back.
 */

import { WebSocketServer, WebSocket } from 'ws';
import { SESSION_WS_PORT } from './constants.js';
import { configManager } from './core/config/config-manager.js';
import { LLMClient } from './core/llm/llm-client.js';
import { PlanExecutor, setUserSystemPrompt } from './orchestration/plan-executor.js';
import { setPlanningUserSystemPrompt } from './agents/planner/index.js';
import { toolRegistry } from './tools/registry.js';
import type { Message, TodoItem, ToolDefinition } from './types/index.js';
import type { ExecutionPhase, AskUserRequest, AskUserResponse, StateCallbacks } from './orchestration/types.js';
import { clearTodoCallbacks } from './tools/llm/simple/todo-tools.js';
import { clearFinalResponseCallbacks } from './tools/llm/simple/final-response-tool.js';
import {
  setTellToUserCallback,
  setAskUserCallback,
  clearAskUserCallback,
} from './tools/llm/simple/user-interaction-tools.js';
import {
  setToolExecutionCallback,
  setToolResponseCallback,
  setPlanCreatedCallback,
  setTodoStartCallback,
  setTodoCompleteCallback,
  setTodoFailCallback,
  setCompactCallback,
  setAssistantResponseCallback,
  setReasoningCallback,
} from './tools/llm/simple/simple-tool-executor.js';
import type { LLMSimpleTool, ToolCategory, ToolResult } from './tools/types.js';
import { logger } from './utils/logger.js';

// ============================================
// Types
// ============================================

/** Inbound message from API server */
interface InboundMessage {
  id: string;
  type: 'execute' | 'interrupt' | 'get_state' | 'ask_user_response' | 'inject_tools' | 'update_config' | 'update_system_prompt' | 'ping';
  payload?: Record<string, unknown>;
}

/** Outbound event to API server */
interface OutboundEvent {
  type: string;
  requestId?: string;
  payload: Record<string, unknown>;
}

/** Injected tool definition from API */
interface InjectedToolDef {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  endpoint: {
    url: string;
    method: string;
    headers?: Record<string, string>;
  };
}

// ============================================
// Session State
// ============================================

let messages: Message[] = [];
let todos: TodoItem[] = [];
let currentTodoId: string | undefined;
let executionPhase: ExecutionPhase = 'idle';
let isInterrupted = false;
let currentActivity = '';
let userSystemPrompt = '';

/** Pending ask_user response — resolved by ask_user_response message */
let askUserResolve: ((response: AskUserResponse) => void) | null = null;

/** Currently active WebSocket client (single connection) */
let activeWs: WebSocket | null = null;

/** Current execution request ID for correlating events */
let currentRequestId: string | undefined;

// ============================================
// WebSocket Helpers
// ============================================

function send(event: OutboundEvent): void {
  if (activeWs && activeWs.readyState === WebSocket.OPEN) {
    activeWs.send(JSON.stringify(event));
  }
}

function emit(type: string, payload: Record<string, unknown> = {}): void {
  send({ type, requestId: currentRequestId, payload });
}

// ============================================
// State Snapshot
// ============================================

function getStateSnapshot(): Record<string, unknown> {
  return {
    messages,
    todos,
    currentTodoId,
    executionPhase,
    isInterrupted,
    currentActivity,
  };
}

// ============================================
// Callbacks Wiring
// ============================================

/**
 * Build StateCallbacks that emit WebSocket events
 */
function buildCallbacks(): StateCallbacks {
  return {
    setTodos: (todosOrFn) => {
      todos = typeof todosOrFn === 'function' ? todosOrFn(todos) : todosOrFn;
      emit('todo:update', { todos });
    },
    setCurrentTodoId: (idOrFn) => {
      currentTodoId = typeof idOrFn === 'function' ? idOrFn(currentTodoId) : idOrFn;
    },
    setExecutionPhase: (phase) => {
      executionPhase = phase;
      if (phase === 'planning') emit('planning:start', {});
      if (phase === 'executing') emit('execution:start', {});
    },
    setIsInterrupted: (v) => {
      isInterrupted = v;
    },
    setCurrentActivity: (activity) => {
      currentActivity = activity;
    },
    setMessages: (msgsOrFn) => {
      messages = typeof msgsOrFn === 'function' ? msgsOrFn(messages) : msgsOrFn;
    },
    setAskUserRequest: (_request) => {
      // ask_user is handled via the Promise-based askUser callback below
    },
    askUser: (request: AskUserRequest): Promise<AskUserResponse> => {
      return new Promise<AskUserResponse>((resolve) => {
        askUserResolve = resolve;
        emit('ask_user', { question: request.question, options: request.options });
      });
    },
    getPendingMessage: () => null,  // Web: no pending messages from terminal
    clearPendingMessage: () => {},
    setRetryPending: (_pending) => {
      // Web sessions auto-retry; no manual retry needed
    },
  };
}

/**
 * Wire all tool-level callbacks to emit WebSocket events
 */
function wireToolCallbacks(): void {
  // Tool execution (tool:call)
  setToolExecutionCallback((toolName, reason, args) => {
    emit('tool:call', { name: toolName, reason, args });
  });

  // Tool response (tool:result)
  setToolResponseCallback((toolName, success, result) => {
    emit('tool:result', { name: toolName, success, result });
  });

  // Planning events
  setPlanCreatedCallback((todoTitles) => {
    emit('planning:todo', { titles: todoTitles });
    emit('planning:complete', { count: todoTitles.length });
  });

  // Todo lifecycle
  setTodoStartCallback((title) => {
    emit('todo:update', { event: 'start', title });
  });
  setTodoCompleteCallback((title) => {
    emit('todo:update', { event: 'complete', title });
  });
  setTodoFailCallback((title) => {
    emit('todo:update', { event: 'fail', title });
  });

  // Compact events
  setCompactCallback((originalCount, newCount) => {
    emit('compact:start', { originalCount });
    emit('compact:complete', { originalCount, newCount });
  });

  // Assistant response
  setAssistantResponseCallback((content) => {
    emit('llm:token', { content, done: true });
  });

  // Reasoning (extended thinking)
  setReasoningCallback((content, isStreaming) => {
    emit('llm:reasoning', { content, isStreaming });
  });

  // tell_to_user
  setTellToUserCallback((message) => {
    emit('tell_user', { message });
  });

  // ask_to_user — handled via StateCallbacks.askUser (Promise-based)
  setAskUserCallback(async (request) => {
    return new Promise<AskUserResponse>((resolve) => {
      askUserResolve = resolve;
      emit('ask_user', { question: request.question, options: request.options });
    });
  });
}

/**
 * Clear all callbacks on shutdown
 */
function clearAllCallbacks(): void {
  clearTodoCallbacks();
  clearFinalResponseCallbacks();
  clearAskUserCallback();
  setTellToUserCallback(null);
  setToolExecutionCallback(null);
  setToolResponseCallback(null);
  setPlanCreatedCallback(null);
  setTodoStartCallback(null);
  setTodoCompleteCallback(null);
  setTodoFailCallback(null);
  setCompactCallback(null);
  setAssistantResponseCallback(null);
  setReasoningCallback(null);
}

// ============================================
// Custom Tool Injection
// ============================================

function injectTools(toolDefs: InjectedToolDef[]): void {
  for (const def of toolDefs) {
    const definition: ToolDefinition = {
      type: 'function',
      function: {
        name: def.name,
        description: def.description,
        parameters: def.parameters,
      },
    };

    const tool: LLMSimpleTool = {
      definition,
      categories: ['llm-simple'] as ToolCategory[],
      description: def.description,
      execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
        try {
          const isGet = def.endpoint.method.toUpperCase() === 'GET';
          // For GET: append args as query params. For POST/PUT/DELETE: send as body.
          let url = def.endpoint.url;
          if (isGet && Object.keys(args).length > 0) {
            const params = new URLSearchParams();
            for (const [k, v] of Object.entries(args)) {
              if (v !== undefined && v !== null) params.set(k, String(v));
            }
            url += (url.includes('?') ? '&' : '?') + params.toString();
          }
          const resp = await fetch(url, {
            method: def.endpoint.method,
            headers: {
              ...(isGet ? {} : { 'Content-Type': 'application/json' }),
              ...def.endpoint.headers,
            },
            ...(isGet ? {} : { body: JSON.stringify(args) }),
          });
          const text = await resp.text();
          return { success: resp.ok, result: text };
        } catch (err) {
          return { success: false, result: `Tool call failed: ${err instanceof Error ? err.message : String(err)}` };
        }
      },
    };

    toolRegistry.register(tool);
    logger.info(`Injected custom tool: ${def.name}`);
  }
}

// ============================================
// Command Handlers
// ============================================

const isInterruptedRef = { current: false };
let currentExecutionPromise: Promise<void> | null = null;

async function handleExecute(id: string, payload: Record<string, unknown>): Promise<void> {
  const userMessage = payload.message as string;
  if (!userMessage) {
    emit('error', { message: 'Missing "message" in execute payload' });
    return;
  }

  // Wait for any running execution to finish before starting a new one
  // This prevents event interleaving (tool:call from old execution appearing after new user message)
  if (currentExecutionPromise) {
    handleInterrupt();
    try {
      await Promise.race([
        currentExecutionPromise,
        new Promise(resolve => setTimeout(resolve, 5000)), // 5s timeout safety
      ]);
    } catch {
      // Previous execution failed — proceed with new one
    }
  }

  currentRequestId = id;
  isInterruptedRef.current = false;
  isInterrupted = false;

  // Emit user message so the frontend can display it in the chat timeline
  emit('user_message', { message: userMessage });

  // Build LLM client from current config
  const authToken = payload.authToken as string | undefined;
  let llmClient: LLMClient;
  try {
    llmClient = new LLMClient(authToken);
  } catch (err) {
    emit('error', { message: `LLM client init failed: ${err instanceof Error ? err.message : String(err)}` });
    return;
  }

  const executor = new PlanExecutor();
  const callbacks = buildCallbacks();

  const thisExecution = executor.executePlanMode(
    userMessage,
    llmClient,
    [...messages],
    isInterruptedRef,
    callbacks,
  );
  currentExecutionPromise = thisExecution;

  try {
    await thisExecution;
    // Only emit if we're still the current execution (a newer one may have taken over after timeout)
    if (currentExecutionPromise === thisExecution) {
      emit('execution:complete', { success: true });
    }
  } catch (err) {
    if (currentExecutionPromise === thisExecution) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (errMsg === 'INTERRUPTED') {
        emit('execution:complete', { success: false, interrupted: true });
      } else {
        emit('error', { message: errMsg });
        emit('execution:complete', { success: false, error: errMsg });
      }
    }
  } finally {
    // Only clear shared state if WE are still the current execution.
    // After 5s timeout, a newer execution may have taken over — don't clobber it.
    if (currentExecutionPromise === thisExecution) {
      currentExecutionPromise = null;
      currentRequestId = undefined;
      executionPhase = 'idle';
    }
  }
}

function handleInterrupt(): void {
  isInterruptedRef.current = true;
  isInterrupted = true;
  // Resolve pending ask_user to unblock execution (prevents deadlock when
  // user interrupts during ask_user and immediately sends a new message)
  if (askUserResolve) {
    askUserResolve({ selectedOption: '', isOther: false });
    askUserResolve = null;
  }
  logger.info('Interrupt requested');
}

function handleGetState(id: string): void {
  send({ type: 'session:state', requestId: id, payload: getStateSnapshot() });
}

function handleAskUserResponse(payload: Record<string, unknown>): void {
  if (!askUserResolve) {
    logger.warn('Received ask_user_response but no pending ask');
    return;
  }
  const response: AskUserResponse = {
    selectedOption: (payload.selectedOption as string) || '',
    isOther: (payload.isOther as boolean) || false,
    customText: payload.customText as string | undefined,
  };
  askUserResolve(response);
  askUserResolve = null;
}

async function handleUpdateConfig(payload: Record<string, unknown>): Promise<void> {
  const { endpointUrl, apiKey, modelId, modelName, maxTokens } = payload as {
    endpointUrl?: string;
    apiKey?: string;
    modelId?: string;
    modelName?: string;
    maxTokens?: number;
  };

  if (!endpointUrl || !modelId) {
    emit('error', { message: 'update_config requires endpointUrl and modelId' });
    return;
  }

  // Upsert endpoint in config
  const config = configManager.getConfig();
  const epId = 'web-endpoint';
  let endpoint = config.endpoints.find((ep) => ep.id === epId);
  if (!endpoint) {
    endpoint = {
      id: epId,
      name: 'Web Session Endpoint',
      baseUrl: endpointUrl,
      apiKey: apiKey || '',
      models: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    config.endpoints.push(endpoint);
  } else {
    endpoint.baseUrl = endpointUrl;
    if (apiKey !== undefined) endpoint.apiKey = apiKey;
    endpoint.updatedAt = new Date();
  }

  // Upsert model
  let model = endpoint.models.find((m) => m.id === modelId);
  if (!model) {
    model = {
      id: modelId,
      name: modelName || modelId,
      maxTokens: maxTokens || 128000,
      enabled: true,
    };
    endpoint.models.push(model);
  } else {
    if (modelName) model.name = modelName;
    if (maxTokens) model.maxTokens = maxTokens;
  }

  config.currentEndpoint = epId;
  config.currentModel = modelId;
  await configManager.saveConfig();
  logger.info('Config updated', { endpointUrl, modelId });
}

function handleUpdateSystemPrompt(payload: Record<string, unknown>): void {
  userSystemPrompt = (payload.prompt as string) || '';
  setUserSystemPrompt(userSystemPrompt);
  setPlanningUserSystemPrompt(userSystemPrompt);
  logger.info('System prompt updated', { length: userSystemPrompt.length });
}

// ============================================
// Message Router
// ============================================

async function handleMessage(raw: string): Promise<void> {
  let msg: InboundMessage;
  try {
    msg = JSON.parse(raw) as InboundMessage;
  } catch {
    emit('error', { message: 'Invalid JSON' });
    return;
  }

  const { id, type, payload } = msg;

  switch (type) {
    case 'execute':
      // Don't await — run in background so WS stays responsive
      handleExecute(id, payload || {}).catch((err) => {
        emit('error', { message: `Unhandled execute error: ${err instanceof Error ? err.message : String(err)}` });
      });
      break;
    case 'interrupt':
      handleInterrupt();
      break;
    case 'get_state':
      handleGetState(id);
      break;
    case 'ask_user_response':
      handleAskUserResponse(payload || {});
      break;
    case 'inject_tools':
      injectTools((payload?.tools as InjectedToolDef[]) || []);
      break;
    case 'update_config':
      await handleUpdateConfig(payload || {});
      break;
    case 'update_system_prompt':
      handleUpdateSystemPrompt(payload || {});
      break;
    case 'ping':
      // Heartbeat from browser/API — respond with pong
      send({ type: 'pong', payload: {} });
      break;
    default:
      logger.warn(`Unknown message type: ${type}`);
  }
}

// ============================================
// Server Initialization
// ============================================

async function main(): Promise<void> {
  // 1. Initialize config manager (creates directories + config file)
  try {
    await configManager.initialize();
  } catch (err) {
    console.error('[session-server] Config init failed, using defaults:', err);
    // Continue with empty config - update_config will set it later
  }

  // 2. Apply agent configuration from Docker env vars
  const agentSystemPrompt = process.env['AGENT_SYSTEM_PROMPT'] || '';
  if (agentSystemPrompt) {
    userSystemPrompt = agentSystemPrompt;
    setUserSystemPrompt(agentSystemPrompt);
    setPlanningUserSystemPrompt(agentSystemPrompt);
    logger.info('Agent system prompt applied from env', { length: agentSystemPrompt.length });
  }

  // 2b. Apply agent enabled tools from Docker env vars
  const agentEnabledTools = process.env['AGENT_ENABLED_TOOLS'] || '';
  if (agentEnabledTools) {
    const enabledList = agentEnabledTools.split(',').map(t => t.trim()).filter(Boolean);
    // Disable all optional tool groups first, then enable only the specified ones
    const allGroups = toolRegistry.getOptionalToolGroups();
    for (const group of allGroups) {
      if (enabledList.some(t => group.tools.some(gt => gt.definition.function.name === t))) {
        toolRegistry.enableToolGroup(group.id).catch(() => {});
      }
    }
    logger.info('Agent enabled tools applied from env', { tools: enabledList });
  }

  // 3. Wire all tool callbacks to emit WS events
  wireToolCallbacks();

  // 4. Start WebSocket server
  const wss = new WebSocketServer({ port: SESSION_WS_PORT });

  wss.on('connection', (ws) => {
    logger.info('API server connected');
    activeWs = ws;

    ws.on('message', (data) => {
      handleMessage(data.toString()).catch((err) => {
        logger.error('Message handler error', err);
      });
    });

    ws.on('close', () => {
      logger.info('API server disconnected');
      if (activeWs === ws) activeWs = null;
    });

    ws.on('error', (err) => {
      logger.error('WebSocket error', err);
    });
  });

  console.log(`[session-server] WebSocket listening on port ${SESSION_WS_PORT}`);

  // 5. Graceful shutdown
  const shutdown = () => {
    console.log('[session-server] Shutting down...');
    clearAllCallbacks();
    wss.close();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('[session-server] Fatal error:', err);
  process.exit(1);
});
