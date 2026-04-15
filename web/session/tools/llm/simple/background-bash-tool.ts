/**
 * Background Bash Tool (Linux Docker dedicated)
 *
 *  bash    
 * npm run dev, npm start     
 */

import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import { ToolDefinition } from '../../../types/index.js';
import { LLMSimpleTool, ToolResult, ToolCategory } from '../../types.js';
import { logger } from '../../../utils/logger.js';


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
 * Background Process Manager
 */
class BackgroundProcessManager {
  private processes: Map<string, BackgroundProcess> = new Map();
  private nextId = 1;

  /**
   * Start a background process
   */
  start(command: string, cwd?: string): { id: string; pid: number } {
    const id = `bg-${this.nextId++}`;
    const workingDir = cwd || process.cwd();

    // Always use bash on WSL/Linux
    const shell = '/bin/bash';
    const shellArgs = ['-c', command];

    const child = spawn(shell, shellArgs, {
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
export const backgroundProcessManager = new BackgroundProcessManager();

/**
 * bash_background Tool Definition
 */
const BASH_BACKGROUND_DEFINITION: ToolDefinition = {
  type: 'function',
  function: {
    name: 'bash_background',
    description: `Start a command in the background. Use this for long-running processes like:
- npm run dev (development server)
- npm start (application server)
- python -m http.server (simple HTTP server)
- docker-compose up

The command will continue running after this tool returns.
Use bash_background_status to check output, or bash_background_kill to stop it.`,
    parameters: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: 'Explanation of why you are running this in background',
        },
        command: {
          type: 'string',
          description: 'The command to run in background',
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

async function executeBashBackground(args: Record<string, unknown>): Promise<ToolResult> {
  const command = args['command'] as string;
  const cwd = args['cwd'] as string | undefined;

  logger.enter('bashBackground.execute', { command, cwd });

  // Validate cwd exists and is a directory
  if (cwd) {
    if (!fs.existsSync(cwd)) {
      logger.warn('Invalid cwd provided (does not exist)', { cwd });
      return {
        success: false,
        error: `Working directory does not exist: ${cwd}`,
      };
    }
    if (!fs.statSync(cwd).isDirectory()) {
      logger.warn('Invalid cwd provided (not a directory)', { cwd });
      return {
        success: false,
        error: `Working directory path is not a directory: ${cwd}`,
      };
    }
  }

  try {
    const { id, pid } = backgroundProcessManager.start(command, cwd);

    // Wait a moment to check if it started successfully
    await new Promise(r => setTimeout(r, 1000));

    const status = backgroundProcessManager.getStatus(id);
    const running = status?.running ?? false;

    if (!running) {
      const output = status?.output.join('\n') || '(no output)';
      return {
        success: false,
        error: `Process failed to start or exited immediately.\nOutput:\n${output}`,
      };
    }

    logger.exit('bashBackground.execute', { id, pid });

    return {
      success: true,
      result: `Background process started\nID: ${id}\nPID: ${pid}\nCommand: ${command}\n\nUse bash_background_status with id="${id}" to check output.\nUse bash_background_kill with id="${id}" to stop it.`,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: `Failed to start background process: ${errorMessage}`,
    };
  }
}

export const bashBackgroundTool: LLMSimpleTool = {
  definition: BASH_BACKGROUND_DEFINITION,
  execute: executeBashBackground,
  categories: ['llm-simple'] as ToolCategory[],
  description: 'Run command in background',
};

/**
 * bash_background_status Tool Definition
 */
const BASH_BACKGROUND_STATUS_DEFINITION: ToolDefinition = {
  type: 'function',
  function: {
    name: 'bash_background_status',
    description: `Check the status and recent output of a background process.
Use this to see if a server started successfully or to check for errors.`,
    parameters: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: 'Explanation of why you are checking status',
        },
        id: {
          type: 'string',
          description: 'The process ID (e.g., "bg-1") returned by bash_background',
        },
      },
      required: ['reason', 'id'],
    },
  },
};

async function executeBashBackgroundStatus(args: Record<string, unknown>): Promise<ToolResult> {
  const id = args['id'] as string;

  const status = backgroundProcessManager.getStatus(id);

  if (!status) {
    // Check if it's a list request
    if (!id || id === 'list') {
      const processes = backgroundProcessManager.list();
      if (processes.length === 0) {
        return {
          success: true,
          result: 'No background processes running.',
        };
      }

      const list = processes.map(p => {
        const status = p.running ? 'running' : 'stopped';
        return `- ${p.id}: ${p.command} (PID: ${p.pid}, ${status})`;
      }).join('\n');

      return {
        success: true,
        result: `Background processes:\n${list}`,
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

export const bashBackgroundStatusTool: LLMSimpleTool = {
  definition: BASH_BACKGROUND_STATUS_DEFINITION,
  execute: executeBashBackgroundStatus,
  categories: ['llm-simple'] as ToolCategory[],
  description: 'Check background process status',
};

/**
 * bash_background_kill Tool Definition
 */
const BASH_BACKGROUND_KILL_DEFINITION: ToolDefinition = {
  type: 'function',
  function: {
    name: 'bash_background_kill',
    description: `Stop a background process.
Use this to stop development servers, watchers, or other long-running processes.`,
    parameters: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: 'Explanation of why you are killing this process',
        },
        id: {
          type: 'string',
          description: 'The process ID (e.g., "bg-1") to kill, or "all" to kill all background processes',
        },
      },
      required: ['reason', 'id'],
    },
  },
};

async function executeBashBackgroundKill(args: Record<string, unknown>): Promise<ToolResult> {
  const id = args['id'] as string;

  if (id === 'all') {
    const killed = backgroundProcessManager.killAll();
    return {
      success: true,
      result: `Killed ${killed} background process(es).`,
    };
  }

  const success = backgroundProcessManager.kill(id);

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

export const bashBackgroundKillTool: LLMSimpleTool = {
  definition: BASH_BACKGROUND_KILL_DEFINITION,
  execute: executeBashBackgroundKill,
  categories: ['llm-simple'] as ToolCategory[],
  description: 'Kill background process',
};

/**
 * All background bash tools
 */
export const BACKGROUND_BASH_TOOLS: LLMSimpleTool[] = [
  bashBackgroundTool,
  bashBackgroundStatusTool,
  bashBackgroundKillTool,
];
