/**
 * Logger Utility
 *
 * Verbose logging for debugging with full flow tracking
 */

import chalk from 'chalk';
import { getJsonStreamLogger } from './json-stream-logger.js';
import * as path from 'path';

export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3,
  VERBOSE = 4,
}

// LLM  dedicated  (--llm-log )
let llmLogEnabled = false;

// dashboard   (     )
type ErrorReportCallback = (error: unknown, context?: Record<string, unknown>) => void;
let errorReportCallback: ErrorReportCallback | null = null;

export function setErrorReportCallback(cb: ErrorReportCallback | null): void {
  errorReportCallback = cb;
}

export function enableLLMLog(): void {
  llmLogEnabled = true;
}

export function disableLLMLog(): void {
  llmLogEnabled = false;
}

export function isLLMLogEnabled(): boolean {
  return llmLogEnabled;
}

export interface LoggerOptions {
  level?: LogLevel;
  prefix?: string;
  timestamp?: boolean;
  showLocation?: boolean; // , ,  
  showPid?: boolean; //  ID 
}

export interface CallLocation {
  file: string;
  line: number;
  column: number;
  function: string;
}

export interface VariableLog {
  name: string;
  value: unknown;
  type?: string;
}

/**
 * Logger class for structured logging with flow tracking
 */
export class Logger {
  private level: LogLevel;
  private prefix: string;
  private showTimestamp: boolean;
  private showLocation: boolean;
  private showPid: boolean;
  private traceId: string | null = null;
  private timers: Map<string, number> = new Map();

  constructor(options: LoggerOptions = {}) {
    this.level = options.level ?? LogLevel.INFO;
    this.prefix = options.prefix ?? '';
    this.showTimestamp = options.timestamp ?? true;
    this.showLocation = options.showLocation ?? true;
    this.showPid = options.showPid ?? false;
  }

  /**
   * Set log level
   */
  setLevel(level: LogLevel): void {
    this.level = level;
  }

  /**
   * Set trace ID for flow tracking
   */
  setTraceId(traceId: string): void {
    this.traceId = traceId;
  }

  /**
   * Clear trace ID
   */
  clearTraceId(): void {
    this.traceId = null;
  }

  /**
   * Get current trace ID
   */
  getTraceId(): string | null {
    return this.traceId;
  }

  /**
   * Get call location from stack trace
   */
  private getCallLocation(depth: number = 3): CallLocation | null {
    try {
      const stack = new Error().stack;
      if (!stack) return null;

      const lines = stack.split('\n');
      if (lines.length <= depth) return null;

      // Extract file, line, column from stack trace
      // Format: "    at functionName (file:line:column)" or "    at file:line:column"
      const line = lines[depth];
      if (!line) return null;

      const match = line.match(/at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?/);

      if (!match) return null;

      const [, functionName, file, lineNum, column] = match;

      if (!file || !lineNum || !column) return null;

      return {
        file: path.basename(file),
        line: parseInt(lineNum),
        column: parseInt(column),
        function: functionName?.trim() || '<anonymous>',
      };
    } catch {
      return null;
    }
  }

  /**
   * Get formatted timestamp
   */
  private getTimestamp(): string {
    if (!this.showTimestamp) return '';
    const now = new Date();
    return chalk.gray(`[${now.toISOString()}]`);
  }

  /**
   * Get formatted prefix
   */
  private getPrefix(): string {
    if (!this.prefix) return '';
    return chalk.cyan(`[${this.prefix}]`);
  }

  /**
   * Get formatted process ID
   */
  private getPid(): string {
    if (!this.showPid) return '';
    return chalk.dim(`[PID:${process.pid}]`);
  }

  /**
   * Get formatted trace ID
   */
  private getTraceIdStr(): string {
    if (!this.traceId) return '';
    return chalk.magenta(`[Trace:${this.traceId.slice(0, 8)}]`);
  }

  /**
   * Get formatted location
   */
  private getLocation(location: CallLocation | null): string {
    if (!this.showLocation || !location) return '';
    return chalk.dim(`[${location.file}:${location.line}:${location.function}]`);
  }

  /**
   * Format variable for logging
   */
  private formatVariable(variable: VariableLog): string {
    const type = variable.type || typeof variable.value;
    const valueStr = this.formatValue(variable.value);
    return chalk.yellow(variable.name) + chalk.gray('=') + chalk.white(valueStr) + chalk.dim(` (${type})`);
  }

  /**
   * Format value for display
   */
  private formatValue(value: unknown): string {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (typeof value === 'string') return `"${value}"`;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (typeof value === 'function') return '[Function]';
    if (Array.isArray(value)) return `Array(${value.length})`;
    if (value instanceof Error) return `Error: ${value.message}`;
    try {
      const json = JSON.stringify(value);
      return json.length > 100 ? json.slice(0, 100) + '...' : json;
    } catch {
      return '[Object]';
    }
  }

  /**
   * Log error
   */
  error(message: string, error?: Error | unknown): void {
    // Always log to file first (for Ctrl+O LogBrowser)
    const jsonLogger = getJsonStreamLogger();
    if (jsonLogger?.isActive()) {
      jsonLogger.logError(error || new Error(message), this.prefix || 'logger');
    }

    // Console output controlled by log level
    if (this.level < LogLevel.ERROR) return;

    const location = this.getCallLocation();
    const timestamp = this.getTimestamp();
    const prefix = this.getPrefix();
    const pid = this.getPid();
    const traceId = this.getTraceIdStr();
    const loc = this.getLocation(location);

    console.error(
      timestamp,
      prefix,
      pid,
      traceId,
      loc,
      chalk.red('❌ ERROR:'),
      message
    );

    if (error) {
      if (error instanceof Error) {
        console.error(chalk.red('  Message:'), error.message);
        if (error.stack) {
          console.error(chalk.gray('  Stack:'));
          console.error(chalk.gray(error.stack));
        }
        // Show cause if available
        if ((error as any).cause) {
          console.error(chalk.red('  Cause:'), (error as any).cause);
        }
        // Show details if available (custom errors)
        if ((error as any).details) {
          console.error(chalk.yellow('  Details:'), JSON.stringify((error as any).details, null, 2));
        }
      } else {
        console.error(chalk.red('  Error:'), error);
      }
    }
  }

  /**
   * Log error silently (file only, no console output)
   * Background tasks that should record errors for telemetry but not disrupt the UI
   * Also sends to Dashboard telemetry via callback
   */
  errorSilent(message: string, error?: Error | unknown): void {
    const jsonLogger = getJsonStreamLogger();
    if (jsonLogger?.isActive()) {
      jsonLogger.logError(error || new Error(message), this.prefix || 'logger');
    }

    // dashboard   (fire-and-forget)
    if (errorReportCallback) {
      const reportErr = error instanceof Error ? error : new Error(message);
      const ctx: Record<string, unknown> = { source: 'errorSilent', message };
      if (error && !(error instanceof Error)) {
        ctx['data'] = error; // plain object context 
      }
      errorReportCallback(reportErr, ctx);
    }
  }

  /**
   * Log warning
   */
  warn(message: string, data?: unknown): void {
    // Always log to file first (for Ctrl+O LogBrowser)
    const jsonLogger = getJsonStreamLogger();
    if (jsonLogger?.isActive()) {
      jsonLogger.logInfo(`[WARN] ${message}`, data);
    }

    // Console output controlled by log level
    if (this.level < LogLevel.WARN) return;

    const location = this.getCallLocation();
    const timestamp = this.getTimestamp();
    const prefix = this.getPrefix();
    const pid = this.getPid();
    const traceId = this.getTraceIdStr();
    const loc = this.getLocation(location);

    console.warn(
      timestamp,
      prefix,
      pid,
      traceId,
      loc,
      chalk.yellow('⚠️  WARN:'),
      message
    );

    if (data) {
      console.warn(chalk.yellow('  Data:'), JSON.stringify(data, null, 2));
    }
  }

  /**
   * Log info
   */
  info(message: string, data?: unknown): void {
    // Always log to file first (for Ctrl+O LogBrowser)
    const jsonLogger = getJsonStreamLogger();
    if (jsonLogger?.isActive()) {
      jsonLogger.logInfo(message, data);
    }

    // Console output controlled by log level
    if (this.level < LogLevel.INFO) return;

    const location = this.getCallLocation();
    const timestamp = this.getTimestamp();
    const prefix = this.getPrefix();
    const pid = this.getPid();
    const traceId = this.getTraceIdStr();
    const loc = this.getLocation(location);

    console.log(
      timestamp,
      prefix,
      pid,
      traceId,
      loc,
      chalk.blue('ℹ️  INFO:'),
      message
    );

    if (data) {
      console.log(chalk.blue('  Data:'), JSON.stringify(data, null, 2));
    }
  }

  /**
   * Log debug
   */
  debug(message: string, data?: unknown): void {
    // Always log to file first (for Ctrl+O LogBrowser)
    const jsonLogger = getJsonStreamLogger();
    if (jsonLogger?.isActive()) {
      jsonLogger.logDebug(message, data);
    }

    // Console output controlled by log level
    if (this.level < LogLevel.DEBUG) return;

    const location = this.getCallLocation();
    const timestamp = this.getTimestamp();
    const prefix = this.getPrefix();
    const pid = this.getPid();
    const traceId = this.getTraceIdStr();
    const loc = this.getLocation(location);

    console.log(
      timestamp,
      prefix,
      pid,
      traceId,
      loc,
      chalk.magenta('🐛 DEBUG:'),
      message
    );

    if (data) {
      console.log(chalk.magenta('  Data:'), JSON.stringify(data, null, 2));
    }
  }

  /**
   * Log verbose (most detailed)
   */
  verbose(message: string, data?: unknown): void {
    // Always log to file first (for Ctrl+O LogBrowser)
    const jsonLogger = getJsonStreamLogger();
    if (jsonLogger?.isActive()) {
      jsonLogger.logDebug(`[VERBOSE] ${message}`, data);
    }

    // Console output controlled by log level
    if (this.level < LogLevel.VERBOSE) return;

    const location = this.getCallLocation();
    const timestamp = this.getTimestamp();
    const prefix = this.getPrefix();
    const pid = this.getPid();
    const traceId = this.getTraceIdStr();
    const loc = this.getLocation(location);

    console.log(
      timestamp,
      prefix,
      pid,
      traceId,
      loc,
      chalk.gray('🔍 VERBOSE:'),
      message
    );

    if (data) {
      console.log(chalk.gray('  Data:'), JSON.stringify(data, null, 2));
    }
  }

  /**
   * Log flow -    ( ,  )
   */
  flow(message: string, context?: Record<string, unknown>): void {
    // Always log to file first (for Ctrl+O LogBrowser)
    const jsonLogger = getJsonStreamLogger();
    if (jsonLogger?.isActive()) {
      jsonLogger.logDebug(`[FLOW] ${message}`, context);
    }

    // Console output controlled by log level
    if (this.level < LogLevel.DEBUG) return;

    const location = this.getCallLocation();
    const timestamp = this.getTimestamp();
    const prefix = this.getPrefix();
    const pid = this.getPid();
    const traceId = this.getTraceIdStr();
    const loc = this.getLocation(location);

    console.log(
      timestamp,
      prefix,
      pid,
      traceId,
      loc,
      chalk.green('➜ FLOW:'),
      message
    );

    if (context) {
      console.log(chalk.green('  Context:'), JSON.stringify(context, null, 2));
    }
  }

  /**
   * Log variables -   
   */
  vars(...variables: VariableLog[]): void {
    // Always log to file first (for Ctrl+O LogBrowser)
    const jsonLogger = getJsonStreamLogger();
    if (jsonLogger?.isActive()) {
      const varsData = variables.reduce((acc, v) => {
        acc[v.name] = v.value;
        return acc;
      }, {} as Record<string, unknown>);
      jsonLogger.logDebug('[VARS]', varsData);
    }

    // Console output controlled by log level
    if (this.level < LogLevel.DEBUG) return;

    const location = this.getCallLocation();
    const timestamp = this.getTimestamp();
    const prefix = this.getPrefix();
    const pid = this.getPid();
    const traceId = this.getTraceIdStr();
    const loc = this.getLocation(location);

    console.log(
      timestamp,
      prefix,
      pid,
      traceId,
      loc,
      chalk.cyan('📦 VARS:')
    );

    variables.forEach(variable => {
      console.log('  ', this.formatVariable(variable));
    });
  }

  /**
   * Log function enter
   */
  enter(functionName: string, args?: Record<string, unknown>): void {
    // Always log to file first (for Ctrl+O LogBrowser)
    const jsonLogger = getJsonStreamLogger();
    if (jsonLogger?.isActive()) {
      jsonLogger.logDebug(`[ENTER] ${functionName}`, args);
    }

    // Console output controlled by log level
    if (this.level < LogLevel.DEBUG) return;

    const location = this.getCallLocation();
    const timestamp = this.getTimestamp();
    const prefix = this.getPrefix();
    const pid = this.getPid();
    const traceId = this.getTraceIdStr();
    const loc = this.getLocation(location);

    console.log(
      timestamp,
      prefix,
      pid,
      traceId,
      loc,
      chalk.green('↓ ENTER:'),
      chalk.bold(functionName)
    );

    if (args) {
      console.log(chalk.green('  Args:'), JSON.stringify(args, null, 2));
    }
  }

  /**
   * Log function exit
   */
  exit(functionName: string, result?: unknown): void {
    // Always log to file first (for Ctrl+O LogBrowser)
    const jsonLogger = getJsonStreamLogger();
    if (jsonLogger?.isActive()) {
      jsonLogger.logDebug(`[EXIT] ${functionName}`, { result });
    }

    // Console output controlled by log level
    if (this.level < LogLevel.DEBUG) return;

    const location = this.getCallLocation();
    const timestamp = this.getTimestamp();
    const prefix = this.getPrefix();
    const pid = this.getPid();
    const traceId = this.getTraceIdStr();
    const loc = this.getLocation(location);

    console.log(
      timestamp,
      prefix,
      pid,
      traceId,
      loc,
      chalk.green('↑ EXIT:'),
      chalk.bold(functionName)
    );

    if (result !== undefined) {
      console.log(chalk.green('  Result:'), this.formatValue(result));
    }
  }

  /**
   * Log state change
   */
  state(description: string, before: unknown, after: unknown): void {
    // Always log to file first (for Ctrl+O LogBrowser)
    const jsonLogger = getJsonStreamLogger();
    if (jsonLogger?.isActive()) {
      jsonLogger.logDebug(`[STATE] ${description}`, { before, after });
    }

    // Console output controlled by log level
    if (this.level < LogLevel.DEBUG) return;

    const location = this.getCallLocation();
    const timestamp = this.getTimestamp();
    const prefix = this.getPrefix();
    const pid = this.getPid();
    const traceId = this.getTraceIdStr();
    const loc = this.getLocation(location);

    console.log(
      timestamp,
      prefix,
      pid,
      traceId,
      loc,
      chalk.yellow('🔄 STATE:'),
      description
    );

    console.log(chalk.red('  Before:'), this.formatValue(before));
    console.log(chalk.green('  After:'), this.formatValue(after));
  }

  /**
   * Start performance timer
   */
  startTimer(label: string): void {
    // Always log to file first (for Ctrl+O LogBrowser)
    const jsonLogger = getJsonStreamLogger();
    if (jsonLogger?.isActive()) {
      jsonLogger.logDebug(`[TIMER] Start: ${label}`);
    }

    this.timers.set(label, Date.now());

    // Console output controlled by log level
    if (this.level >= LogLevel.DEBUG) {
      const location = this.getCallLocation();
      const timestamp = this.getTimestamp();
      const prefix = this.getPrefix();
      const pid = this.getPid();
      const traceId = this.getTraceIdStr();
      const loc = this.getLocation(location);

      console.log(
        timestamp,
        prefix,
        pid,
        traceId,
        loc,
        chalk.blue('⏱️  TIMER START:'),
        label
      );
    }
  }

  /**
   * End performance timer
   */
  endTimer(label: string): number {
    const startTime = this.timers.get(label);
    if (!startTime) {
      this.warn(`Timer "${label}" was not started`);
      return 0;
    }

    const elapsed = Date.now() - startTime;
    this.timers.delete(label);

    // Always log to file first (for Ctrl+O LogBrowser)
    const jsonLogger = getJsonStreamLogger();
    if (jsonLogger?.isActive()) {
      jsonLogger.logDebug(`[TIMER] End: ${label}`, { elapsed });
    }

    // Console output controlled by log level
    if (this.level >= LogLevel.DEBUG) {
      const location = this.getCallLocation();
      const timestamp = this.getTimestamp();
      const prefix = this.getPrefix();
      const pid = this.getPid();
      const traceId = this.getTraceIdStr();
      const loc = this.getLocation(location);

      console.log(
        timestamp,
        prefix,
        pid,
        traceId,
        loc,
        chalk.blue('⏱️  TIMER END:'),
        label,
        chalk.bold(`${elapsed}ms`)
      );
    }

    return elapsed;
  }

  /**
   * Log HTTP request
   */
  httpRequest(method: string, url: string, body?: unknown): void {
    // Always log to file first (for Ctrl+O LogBrowser)
    const jsonLogger = getJsonStreamLogger();
    if (jsonLogger?.isActive()) {
      jsonLogger.logDebug(`HTTP ${method} ${url}`, { body });
    }

    // Console output controlled by log level
    if (this.level < LogLevel.DEBUG) return;

    const location = this.getCallLocation();
    const timestamp = this.getTimestamp();
    const prefix = this.getPrefix();
    const pid = this.getPid();
    const traceId = this.getTraceIdStr();
    const loc = this.getLocation(location);

    console.log(
      timestamp,
      prefix,
      pid,
      traceId,
      loc,
      chalk.cyan('→ HTTP REQUEST:'),
      chalk.bold(method),
      url
    );

    if (body) {
      console.log(chalk.cyan('  Body:'), JSON.stringify(body, null, 2));
    }
  }

  /**
   * Log HTTP response
   */
  httpResponse(status: number, statusText: string, data?: unknown): void {
    // Always log to file first (for Ctrl+O LogBrowser)
    const jsonLogger = getJsonStreamLogger();
    if (jsonLogger?.isActive()) {
      jsonLogger.logDebug(`HTTP Response ${status} ${statusText}`, { status, statusText, data });
    }

    // Console output controlled by log level
    if (this.level < LogLevel.DEBUG) return;

    const location = this.getCallLocation();
    const timestamp = this.getTimestamp();
    const prefix = this.getPrefix();
    const pid = this.getPid();
    const traceId = this.getTraceIdStr();
    const loc = this.getLocation(location);
    const statusColor = status >= 400 ? chalk.red : status >= 300 ? chalk.yellow : chalk.green;

    console.log(
      timestamp,
      prefix,
      pid,
      traceId,
      loc,
      chalk.cyan('← HTTP RESPONSE:'),
      statusColor(`${status} ${statusText}`)
    );

    if (data && this.level >= LogLevel.VERBOSE) {
      console.log(chalk.cyan('  Data:'), JSON.stringify(data, null, 2));
    }
  }

  /**
   * Log tool execution
   */
  toolExecution(toolName: string, args: unknown, result?: unknown, error?: Error): void {
    // Always log to file first (for Ctrl+O LogBrowser)
    const jsonLogger = getJsonStreamLogger();
    if (jsonLogger?.isActive()) {
      jsonLogger.logToolCall(toolName, args, result, error);
    }

    // Console output controlled by log level
    if (this.level < LogLevel.DEBUG) return;

    const location = this.getCallLocation();
    const timestamp = this.getTimestamp();
    const prefix = this.getPrefix();
    const pid = this.getPid();
    const traceId = this.getTraceIdStr();
    const loc = this.getLocation(location);

    if (error) {
      console.log(
        timestamp,
        prefix,
        pid,
        traceId,
        loc,
        chalk.red('🔧 TOOL FAILED:'),
        chalk.bold(toolName)
      );
      console.log(chalk.red('  Args:'), JSON.stringify(args, null, 2));
      console.log(chalk.red('  Error:'), error.message);
    } else {
      console.log(
        timestamp,
        prefix,
        pid,
        traceId,
        loc,
        chalk.green('🔧 TOOL SUCCESS:'),
        chalk.bold(toolName)
      );
      console.log(chalk.green('  Args:'), JSON.stringify(args, null, 2));
      if (result && this.level >= LogLevel.VERBOSE) {
        console.log(chalk.green('  Result:'), JSON.stringify(result, null, 2));
      }
    }
  }

  /**
   * Log bash command execution with formatted display
   */
  bashExecution(formattedDisplay: string): void {
    // Always log to file first (for Ctrl+O LogBrowser)
    const jsonLogger = getJsonStreamLogger();
    if (jsonLogger?.isActive()) {
      jsonLogger.logDebug('[BASH] Execution', { output: formattedDisplay });
    }

    // Console output controlled by log level
    if (this.level < LogLevel.INFO) return;

    // Split formatted display into lines and colorize
    const lines = formattedDisplay.split('\n');
    lines.forEach((line) => {
      if (line.startsWith('●')) {
        // Command header in cyan
        console.log(chalk.cyan(line));
      } else if (line.includes('Error:')) {
        // Error lines in red
        console.log(chalk.red(line));
      } else {
        // Output lines in default color
        console.log(line);
      }
    });

    // Add blank line after output for better readability
    console.log();
  }

  /**
   * Log LLM request (--llm-log mode only)
   */
  llmRequest(messages: unknown[], model: string, tools?: unknown[]): void {
    // Always log to file first (for Ctrl+O LogBrowser)
    const jsonLogger = getJsonStreamLogger();
    if (jsonLogger?.isActive()) {
      const toolNamesList = Array.isArray(tools)
        ? tools.map((t: any) => t.function?.name || t.name || '?').filter(Boolean)
        : [];
      jsonLogger.logDebug('[LLM] Request', { model, messageCount: messages?.length, toolCount: tools?.length, toolNames: toolNamesList });
    }

    // Console output only in --llm-log mode
    if (!llmLogEnabled) return;

    const timestamp = this.getTimestamp();
    console.log();
    console.log(chalk.cyan('─'.repeat(80)));
    console.log(chalk.cyan.bold(`[${timestamp}] 📤 LLM REQUEST`));
    console.log(chalk.gray(`Model: ${model}`));
    if (tools && Array.isArray(tools) && tools.length > 0) {
      const toolNames = tools.map((t: any) => t.function?.name || t.name || '?').filter(Boolean);
      console.log(chalk.gray(`Tools (${tools.length}): ${toolNames.join(', ')}`));
    }
    console.log(chalk.cyan('─'.repeat(40)));

    // Show messages
    if (Array.isArray(messages)) {
      messages.forEach((msg: any, idx) => {
        const role = msg.role || 'unknown';
        const content = msg.content || '';
        const roleColor = role === 'user' ? chalk.green : role === 'assistant' ? chalk.blue : chalk.yellow;

        console.log(roleColor.bold(`[${role.toUpperCase()}]`));
        if (content) {
          // Truncate very long content
          const displayContent = content.length > 2000
            ? content.substring(0, 2000) + chalk.gray(`\n... (${content.length - 2000} more chars)`)
            : content;
          console.log(displayContent);
        }
        if (msg.tool_calls && msg.tool_calls.length > 0) {
          console.log(chalk.yellow(`  Tool calls: ${msg.tool_calls.map((tc: any) => tc.function?.name).join(', ')}`));
        }
        if (idx < messages.length - 1) console.log();
      });
    }
    console.log(chalk.cyan('─'.repeat(80)));
  }

  /**
   * Log LLM response (--llm-log mode only)
   */
  llmResponse(response: string, toolCalls?: unknown[]): void {
    // Always log to file first (for Ctrl+O LogBrowser)
    const jsonLogger = getJsonStreamLogger();
    if (jsonLogger?.isActive()) {
      jsonLogger.logDebug('[LLM] Response', { responseLength: response?.length, toolCallCount: toolCalls?.length });
    }

    // Console output only in --llm-log mode
    if (!llmLogEnabled) return;

    const timestamp = this.getTimestamp();
    console.log();
    console.log(chalk.green('─'.repeat(80)));
    console.log(chalk.green.bold(`[${timestamp}] 📥 LLM RESPONSE`));
    console.log(chalk.green('─'.repeat(40)));

    // Truncate very long response
    const displayResponse = response.length > 3000
      ? response.substring(0, 3000) + chalk.gray(`\n... (${response.length - 3000} more chars)`)
      : response;
    console.log(displayResponse);

    if (toolCalls && Array.isArray(toolCalls) && toolCalls.length > 0) {
      console.log();
      console.log(chalk.yellow.bold('Tool Calls:'));
      toolCalls.forEach((tc: any) => {
        console.log(chalk.yellow(`  - ${tc.function?.name}:`));
        // Pretty print full arguments JSON
        try {
          const args = JSON.parse(tc.function?.arguments || '{}');
          console.log(chalk.gray(JSON.stringify(args, null, 2)));
        } catch {
          console.log(chalk.gray(tc.function?.arguments || '(no arguments)'));
        }
      });
    }
    console.log(chalk.green('─'.repeat(80)));
  }

  /**
   * Log tool execution result (--llm-log mode only)
   */
  llmToolResult(toolName: string, result: string, success: boolean): void {
    // Always log to file first (for Ctrl+O LogBrowser)
    const jsonLogger = getJsonStreamLogger();
    if (jsonLogger?.isActive()) {
      jsonLogger.logDebug(`[LLM] Tool Result: ${toolName}`, { success, resultLength: result?.length });
    }

    // Console output only in --llm-log mode
    if (!llmLogEnabled) return;

    const timestamp = this.getTimestamp();
    const color = success ? chalk.cyan : chalk.red;
    console.log();
    console.log(color('─'.repeat(80)));
    console.log(color.bold(`[${timestamp}] 🔧 TOOL: ${toolName} ${success ? '✓' : '✗'}`));
    console.log(color('─'.repeat(40)));

    // Truncate very long result
    const displayResult = result.length > 1000
      ? result.substring(0, 1000) + chalk.gray(`\n... (${result.length - 1000} more chars)`)
      : result;
    console.log(displayResult);
    console.log(color('─'.repeat(80)));
  }

  // ============================================================================
  // HTTP Extended Methods
  // ============================================================================

  /**
   * Log HTTP error
   */
  httpError(url: string, error: Error | unknown): void {
    // Always log to file first (for Ctrl+O LogBrowser)
    const jsonLogger = getJsonStreamLogger();
    if (jsonLogger?.isActive()) {
      jsonLogger.logError(error instanceof Error ? error : new Error(String(error)), `HTTP ${url}`);
    }

    // Console output controlled by log level
    if (this.level < LogLevel.DEBUG) return;

    const location = this.getCallLocation();
    const timestamp = this.getTimestamp();
    const prefix = this.getPrefix();
    const pid = this.getPid();
    const traceId = this.getTraceIdStr();
    const loc = this.getLocation(location);

    console.log(
      timestamp,
      prefix,
      pid,
      traceId,
      loc,
      chalk.red('✗ HTTP ERROR:'),
      url
    );

    if (error instanceof Error) {
      console.log(chalk.red('  Message:'), error.message);
    } else {
      console.log(chalk.red('  Error:'), error);
    }
  }

  /**
   * Log HTTP stream start
   */
  httpStreamStart(method: string, url: string): void {
    // Always log to file first (for Ctrl+O LogBrowser)
    const jsonLogger = getJsonStreamLogger();
    if (jsonLogger?.isActive()) {
      jsonLogger.logDebug(`HTTP Stream Start: ${method} ${url}`);
    }

    // Console output controlled by log level
    if (this.level < LogLevel.DEBUG) return;

    const location = this.getCallLocation();
    const timestamp = this.getTimestamp();
    const prefix = this.getPrefix();
    const pid = this.getPid();
    const traceId = this.getTraceIdStr();
    const loc = this.getLocation(location);

    console.log(
      timestamp,
      prefix,
      pid,
      traceId,
      loc,
      chalk.cyan('⇢ HTTP STREAM START:'),
      chalk.bold(method),
      url
    );
  }

  /**
   * Log HTTP stream chunk
   */
  httpStreamChunk(data: unknown): void {
    // Always log to file first (for Ctrl+O LogBrowser)
    const chunkSize = typeof data === 'string' ? data.length : JSON.stringify(data).length;
    const jsonLogger = getJsonStreamLogger();
    if (jsonLogger?.isActive()) {
      jsonLogger.logDebug('[HTTP] Stream Chunk', { bytes: chunkSize });
    }

    // Console output controlled by log level
    if (this.level < LogLevel.VERBOSE) return;

    const location = this.getCallLocation();
    const timestamp = this.getTimestamp();
    const prefix = this.getPrefix();
    const pid = this.getPid();
    const traceId = this.getTraceIdStr();
    const loc = this.getLocation(location);

    console.log(
      timestamp,
      prefix,
      pid,
      traceId,
      loc,
      chalk.gray('⇨ HTTP STREAM CHUNK:'),
      `${chunkSize} bytes`
    );
  }

  /**
   * Log HTTP stream end
   */
  httpStreamEnd(totalBytes: number, duration: number): void {
    // Always log to file first (for Ctrl+O LogBrowser)
    const jsonLogger = getJsonStreamLogger();
    if (jsonLogger?.isActive()) {
      jsonLogger.logDebug(`HTTP Stream End`, { totalBytes, duration });
    }

    // Console output controlled by log level
    if (this.level < LogLevel.DEBUG) return;

    const location = this.getCallLocation();
    const timestamp = this.getTimestamp();
    const prefix = this.getPrefix();
    const pid = this.getPid();
    const traceId = this.getTraceIdStr();
    const loc = this.getLocation(location);

    console.log(
      timestamp,
      prefix,
      pid,
      traceId,
      loc,
      chalk.cyan('⇠ HTTP STREAM END:'),
      `${totalBytes} bytes in ${duration}ms`
    );
  }

  // ============================================================================
  // Tool Individual Methods
  // ============================================================================

  /**
   * Log tool start
   */
  toolStart(name: string, args: unknown, reason?: string): void {
    // Always log to file first (for Ctrl+O LogBrowser)
    const jsonLogger = getJsonStreamLogger();
    if (jsonLogger?.isActive()) {
      jsonLogger.logToolStart(name, args, reason);
    }

    // Console output controlled by log level
    if (this.level < LogLevel.DEBUG) return;

    const location = this.getCallLocation();
    const timestamp = this.getTimestamp();
    const prefix = this.getPrefix();
    const pid = this.getPid();
    const traceId = this.getTraceIdStr();
    const loc = this.getLocation(location);

    console.log(
      timestamp,
      prefix,
      pid,
      traceId,
      loc,
      chalk.blue('🔧 TOOL START:'),
      chalk.bold(name)
    );
    if (reason) {
      console.log(chalk.blue('  Reason:'), reason);
    }
    if (args && this.level >= LogLevel.VERBOSE) {
      console.log(chalk.blue('  Args:'), JSON.stringify(args, null, 2));
    }
  }

  /**
   * Log tool success
   */
  toolSuccess(name: string, _args: unknown, result: unknown, duration: number): void {
    // Always log to file first (for Ctrl+O LogBrowser)
    const jsonLogger = getJsonStreamLogger();
    if (jsonLogger?.isActive()) {
      jsonLogger.logToolEnd(name, true, result, undefined, duration);
    }

    // Console output controlled by log level
    if (this.level < LogLevel.DEBUG) return;

    const location = this.getCallLocation();
    const timestamp = this.getTimestamp();
    const prefix = this.getPrefix();
    const pid = this.getPid();
    const traceId = this.getTraceIdStr();
    const loc = this.getLocation(location);

    console.log(
      timestamp,
      prefix,
      pid,
      traceId,
      loc,
      chalk.green('✓ TOOL SUCCESS:'),
      chalk.bold(name),
      chalk.dim(`(${duration}ms)`)
    );
    if (result && this.level >= LogLevel.VERBOSE) {
      console.log(chalk.green('  Result:'), this.formatValue(result));
    }
  }

  /**
   * Log tool error
   */
  toolError(name: string, args: unknown, error: Error, duration: number): void {
    // Always log to file first (for Ctrl+O LogBrowser)
    const jsonLogger = getJsonStreamLogger();
    if (jsonLogger?.isActive()) {
      jsonLogger.logToolEnd(name, false, undefined, error.message, duration);
    }

    // Console output controlled by log level
    if (this.level < LogLevel.ERROR) return;

    const location = this.getCallLocation();
    const timestamp = this.getTimestamp();
    const prefix = this.getPrefix();
    const pid = this.getPid();
    const traceId = this.getTraceIdStr();
    const loc = this.getLocation(location);

    console.log(
      timestamp,
      prefix,
      pid,
      traceId,
      loc,
      chalk.red('✗ TOOL ERROR:'),
      chalk.bold(name),
      chalk.dim(`(${duration}ms)`)
    );
    console.log(chalk.red('  Error:'), error.message);
    if (args) {
      console.log(chalk.red('  Args:'), JSON.stringify(args, null, 2));
    }
  }

  // ============================================================================
  // UI/UX Interaction Methods
  // ============================================================================

  /**
   * Log user click event
   */
  userClick(element: string, context: Record<string, unknown>): void {
    // Always log to file first (for Ctrl+O LogBrowser)
    const jsonLogger = getJsonStreamLogger();
    if (jsonLogger?.isActive()) {
      jsonLogger.logDebug(`[UI] User Click: ${element}`, context);
    }

    // Console output controlled by log level
    if (this.level < LogLevel.DEBUG) return;

    const location = this.getCallLocation();
    const timestamp = this.getTimestamp();
    const prefix = this.getPrefix();
    const loc = this.getLocation(location);

    console.log(timestamp, prefix, loc, chalk.yellow('👆 USER CLICK:'), element);
    if (Object.keys(context).length > 0) {
      console.log(chalk.yellow('  Context:'), JSON.stringify(context, null, 2));
    }
  }

  /**
   * Log user keyboard event
   */
  userKeyboard(type: string, context: Record<string, unknown>): void {
    // Always log to file first (for Ctrl+O LogBrowser)
    const jsonLogger = getJsonStreamLogger();
    if (jsonLogger?.isActive()) {
      jsonLogger.logDebug(`[UI] User Keyboard: ${type}`, context);
    }

    // Console output controlled by log level
    if (this.level < LogLevel.DEBUG) return;

    const location = this.getCallLocation();
    const timestamp = this.getTimestamp();
    const prefix = this.getPrefix();
    const loc = this.getLocation(location);

    console.log(timestamp, prefix, loc, chalk.yellow('⌨️  USER KEYBOARD:'), type);
    if (Object.keys(context).length > 0) {
      console.log(chalk.yellow('  Context:'), JSON.stringify(context, null, 2));
    }
  }

  /**
   * Log user scroll event
   */
  userScroll(context: Record<string, unknown>): void {
    // Always log to file first (for Ctrl+O LogBrowser)
    const jsonLogger = getJsonStreamLogger();
    if (jsonLogger?.isActive()) {
      jsonLogger.logDebug('[UI] User Scroll', context);
    }

    // Console output controlled by log level
    if (this.level < LogLevel.VERBOSE) return;

    const location = this.getCallLocation();
    const timestamp = this.getTimestamp();
    const prefix = this.getPrefix();
    const loc = this.getLocation(location);

    console.log(timestamp, prefix, loc, chalk.gray('📜 USER SCROLL'));
    if (Object.keys(context).length > 0) {
      console.log(chalk.gray('  Context:'), JSON.stringify(context, null, 2));
    }
  }

  /**
   * Log user drag start
   */
  userDragStart(element: string, context: Record<string, unknown>): void {
    // Always log to file first (for Ctrl+O LogBrowser)
    const jsonLogger = getJsonStreamLogger();
    if (jsonLogger?.isActive()) {
      jsonLogger.logDebug(`[UI] User Drag Start: ${element}`, context);
    }

    // Console output controlled by log level
    if (this.level < LogLevel.DEBUG) return;

    const location = this.getCallLocation();
    const timestamp = this.getTimestamp();
    const prefix = this.getPrefix();
    const loc = this.getLocation(location);

    console.log(timestamp, prefix, loc, chalk.yellow('🖱️  USER DRAG START:'), element);
    if (Object.keys(context).length > 0) {
      console.log(chalk.yellow('  Context:'), JSON.stringify(context, null, 2));
    }
  }

  /**
   * Log user drag end
   */
  userDragEnd(element: string, context: Record<string, unknown>): void {
    // Always log to file first (for Ctrl+O LogBrowser)
    const jsonLogger = getJsonStreamLogger();
    if (jsonLogger?.isActive()) {
      jsonLogger.logDebug(`[UI] User Drag End: ${element}`, context);
    }

    // Console output controlled by log level
    if (this.level < LogLevel.DEBUG) return;

    const location = this.getCallLocation();
    const timestamp = this.getTimestamp();
    const prefix = this.getPrefix();
    const loc = this.getLocation(location);

    console.log(timestamp, prefix, loc, chalk.yellow('🖱️  USER DRAG END:'), element);
    if (Object.keys(context).length > 0) {
      console.log(chalk.yellow('  Context:'), JSON.stringify(context, null, 2));
    }
  }

  // ============================================================================
  // Component Lifecycle Methods
  // ============================================================================

  /**
   * Log component mount
   */
  componentMount(name: string, context: Record<string, unknown>): void {
    // Always log to file first (for Ctrl+O LogBrowser)
    const jsonLogger = getJsonStreamLogger();
    if (jsonLogger?.isActive()) {
      jsonLogger.logDebug(`[COMPONENT] Mount: ${name}`, context);
    }

    // Console output controlled by log level
    if (this.level < LogLevel.DEBUG) return;

    const location = this.getCallLocation();
    const timestamp = this.getTimestamp();
    const prefix = this.getPrefix();
    const loc = this.getLocation(location);

    console.log(timestamp, prefix, loc, chalk.green('📦 COMPONENT MOUNT:'), name);
    if (Object.keys(context).length > 0) {
      console.log(chalk.green('  Context:'), JSON.stringify(context, null, 2));
    }
  }

  /**
   * Log component unmount
   */
  componentUnmount(name: string, context: Record<string, unknown>): void {
    // Always log to file first (for Ctrl+O LogBrowser)
    const jsonLogger = getJsonStreamLogger();
    if (jsonLogger?.isActive()) {
      jsonLogger.logDebug(`[COMPONENT] Unmount: ${name}`, context);
    }

    // Console output controlled by log level
    if (this.level < LogLevel.DEBUG) return;

    const location = this.getCallLocation();
    const timestamp = this.getTimestamp();
    const prefix = this.getPrefix();
    const loc = this.getLocation(location);

    console.log(timestamp, prefix, loc, chalk.red('📦 COMPONENT UNMOUNT:'), name);
    if (Object.keys(context).length > 0) {
      console.log(chalk.red('  Context:'), JSON.stringify(context, null, 2));
    }
  }

  /**
   * Log component render
   */
  componentRender(name: string, context: Record<string, unknown>): void {
    // Always log to file first (for Ctrl+O LogBrowser)
    const jsonLogger = getJsonStreamLogger();
    if (jsonLogger?.isActive()) {
      jsonLogger.logDebug(`[COMPONENT] Render: ${name}`, context);
    }

    // Console output controlled by log level
    if (this.level < LogLevel.VERBOSE) return;

    const location = this.getCallLocation();
    const timestamp = this.getTimestamp();
    const prefix = this.getPrefix();
    const loc = this.getLocation(location);

    console.log(timestamp, prefix, loc, chalk.blue('📦 COMPONENT RENDER:'), name);
    if (Object.keys(context).length > 0) {
      console.log(chalk.blue('  Context:'), JSON.stringify(context, null, 2));
    }
  }

  /**
   * Log component render complete
   */
  componentRenderComplete(name: string, context: Record<string, unknown>): void {
    // Always log to file first (for Ctrl+O LogBrowser)
    const jsonLogger = getJsonStreamLogger();
    if (jsonLogger?.isActive()) {
      jsonLogger.logDebug(`[COMPONENT] Render Complete: ${name}`, context);
    }

    // Console output controlled by log level
    if (this.level < LogLevel.VERBOSE) return;

    const location = this.getCallLocation();
    const timestamp = this.getTimestamp();
    const prefix = this.getPrefix();
    const loc = this.getLocation(location);

    console.log(timestamp, prefix, loc, chalk.green('✓ COMPONENT RENDER COMPLETE:'), name);
    if (Object.keys(context).length > 0) {
      console.log(chalk.green('  Context:'), JSON.stringify(context, null, 2));
    }
  }

  /**
   * Log component state change
   */
  componentStateChange(name: string, field: string, context: Record<string, unknown>): void {
    // Always log to file first (for Ctrl+O LogBrowser)
    const jsonLogger = getJsonStreamLogger();
    if (jsonLogger?.isActive()) {
      jsonLogger.logDebug(`[COMPONENT] State Change: ${name}.${field}`, context);
    }

    // Console output controlled by log level
    if (this.level < LogLevel.DEBUG) return;

    const location = this.getCallLocation();
    const timestamp = this.getTimestamp();
    const prefix = this.getPrefix();
    const loc = this.getLocation(location);

    console.log(timestamp, prefix, loc, chalk.yellow('🔄 COMPONENT STATE:'), `${name}.${field}`);
    if (Object.keys(context).length > 0) {
      console.log(chalk.yellow('  Context:'), JSON.stringify(context, null, 2));
    }
  }

  // ============================================================================
  // Screen/Navigation Methods
  // ============================================================================

  /**
   * Log screen change
   */
  screenChange(to: string, context: Record<string, unknown>): void {
    // Always log to file first (for Ctrl+O LogBrowser)
    const jsonLogger = getJsonStreamLogger();
    if (jsonLogger?.isActive()) {
      jsonLogger.logDebug(`[SCREEN] Change: ${to}`, context);
    }

    // Console output controlled by log level
    if (this.level < LogLevel.DEBUG) return;

    const location = this.getCallLocation();
    const timestamp = this.getTimestamp();
    const prefix = this.getPrefix();
    const loc = this.getLocation(location);

    console.log(timestamp, prefix, loc, chalk.magenta('📱 SCREEN CHANGE:'), to);
    if (Object.keys(context).length > 0) {
      console.log(chalk.magenta('  Context:'), JSON.stringify(context, null, 2));
    }
  }

  /**
   * Log tab change
   */
  tabChange(container: string, context: Record<string, unknown>): void {
    // Always log to file first (for Ctrl+O LogBrowser)
    const jsonLogger = getJsonStreamLogger();
    if (jsonLogger?.isActive()) {
      jsonLogger.logDebug(`[TAB] Change: ${container}`, context);
    }

    // Console output controlled by log level
    if (this.level < LogLevel.DEBUG) return;

    const location = this.getCallLocation();
    const timestamp = this.getTimestamp();
    const prefix = this.getPrefix();
    const loc = this.getLocation(location);

    console.log(timestamp, prefix, loc, chalk.magenta('🗂️  TAB CHANGE:'), container);
    if (Object.keys(context).length > 0) {
      console.log(chalk.magenta('  Context:'), JSON.stringify(context, null, 2));
    }
  }

  /**
   * Log route change
   */
  routeChange(context: Record<string, unknown>): void {
    // Always log to file first (for Ctrl+O LogBrowser)
    const jsonLogger = getJsonStreamLogger();
    if (jsonLogger?.isActive()) {
      jsonLogger.logDebug(`[ROUTE] Change`, context);
    }

    // Console output controlled by log level
    if (this.level < LogLevel.DEBUG) return;

    const location = this.getCallLocation();
    const timestamp = this.getTimestamp();
    const prefix = this.getPrefix();
    const loc = this.getLocation(location);

    console.log(timestamp, prefix, loc, chalk.magenta('🛤️  ROUTE CHANGE'));
    if (Object.keys(context).length > 0) {
      console.log(chalk.magenta('  Context:'), JSON.stringify(context, null, 2));
    }
  }

  // ============================================================================
  // Form Methods
  // ============================================================================

  /**
   * Log form start
   */
  formStart(formId: string, context: Record<string, unknown>): void {
    // Always log to file first (for Ctrl+O LogBrowser)
    const jsonLogger = getJsonStreamLogger();
    if (jsonLogger?.isActive()) {
      jsonLogger.logDebug(`[FORM] Start: ${formId}`, context);
    }

    // Console output controlled by log level
    if (this.level < LogLevel.DEBUG) return;

    const location = this.getCallLocation();
    const timestamp = this.getTimestamp();
    const prefix = this.getPrefix();
    const loc = this.getLocation(location);

    console.log(timestamp, prefix, loc, chalk.blue('📝 FORM START:'), formId);
    if (Object.keys(context).length > 0) {
      console.log(chalk.blue('  Context:'), JSON.stringify(context, null, 2));
    }
  }

  /**
   * Log form submit
   */
  formSubmit(formId: string, context: Record<string, unknown>): void {
    // Always log to file first (for Ctrl+O LogBrowser)
    const jsonLogger = getJsonStreamLogger();
    if (jsonLogger?.isActive()) {
      jsonLogger.logDebug(`[FORM] Submit: ${formId}`, context);
    }

    // Console output controlled by log level
    if (this.level < LogLevel.DEBUG) return;

    const location = this.getCallLocation();
    const timestamp = this.getTimestamp();
    const prefix = this.getPrefix();
    const loc = this.getLocation(location);

    console.log(timestamp, prefix, loc, chalk.blue('📤 FORM SUBMIT:'), formId);
    if (Object.keys(context).length > 0) {
      console.log(chalk.blue('  Context:'), JSON.stringify(context, null, 2));
    }
  }

  /**
   * Log form result
   */
  formResult(formId: string, context: Record<string, unknown>): void {
    // Always log to file first (for Ctrl+O LogBrowser)
    const jsonLogger = getJsonStreamLogger();
    if (jsonLogger?.isActive()) {
      jsonLogger.logDebug(`[FORM] Result: ${formId}`, context);
    }

    // Console output controlled by log level
    if (this.level < LogLevel.DEBUG) return;

    const location = this.getCallLocation();
    const timestamp = this.getTimestamp();
    const prefix = this.getPrefix();
    const loc = this.getLocation(location);

    console.log(timestamp, prefix, loc, chalk.green('✓ FORM RESULT:'), formId);
    if (Object.keys(context).length > 0) {
      console.log(chalk.green('  Context:'), JSON.stringify(context, null, 2));
    }
  }

  /**
   * Log form error
   */
  formError(formId: string, context: Record<string, unknown>): void {
    // Always log to file first (for Ctrl+O LogBrowser)
    const jsonLogger = getJsonStreamLogger();
    if (jsonLogger?.isActive()) {
      jsonLogger.logDebug(`[FORM] Error: ${formId}`, context);
    }

    // Console output controlled by log level
    if (this.level < LogLevel.DEBUG) return;

    const location = this.getCallLocation();
    const timestamp = this.getTimestamp();
    const prefix = this.getPrefix();
    const loc = this.getLocation(location);

    console.log(timestamp, prefix, loc, chalk.red('✗ FORM ERROR:'), formId);
    if (Object.keys(context).length > 0) {
      console.log(chalk.red('  Context:'), JSON.stringify(context, null, 2));
    }
  }

  /**
   * Log field change
   */
  fieldChange(formId: string, field: string, context: Record<string, unknown>): void {
    // Always log to file first (for Ctrl+O LogBrowser)
    const jsonLogger = getJsonStreamLogger();
    if (jsonLogger?.isActive()) {
      jsonLogger.logDebug(`[FORM] Field Change: ${formId}.${field}`, context);
    }

    // Console output controlled by log level
    if (this.level < LogLevel.VERBOSE) return;

    const location = this.getCallLocation();
    const timestamp = this.getTimestamp();
    const prefix = this.getPrefix();
    const loc = this.getLocation(location);

    console.log(timestamp, prefix, loc, chalk.gray('📝 FIELD CHANGE:'), `${formId}.${field}`);
    if (Object.keys(context).length > 0) {
      console.log(chalk.gray('  Context:'), JSON.stringify(context, null, 2));
    }
  }

  /**
   * Log field validation
   */
  fieldValidation(formId: string, field: string, context: Record<string, unknown>): void {
    // Always log to file first (for Ctrl+O LogBrowser)
    const jsonLogger = getJsonStreamLogger();
    if (jsonLogger?.isActive()) {
      jsonLogger.logDebug(`[FORM] Field Validation: ${formId}.${field}`, context);
    }

    // Console output controlled by log level
    if (this.level < LogLevel.DEBUG) return;

    const location = this.getCallLocation();
    const timestamp = this.getTimestamp();
    const prefix = this.getPrefix();
    const loc = this.getLocation(location);

    console.log(timestamp, prefix, loc, chalk.yellow('✓ FIELD VALIDATION:'), `${formId}.${field}`);
    if (Object.keys(context).length > 0) {
      console.log(chalk.yellow('  Context:'), JSON.stringify(context, null, 2));
    }
  }

  // ============================================================================
  // Modal/Dialog Methods
  // ============================================================================

  /**
   * Log modal open
   */
  modalOpen(id: string, context: Record<string, unknown>): void {
    // Always log to file first (for Ctrl+O LogBrowser)
    const jsonLogger = getJsonStreamLogger();
    if (jsonLogger?.isActive()) {
      jsonLogger.logDebug(`[MODAL] Open: ${id}`, context);
    }

    // Console output controlled by log level
    if (this.level < LogLevel.DEBUG) return;

    const location = this.getCallLocation();
    const timestamp = this.getTimestamp();
    const prefix = this.getPrefix();
    const loc = this.getLocation(location);

    console.log(timestamp, prefix, loc, chalk.cyan('📭 MODAL OPEN:'), id);
    if (Object.keys(context).length > 0) {
      console.log(chalk.cyan('  Context:'), JSON.stringify(context, null, 2));
    }
  }

  /**
   * Log modal close
   */
  modalClose(id: string, context: Record<string, unknown>): void {
    // Always log to file first (for Ctrl+O LogBrowser)
    const jsonLogger = getJsonStreamLogger();
    if (jsonLogger?.isActive()) {
      jsonLogger.logDebug(`[MODAL] Close: ${id}`, context);
    }

    // Console output controlled by log level
    if (this.level < LogLevel.DEBUG) return;

    const location = this.getCallLocation();
    const timestamp = this.getTimestamp();
    const prefix = this.getPrefix();
    const loc = this.getLocation(location);

    console.log(timestamp, prefix, loc, chalk.cyan('📪 MODAL CLOSE:'), id);
    if (Object.keys(context).length > 0) {
      console.log(chalk.cyan('  Context:'), JSON.stringify(context, null, 2));
    }
  }

  /**
   * Log dialog show
   */
  dialogShow(type: string, context: Record<string, unknown>): void {
    // Always log to file first (for Ctrl+O LogBrowser)
    const jsonLogger = getJsonStreamLogger();
    if (jsonLogger?.isActive()) {
      jsonLogger.logDebug(`[DIALOG] Show: ${type}`, context);
    }

    // Console output controlled by log level
    if (this.level < LogLevel.DEBUG) return;

    const location = this.getCallLocation();
    const timestamp = this.getTimestamp();
    const prefix = this.getPrefix();
    const loc = this.getLocation(location);

    console.log(timestamp, prefix, loc, chalk.cyan('💬 DIALOG SHOW:'), type);
    if (Object.keys(context).length > 0) {
      console.log(chalk.cyan('  Context:'), JSON.stringify(context, null, 2));
    }
  }

  /**
   * Log dialog result
   */
  dialogResult(type: string, context: Record<string, unknown>): void {
    // Always log to file first (for Ctrl+O LogBrowser)
    const jsonLogger = getJsonStreamLogger();
    if (jsonLogger?.isActive()) {
      jsonLogger.logDebug(`[DIALOG] Result: ${type}`, context);
    }

    // Console output controlled by log level
    if (this.level < LogLevel.DEBUG) return;

    const location = this.getCallLocation();
    const timestamp = this.getTimestamp();
    const prefix = this.getPrefix();
    const loc = this.getLocation(location);

    console.log(timestamp, prefix, loc, chalk.cyan('💬 DIALOG RESULT:'), type);
    if (Object.keys(context).length > 0) {
      console.log(chalk.cyan('  Context:'), JSON.stringify(context, null, 2));
    }
  }

  /**
   * Log toast show
   */
  toastShow(context: Record<string, unknown>): void {
    // Always log to file first (for Ctrl+O LogBrowser)
    const jsonLogger = getJsonStreamLogger();
    if (jsonLogger?.isActive()) {
      jsonLogger.logDebug(`[TOAST] Show`, context);
    }

    // Console output controlled by log level
    if (this.level < LogLevel.DEBUG) return;

    const location = this.getCallLocation();
    const timestamp = this.getTimestamp();
    const prefix = this.getPrefix();
    const loc = this.getLocation(location);

    console.log(timestamp, prefix, loc, chalk.yellow('🔔 TOAST SHOW'));
    if (Object.keys(context).length > 0) {
      console.log(chalk.yellow('  Context:'), JSON.stringify(context, null, 2));
    }
  }

  /**
   * Log toast dismiss
   */
  toastDismiss(context: Record<string, unknown>): void {
    // Always log to file first (for Ctrl+O LogBrowser)
    const jsonLogger = getJsonStreamLogger();
    if (jsonLogger?.isActive()) {
      jsonLogger.logDebug(`[TOAST] Dismiss`, context);
    }

    // Console output controlled by log level
    if (this.level < LogLevel.DEBUG) return;

    const location = this.getCallLocation();
    const timestamp = this.getTimestamp();
    const prefix = this.getPrefix();
    const loc = this.getLocation(location);

    console.log(timestamp, prefix, loc, chalk.gray('🔕 TOAST DISMISS'));
    if (Object.keys(context).length > 0) {
      console.log(chalk.gray('  Context:'), JSON.stringify(context, null, 2));
    }
  }

  // ============================================================================
  // Loading Methods
  // ============================================================================

  /**
   * Log loading start
   */
  loadingStart(id: string, context: Record<string, unknown>): void {
    // Always log to file first (for Ctrl+O LogBrowser)
    const jsonLogger = getJsonStreamLogger();
    if (jsonLogger?.isActive()) {
      jsonLogger.logDebug(`[LOADING] Start: ${id}`, context);
    }

    // Console output controlled by log level
    if (this.level < LogLevel.DEBUG) return;

    const location = this.getCallLocation();
    const timestamp = this.getTimestamp();
    const prefix = this.getPrefix();
    const loc = this.getLocation(location);

    console.log(timestamp, prefix, loc, chalk.blue('⏳ LOADING START:'), id);
    if (Object.keys(context).length > 0) {
      console.log(chalk.blue('  Context:'), JSON.stringify(context, null, 2));
    }
  }

  /**
   * Log loading end
   */
  loadingEnd(id: string, context: Record<string, unknown>): void {
    // Always log to file first (for Ctrl+O LogBrowser)
    const jsonLogger = getJsonStreamLogger();
    if (jsonLogger?.isActive()) {
      jsonLogger.logDebug(`[LOADING] End: ${id}`, context);
    }

    // Console output controlled by log level
    if (this.level < LogLevel.DEBUG) return;

    const location = this.getCallLocation();
    const timestamp = this.getTimestamp();
    const prefix = this.getPrefix();
    const loc = this.getLocation(location);

    console.log(timestamp, prefix, loc, chalk.green('✓ LOADING END:'), id);
    if (Object.keys(context).length > 0) {
      console.log(chalk.green('  Context:'), JSON.stringify(context, null, 2));
    }
  }

  /**
   * Log loading error
   */
  loadingError(id: string, context: Record<string, unknown>): void {
    // Always log to file first (for Ctrl+O LogBrowser)
    const jsonLogger = getJsonStreamLogger();
    if (jsonLogger?.isActive()) {
      jsonLogger.logDebug(`[LOADING] Error: ${id}`, context);
    }

    // Console output controlled by log level
    if (this.level < LogLevel.DEBUG) return;

    const location = this.getCallLocation();
    const timestamp = this.getTimestamp();
    const prefix = this.getPrefix();
    const loc = this.getLocation(location);

    console.log(timestamp, prefix, loc, chalk.red('✗ LOADING ERROR:'), id);
    if (Object.keys(context).length > 0) {
      console.log(chalk.red('  Context:'), JSON.stringify(context, null, 2));
    }
  }

  /**
   * Log skeleton show
   */
  skeletonShow(id: string, context: Record<string, unknown>): void {
    // Always log to file first (for Ctrl+O LogBrowser)
    const jsonLogger = getJsonStreamLogger();
    if (jsonLogger?.isActive()) {
      jsonLogger.logDebug(`[UI] Skeleton Show: ${id}`, context);
    }

    // Console output controlled by log level
    if (this.level < LogLevel.VERBOSE) return;

    const location = this.getCallLocation();
    const timestamp = this.getTimestamp();
    const prefix = this.getPrefix();
    const loc = this.getLocation(location);

    console.log(timestamp, prefix, loc, chalk.gray('💀 SKELETON SHOW:'), id);
    if (Object.keys(context).length > 0) {
      console.log(chalk.gray('  Context:'), JSON.stringify(context, null, 2));
    }
  }

  /**
   * Log skeleton hide
   */
  skeletonHide(id: string, context: Record<string, unknown>): void {
    // Always log to file first (for Ctrl+O LogBrowser)
    const jsonLogger = getJsonStreamLogger();
    if (jsonLogger?.isActive()) {
      jsonLogger.logDebug(`[UI] Skeleton Hide: ${id}`, context);
    }

    // Console output controlled by log level
    if (this.level < LogLevel.VERBOSE) return;

    const location = this.getCallLocation();
    const timestamp = this.getTimestamp();
    const prefix = this.getPrefix();
    const loc = this.getLocation(location);

    console.log(timestamp, prefix, loc, chalk.gray('💀 SKELETON HIDE:'), id);
    if (Object.keys(context).length > 0) {
      console.log(chalk.gray('  Context:'), JSON.stringify(context, null, 2));
    }
  }

  /**
   * Log progress start
   */
  progressStart(id: string, context: Record<string, unknown>): void {
    // Always log to file first (for Ctrl+O LogBrowser)
    const jsonLogger = getJsonStreamLogger();
    if (jsonLogger?.isActive()) {
      jsonLogger.logDebug(`[PROGRESS] Start: ${id}`, context);
    }

    // Console output controlled by log level
    if (this.level < LogLevel.DEBUG) return;

    const location = this.getCallLocation();
    const timestamp = this.getTimestamp();
    const prefix = this.getPrefix();
    const loc = this.getLocation(location);

    console.log(timestamp, prefix, loc, chalk.blue('📊 PROGRESS START:'), id);
    if (Object.keys(context).length > 0) {
      console.log(chalk.blue('  Context:'), JSON.stringify(context, null, 2));
    }
  }

  /**
   * Log progress update
   */
  progressUpdate(id: string, context: Record<string, unknown>): void {
    // Always log to file first (for Ctrl+O LogBrowser)
    const jsonLogger = getJsonStreamLogger();
    if (jsonLogger?.isActive()) {
      jsonLogger.logDebug(`[PROGRESS] Update: ${id}`, context);
    }

    // Console output controlled by log level
    if (this.level < LogLevel.VERBOSE) return;

    const location = this.getCallLocation();
    const timestamp = this.getTimestamp();
    const prefix = this.getPrefix();
    const loc = this.getLocation(location);

    console.log(timestamp, prefix, loc, chalk.blue('📊 PROGRESS UPDATE:'), id);
    if (Object.keys(context).length > 0) {
      console.log(chalk.blue('  Context:'), JSON.stringify(context, null, 2));
    }
  }

  /**
   * Log progress complete
   */
  progressComplete(id: string, context: Record<string, unknown>): void {
    // Always log to file first (for Ctrl+O LogBrowser)
    const jsonLogger = getJsonStreamLogger();
    if (jsonLogger?.isActive()) {
      jsonLogger.logDebug(`[PROGRESS] Complete: ${id}`, context);
    }

    // Console output controlled by log level
    if (this.level < LogLevel.DEBUG) return;

    const location = this.getCallLocation();
    const timestamp = this.getTimestamp();
    const prefix = this.getPrefix();
    const loc = this.getLocation(location);

    console.log(timestamp, prefix, loc, chalk.green('✓ PROGRESS COMPLETE:'), id);
    if (Object.keys(context).length > 0) {
      console.log(chalk.green('  Context:'), JSON.stringify(context, null, 2));
    }
  }

  /**
   * Log progress error
   */
  progressError(id: string, context: Record<string, unknown>): void {
    // Always log to file first (for Ctrl+O LogBrowser)
    const jsonLogger = getJsonStreamLogger();
    if (jsonLogger?.isActive()) {
      jsonLogger.logDebug(`[PROGRESS] Error: ${id}`, context);
    }

    // Console output controlled by log level
    if (this.level < LogLevel.DEBUG) return;

    const location = this.getCallLocation();
    const timestamp = this.getTimestamp();
    const prefix = this.getPrefix();
    const loc = this.getLocation(location);

    console.log(timestamp, prefix, loc, chalk.red('✗ PROGRESS ERROR:'), id);
    if (Object.keys(context).length > 0) {
      console.log(chalk.red('  Context:'), JSON.stringify(context, null, 2));
    }
  }

  // ============================================================================
  // Animation Methods
  // ============================================================================

  /**
   * Log animation start
   */
  animationStart(name: string, context: Record<string, unknown>): void {
    // Always log to file first (for Ctrl+O LogBrowser)
    const jsonLogger = getJsonStreamLogger();
    if (jsonLogger?.isActive()) {
      jsonLogger.logDebug(`[UI] Animation Start: ${name}`, context);
    }

    // Console output controlled by log level
    if (this.level < LogLevel.VERBOSE) return;

    const location = this.getCallLocation();
    const timestamp = this.getTimestamp();
    const prefix = this.getPrefix();
    const loc = this.getLocation(location);

    console.log(timestamp, prefix, loc, chalk.magenta('🎬 ANIMATION START:'), name);
    if (Object.keys(context).length > 0) {
      console.log(chalk.magenta('  Context:'), JSON.stringify(context, null, 2));
    }
  }

  /**
   * Log animation end
   */
  animationEnd(name: string, context: Record<string, unknown>): void {
    // Always log to file first (for Ctrl+O LogBrowser)
    const jsonLogger = getJsonStreamLogger();
    if (jsonLogger?.isActive()) {
      jsonLogger.logDebug(`[UI] Animation End: ${name}`, context);
    }

    // Console output controlled by log level
    if (this.level < LogLevel.VERBOSE) return;

    const location = this.getCallLocation();
    const timestamp = this.getTimestamp();
    const prefix = this.getPrefix();
    const loc = this.getLocation(location);

    console.log(timestamp, prefix, loc, chalk.magenta('🎬 ANIMATION END:'), name);
    if (Object.keys(context).length > 0) {
      console.log(chalk.magenta('  Context:'), JSON.stringify(context, null, 2));
    }
  }

  /**
   * Log transition start
   */
  transitionStart(name: string, context: Record<string, unknown>): void {
    // Always log to file first (for Ctrl+O LogBrowser)
    const jsonLogger = getJsonStreamLogger();
    if (jsonLogger?.isActive()) {
      jsonLogger.logDebug(`[UI] Transition Start: ${name}`, context);
    }

    // Console output controlled by log level
    if (this.level < LogLevel.VERBOSE) return;

    const location = this.getCallLocation();
    const timestamp = this.getTimestamp();
    const prefix = this.getPrefix();
    const loc = this.getLocation(location);

    console.log(timestamp, prefix, loc, chalk.magenta('🔀 TRANSITION START:'), name);
    if (Object.keys(context).length > 0) {
      console.log(chalk.magenta('  Context:'), JSON.stringify(context, null, 2));
    }
  }

  /**
   * Log transition end
   */
  transitionEnd(name: string, context: Record<string, unknown>): void {
    // Always log to file first (for Ctrl+O LogBrowser)
    const jsonLogger = getJsonStreamLogger();
    if (jsonLogger?.isActive()) {
      jsonLogger.logDebug(`[UI] Transition End: ${name}`, context);
    }

    // Console output controlled by log level
    if (this.level < LogLevel.VERBOSE) return;

    const location = this.getCallLocation();
    const timestamp = this.getTimestamp();
    const prefix = this.getPrefix();
    const loc = this.getLocation(location);

    console.log(timestamp, prefix, loc, chalk.magenta('🔀 TRANSITION END:'), name);
    if (Object.keys(context).length > 0) {
      console.log(chalk.magenta('  Context:'), JSON.stringify(context, null, 2));
    }
  }

  /**
   * Log hover enter
   */
  hoverEnter(element: string, context: Record<string, unknown>): void {
    // Always log to file first (for Ctrl+O LogBrowser)
    const jsonLogger = getJsonStreamLogger();
    if (jsonLogger?.isActive()) {
      jsonLogger.logDebug(`[UI] Hover Enter: ${element}`, context);
    }

    // Console output controlled by log level
    if (this.level < LogLevel.VERBOSE) return;

    const location = this.getCallLocation();
    const timestamp = this.getTimestamp();
    const prefix = this.getPrefix();
    const loc = this.getLocation(location);

    console.log(timestamp, prefix, loc, chalk.gray('🖱️  HOVER ENTER:'), element);
    if (Object.keys(context).length > 0) {
      console.log(chalk.gray('  Context:'), JSON.stringify(context, null, 2));
    }
  }

  /**
   * Log hover leave
   */
  hoverLeave(element: string, context: Record<string, unknown>): void {
    // Always log to file first (for Ctrl+O LogBrowser)
    const jsonLogger = getJsonStreamLogger();
    if (jsonLogger?.isActive()) {
      jsonLogger.logDebug(`[UI] Hover Leave: ${element}`, context);
    }

    // Console output controlled by log level
    if (this.level < LogLevel.VERBOSE) return;

    const location = this.getCallLocation();
    const timestamp = this.getTimestamp();
    const prefix = this.getPrefix();
    const loc = this.getLocation(location);

    console.log(timestamp, prefix, loc, chalk.gray('🖱️  HOVER LEAVE:'), element);
    if (Object.keys(context).length > 0) {
      console.log(chalk.gray('  Context:'), JSON.stringify(context, null, 2));
    }
  }

  // ============================================================================
  // Layout Methods
  // ============================================================================

  /**
   * Log viewport resize
   */
  viewportResize(context: Record<string, unknown>): void {
    // Always log to file first (for Ctrl+O LogBrowser)
    const jsonLogger = getJsonStreamLogger();
    if (jsonLogger?.isActive()) {
      jsonLogger.logDebug(`[LAYOUT] Viewport Resize`, context);
    }

    // Console output controlled by log level
    if (this.level < LogLevel.DEBUG) return;

    const location = this.getCallLocation();
    const timestamp = this.getTimestamp();
    const prefix = this.getPrefix();
    const loc = this.getLocation(location);

    console.log(timestamp, prefix, loc, chalk.blue('📐 VIEWPORT RESIZE'));
    if (Object.keys(context).length > 0) {
      console.log(chalk.blue('  Context:'), JSON.stringify(context, null, 2));
    }
  }

  /**
   * Log breakpoint change
   */
  breakpointChange(context: Record<string, unknown>): void {
    // Always log to file first (for Ctrl+O LogBrowser)
    const jsonLogger = getJsonStreamLogger();
    if (jsonLogger?.isActive()) {
      jsonLogger.logDebug(`[LAYOUT] Breakpoint Change`, context);
    }

    // Console output controlled by log level
    if (this.level < LogLevel.DEBUG) return;

    const location = this.getCallLocation();
    const timestamp = this.getTimestamp();
    const prefix = this.getPrefix();
    const loc = this.getLocation(location);

    console.log(timestamp, prefix, loc, chalk.blue('📐 BREAKPOINT CHANGE'));
    if (Object.keys(context).length > 0) {
      console.log(chalk.blue('  Context:'), JSON.stringify(context, null, 2));
    }
  }

  /**
   * Log layout shift
   */
  layoutShift(context: Record<string, unknown>): void {
    // Always log to file first (for Ctrl+O LogBrowser)
    const jsonLogger = getJsonStreamLogger();
    if (jsonLogger?.isActive()) {
      jsonLogger.logDebug(`[LAYOUT] Shift`, context);
    }

    // Console output controlled by log level
    if (this.level < LogLevel.DEBUG) return;

    const location = this.getCallLocation();
    const timestamp = this.getTimestamp();
    const prefix = this.getPrefix();
    const loc = this.getLocation(location);

    console.log(timestamp, prefix, loc, chalk.yellow('📐 LAYOUT SHIFT'));
    if (Object.keys(context).length > 0) {
      console.log(chalk.yellow('  Context:'), JSON.stringify(context, null, 2));
    }
  }

  /**
   * Log scroll position
   */
  scrollPosition(context: Record<string, unknown>): void {
    // Always log to file first (for Ctrl+O LogBrowser)
    const jsonLogger = getJsonStreamLogger();
    if (jsonLogger?.isActive()) {
      jsonLogger.logDebug('[UI] Scroll Position', context);
    }

    // Console output controlled by log level
    if (this.level < LogLevel.VERBOSE) return;

    const location = this.getCallLocation();
    const timestamp = this.getTimestamp();
    const prefix = this.getPrefix();
    const loc = this.getLocation(location);

    console.log(timestamp, prefix, loc, chalk.gray('📜 SCROLL POSITION'));
    if (Object.keys(context).length > 0) {
      console.log(chalk.gray('  Context:'), JSON.stringify(context, null, 2));
    }
  }

  // ============================================================================
  // Error Boundary Methods
  // ============================================================================

  /**
   * Log error boundary catch
   */
  errorBoundary(context: Record<string, unknown>): void {
    // Always log to file first (for Ctrl+O LogBrowser)
    const jsonLogger = getJsonStreamLogger();
    if (jsonLogger?.isActive()) {
      jsonLogger.logError(new Error('Error Boundary'), 'errorBoundary');
    }

    // Console output controlled by log level
    if (this.level < LogLevel.ERROR) return;

    const location = this.getCallLocation();
    const timestamp = this.getTimestamp();
    const prefix = this.getPrefix();
    const loc = this.getLocation(location);

    console.log(timestamp, prefix, loc, chalk.red('🛡️  ERROR BOUNDARY'));
    if (Object.keys(context).length > 0) {
      console.log(chalk.red('  Context:'), JSON.stringify(context, null, 2));
    }
  }

  /**
   * Log unhandled rejection
   */
  unhandledRejection(context: Record<string, unknown>): void {
    // Always log to file first (for Ctrl+O LogBrowser)
    const jsonLogger = getJsonStreamLogger();
    if (jsonLogger?.isActive()) {
      jsonLogger.logError(new Error('Unhandled Rejection'), 'unhandledRejection');
    }

    // Console output controlled by log level
    if (this.level < LogLevel.ERROR) return;

    const location = this.getCallLocation();
    const timestamp = this.getTimestamp();
    const prefix = this.getPrefix();
    const loc = this.getLocation(location);

    console.log(timestamp, prefix, loc, chalk.red('⚠️  UNHANDLED REJECTION'));
    if (Object.keys(context).length > 0) {
      console.log(chalk.red('  Context:'), JSON.stringify(context, null, 2));
    }
  }

  /**
   * Log global error
   */
  globalError(context: Record<string, unknown>): void {
    // Always log to file first (for Ctrl+O LogBrowser)
    const jsonLogger = getJsonStreamLogger();
    if (jsonLogger?.isActive()) {
      jsonLogger.logError(new Error('Global Error'), 'globalError');
    }

    // Console output controlled by log level
    if (this.level < LogLevel.ERROR) return;

    const location = this.getCallLocation();
    const timestamp = this.getTimestamp();
    const prefix = this.getPrefix();
    const loc = this.getLocation(location);

    console.log(timestamp, prefix, loc, chalk.red('💥 GLOBAL ERROR'));
    if (Object.keys(context).length > 0) {
      console.log(chalk.red('  Context:'), JSON.stringify(context, null, 2));
    }
  }

  // ============================================================================
  // Session Methods
  // ============================================================================

  /**
   * Log session start
   */
  sessionStart(context: Record<string, unknown>): void {
    // Always log to file first (for Ctrl+O LogBrowser)
    const jsonLogger = getJsonStreamLogger();
    if (jsonLogger?.isActive()) {
      jsonLogger.logInfo(`Session Start`, context);
    }

    // Console output controlled by log level
    if (this.level < LogLevel.INFO) return;

    const location = this.getCallLocation();
    const timestamp = this.getTimestamp();
    const prefix = this.getPrefix();
    const loc = this.getLocation(location);

    console.log(timestamp, prefix, loc, chalk.green('🚀 SESSION START'));
    if (Object.keys(context).length > 0) {
      console.log(chalk.green('  Context:'), JSON.stringify(context, null, 2));
    }
  }

  /**
   * Log session end
   */
  sessionEnd(context: Record<string, unknown>): void {
    // Always log to file first (for Ctrl+O LogBrowser)
    const jsonLogger = getJsonStreamLogger();
    if (jsonLogger?.isActive()) {
      jsonLogger.logInfo(`Session End`, context);
    }

    // Console output controlled by log level
    if (this.level < LogLevel.INFO) return;

    const location = this.getCallLocation();
    const timestamp = this.getTimestamp();
    const prefix = this.getPrefix();
    const loc = this.getLocation(location);

    console.log(timestamp, prefix, loc, chalk.red('🏁 SESSION END'));
    if (Object.keys(context).length > 0) {
      console.log(chalk.red('  Context:'), JSON.stringify(context, null, 2));
    }
  }

  /**
   * Log user milestone
   */
  userMilestone(name: string, context: Record<string, unknown>): void {
    // Always log to file first (for Ctrl+O LogBrowser)
    const jsonLogger = getJsonStreamLogger();
    if (jsonLogger?.isActive()) {
      jsonLogger.logInfo(`User Milestone: ${name}`, context);
    }

    // Console output controlled by log level
    if (this.level < LogLevel.INFO) return;

    const location = this.getCallLocation();
    const timestamp = this.getTimestamp();
    const prefix = this.getPrefix();
    const loc = this.getLocation(location);

    console.log(timestamp, prefix, loc, chalk.yellow('🏆 USER MILESTONE:'), name);
    if (Object.keys(context).length > 0) {
      console.log(chalk.yellow('  Context:'), JSON.stringify(context, null, 2));
    }
  }

  /**
   * Log feature usage
   */
  featureUsage(name: string, context: Record<string, unknown>): void {
    // Always log to file first (for Ctrl+O LogBrowser)
    const jsonLogger = getJsonStreamLogger();
    if (jsonLogger?.isActive()) {
      jsonLogger.logDebug(`Feature Usage: ${name}`, context);
    }

    // Console output controlled by log level
    if (this.level < LogLevel.DEBUG) return;

    const location = this.getCallLocation();
    const timestamp = this.getTimestamp();
    const prefix = this.getPrefix();
    const loc = this.getLocation(location);

    console.log(timestamp, prefix, loc, chalk.cyan('📊 FEATURE USAGE:'), name);
    if (Object.keys(context).length > 0) {
      console.log(chalk.cyan('  Context:'), JSON.stringify(context, null, 2));
    }
  }

  // ============================================================================
  // Update Methods (for S3AutoUpdater)
  // ============================================================================

  /**
   * Log update check start
   */
  updateCheckStart(): void {
    // Always log to file first (for Ctrl+O LogBrowser)
    const jsonLogger = getJsonStreamLogger();
    if (jsonLogger?.isActive()) {
      jsonLogger.logInfo('Update Check Start', {});
    }

    // Console output controlled by log level
    if (this.level < LogLevel.INFO) return;

    const location = this.getCallLocation();
    const timestamp = this.getTimestamp();
    const prefix = this.getPrefix();
    const loc = this.getLocation(location);

    console.log(timestamp, prefix, loc, chalk.cyan('🔄 UPDATE CHECK START'));
  }

  /**
   * Log update available
   */
  updateAvailable(context: Record<string, unknown>): void {
    // Always log to file first (for Ctrl+O LogBrowser)
    const jsonLogger = getJsonStreamLogger();
    if (jsonLogger?.isActive()) {
      jsonLogger.logInfo('Update Available', context);
    }

    // Console output controlled by log level
    if (this.level < LogLevel.INFO) return;

    const location = this.getCallLocation();
    const timestamp = this.getTimestamp();
    const prefix = this.getPrefix();
    const loc = this.getLocation(location);

    console.log(timestamp, prefix, loc, chalk.green('✨ UPDATE AVAILABLE'));
    if (Object.keys(context).length > 0) {
      console.log(chalk.green('  Version:'), context['version']);
    }
  }

  /**
   * Log update download start
   */
  updateDownloadStart(context: Record<string, unknown>): void {
    // Always log to file first (for Ctrl+O LogBrowser)
    const jsonLogger = getJsonStreamLogger();
    if (jsonLogger?.isActive()) {
      jsonLogger.logInfo('Update Download Start', context);
    }

    // Console output controlled by log level
    if (this.level < LogLevel.INFO) return;

    const location = this.getCallLocation();
    const timestamp = this.getTimestamp();
    const prefix = this.getPrefix();
    const loc = this.getLocation(location);

    console.log(timestamp, prefix, loc, chalk.cyan('⬇️  UPDATE DOWNLOAD START'));
    if (Object.keys(context).length > 0) {
      console.log(chalk.cyan('  Context:'), JSON.stringify(context, null, 2));
    }
  }

  /**
   * Log update download progress
   */
  updateDownloadProgress(context: Record<string, unknown>): void {
    // Always log to file first (for Ctrl+O LogBrowser)
    const jsonLogger = getJsonStreamLogger();
    if (jsonLogger?.isActive()) {
      jsonLogger.logDebug('Update Download Progress', context);
    }

    // Console output controlled by log level
    if (this.level < LogLevel.DEBUG) return;

    const location = this.getCallLocation();
    const timestamp = this.getTimestamp();
    const prefix = this.getPrefix();
    const loc = this.getLocation(location);

    console.log(timestamp, prefix, loc, chalk.cyan('⬇️  DOWNLOAD PROGRESS:'), `${context['percent']}%`);
  }

  /**
   * Log update download complete
   */
  updateDownloadComplete(context: Record<string, unknown>): void {
    // Always log to file first (for Ctrl+O LogBrowser)
    const jsonLogger = getJsonStreamLogger();
    if (jsonLogger?.isActive()) {
      jsonLogger.logInfo('Update Download Complete', context);
    }

    // Console output controlled by log level
    if (this.level < LogLevel.INFO) return;

    const location = this.getCallLocation();
    const timestamp = this.getTimestamp();
    const prefix = this.getPrefix();
    const loc = this.getLocation(location);

    console.log(timestamp, prefix, loc, chalk.green('✅ UPDATE DOWNLOAD COMPLETE'));
    if (Object.keys(context).length > 0) {
      console.log(chalk.green('  Version:'), context['version']);
    }
  }

  /**
   * Log update installing
   */
  updateInstalling(): void {
    // Always log to file first (for Ctrl+O LogBrowser)
    const jsonLogger = getJsonStreamLogger();
    if (jsonLogger?.isActive()) {
      jsonLogger.logInfo('Update Installing', {});
    }

    // Console output controlled by log level
    if (this.level < LogLevel.INFO) return;

    const location = this.getCallLocation();
    const timestamp = this.getTimestamp();
    const prefix = this.getPrefix();
    const loc = this.getLocation(location);

    console.log(timestamp, prefix, loc, chalk.yellow('🔧 UPDATE INSTALLING'));
  }

  /**
   * Log update installed
   */
  updateInstalled(context: Record<string, unknown>): void {
    // Always log to file first (for Ctrl+O LogBrowser)
    const jsonLogger = getJsonStreamLogger();
    if (jsonLogger?.isActive()) {
      jsonLogger.logInfo('Update Installed', context);
    }

    // Console output controlled by log level
    if (this.level < LogLevel.INFO) return;

    const location = this.getCallLocation();
    const timestamp = this.getTimestamp();
    const prefix = this.getPrefix();
    const loc = this.getLocation(location);

    console.log(timestamp, prefix, loc, chalk.green('🎉 UPDATE INSTALLED'));
    if (Object.keys(context).length > 0) {
      console.log(chalk.green('  Version:'), context['version']);
    }
  }

  /**
   * Log update error
   */
  updateError(context: Record<string, unknown>): void {
    // Always log to file first (for Ctrl+O LogBrowser)
    const jsonLogger = getJsonStreamLogger();
    if (jsonLogger?.isActive()) {
      jsonLogger.logError(new Error(String(context['error'] || 'Unknown error')), 'updateError');
    }

    // Console output controlled by log level
    if (this.level < LogLevel.ERROR) return;

    const location = this.getCallLocation();
    const timestamp = this.getTimestamp();
    const prefix = this.getPrefix();
    const loc = this.getLocation(location);

    console.log(timestamp, prefix, loc, chalk.red('❌ UPDATE ERROR'));
    if (Object.keys(context).length > 0) {
      console.log(chalk.red('  Error:'), context['error']);
    }
  }
}

/**
 * Global logger instance
 *
 *  ERROR  (Normal    )
 * CLI argument  :
 * - Normal mode (open): ERROR (  , UI )
 * - Verbose mode (open --verbose): WARN
 * - Debug mode (open --debug): VERBOSE
 */
export const logger = new Logger({
  level: LogLevel.ERROR, // Normal :    (ERROR )
  prefix: '',
  timestamp: true,
  showLocation: false, // setLogLevel()  
  showPid: false, //    
});

/**
 * Set global log level from CLI or config
 * DEBUG      
 */
export function setLogLevel(level: LogLevel): void {
  logger.setLevel(level);

  // DEBUG     
  if (level >= LogLevel.DEBUG) {
    logger['showLocation'] = true;
  }
}

/**
 * Enable verbose logging
 */
export function enableVerbose(): void {
  logger.setLevel(LogLevel.VERBOSE);
}

/**
 * Disable verbose logging
 */
export function disableVerbose(): void {
  logger.setLevel(LogLevel.INFO);
}

/**
 * Enable debug logging
 */
export function enableDebug(): void {
  logger.setLevel(LogLevel.DEBUG);
}

/**
 * Create a child logger with a specific prefix
 */
export function createLogger(prefix: string, options?: Partial<LoggerOptions>): Logger {
  return new Logger({
    level: logger['level'],
    prefix,
    timestamp: true,
    showLocation: logger['showLocation'],
    showPid: logger['showPid'],
    ...options,
  });
}

/**
 * Generate a unique trace ID
 */
export function generateTraceId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Setup logging configuration based on CLI options
 * - Configures log level (verbose/debug)
 * - Initializes JSON stream logger
 * - Sets up process exit handlers for cleanup
 * 
 * @param options - CLI options containing verbose and debug flags
 * @returns Object containing cleanup function and JSON logger instance
 */
export async function setupLogging(options: {
  verbose?: boolean;
  debug?: boolean;
  llmLog?: boolean;
  sessionId?: string;
}): Promise<{
  cleanup: () => Promise<void>;
  jsonLogger: Awaited<ReturnType<typeof import('./json-stream-logger.js').initializeJsonStreamLogger>>;
}> {
  const { initializeJsonStreamLogger, closeJsonStreamLogger } = await import('./json-stream-logger.js');
  const { sessionManager } = await import('../core/session/session-manager.js');

  // Determine if verbose/debug mode is enabled
  const isVerboseMode = options.verbose || options.debug;

  // Initialize JSON stream logger (always enabled, but only show messages in verbose/debug mode)
  const sessionId = options.sessionId || (sessionManager.getCurrentSessionId() as string);
  const jsonLogger = await initializeJsonStreamLogger(sessionId, false, isVerboseMode);

  // Enable LLM logging if --llm-log flag is set
  if (options.llmLog) {
    enableLLMLog();
  }

  // Set log level based on CLI options
  // Normal mode (no flags): ERROR
  // --verbose: DEBUG ( )
  // --debug: VERBOSE (   +  )
  // --llm-log: ERROR (LLM / )
  if (options.debug) {
    setLogLevel(LogLevel.VERBOSE);
    logger.debug('🔍 Debug mode enabled - maximum logging with location tracking');
  } else if (options.verbose) {
    setLogLevel(LogLevel.DEBUG);
    logger.debug('📝 Verbose mode enabled - detailed logging');
  } else if (options.llmLog) {
    // llm-log mode: keep ERROR level, just enable LLM logging
    console.log(chalk.cyan('📡 LLM Log mode enabled - showing LLM requests/responses only'));
  }
  // Normal mode: no startup message

  // Track cleanup state to prevent duplicate calls
  let cleanupCalled = false;

  // Cleanup function to close logger (idempotent - safe to call multiple times)
  const cleanup = async () => {
    if (cleanupCalled) {
      return; // Already cleaned up, skip
    }
    cleanupCalled = true;
    await closeJsonStreamLogger();
  };

  // Ensure cleanup on exit (prevent duplicate handlers with once flag)
  // Note: SIGINT is handled by ink/PlanExecuteApp for smart Ctrl+C behavior
  // Only SIGTERM triggers automatic exit (for system shutdown signals)
  const exitHandler = async (signal: string) => {
    logger.debug(`Received ${signal}, cleaning up...`);
    await cleanup();
    process.exit(0);
  };

  process.once('SIGTERM', () => exitHandler('SIGTERM'));

  return { cleanup, jsonLogger };
}
