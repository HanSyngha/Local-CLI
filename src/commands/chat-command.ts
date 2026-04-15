/**
 * Chat Command
 *
 * CLI Electron Chat      .
 * `local-cli chat "  "` → Electron Chat  → stdout 
 */

import chalk from 'chalk';
import { CLI_SERVER_PORT } from '../constants.js';
import { ElectronClient, SSEEvent } from './electron-client.js';

function log(msg: string): void {
  process.stderr.write(msg + '\n');
}

export async function runChatCommand(prompt: string, specific: boolean): Promise<void> {
  const client = new ElectronClient(CLI_SERVER_PORT);

  // Electron  
  if (!await client.isRunning()) {
    if (specific) log(chalk.dim('Electron   ...'));
    try {
      await client.startElectron();
      if (specific) log(chalk.dim('Electron  '));
    } catch (error) {
      console.error(chalk.red(error instanceof Error ? error.message : String(error)));
      process.exit(1);
    }
  }

  try {
    const response = await client.execute('chat', prompt, (event: SSEEvent) => {
      if (!specific) return;
      handleSSEEvent(event);
    });

    if (response) {
      console.log(response);
    }
  } catch (error) {
    console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
    process.exit(1);
  }
}

function handleSSEEvent(event: SSEEvent): void {
  const data = event.data as Record<string, unknown>;

  switch (event.event) {
    case 'status': {
      const phase = data['phase'] as string;
      if (phase === 'planning') log(chalk.yellow('\n[Planning] TODO  ...'));
      if (phase === 'complete') log(chalk.dim('\n[Complete]'));
      break;
    }
    case 'todo': {
      const todos = data as unknown as Array<{ title: string; status: string }>;
      if (Array.isArray(todos)) {
        for (const todo of todos) {
          if (todo.status === 'in_progress') {
            log(chalk.cyan(`\n[Executing] ${todo.title}`));
          } else if (todo.status === 'completed') {
            log(chalk.green(`  ✓ ${todo.title}`));
          }
        }
      }
      break;
    }
    case 'tool': {
      const name = data['name'] as string;
      const summary = data['summary'] as string;
      log(chalk.dim(`  → ${name} ${summary || ''}`));
      break;
    }
    case 'tool_result': {
      const success = data['success'] as boolean;
      if (success) {
        log(chalk.dim('  ← OK'));
      } else {
        log(chalk.red('  ← Error'));
      }
      break;
    }
    case 'ask_user': {
      const question = data['question'] as string;
      log(chalk.magenta(`  [Auto] Q: ${question}`));
      break;
    }
    case 'error': {
      const message = data['message'] as string;
      log(chalk.red(`  [Error] ${message}`));
      break;
    }
  }
}
