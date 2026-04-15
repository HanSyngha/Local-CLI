/**
 * JSON Stream Logger
 *
 * Logs all terminal interactions and events to a JSON file for analysis
 */

import { createWriteStream, WriteStream } from 'fs';
import { mkdir, access, readFile, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import chalk from 'chalk';
import { PROJECTS_DIR } from '../constants.js';

// Flush interval for periodic buffer writes (in milliseconds)
const FLUSH_INTERVAL_MS = 1000;

//   
export type LogCategory = 'all' | 'chat' | 'tool' | 'http' | 'llm' | 'subagent' | 'ui' | 'system' | 'debug';

export interface StreamLogEntry {
  timestamp: string;
  type:
    | 'user_input'
    | 'assistant_response'
    | 'system_message'
    | 'error'
    | 'tool_call'
    | 'tool_start'      // Tool  
    | 'tool_end'        // Tool  
    | 'todo_update'
    | 'planning_start'  // Planning 
    | 'planning_end'    // Planning 
    | 'server_request'  // Windows  
    | 'server_response' // Windows  
    | 'debug'
    | 'info'
    // New log types for comprehensive logging
    | 'ui_interaction'      // UI  (, ,  )
    | 'component_lifecycle' //   (mount, unmount, render)
    | 'screen_change'       // // 
    | 'form_event'          //   (submit, validation )
    | 'modal_event'         // // 
    | 'loading_event'       // // 
    | 'animation_event'     // / 
    | 'layout_event'        //   (resize, breakpoint )
    | 'ipc_event'           // IPC   (Electron)
    | 'window_event'        //   (Electron)
    | 'system_event'        //   (app ready, quit )
    | 'update_event'        //   
    | 'session_event'       //   (start, end, milestone)
    | 'http_event';         // HTTP  (stream start/end )
  content: string;
  category?: LogCategory;  //   ( )
  metadata?: Record<string, unknown>;
}

/**
 *    
 */
function getLogCategory(type: StreamLogEntry['type']): LogCategory {
  switch (type) {
    // Chat 
    case 'user_input':
    case 'assistant_response':
      return 'chat';

    // Tool 
    case 'tool_call':
    case 'tool_start':
    case 'tool_end':
    case 'todo_update':
    case 'planning_start':
    case 'planning_end':
      return 'tool';

    // HTTP 
    case 'server_request':
    case 'server_response':
    case 'http_event':
      return 'http';

    // UI 
    case 'ui_interaction':
    case 'component_lifecycle':
    case 'screen_change':
    case 'form_event':
    case 'modal_event':
    case 'loading_event':
    case 'animation_event':
    case 'layout_event':
      return 'ui';

    // System 
    case 'system_message':
    case 'ipc_event':
    case 'window_event':
    case 'system_event':
    case 'update_event':
    case 'session_event':
    case 'error':
      return 'system';

    // Debug 
    case 'debug':
    case 'info':
      return 'debug';

    default:
      return 'system';
  }
}

/**
 *    
 *  (prefix)     
 */
function refineCategoryFromContent(category: LogCategory, content: string): LogCategory {
  const msg = content.toLowerCase();

  // SubAgent   subagent  (  )
  if (msg.includes('[subagent:') || msg.includes('[subagent]') ||
      msg.includes('sub-agent') || msg.includes('subagent[') ||
      msg.includes('[desktop-control]') || msg.includes('desktop control') ||
      msg.includes('desktopcontrolsubagent') || msg.includes('desktop_control') ||
      msg.includes('vlm action') || msg.includes('vlm request') ||
      msg.includes('capturescreen') || msg.includes('screenshot captured') ||
      msg.includes('bring_window') || msg.includes('list_windows') ||
      msg.includes('bringwindowtoprimary') || msg.includes('mouseclick') ||
      msg.includes('presshotkey') || msg.includes('presskey') || msg.includes('typetext') ||
      msg.includes('[word-agent]') || msg.includes('[excel-agent]') ||
      msg.includes('[powerpoint-agent]') || msg.includes('[pptx-agent]') ||
      msg.includes('[confluence-agent]') || msg.includes('[jira-agent]') ||
      msg.includes('[search-agent]') || msg.includes('[browser-agent]') ||
      msg.includes('browsersubagent')) {
    return 'subagent';
  }

  // LLM   llm 
  if (msg.includes('[llm]') || msg.includes('llm request') || msg.includes('llm response') ||
      msg.includes('llm tool') || msg.includes('completion') || msg.includes('tokens')) {
    return 'llm';
  }

  // HTTP  
  if (msg.includes('[http]') || msg.includes('stream start') || msg.includes('stream end') ||
      msg.includes('stream chunk') || msg.includes('http request') || msg.includes('http response')) {
    return 'http';
  }

  // Tool  
  if (msg.includes('[tool]') || msg.includes('[bash]') || msg.includes('[read]') ||
      msg.includes('[write]') || msg.includes('[edit]') || msg.includes('tool execution') ||
      msg.includes('tool result')) {
    return 'tool';
  }

  // UI  
  if (msg.includes('[ui]') || msg.includes('[component]') || msg.includes('[render]') ||
      msg.includes('[modal]') || msg.includes('[form]') || msg.includes('[loading]')) {
    return 'ui';
  }

  // System  
  if (msg.includes('[system]') || msg.includes('[session]') || msg.includes('[config]') ||
      msg.includes('[update]') || msg.includes('[window]') || msg.includes('[ipc]')) {
    return 'system';
  }

  //   
  return category;
}

//   
interface CategoryStreamInfo {
  stream: WriteStream;
  buffer: StreamLogEntry[];
  isFirstEntry: boolean;
  filePath: string;
}

export class JsonStreamLogger {
  private writeStream: WriteStream | null = null;
  private errorWriteStream: WriteStream | null = null;
  private filePath: string;
  private errorFilePath: string;
  private isFirstEntry = true;
  private isFirstErrorEntry = true;
  private buffer: StreamLogEntry[] = [];
  private errorBuffer: StreamLogEntry[] = [];
  private flushInterval: NodeJS.Timeout | null = null;
  private isEnabled = false;
  private errorStreamInitialized = false;
  private appendMode = false;
  private verbose = false;

  //    ( )
  private categoryStreams: Map<LogCategory, CategoryStreamInfo> = new Map();
  private enableCategorySplit = true; //    
  private pendingStreamInits: Set<Promise<void>> = new Set(); //    promise 

  constructor(filePath: string, errorFilePath: string) {
    this.filePath = filePath;
    this.errorFilePath = errorFilePath;
  }

  /**
   * Initialize the JSON stream logger
   * @param append - Whether to append to existing file
   * @param verbose - Whether to show initialization messages
   */
  async initialize(append = false, verbose = false): Promise<void> {
    this.verbose = verbose;
    try {
      // Store append mode for error stream initialization
      this.appendMode = append;

      // Create directory if it doesn't exist
      await mkdir(dirname(this.filePath), { recursive: true });

      // Check if file exists and we're in append mode
      let fileExists = false;
      try {
        await access(this.filePath);
        fileExists = true;
      } catch {
        fileExists = false;
      }

      if (append && fileExists) {
        // Append mode: remove closing bracket and continue
        await this.prepareFileForAppend(this.filePath);
        this.writeStream = createWriteStream(this.filePath, { flags: 'a' });
        this.isFirstEntry = false; // Not first entry since file has content
        if (this.verbose) {
          console.log(chalk.dim(`📝 JSON stream logging resumed (append mode)`));
        }
      } else {
        // New file mode: create fresh file
        this.writeStream = createWriteStream(this.filePath, { flags: 'w' });
        this.writeStream.write('[\n');
        this.isFirstEntry = true;
        if (this.verbose) {
          console.log(chalk.dim(`📝 JSON stream logging enabled`));
        }
      }

      this.isEnabled = true;

      // Set up periodic flush
      this.flushInterval = setInterval(() => {
        this.flush();
        this.flushErrors();
        this.flushCategories();
      }, FLUSH_INTERVAL_MS);

      if (this.verbose) {
        console.log(chalk.dim(`   Log: ${this.filePath}`));
      }
    } catch (error) {
      console.error(chalk.red('Failed to initialize JSON stream logger:'), error);
      this.isEnabled = false;
    }
  }

  /**
   * Prepare file for append by removing closing bracket
   */
  private async prepareFileForAppend(filePath: string): Promise<void> {
    try {
      const content = await readFile(filePath, 'utf-8');
      // Remove the closing bracket and trailing whitespace
      const trimmed = content.trimEnd();
      if (trimmed.endsWith(']')) {
        const withoutClosing = trimmed.slice(0, -1);
        await writeFile(filePath, withoutClosing, 'utf-8');
      }
    } catch (error) {
      console.error(chalk.yellow('Warning: Could not prepare file for append:'), error);
      // Continue anyway - will create new file
    }
  }

  /**
   * Initialize category stream (lazy initialization)
   *   log()  Map     
   * stream null     info 
   */
  private async initializeCategoryStream(category: LogCategory): Promise<void> {
    if (!this.enableCategorySplit) {
      return;
    }

    //  info  (log()    )
    const existingInfo = this.categoryStreams.get(category);

    //     return
    if (existingInfo && existingInfo.stream && !existingInfo.stream.destroyed) {
      return;
    }

    try {
      // Generate category file path: {sessionId}_log.json → {sessionId}_{category}.json
      const categoryFilePath = existingInfo?.filePath || this.filePath.replace('_log.json', `_${category}.json`);

      // Create directory if it doesn't exist
      await mkdir(dirname(categoryFilePath), { recursive: true });

      // Check if file exists and we're in append mode
      let fileExists = false;
      try {
        await access(categoryFilePath);
        fileExists = true;
      } catch {
        fileExists = false;
      }

      let stream: WriteStream;
      let isFirstEntry = true;

      if (this.appendMode && fileExists) {
        // Append mode: remove closing bracket and continue
        await this.prepareFileForAppend(categoryFilePath);
        stream = createWriteStream(categoryFilePath, { flags: 'a' });
        isFirstEntry = false;
      } else {
        // New file mode: create fresh file
        stream = createWriteStream(categoryFilePath, { flags: 'w' });
        stream.write('[\n');
        isFirstEntry = true;
      }

      //  info   ,   
      if (existingInfo) {
        existingInfo.stream = stream;
        existingInfo.isFirstEntry = isFirstEntry;
        // filePath   
      } else {
        this.categoryStreams.set(category, {
          stream,
          buffer: [],
          isFirstEntry,
          filePath: categoryFilePath,
        });
      }

      if (this.verbose) {
        console.log(chalk.dim(`   Category log: ${categoryFilePath}`));
      }
    } catch (error) {
      console.error(chalk.red(`Failed to initialize category stream (${category}):`), error);
    }
  }

  /**
   * Log an entry to the JSON stream
   */
  log(entry: StreamLogEntry): void {
    if (!this.isEnabled || !this.writeStream) {
      return;
    }

    // Determine category if not set
    if (!entry.category) {
      const baseCategory = getLogCategory(entry.type);
      // Refine category based on message content (for more accurate categorization)
      entry.category = refineCategoryFromContent(baseCategory, entry.content);
    }

    // Add to main buffer
    this.buffer.push(entry);

    // Add to error buffer if error
    if (entry.type === 'error') {
      // Initialize error stream on first error (lazy initialization)
      if (!this.errorStreamInitialized) {
        this.initializeErrorStream().catch(err => {
          console.error(chalk.red('Failed to initialize error stream:'), err);
        });
      }
      this.errorBuffer.push(entry);
    }

    // Add to category buffer (for file splitting)
    if (this.enableCategorySplit && entry.category && entry.category !== 'all') {
      const category = entry.category;

      //         (  )
      if (!this.categoryStreams.has(category)) {
        //   
        const categoryFilePath = this.filePath.replace('_log.json', `_${category}.json`);

        //  Map  ( null,  )
        this.categoryStreams.set(category, {
          stream: null as unknown as WriteStream,
          buffer: [],
          isFirstEntry: true,
          filePath: categoryFilePath,
        });

        //    (promise )
        const initPromise = this.initializeCategoryStream(category).catch(err => {
          console.error(chalk.red(`Failed to initialize category stream (${category}):`), err);
        });
        this.pendingStreamInits.add(initPromise);
        initPromise.finally(() => this.pendingStreamInits.delete(initPromise));
      }

      //   streamInfo 
      const streamInfo = this.categoryStreams.get(category);
      if (streamInfo) {
        streamInfo.buffer.push(entry);
      }
    }
  }

  /**
   * Flush buffered entries to file
   */
  private flush(): void {
    if (!this.writeStream || this.buffer.length === 0) {
      return;
    }

    try {
      for (const entry of this.buffer) {
        // Add comma if not first entry
        if (!this.isFirstEntry) {
          this.writeStream.write(',\n');
        }
        this.isFirstEntry = false;

        // Write the entry as formatted JSON
        const json = JSON.stringify(entry, null, 2);
        // Indent each line by 2 spaces for array formatting
        const indentedJson = json.split('\n').map(line => '  ' + line).join('\n');
        this.writeStream.write(indentedJson);
      }

      // Clear buffer
      this.buffer = [];
    } catch (error) {
      console.error(chalk.red('Failed to write to JSON stream:'), error);
    }
  }

  /**
   * Initialize error stream (lazy initialization)
   */
  private async initializeErrorStream(): Promise<void> {
    if (this.errorStreamInitialized) {
      return;
    }

    try {
      // Create directory if it doesn't exist
      await mkdir(dirname(this.errorFilePath), { recursive: true });

      // Check if file exists and we're in append mode
      let fileExists = false;
      try {
        await access(this.errorFilePath);
        fileExists = true;
      } catch {
        fileExists = false;
      }

      if (this.appendMode && fileExists) {
        // Append mode: remove closing bracket and continue
        await this.prepareFileForAppend(this.errorFilePath);
        this.errorWriteStream = createWriteStream(this.errorFilePath, { flags: 'a' });
        this.isFirstErrorEntry = false;
      } else {
        // New file mode: create fresh file
        this.errorWriteStream = createWriteStream(this.errorFilePath, { flags: 'w' });
        this.errorWriteStream.write('[\n');
        this.isFirstErrorEntry = true;
      }

      this.errorStreamInitialized = true;
      // Silent:     
    } catch (error) {
      console.error(chalk.red('Failed to initialize error stream:'), error);
    }
  }

  /**
   * Flush buffered error entries to error file
   */
  private flushErrors(): void {
    if (!this.errorWriteStream || this.errorBuffer.length === 0) {
      return;
    }

    try {
      for (const entry of this.errorBuffer) {
        // Add comma if not first entry
        if (!this.isFirstErrorEntry) {
          this.errorWriteStream.write(',\n');
        }
        this.isFirstErrorEntry = false;

        // Write the entry as formatted JSON
        const json = JSON.stringify(entry, null, 2);
        // Indent each line by 2 spaces for array formatting
        const indentedJson = json.split('\n').map(line => '  ' + line).join('\n');
        this.errorWriteStream.write(indentedJson);
      }

      // Clear error buffer
      this.errorBuffer = [];
    } catch (error) {
      console.error(chalk.red('Failed to write to error JSON stream:'), error);
    }
  }

  /**
   * Flush buffered entries to category files
   */
  private flushCategories(): void {
    for (const [_category, streamInfo] of this.categoryStreams) {
      // stream , writable ,   skip
      // stream     ,  flush  
      if (!streamInfo.stream || !streamInfo.stream.writable || streamInfo.buffer.length === 0) {
        continue;
      }

      try {
        for (const entry of streamInfo.buffer) {
          // Add comma if not first entry
          if (!streamInfo.isFirstEntry) {
            streamInfo.stream.write(',\n');
          }
          streamInfo.isFirstEntry = false;

          // Write the entry as formatted JSON
          const json = JSON.stringify(entry, null, 2);
          // Indent each line by 2 spaces for array formatting
          const indentedJson = json.split('\n').map(line => '  ' + line).join('\n');
          streamInfo.stream.write(indentedJson);
        }

        // Clear category buffer
        streamInfo.buffer = [];
      } catch (error) {
        console.error(chalk.red(`Failed to write to category stream:`), error);
      }
    }
  }

  /**
   * Log user input
   */
  logUserInput(input: string): void {
    this.log({
      timestamp: new Date().toISOString(),
      type: 'user_input',
      content: input,
      metadata: {
        length: input.length,
      },
    });
  }

  /**
   * Log assistant response
   */
  logAssistantResponse(response: string, streaming = false): void {
    this.log({
      timestamp: new Date().toISOString(),
      type: 'assistant_response',
      content: response,
      metadata: {
        length: response.length,
        streaming,
      },
    });
  }

  /**
   * Log system message
   */
  logSystemMessage(message: string): void {
    this.log({
      timestamp: new Date().toISOString(),
      type: 'system_message',
      content: message,
    });
  }

  /**
   * Log error
   */
  logError(error: Error | unknown, context?: string): void {
    let errorMessage: string;
    let errorStack: string | undefined;
    let errorDetails: Record<string, unknown> | undefined;

    if (error instanceof Error) {
      errorMessage = error.message;
      errorStack = error.stack;
      // Include custom error details if available
      if ((error as any).details) {
        errorDetails = (error as any).details;
      }
    } else if (typeof error === 'object' && error !== null) {
      // For plain objects, serialize them properly
      try {
        errorMessage = JSON.stringify(error, null, 2);
        errorDetails = error as Record<string, unknown>;
      } catch {
        errorMessage = String(error);
      }
    } else {
      errorMessage = String(error);
    }

    this.log({
      timestamp: new Date().toISOString(),
      type: 'error',
      content: errorMessage,
      metadata: {
        context,
        stack: errorStack,
        name: error instanceof Error ? error.constructor.name : 'Unknown',
        ...(errorDetails && { details: errorDetails }),
      },
    });
  }

  /**
   * Log tool call
   */
  logToolCall(toolName: string, args: unknown, result?: unknown, error?: Error): void {
    this.log({
      timestamp: new Date().toISOString(),
      type: 'tool_call',
      content: `Tool: ${toolName}`,
      metadata: {
        toolName,
        args,
        result: result ? (typeof result === 'string' ? result.substring(0, 500) : result) : undefined,
        error: error ? error.message : undefined,
        success: !error,
      },
    });
  }

  /**
   * Log TODO update
   */
  logTodoUpdate(todos: unknown[]): void {
    this.log({
      timestamp: new Date().toISOString(),
      type: 'todo_update',
      content: `TODO list updated (${todos.length} items)`,
      metadata: {
        todos,
        count: todos.length,
      },
    });
  }

  /**
   * Log debug information
   */
  logDebug(message: string, data?: unknown): void {
    this.log({
      timestamp: new Date().toISOString(),
      type: 'debug',
      content: message,
      metadata: data ? { data } : undefined,
    });
  }

  /**
   * Log info message
   */
  logInfo(message: string, data?: unknown): void {
    this.log({
      timestamp: new Date().toISOString(),
      type: 'info',
      content: message,
      metadata: data ? { data } : undefined,
    });
  }

  /**
   * Log tool execution start
   */
  logToolStart(toolName: string, args: unknown, reason?: string): void {
    this.log({
      timestamp: new Date().toISOString(),
      type: 'tool_start',
      content: `Tool Start: ${toolName}`,
      metadata: {
        toolName,
        args,
        reason,
      },
    });
  }

  /**
   * Log tool execution end
   */
  logToolEnd(toolName: string, success: boolean, result?: unknown, error?: string, durationMs?: number): void {
    this.log({
      timestamp: new Date().toISOString(),
      type: 'tool_end',
      content: `Tool End: ${toolName} (${success ? 'success' : 'failed'})`,
      metadata: {
        toolName,
        success,
        result: result ? (typeof result === 'string' ? result.substring(0, 1000) : result) : undefined,
        error,
        durationMs,
      },
    });
  }

  /**
   * Log planning phase start
   */
  logPlanningStart(userMessage: string, context?: Record<string, unknown>): void {
    this.log({
      timestamp: new Date().toISOString(),
      type: 'planning_start',
      content: `Planning Start: ${userMessage.substring(0, 100)}...`,
      metadata: {
        userMessage,
        messageLength: userMessage.length,
        ...context,
      },
    });
  }

  /**
   * Log planning phase end
   */
  logPlanningEnd(todoCount: number, todos?: unknown[], directResponse?: boolean, durationMs?: number): void {
    this.log({
      timestamp: new Date().toISOString(),
      type: 'planning_end',
      content: directResponse ? 'Planning End: Direct response' : `Planning End: ${todoCount} TODOs created`,
      metadata: {
        todoCount,
        todos,
        directResponse,
        durationMs,
      },
    });
  }

  /**
   * Log server request (legacy Windows servers)
   */
  logServerRequest(serverType: 'browser' | 'office', method: string, endpoint: string, body?: unknown): void {
    this.log({
      timestamp: new Date().toISOString(),
      type: 'server_request',
      content: `${serverType.toUpperCase()} Server: ${method} ${endpoint}`,
      metadata: {
        serverType,
        method,
        endpoint,
        body,
      },
    });
  }

  /**
   * Log server response (for Windows servers)
   */
  logServerResponse(
    serverType: 'browser' | 'office',
    endpoint: string,
    success: boolean,
    response?: unknown,
    error?: string,
    durationMs?: number
  ): void {
    this.log({
      timestamp: new Date().toISOString(),
      type: 'server_response',
      content: `${serverType.toUpperCase()} Server Response: ${endpoint} (${success ? 'success' : 'failed'})`,
      metadata: {
        serverType,
        endpoint,
        success,
        response: response ? (typeof response === 'string' ? response.substring(0, 500) : response) : undefined,
        error,
        durationMs,
      },
    });
  }

  // ============================================================================
  // New Log Methods for Comprehensive Logging
  // ============================================================================

  /**
   * Log UI interaction (click, keyboard, scroll, drag)
   */
  logUIInteraction(action: string, element?: string, context?: Record<string, unknown>): void {
    this.log({
      timestamp: new Date().toISOString(),
      type: 'ui_interaction',
      content: `UI: ${action}${element ? ` - ${element}` : ''}`,
      metadata: {
        action,
        element,
        ...context,
      },
    });
  }

  /**
   * Log component lifecycle (mount, unmount, render, stateChange)
   */
  logComponentLifecycle(
    event: 'mount' | 'unmount' | 'render' | 'renderComplete' | 'stateChange',
    componentName: string,
    context?: Record<string, unknown>
  ): void {
    this.log({
      timestamp: new Date().toISOString(),
      type: 'component_lifecycle',
      content: `Component ${event}: ${componentName}`,
      metadata: {
        event,
        componentName,
        ...context,
      },
    });
  }

  /**
   * Log screen/navigation changes
   */
  logScreenChange(
    changeType: 'screen' | 'tab' | 'route',
    target: string,
    context?: Record<string, unknown>
  ): void {
    this.log({
      timestamp: new Date().toISOString(),
      type: 'screen_change',
      content: `${changeType.charAt(0).toUpperCase() + changeType.slice(1)} change: ${target}`,
      metadata: {
        changeType,
        target,
        ...context,
      },
    });
  }

  /**
   * Log form events
   */
  logFormEvent(
    event: 'start' | 'submit' | 'result' | 'error' | 'fieldChange' | 'validation',
    formId: string,
    context?: Record<string, unknown>
  ): void {
    this.log({
      timestamp: new Date().toISOString(),
      type: 'form_event',
      content: `Form ${event}: ${formId}`,
      metadata: {
        event,
        formId,
        ...context,
      },
    });
  }

  /**
   * Log modal/dialog/toast events
   */
  logModalEvent(
    event: 'modalOpen' | 'modalClose' | 'dialogShow' | 'dialogResult' | 'toastShow' | 'toastDismiss',
    id: string,
    context?: Record<string, unknown>
  ): void {
    this.log({
      timestamp: new Date().toISOString(),
      type: 'modal_event',
      content: `${event}: ${id}`,
      metadata: {
        event,
        id,
        ...context,
      },
    });
  }

  /**
   * Log loading/skeleton/progress events
   */
  logLoadingEvent(
    event: 'loadingStart' | 'loadingEnd' | 'loadingError' | 'skeletonShow' | 'skeletonHide' |
           'progressStart' | 'progressUpdate' | 'progressComplete' | 'progressError',
    id: string,
    context?: Record<string, unknown>
  ): void {
    this.log({
      timestamp: new Date().toISOString(),
      type: 'loading_event',
      content: `${event}: ${id}`,
      metadata: {
        event,
        id,
        ...context,
      },
    });
  }

  /**
   * Log animation/transition events
   */
  logAnimationEvent(
    event: 'animationStart' | 'animationEnd' | 'transitionStart' | 'transitionEnd' | 'hoverEnter' | 'hoverLeave',
    name: string,
    context?: Record<string, unknown>
  ): void {
    this.log({
      timestamp: new Date().toISOString(),
      type: 'animation_event',
      content: `${event}: ${name}`,
      metadata: {
        event,
        name,
        ...context,
      },
    });
  }

  /**
   * Log layout events (viewport, breakpoint, shift)
   */
  logLayoutEvent(
    event: 'viewportResize' | 'breakpointChange' | 'layoutShift' | 'scrollPosition',
    context?: Record<string, unknown>
  ): void {
    this.log({
      timestamp: new Date().toISOString(),
      type: 'layout_event',
      content: `Layout: ${event}`,
      metadata: {
        event,
        ...context,
      },
    });
  }

  /**
   * Log IPC events (Electron)
   */
  logIPCEvent(
    event: 'send' | 'receive' | 'invoke' | 'handle' | 'error',
    channel: string,
    context?: Record<string, unknown>
  ): void {
    this.log({
      timestamp: new Date().toISOString(),
      type: 'ipc_event',
      content: `IPC ${event}: ${channel}`,
      metadata: {
        event,
        channel,
        ...context,
      },
    });
  }

  /**
   * Log window events (Electron)
   */
  logWindowEvent(
    event: 'create' | 'close' | 'stateChange' | 'focus' | 'blur',
    context?: Record<string, unknown>
  ): void {
    this.log({
      timestamp: new Date().toISOString(),
      type: 'window_event',
      content: `Window: ${event}`,
      metadata: {
        event,
        ...context,
      },
    });
  }

  /**
   * Log system events (app lifecycle)
   */
  logSystemEvent(
    event: 'appReady' | 'appActivate' | 'appBeforeQuit' | 'appQuit' | 'systemSuspend' | 'systemResume' |
           'networkChange' | 'themeChange',
    context?: Record<string, unknown>
  ): void {
    this.log({
      timestamp: new Date().toISOString(),
      type: 'system_event',
      content: `System: ${event}`,
      metadata: {
        event,
        ...context,
      },
    });
  }

  /**
   * Log auto-update events
   */
  logUpdateEvent(
    event: 'checkStart' | 'available' | 'downloadStart' | 'downloadProgress' | 'downloadComplete' |
           'installing' | 'installed' | 'error',
    context?: Record<string, unknown>
  ): void {
    this.log({
      timestamp: new Date().toISOString(),
      type: 'update_event',
      content: `Update: ${event}`,
      metadata: {
        event,
        ...context,
      },
    });
  }

  /**
   * Log session events
   */
  logSessionEvent(
    event: 'start' | 'end' | 'milestone' | 'featureUsage',
    context?: Record<string, unknown>
  ): void {
    this.log({
      timestamp: new Date().toISOString(),
      type: 'session_event',
      content: `Session: ${event}`,
      metadata: {
        event,
        ...context,
      },
    });
  }

  /**
   * Log HTTP stream events
   */
  logHTTPEvent(
    event: 'streamStart' | 'streamChunk' | 'streamEnd' | 'error',
    context?: Record<string, unknown>
  ): void {
    this.log({
      timestamp: new Date().toISOString(),
      type: 'http_event',
      content: `HTTP: ${event}`,
      metadata: {
        event,
        ...context,
      },
    });
  }

  /**
   * Log error boundary/unhandled errors
   */
  logErrorEvent(
    event: 'errorBoundary' | 'unhandledRejection' | 'globalError',
    context?: Record<string, unknown>
  ): void {
    this.log({
      timestamp: new Date().toISOString(),
      type: 'error',
      content: `Error: ${event}`,
      metadata: {
        event,
        ...context,
      },
    });
  }

  /**
   * Get the log directory path (for server log files)
   */
  getLogDirectory(): string {
    return dirname(this.filePath);
  }

  /**
   * Get the log file path
   */
  getLogFilePath(): string {
    return this.filePath;
  }

  /**
   * Close the JSON stream logger
   */
  async close(): Promise<void> {
    // Already closed, skip
    if (!this.isEnabled || !this.writeStream) {
      return;
    }

    // Mark as disabled immediately to prevent duplicate close attempts
    this.isEnabled = false;

    // Clear flush interval
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }

    // Wait for all pending category stream initializations to complete
    if (this.pendingStreamInits.size > 0) {
      await Promise.all(this.pendingStreamInits);
    }

    // Flush any remaining buffers
    this.flush();

    // Only flush errors if error stream was initialized
    if (this.errorStreamInitialized) {
      this.flushErrors();
    }

    // Flush category buffers
    this.flushCategories();

    // Close all streams
    const promises: Promise<void>[] = [];

    // Close main stream if not already destroyed
    if (!this.writeStream.destroyed) {
      // Write closing bracket for JSON array
      if (this.writeStream.writable) {
        this.writeStream.write('\n]\n');
      }

      promises.push(new Promise<void>((resolve, reject) => {
        this.writeStream!.end((error?: Error) => {
          if (error) {
            console.error(chalk.red('Failed to close JSON stream:'), error);
            reject(error);
          } else {
            if (this.verbose) {
              console.log(chalk.dim(`✅ Log saved: ${this.filePath}`));
            }
            resolve();
          }
        });
      }));
    } else if (this.verbose) {
      console.log(chalk.dim(`⚠️  Log stream already closed: ${this.filePath}`));
    }

    // Only close error stream if it was initialized and not destroyed
    if (this.errorStreamInitialized && this.errorWriteStream && !this.errorWriteStream.destroyed) {
      if (this.errorWriteStream.writable) {
        this.errorWriteStream.write('\n]\n');
      }

      promises.push(new Promise<void>((resolve, reject) => {
        this.errorWriteStream!.end((error?: Error) => {
          if (error) {
            console.error(chalk.red('Failed to close error JSON stream:'), error);
            reject(error);
          } else {
            // Silent:      
            resolve();
          }
        });
      }));
    }

    // Close category streams
    for (const [category, streamInfo] of this.categoryStreams) {
      if (streamInfo.stream && !streamInfo.stream.destroyed) {
        if (streamInfo.stream.writable) {
          streamInfo.stream.write('\n]\n');
        }

        promises.push(new Promise<void>((resolve, reject) => {
          streamInfo.stream.end((error?: Error) => {
            if (error) {
              console.error(chalk.red(`Failed to close category stream (${category}):`), error);
              reject(error);
            } else {
              if (this.verbose) {
                console.log(chalk.dim(`✅ Category log saved: ${streamInfo.filePath}`));
              }
              resolve();
            }
          });
        }));
      }
    }

    await Promise.all(promises);

    // Clear references
    this.writeStream = null;
    this.errorWriteStream = null;
    this.categoryStreams.clear();
  }

  /**
   * Check if logging is enabled
   */
  isActive(): boolean {
    return this.isEnabled;
  }

  /**
   * Get the log file path
   */
  getFilePath(): string {
    return this.filePath;
  }
}

// Global JSON stream logger instance (null if not enabled)
let globalJsonStreamLogger: JsonStreamLogger | null = null;

/**
 * Initialize global JSON stream logger
 * Automatically generates log paths based on current working directory and session ID
 * @param sessionId - Session ID for the log file
 * @param append - Whether to append to existing file
 * @param verbose - Whether to show initialization messages
 */
export async function initializeJsonStreamLogger(sessionId: string, append = false, verbose = false): Promise<JsonStreamLogger> {
  if (globalJsonStreamLogger) {
    await globalJsonStreamLogger.close();
  }

  // Get current working directory and sanitize it for use in path
  // Replace '/' with '-' and remove leading '-' if present (for absolute paths)
  const cwd = process.cwd().replace(/\//g, '-').replace(/^-/, '');

  // Create log directory path
  const projectLogDir = join(PROJECTS_DIR, cwd);

  // Create log file paths
  const logFile = join(projectLogDir, `${sessionId}_log.json`);
  const errorLogFile = join(projectLogDir, `${sessionId}_error.json`);

  globalJsonStreamLogger = new JsonStreamLogger(logFile, errorLogFile);
  await globalJsonStreamLogger.initialize(append, verbose);

  return globalJsonStreamLogger;
}

/**
 * Get global JSON stream logger instance
 */
export function getJsonStreamLogger(): JsonStreamLogger | null {
  return globalJsonStreamLogger;
}

/**
 * Alias for getJsonStreamLogger (shorter name)
 */
export const getStreamLogger = getJsonStreamLogger;

/**
 * Close global JSON stream logger
 */
export async function closeJsonStreamLogger(): Promise<void> {
  if (globalJsonStreamLogger && globalJsonStreamLogger.isActive()) {
    await globalJsonStreamLogger.close();
    globalJsonStreamLogger = null;
  }
}
