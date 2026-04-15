/**
 * PowerShell Tools (LLM Simple)
 *
 * PowerShell execution tools for Windows Native
 * CLI parity: src/tools/llm/simple/powershell-tool.ts
 *
 * Category: LLM Simple Tools - LLM tool_call , Sub-LLM 
 *
 * Note: Electron uses PowerShell instead of bash (Windows native)
 */

import * as fsSync from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn, ChildProcess } from 'child_process';
import { powerShellManager } from '../../../powershell-manager';
import { logger } from '../../../utils/logger';
import type { ToolDefinition } from '../../../core';
import type { LLMSimpleTool, ToolResult, ToolCategory } from '../../types';

// =============================================================================
// Constants
// =============================================================================

const MAX_OUTPUT_LENGTH = 50000;
const DEFAULT_TIMEOUT = 30000;
const CORE_CATEGORIES: ToolCategory[] = ['llm-simple'];

// Dangerous PowerShell command patterns
const DANGEROUS_POWERSHELL_PATTERNS = [
  /Remove-Item\s+.*-Recurse.*-Force.*[A-Z]:\\/i,
  /Remove-Item\s+.*[A-Z]:\\Windows/i,
  /Remove-Item\s+.*[A-Z]:\\Program\s+Files/i,
  /Remove-Item\s+.*\$env:SystemRoot/i,
  /Format-Volume/i,
  /Clear-Disk/i,
  /Stop-Computer/i,
  /Restart-Computer.*-Force/i,
  /Remove-Item\s+.*HKLM:/i,
  /Remove-Item\s+.*HKCU:/i,
  /Set-ExecutionPolicy\s+Unrestricted\s+-Force/i,
  /Invoke-Expression.*\(.*New-Object.*Net\.WebClient/i,
  /Start-Process.*-Verb\s+RunAs.*-ArgumentList.*Remove-Item/i,
];

function isDangerousPowerShellCommand(command: string): boolean {
  return DANGEROUS_POWERSHELL_PATTERNS.some((pattern) => pattern.test(command));
}

// =============================================================================
// Working Directory Management
// =============================================================================

// Portable/      :   fallback
function getSafeInitialCwd(): string {
  const cwd = process.cwd();
  const lower = cwd.toLowerCase();
  const tempDir = (process.env.TEMP || process.env.TMP || os.tmpdir()).toLowerCase();
  if (
    (tempDir && lower.startsWith(tempDir)) ||
    lower.includes('\\appdata\\local\\temp\\') ||
    lower.includes('\\program files\\') ||
    lower.includes('\\program files (x86)\\') ||
    lower.includes('\\windows\\') ||
    lower.includes('\\system32\\')
  ) {
    return os.homedir();
  }
  return cwd;
}
let currentWorkingDirectory: string = getSafeInitialCwd();

export function setWorkingDirectory(dir: string): void {
  currentWorkingDirectory = dir;
}

export function getWorkingDirectory(): string {
  return currentWorkingDirectory;
}

function resolvePath(filePath: string): string {
  const cleanPath = filePath.startsWith('@') ? filePath.slice(1) : filePath;
  if (path.isAbsolute(cleanPath)) {
    return cleanPath;
  }
  return path.resolve(currentWorkingDirectory, cleanPath);
}

// =============================================================================
// PowerShell Command Preprocessing
// =============================================================================

/**
 * Preprocess PowerShell command to fix common alias issues
 * - curl → curl.exe (PowerShell aliases curl to Invoke-WebRequest)
 * - wget → wget.exe (same alias issue)
 */
function preprocessPowerShellCommand(command: string): string {
  let processed = command;
  // curl → curl.exe only in command position (line start, after pipe/semicolon/operators/assignment/block)
  // Case-insensitive + preserve original casing via $2 capture group
  processed = processed.replace(/(^|[|;&(={]\s*)(curl)\b(?!\.)/gim, '$1$2.exe');
  // wget → wget.exe (same alias issue)
  processed = processed.replace(/(^|[|;&(={]\s*)(wget)\b(?!\.)/gim, '$1$2.exe');
  return processed;
}

// =============================================================================
// powershell Tool
// =============================================================================

const POWERSHELL_DEFINITION: ToolDefinition = {
  type: 'function',
  function: {
    name: 'powershell',
    description: `Execute a PowerShell command on Windows. Use this to run terminal commands like git, npm, docker, python, etc.

IMPORTANT:
- Do NOT use for file reading/writing - use read_file, create_file, edit_file instead
- Commands have a 30 second timeout by default
- Dangerous commands are blocked for safety
- Output is truncated if too long
- PowerShell 7 (pwsh) is used if available, otherwise PowerShell 5.1
- IMPORTANT: Use \`curl.exe\` instead of \`curl\` (PowerShell aliases curl to Invoke-WebRequest)
- IMPORTANT: Use \`wget.exe\` instead of \`wget\` (same alias issue)
- IMPORTANT: \`Invoke-WebRequest -Form\` is PowerShell 7+ only. Most PCs have PS 5.1.`,
    parameters: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: `A natural, conversational explanation for the user about what you're doing.
Write as if you're talking to the user directly. Use the same language as the user.
Examples:
- "Running the build command to compile the project"
- "Installing the required dependencies"
- "Checking the git status"`,
        },
        command: {
          type: 'string',
          description: 'The PowerShell command to execute',
        },
        cwd: {
          type: 'string',
          description: 'Working directory for the command (optional)',
        },
        timeout: {
          type: 'number',
          description: 'Timeout in milliseconds (optional, default: 30000)',
        },
      },
      required: ['reason', 'command'],
    },
  },
};

async function executePowerShell(args: Record<string, unknown>): Promise<ToolResult> {
  const command = args['command'] as string;
  const cwd = args['cwd'] as string | undefined;
  const timeout = (args['timeout'] as number) || DEFAULT_TIMEOUT;
  const reason = args['reason'] as string | undefined;
  const startTime = Date.now();

  logger.toolStart('powershell', args, reason);

  if (!command || typeof command !== 'string') {
    return { success: false, error: 'command is required and must be a string' };
  }

  if (isDangerousPowerShellCommand(command)) {
    logger.warn('Dangerous PowerShell command blocked', { command });
    return { success: false, error: 'This command is blocked for safety reasons' };
  }

  try {
    const workingDir = cwd ? resolvePath(cwd) : currentWorkingDirectory;
    const processedCommand = preprocessPowerShellCommand(command);
    if (processedCommand !== command) {
      logger.info('PowerShell command preprocessed', { original: command, processed: processedCommand });
    }
    const result = await powerShellManager.executeOnce(processedCommand, workingDir);

    let output = '';
    if (result.stdout) {
      output += result.stdout;
    }
    if (result.stderr) {
      output += (output ? '\n\n' : '') + `stderr:\n${result.stderr}`;
    }

    if (output.length > MAX_OUTPUT_LENGTH) {
      output = output.slice(0, MAX_OUTPUT_LENGTH) + '\n\n... [output truncated]';
    }

    if (result.exitCode !== 0 && result.exitCode !== null) {
      output += `\n\n[Exit code: ${result.exitCode}]`;
    }

    const durationMs = Date.now() - startTime;

    if (!result.success) {
      logger.toolError('powershell', args, new Error(output || 'Command failed'), durationMs);
      return { success: false, error: output || '(no output)' };
    }

    logger.toolSuccess('powershell', args, { outputLength: output.length, exitCode: result.exitCode }, durationMs);
    return { success: true, result: output || '(no output)' };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.toolError('powershell', args, error instanceof Error ? error : new Error(errorMessage), durationMs);
    return { success: false, error: `Error executing command: ${errorMessage}` };
  }
}

export const powershellTool: LLMSimpleTool = {
  definition: POWERSHELL_DEFINITION,
  execute: executePowerShell,
  categories: CORE_CATEGORIES,
  description: 'Execute PowerShell command',
};

// =============================================================================
// Background PowerShell Task Management
// =============================================================================

interface BackgroundTask {
  id: string;
  process: ChildProcess;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  isRunning: boolean;
  startTime: number;
  command: string;
}

const backgroundTasks: Map<string, BackgroundTask> = new Map();

// =============================================================================
// powershell_background_start Tool
// =============================================================================

const POWERSHELL_BG_START_DEFINITION: ToolDefinition = {
  type: 'function',
  function: {
    name: 'powershell_background_start',
    description: `Start a PowerShell command in the background. Use for long-running processes like:
- npm run dev (development server)
- npm start (application server)
- docker-compose up

The command will continue running after this tool returns.`,
    parameters: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: `A natural, conversational explanation for the user about what you're doing.
Write as if you're talking to the user directly. Use the same language as the user.
Examples:
- "Starting the development server in the background"
- "Running the database in the background"`,
        },
        command: {
          type: 'string',
          description: 'The PowerShell command to run in background',
        },
        cwd: {
          type: 'string',
          description: 'Working directory (optional)',
        },
      },
      required: ['reason', 'command'],
    },
  },
};

async function executePowerShellBackgroundStart(args: Record<string, unknown>): Promise<ToolResult> {
  const command = args['command'] as string;
  const cwd = args['cwd'] as string | undefined;

  if (!command || typeof command !== 'string') {
    return { success: false, error: 'command is required and must be a string' };
  }

  if (isDangerousPowerShellCommand(command)) {
    logger.warn('Dangerous PowerShell command blocked', { command });
    return { success: false, error: 'This command is blocked for safety reasons' };
  }

  const taskId = `bg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const workingDir = cwd ? resolvePath(cwd) : currentWorkingDirectory;

  try {
    const psPath = process.platform === 'win32'
      ? (fsSync.existsSync('C:\\Program Files\\PowerShell\\7\\pwsh.exe')
          ? 'C:\\Program Files\\PowerShell\\7\\pwsh.exe'
          : 'powershell.exe')
      : 'pwsh';

    const processedCommand = preprocessPowerShellCommand(command);
    if (processedCommand !== command) {
      logger.info('PowerShell background command preprocessed', { original: command, processed: processedCommand });
    }
    const childProcess = spawn(psPath, ['-NoProfile', '-Command', processedCommand], {
      cwd: workingDir,
      env: { ...process.env },
    });

    const task: BackgroundTask = {
      id: taskId,
      process: childProcess,
      stdout: '',
      stderr: '',
      exitCode: null,
      isRunning: true,
      startTime: Date.now(),
      command,
    };

    childProcess.stdout?.on('data', (data) => {
      task.stdout += data.toString();
    });

    childProcess.stderr?.on('data', (data) => {
      task.stderr += data.toString();
    });

    childProcess.on('close', (code) => {
      task.exitCode = code;
      task.isRunning = false;
    });

    childProcess.on('error', (error) => {
      task.stderr += `\nProcess error: ${error.message}`;
      task.isRunning = false;
    });

    backgroundTasks.set(taskId, task);

    logger.info('Background task started', { taskId, command: command.substring(0, 100) });

    return {
      success: true,
      result: JSON.stringify({
        task_id: taskId,
        status: 'started',
        message: `Background task started. Use task_id "${taskId}" to check output.`,
      }),
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, error: `Failed to start background task: ${errorMessage}` };
  }
}

export const powershellBackgroundStartTool: LLMSimpleTool = {
  definition: POWERSHELL_BG_START_DEFINITION,
  execute: executePowerShellBackgroundStart,
  categories: CORE_CATEGORIES,
  description: 'Start PowerShell command in background',
};

// =============================================================================
// powershell_background_read Tool
// =============================================================================

const POWERSHELL_BG_READ_DEFINITION: ToolDefinition = {
  type: 'function',
  function: {
    name: 'powershell_background_read',
    description: 'Read output from a background PowerShell task.',
    parameters: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: `A natural, conversational explanation for the user about what you're doing.
Write as if you're talking to the user directly. Use the same language as the user.
Examples:
- "Checking the server output"
- "Seeing if the build completed"`,
        },
        task_id: {
          type: 'string',
          description: 'The task ID returned by powershell_background_start',
        },
      },
      required: ['reason', 'task_id'],
    },
  },
};

async function executePowerShellBackgroundRead(args: Record<string, unknown>): Promise<ToolResult> {
  const taskId = args['task_id'] as string;

  if (!taskId) {
    return { success: false, error: 'task_id is required' };
  }

  const task = backgroundTasks.get(taskId);
  if (!task) {
    return { success: false, error: `Task not found: ${taskId}` };
  }

  let output = '';
  if (task.stdout) {
    output += task.stdout;
  }
  if (task.stderr) {
    output += (output ? '\n\nstderr:\n' : 'stderr:\n') + task.stderr;
  }

  if (output.length > MAX_OUTPUT_LENGTH) {
    output = output.slice(-MAX_OUTPUT_LENGTH) + '\n\n... [output truncated, showing last portion]';
  }

  const duration = Date.now() - task.startTime;

  return {
    success: true,
    result: JSON.stringify({
      task_id: taskId,
      is_running: task.isRunning,
      exit_code: task.exitCode,
      duration_ms: duration,
      output: output || '(no output yet)',
    }),
  };
}

export const powershellBackgroundReadTool: LLMSimpleTool = {
  definition: POWERSHELL_BG_READ_DEFINITION,
  execute: executePowerShellBackgroundRead,
  categories: CORE_CATEGORIES,
  description: 'Read background task output',
};

// =============================================================================
// powershell_background_stop Tool
// =============================================================================

const POWERSHELL_BG_STOP_DEFINITION: ToolDefinition = {
  type: 'function',
  function: {
    name: 'powershell_background_stop',
    description: 'Stop a background PowerShell task.',
    parameters: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: `A natural, conversational explanation for the user about what you're doing.
Write as if you're talking to the user directly. Use the same language as the user.
Examples:
- "Stopping the development server"
- "Terminating the background process"`,
        },
        task_id: {
          type: 'string',
          description: 'The task ID to stop',
        },
      },
      required: ['reason', 'task_id'],
    },
  },
};

async function executePowerShellBackgroundStop(args: Record<string, unknown>): Promise<ToolResult> {
  const taskId = args['task_id'] as string;

  if (!taskId) {
    return { success: false, error: 'task_id is required' };
  }

  const task = backgroundTasks.get(taskId);
  if (!task) {
    return { success: false, error: `Task not found: ${taskId}` };
  }

  if (!task.isRunning) {
    return {
      success: true,
      result: JSON.stringify({
        task_id: taskId,
        message: 'Task already completed',
        exit_code: task.exitCode,
      }),
    };
  }

  try {
    task.process.kill('SIGTERM');
    task.isRunning = false;

    return {
      success: true,
      result: JSON.stringify({
        task_id: taskId,
        message: 'Task stopped',
      }),
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, error: `Failed to stop task: ${errorMessage}` };
  }
}

export const powershellBackgroundStopTool: LLMSimpleTool = {
  definition: POWERSHELL_BG_STOP_DEFINITION,
  execute: executePowerShellBackgroundStop,
  categories: CORE_CATEGORIES,
  description: 'Stop background task',
};

// =============================================================================
// Export All PowerShell Tools
// =============================================================================

export const POWERSHELL_TOOLS: LLMSimpleTool[] = [
  powershellTool,
  powershellBackgroundStartTool,
  powershellBackgroundReadTool,
  powershellBackgroundStopTool,
];

/**
 * Background PowerShell tools (for compatibility with CLI naming)
 */
export const BACKGROUND_POWERSHELL_TOOLS: LLMSimpleTool[] = [
  powershellBackgroundStartTool,
  powershellBackgroundReadTool,
  powershellBackgroundStopTool,
];
