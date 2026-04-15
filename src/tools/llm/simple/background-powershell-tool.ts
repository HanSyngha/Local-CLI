/**
 * Background PowerShell Tool (Native Windows Only)
 *
 *  PowerShell    
 * npm run dev, npm start     
 */

import { spawn, ChildProcess } from 'node:child_process';
import { ToolDefinition } from '../../../types/index.js';
import { LLMSimpleTool, ToolResult, ToolCategory } from '../../types.js';
import { logger } from '../../../utils/logger.js';
import { isNativeWindows, findNativePowerShellPath } from '../../../utils/platform-utils.js';

/**
 * Background process info
 */
interface BackgroundProcess {
  id: string;
  command: string;
  process: ChildProcess;
  startedAt: Date;
  cwd: string;
  output: string[];
  maxOutputLines: number;
}

/**
 * Background PowerShell Process Manager
 */
class BackgroundPowerShellProcessManager {
  private processes: Map<string, BackgroundProcess> = new Map();
  private nextId = 1;

  /**
   * Start a background process
   */
  start(command: string, cwd?: string): { id: string; pid: number } {
    const id = `ps-bg-${this.nextId++}`;
    const workingDir = cwd || process.cwd();

    const psPath = findNativePowerShellPath();

    const child = spawn(psPath, ['-NoProfile', '-Command', command], {
      cwd: workingDir,
      env: { ...process.env },
      detached: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const bgProcess: BackgroundProcess = {
      id,
      command,
      process: child,
      startedAt: new Date(),
      cwd: workingDir,
      output: [],
      maxOutputLines: 100,
    };

    // Capture output
    child.stdout?.on('data', (data) => {
      const lines = data.toString().split('\n').filter((l: string) => l.trim());
      bgProcess.output.push(...lines);
      // Keep only last N lines
      if (bgProcess.output.length > bgProcess.maxOutputLines) {
        bgProcess.output = bgProcess.output.slice(-bgProcess.maxOutputLines);
      }
    });

    child.stderr?.on('data', (data) => {
      const lines = data.toString().split('\n').filter((l: string) => l.trim());
      bgProcess.output.push(...lines.map((l: string) => `[stderr] ${l}`));
      if (bgProcess.output.length > bgProcess.maxOutputLines) {
        bgProcess.output = bgProcess.output.slice(-bgProcess.maxOutputLines);
      }
    });

    child.on('close', (code) => {
      bgProcess.output.push(`[Process exited with code ${code}]`);
    });

    child.on('error', (error) => {
      bgProcess.output.push(`[Error: ${error.message}]`);
    });

    this.processes.set(id, bgProcess);

    return { id, pid: child.pid || 0 };
  }

  /**
   * Kill a background process
   */
  kill(id: string): boolean {
    const bgProcess = this.processes.get(id);
    if (!bgProcess) {
      return false;
    }

    try {
      bgProcess.process.kill('SIGTERM');
      // Give it a moment, then force kill if needed
      setTimeout(() => {
        if (!bgProcess.process.killed) {
          bgProcess.process.kill('SIGKILL');
        }
      }, 2000);
      this.processes.delete(id);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get process status
   */
  getStatus(id: string): { running: boolean; output: string[] } | null {
    const bgProcess = this.processes.get(id);
    if (!bgProcess) {
      return null;
    }

    return {
      running: !bgProcess.process.killed && bgProcess.process.exitCode === null,
      output: bgProcess.output.slice(-20), // Last 20 lines
    };
  }

  /**
   * List all processes
   */
  list(): Array<{
    id: string;
    command: string;
    pid: number;
    running: boolean;
    startedAt: Date;
    cwd: string;
  }> {
    return Array.from(this.processes.values()).map(p => ({
      id: p.id,
      command: p.command,
      pid: p.process.pid || 0,
      running: !p.process.killed && p.process.exitCode === null,
      startedAt: p.startedAt,
      cwd: p.cwd,
    }));
  }

  /**
   * Kill all processes
   */
  killAll(): number {
    let killed = 0;
    for (const [id] of this.processes) {
      if (this.kill(id)) {
        killed++;
      }
    }
    return killed;
  }
}

// Global instance
export const backgroundPowerShellProcessManager = new BackgroundPowerShellProcessManager();

/**
 * powershell_background Tool Definition
 */
const POWERSHELL_BACKGROUND_DEFINITION: ToolDefinition = {
  type: 'function',
  function: {
    name: 'powershell_background_start',
    description: `Start a PowerShell command in the background on Windows. Use this for long-running processes like:
- npm run dev (development server)
- npm start (application server)
- python -m http.server (simple HTTP server)
- docker-compose up

The command will continue running after this tool returns.`,
    parameters: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: 'Explanation of why you are running this in background',
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

async function executePowerShellBackground(args: Record<string, unknown>): Promise<ToolResult> {
  const command = args['command'] as string;
  const cwd = args['cwd'] as string | undefined;

  logger.enter('powershellBackground.execute', { command, cwd });

  // Check platform - should only run on Native Windows
  if (!isNativeWindows()) {
    return {
      success: false,
      error: 'powershell_background_start tool is only available on Native Windows. Use bash_background instead.',
    };
  }

  try {
    const { id, pid } = backgroundPowerShellProcessManager.start(command, cwd);

    // Wait a moment to check if it started successfully
    await new Promise(r => setTimeout(r, 1000));

    const status = backgroundPowerShellProcessManager.getStatus(id);
    const running = status?.running ?? false;

    if (!running) {
      const output = status?.output.join('\n') || '(no output)';
      return {
        success: false,
        error: `Process failed to start or exited immediately.\nOutput:\n${output}`,
      };
    }

    logger.exit('powershellBackground.execute', { id, pid });

    return {
      success: true,
      result: `Background process started\nID: ${id}\nPID: ${pid}\nCommand: ${command}\n\nUse powershell_background_read with id="${id}" to check output.\nUse powershell_background_stop with id="${id}" to stop it.`,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: `Failed to start background process: ${errorMessage}`,
    };
  }
}

export const powershellBackgroundTool: LLMSimpleTool = {
  definition: POWERSHELL_BACKGROUND_DEFINITION,
  execute: executePowerShellBackground,
  categories: ['llm-simple'] as ToolCategory[],
  description: 'Run PowerShell command in background',
};

/**
 * powershell_background_status Tool Definition
 */
const POWERSHELL_BACKGROUND_STATUS_DEFINITION: ToolDefinition = {
  type: 'function',
  function: {
    name: 'powershell_background_read',
    description: 'Read output from a background PowerShell task.',
    parameters: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: 'Explanation of why you are checking status',
        },
        id: {
          type: 'string',
          description: 'The process ID (e.g., "ps-bg-1") returned by powershell_background_start',
        },
      },
      required: ['reason', 'id'],
    },
  },
};

async function executePowerShellBackgroundStatus(args: Record<string, unknown>): Promise<ToolResult> {
  const id = args['id'] as string;

  // Check platform
  if (!isNativeWindows()) {
    return {
      success: false,
      error: 'powershell_background_read tool is only available on Native Windows.',
    };
  }

  const status = backgroundPowerShellProcessManager.getStatus(id);

  if (!status) {
    // Check if it's a list request
    if (!id || id === 'list') {
      const processes = backgroundPowerShellProcessManager.list();
      if (processes.length === 0) {
        return {
          success: true,
          result: 'No background PowerShell processes running.',
        };
      }

      const list = processes.map(p => {
        const status = p.running ? 'running' : 'stopped';
        return `- ${p.id}: ${p.command} (PID: ${p.pid}, ${status})`;
      }).join('\n');

      return {
        success: true,
        result: `Background PowerShell processes:\n${list}`,
      };
    }

    return {
      success: false,
      error: `No background process found with ID: ${id}`,
    };
  }

  const statusStr = status.running ? 'Running' : 'Stopped';
  const output = status.output.length > 0
    ? status.output.join('\n')
    : '(no output yet)';

  return {
    success: true,
    result: `Process ${id}:\nStatus: ${statusStr}\n\nRecent output:\n${output}`,
  };
}

export const powershellBackgroundStatusTool: LLMSimpleTool = {
  definition: POWERSHELL_BACKGROUND_STATUS_DEFINITION,
  execute: executePowerShellBackgroundStatus,
  categories: ['llm-simple'] as ToolCategory[],
  description: 'Check background PowerShell process status',
};

/**
 * powershell_background_kill Tool Definition
 */
const POWERSHELL_BACKGROUND_KILL_DEFINITION: ToolDefinition = {
  type: 'function',
  function: {
    name: 'powershell_background_stop',
    description: 'Stop a background PowerShell task.',
    parameters: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: 'Explanation of why you are killing this process',
        },
        id: {
          type: 'string',
          description: 'The process ID (e.g., "ps-bg-1") to kill, or "all" to kill all background processes',
        },
      },
      required: ['reason', 'id'],
    },
  },
};

async function executePowerShellBackgroundKill(args: Record<string, unknown>): Promise<ToolResult> {
  const id = args['id'] as string;

  // Check platform
  if (!isNativeWindows()) {
    return {
      success: false,
      error: 'powershell_background_stop tool is only available on Native Windows.',
    };
  }

  if (id === 'all') {
    const killed = backgroundPowerShellProcessManager.killAll();
    return {
      success: true,
      result: `Killed ${killed} background PowerShell process(es).`,
    };
  }

  const success = backgroundPowerShellProcessManager.kill(id);

  if (!success) {
    return {
      success: false,
      error: `No background process found with ID: ${id}`,
    };
  }

  return {
    success: true,
    result: `Background process ${id} has been killed.`,
  };
}

export const powershellBackgroundKillTool: LLMSimpleTool = {
  definition: POWERSHELL_BACKGROUND_KILL_DEFINITION,
  execute: executePowerShellBackgroundKill,
  categories: ['llm-simple'] as ToolCategory[],
  description: 'Kill background PowerShell process',
};

/**
 * All background PowerShell tools
 */
export const BACKGROUND_POWERSHELL_TOOLS: LLMSimpleTool[] = [
  powershellBackgroundTool,
  powershellBackgroundStatusTool,
  powershellBackgroundKillTool,
];
