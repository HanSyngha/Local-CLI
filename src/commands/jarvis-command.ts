/**
 * Jarvis Command
 *
 * CLI Electron Jarvis     .
 * `local-cli jarvis "   "` → Jarvis  → stdout 
 */

import chalk from 'chalk';
import { CLI_SERVER_PORT } from '../constants.js';
import { ElectronClient, SSEEvent } from './electron-client.js';

function log(msg: string): void {
  process.stderr.write(msg + '\n');
}

export async function runJarvisCommand(prompt: string, specific: boolean): Promise<void> {
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
    const response = await client.execute('jarvis', prompt, (event: SSEEvent) => {
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
      if (phase === 'starting') log(chalk.yellow('\n[Jarvis]  ...'));
      if (phase === 'complete') log(chalk.dim('\n[Complete]'));
      break;
    }
    case 'jarvis_message': {
      const type = data['type'] as string;
      const content = data['content'] as string;
      if (type === 'execution_status') {
        log(chalk.dim(`  [Jarvis] ${content}`));
      } else if (type === 'jarvis') {
        log(chalk.cyan(`  [Jarvis] ${content.slice(0, 200)}`));
      }
      break;
    }
    case 'error': {
      const message = data['message'] as string;
      log(chalk.red(`  [Error] ${message}`));
      break;
    }
  }
}
