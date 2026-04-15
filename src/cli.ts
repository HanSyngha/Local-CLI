#!/usr/bin/env node

/**
 * LOCAL-CLI
 *       LLM CLI 
 *
 * Entry Point: CLI  
 */

import { Command } from 'commander';
import chalk from 'chalk';
import React from 'react';
import { render } from 'ink';
import { createRequire } from 'module';
import { configManager } from './core/config/config-manager.js';
import { createLLMClient } from './core/llm/llm-client.js';
import { PlanExecuteApp } from './ui/components/PlanExecuteApp.js';
import { setupLogging, logger } from './utils/logger.js';
import { runPipeMode } from './pipe/index.js';
import { initializeOptionalTools } from './tools/registry.js';
import { sessionManager } from './core/session/session-manager.js';
import { reportError } from './core/telemetry/error-reporter.js';
import { runChatCommand } from './commands/chat-command.js';
import { runJarvisCommand } from './commands/jarvis-command.js';

// Read version from package.json (single source of truth)
const require = createRequire(import.meta.url);
const packageJson = require('../package.json') as { version: string };

// Process-level error handlers (fire-and-forget)
process.on('uncaughtException', (error) => {
  reportError(error, { type: 'uncaughtException' }).catch(() => {});
});
process.on('unhandledRejection', (reason) => {
  reportError(reason, { type: 'unhandledRejection' }).catch(() => {});
});

const program = new Command();

/**
 * CLI  
 */
program
  .name('local-cli')
  .description('Local CLI - OpenAI-Compatible Local CLI Coding Agent')
  .version(packageJson.version)
  .helpOption(false);  // -h, --help  (/help )

/**
 *  :   
 */
program
  .argument('[prompt]', 'Pipe (-p)  ')
  .option('-p, --pipe', 'Pipe : UI      ')
  .option('-s, --specific', 'Pipe    (-p  )')
  .option('--verbose', 'Enable verbose logging')
  .option('--debug', 'Enable debug logging')
  .option('--llm-log', 'Enable LLM logging')
  .action(async (prompt: string | undefined, options: { pipe?: boolean; specific?: boolean; verbose?: boolean; debug?: boolean; llmLog?: boolean }) => {
    // -p : non-interactive pipe 
    if (options.pipe) {
      if (!prompt) {
        console.error('Error: -p   . : local-cli -p "  "');
        process.exit(1);
      }
      // Setup logging for pipe mode (--verbose, --debug, --llm-log)
      if (options.verbose || options.debug || options.llmLog) {
        await setupLogging({ verbose: options.verbose, debug: options.debug, llmLog: options.llmLog });
      }
      await runPipeMode(prompt, options.specific ?? false);
      return;
    }

    let cleanup: (() => Promise<void>) | null = null;
    try {
      // Clear terminal on start
      process.stdout.write('\x1B[2J\x1B[0f');

      // Show loading spinner immediately (before any async work)
      const ora = (await import('ora')).default;
      const spinner = ora({
        text: chalk.cyan('Local-CLI  ...'),
        color: 'cyan',
      }).start();

      // Setup logging (log level, JSON stream logger, exit handlers)
      const loggingSetup = await setupLogging({
        verbose: options.verbose,
        debug: options.debug,
        llmLog: options.llmLog,
      });
      cleanup = loggingSetup.cleanup;

      // Log session start
      logger.sessionStart({
        sessionId: sessionManager.getCurrentSessionId(),
        verbose: options.verbose,
        debug: options.debug,
        llmLog: options.llmLog,
        cwd: process.cwd(),
        platform: process.platform,
        nodeVersion: process.version,
      });

      // ConfigManager 
      spinner.text = chalk.cyan('  ...');
      logger.flow('Initializing config manager');
      await configManager.initialize();
      logger.flow('Config manager initialized');

      // Load saved optional tool states (e.g., browser tools, Office tools)
      logger.flow('Initializing optional tools');
      await initializeOptionalTools();
      logger.flow('Optional tools initialized');

      // LLMClient  (  null)
      spinner.text = chalk.cyan('LLM   ...');
      let llmClient = null;
      let modelInfo = { model: 'Not configured', endpoint: 'Not configured' };

      if (configManager.hasEndpoints()) {
        logger.flow('Creating LLM client');
        try {
          llmClient = createLLMClient();
          modelInfo = llmClient.getModelInfo();
          logger.flow('LLM client created', { model: modelInfo.model, endpoint: modelInfo.endpoint });
        } catch (error) {
          // LLMClient    null 
          logger.warn('Failed to create LLM client', { error: error instanceof Error ? error.message : String(error) });
        }
      } else {
        logger.flow('No LLM endpoints configured');
      }

      // Stop spinner before starting Ink UI
      spinner.stop();
      process.stdout.write('\x1B[2J\x1B[0f'); // Clear again for clean UI

      // Ink UI  (verbose/debug/llm-log    )
      if (options.verbose || options.debug) {
        console.log(chalk.cyan('🚀 Starting local-cli...\n'));
      }

      // Ink UI     (stdin raw mode )
      try {
        // Use PlanExecuteApp for enhanced functionality
        // exitOnCtrlC: false - Ctrl+C is handled manually in PlanExecuteApp for smart behavior
        const { waitUntilExit } = render(
          React.createElement(PlanExecuteApp, { llmClient, modelInfo }),
          { exitOnCtrlC: false }
        );

        // Wait until the UI exits before cleanup
        await waitUntilExit();
      } catch (error) {
        reportError(error, { type: 'inkUiInit' }).catch(() => {});
        console.log(chalk.yellow('\n⚠️  Ink UI   .\n'));
        console.log(chalk.dim(`Error: ${error instanceof Error ? error.message : String(error)}\n`));
        process.exit(1);
      }
    } catch (error) {
      reportError(error, { type: 'initialization' }).catch(() => {});
      console.error(chalk.red('\n❌  :'));
      if (error instanceof Error) {
        console.error(chalk.red(error.message));
      }
      console.log();
      process.exit(1);
    } finally {
      // Log session end
      logger.sessionEnd({
        sessionId: sessionManager.getCurrentSessionId(),
        exitReason: 'normal',
      });

      // JSON Stream Logger 
      if (cleanup) {
        await cleanup();
      }
    }
  });


/**
 * chat : Electron Chat   
 */
program
  .command('chat')
  .description('Electron Chat    ')
  .argument('<prompt>', ' ')
  .option('-s, --specific', '  stderr ')
  .action(async (prompt: string, opts: { specific?: boolean }) => {
    await runChatCommand(prompt, opts.specific ?? false);
  });

/**
 * jarvis : Electron Jarvis  
 */
program
  .command('jarvis')
  .description('Electron Jarvis    ')
  .argument('<prompt>', ' ')
  .option('-s, --specific', '  stderr ')
  .action(async (prompt: string, opts: { specific?: boolean }) => {
    await runJarvisCommand(prompt, opts.specific ?? false);
  });

/**
 *  :     
 */
program.showHelpAfterError(false);
program.configureOutput({
  outputError: (str, write) => {
    if (str.includes('--help') || str.includes('-h')) {
      write(chalk.yellow('💡 For help, use /help command after starting the app.\n'));
    } else {
      write(chalk.red(str));
    }
  }
});

program.on('command:*', () => {
  console.error(chalk.red('⚠️  Unknown command.'));
  console.log(chalk.white('Usage: local-cli [--verbose] [--debug]\n'));
  console.log(chalk.white('Use /help in interactive mode for help.\n'));
  process.exit(1);
});

/**
 * CLI  
 */
program.parse(process.argv);
