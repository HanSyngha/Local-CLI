/**
 * PowerShell Tool (Native Windows Only)
 *
 * LLM PowerShell      
 * Native Windows  
 */

import { spawn } from 'node:child_process';
import { ToolDefinition } from '../../../types/index.js';
import { LLMSimpleTool, ToolResult, ToolCategory } from '../../types.js';
import { logger } from '../../../utils/logger.js';
import {
  isNativeWindows,
  findNativePowerShellPath,
  isDangerousPowerShellCommand,
} from '../../../utils/platform-utils.js';

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

/**
 * Execute PowerShell command
 */
async function executePowerShell(
  command: string,
  cwd?: string,
  timeout: number = 30000
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const psPath = findNativePowerShellPath();

    // Use -NoProfile for faster startup, -Command for direct execution
    const child = spawn(psPath, ['-NoProfile', '-Command', command], {
      cwd: cwd || process.cwd(),
      env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';
    let killed = false;

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      if (!killed) {
        resolve({
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          exitCode: code ?? 0,
        });
      }
    });

    child.on('error', (error) => {
      reject(error);
    });

    // Timeout handling
    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGTERM');
      reject(new Error(`Command timed out after ${timeout}ms`));
    }, timeout);

    child.on('close', () => {
      clearTimeout(timer);
    });
  });
}

/**
 * PowerShell Tool Definition
 */
const POWERSHELL_TOOL_DEFINITION: ToolDefinition = {
  type: 'function',
  function: {
    name: 'powershell',
    description: `Execute a PowerShell command on Windows. Use this to run terminal commands like git, npm, docker, python, etc.

IMPORTANT:
- Do NOT use for file reading/writing - use read_file, create_file, edit_file instead
- Commands have a 30 second timeout by default
- Dangerous commands (Remove-Item -Recurse -Force C:\\, Stop-Computer, etc.) are blocked
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
          description: `A natural, conversational explanation for the user about what you're doing (in user's language).
Write as if you're talking to the user directly.
Examples:
- "Installing project dependencies"
- "Running tests to check the results"
- "Checking git status"
- "Running the build"`,
        },
        command: {
          type: 'string',
          description: 'The PowerShell command to execute',
        },
        cwd: {
          type: 'string',
          description: 'Working directory for the command (optional, defaults to current directory)',
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

/**
 * PowerShell Tool (LLM Simple)
 */
export const powershellTool: LLMSimpleTool = {
  definition: POWERSHELL_TOOL_DEFINITION,
  categories: ['llm-simple'] as ToolCategory[],

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const command = args['command'] as string;
    const cwd = args['cwd'] as string | undefined;
    const timeout = (args['timeout'] as number) || 30000;

    logger.enter('powershellTool.execute', { command, cwd, timeout });

    // Check platform - should only run on Native Windows
    if (!isNativeWindows()) {
      return {
        success: false,
        error: 'powershell tool is only available on Native Windows. Use bash instead.',
      };
    }

    // Validate command
    if (!command || typeof command !== 'string') {
      return {
        success: false,
        error: 'command is required and must be a string',
      };
    }

    // Check for dangerous commands
    if (isDangerousPowerShellCommand(command)) {
      logger.warn('Dangerous PowerShell command blocked', { command });
      return {
        success: false,
        error: 'This command is blocked for safety reasons',
      };
    }

    try {
      const processedCommand = preprocessPowerShellCommand(command);
      if (processedCommand !== command) {
        logger.info('PowerShell command preprocessed', { original: command, processed: processedCommand });
      }
      const execResult = await executePowerShell(processedCommand, cwd, timeout);

      // Combine output
      let output = '';
      if (execResult.stdout) {
        output += execResult.stdout;
      }
      if (execResult.stderr) {
        output += (output ? '\n\n' : '') + `stderr:\n${execResult.stderr}`;
      }

      // Truncate if too long
      const MAX_OUTPUT_LENGTH = 50000;
      if (output.length > MAX_OUTPUT_LENGTH) {
        output = output.slice(0, MAX_OUTPUT_LENGTH) + '\n\n... [output truncated]';
      }

      // Add exit code if non-zero
      if (execResult.exitCode !== 0) {
        output += `\n\n[Exit code: ${execResult.exitCode}]`;
      }

      logger.exit('powershellTool.execute', { exitCode: execResult.exitCode, outputLength: output.length });

      // Return with error field when command fails
      if (execResult.exitCode !== 0) {
        return {
          success: false,
          error: output || '(no output)',
        };
      }

      return {
        success: true,
        result: output || '(no output)',
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('powershellTool.execute failed', error as Error);

      return {
        success: false,
        error: `Error executing command: ${errorMessage}`,
      };
    }
  },
};

export default powershellTool;
