/**
 * CLI Server
 *
 * Electron  HTTP . CLI POST   → agent/Jarvis  → SSE .
 * VSCode `code`  : CLI   Electron   .
 */

import http from 'http';
import { BrowserWindow } from 'electron';
import { CLI_SERVER_PORT, APP_VERSION } from './constants';
import { cliBridge } from './cli-server-bridge';
import { workerManager } from './workers/worker-manager';
import { sessionManager } from './core/session';
import { runAgent, AgentCallbacks, AgentResult } from './orchestration';
import { setAgentMainWindow, setAgentTaskWindow } from './orchestration';
import { jarvisService } from './jarvis';
import { logger } from './utils/logger';
import type { Message } from './core/llm';

let server: http.Server | null = null;

//   (index.ts )
let chatWindow: BrowserWindow | null = null;
let taskWindow: BrowserWindow | null = null;
let jarvisWindow: BrowserWindow | null = null;

export function setCliServerWindows(
  chat: BrowserWindow | null,
  task: BrowserWindow | null,
  jarvis: BrowserWindow | null,
): void {
  chatWindow = chat;
  taskWindow = task;
  jarvisWindow = jarvis;
}

/**
 * CLI Server 
 */
export function startCliServer(): void {
  if (server) return;

  server = http.createServer((req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://127.0.0.1:${CLI_SERVER_PORT}`);

    if (req.method === 'GET' && url.pathname === '/api/health') {
      handleHealth(res);
    } else if (req.method === 'POST' && url.pathname === '/api/chat') {
      readBody(req).then(body => handleChat(res, body)).catch(err => sendError(res, 400, String(err)));
    } else if (req.method === 'POST' && url.pathname === '/api/jarvis') {
      readBody(req).then(body => handleJarvis(res, body)).catch(err => sendError(res, 400, String(err)));
    } else {
      sendError(res, 404, 'Not found');
    }
  });

  server.listen(CLI_SERVER_PORT, '127.0.0.1', () => {
    logger.info('[CliServer] Started', { port: CLI_SERVER_PORT });
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      logger.warn('[CliServer] Port already in use, skipping', { port: CLI_SERVER_PORT });
      server = null;
    } else {
      logger.errorSilent('[CliServer] Server error', { error: String(err) });
    }
  });
}

/**
 * CLI Server 
 */
export function stopCliServer(): void {
  if (server) {
    server.close();
    server = null;
    logger.info('[CliServer] Stopped');
  }
}

// =============================================================================
// Handlers
// =============================================================================

function handleHealth(res: http.ServerResponse): void {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    status: 'ok',
    version: APP_VERSION,
    pid: process.pid,
  }));
}

async function handleChat(res: http.ServerResponse, body: string): Promise<void> {
  let parsed: { prompt?: string; specific?: boolean };
  try {
    parsed = JSON.parse(body);
  } catch {
    sendError(res, 400, 'Invalid JSON');
    return;
  }

  const prompt = parsed.prompt;
  if (!prompt) {
    sendError(res, 400, 'prompt is required');
    return;
  }

  // SSE 
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  // Chat  show & focus
  if (chatWindow && !chatWindow.isDestroyed()) {
    if (!chatWindow.isVisible()) chatWindow.show();
    chatWindow.focus();
  }

  sendSSE(res, 'status', { phase: 'starting' });

  try {
    //    
    const currentSession = sessionManager.getCurrentSession();
    const existingMessages: Message[] = currentSession?.messages || [];

    // Agent  (Worker   Legacy)
    const sessionId = currentSession?.id;

    sendSSE(res, 'status', { phase: 'planning' });

    const callbacks: AgentCallbacks = {
      onTodoUpdate: (todos) => {
        sendSSE(res, 'todo', todos.map(t => ({ id: t.id, title: t.title, status: t.status })));
      },
      onToolCall: (toolName, args) => {
        sendSSE(res, 'tool', { name: toolName, summary: summarizeToolArgs(toolName, args) });
      },
      onToolResult: (toolName, _result, success) => {
        sendSSE(res, 'tool_result', { name: toolName, success });
      },
      onAskUser: async (request) => {
        // CLI   (   )
        sendSSE(res, 'ask_user', { question: request.question, options: request.options });
        return {
          selectedOption: request.options[0] || 'Yes',
          isOther: request.options.length === 0,
          customText: request.options.length === 0 ? 'Yes' : undefined,
        };
      },
      onComplete: (response) => {
        sendSSE(res, 'result', { response });
      },
      onError: (error) => {
        sendSSE(res, 'error', { message: error.message });
      },
    };

    let result: AgentResult;

    if (sessionId && workerManager.hasWorker(sessionId)) {
      // Worker  
      workerManager.setChatWindow(chatWindow);
      workerManager.setTaskWindow(taskWindow);

      // Bridge   SSE 
      const bridgeHandler = (channel: string, ...args: unknown[]) => {
        if (channel === 'agent:todoUpdate') sendSSE(res, 'todo', args[0]);
        if (channel === 'agent:toolCall') sendSSE(res, 'tool', args[0]);
        if (channel === 'agent:toolResult') sendSSE(res, 'tool_result', args[0]);
      };
      cliBridge.on('agent:event', bridgeHandler);

      result = await workerManager.runAgent(sessionId, prompt, existingMessages, {
        enablePlanning: true,
      });

      cliBridge.off('agent:event', bridgeHandler);
    } else {
      // Legacy direct execution
      setAgentMainWindow(chatWindow);
      setAgentTaskWindow(taskWindow);
      result = await runAgent(prompt, existingMessages, { enablePlanning: true }, callbacks);
    }

    sendSSE(res, 'status', { phase: 'complete' });
    if (result.response) {
      sendSSE(res, 'result', { response: result.response });
    }
  } catch (error) {
    sendSSE(res, 'error', { message: error instanceof Error ? error.message : String(error) });
  } finally {
    res.end();
  }
}

async function handleJarvis(res: http.ServerResponse, body: string): Promise<void> {
  let parsed: { prompt?: string; specific?: boolean };
  try {
    parsed = JSON.parse(body);
  } catch {
    sendError(res, 400, 'Invalid JSON');
    return;
  }

  const prompt = parsed.prompt;
  if (!prompt) {
    sendError(res, 400, 'prompt is required');
    return;
  }

  // SSE 
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  // Jarvis  show & focus
  if (jarvisWindow && !jarvisWindow.isDestroyed()) {
    if (!jarvisWindow.isVisible()) jarvisWindow.show();
    jarvisWindow.focus();
  }

  sendSSE(res, 'status', { phase: 'starting' });

  try {
    // Bridge   SSE 
    let finalResponse = '';
    const messageHandler = (msg: { type: string; content: string }) => {
      if (msg.type === 'jarvis' || msg.type === 'system') {
        sendSSE(res, 'jarvis_message', { type: msg.type, content: msg.content });
        if (msg.type === 'jarvis') {
          finalResponse = msg.content;
        }
      } else if (msg.type === 'execution_status') {
        sendSSE(res, 'status', { phase: msg.content });
      }
    };
    const completeHandler = (msg: { content: string }) => {
      finalResponse = msg.content;
    };

    cliBridge.on('jarvis:message', messageHandler);
    cliBridge.on('jarvis:complete', completeHandler);

    // Jarvis  
    await jarvisService.handleUserMessage(prompt);

    cliBridge.off('jarvis:message', messageHandler);
    cliBridge.off('jarvis:complete', completeHandler);

    sendSSE(res, 'status', { phase: 'complete' });
    if (finalResponse) {
      sendSSE(res, 'result', { response: finalResponse });
    }
  } catch (error) {
    sendSSE(res, 'error', { message: error instanceof Error ? error.message : String(error) });
  } finally {
    res.end();
  }
}

// =============================================================================
// Helpers
// =============================================================================

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

function sendSSE(res: http.ServerResponse, event: string, data: unknown): void {
  if (res.writableEnded) return;
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function sendError(res: http.ServerResponse, status: number, message: string): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: message }));
}

function summarizeToolArgs(toolName: string, args: Record<string, unknown>): string {
  if (toolName === 'bash' && args['command']) return String(args['command']).slice(0, 80);
  if (toolName.includes('file') && args['path']) return String(args['path']);
  if (toolName.includes('search') && args['query']) return String(args['query']).slice(0, 60);
  const keys = Object.keys(args);
  if (keys.length === 0) return '';
  return String(args[keys[0]!]).slice(0, 60);
}
