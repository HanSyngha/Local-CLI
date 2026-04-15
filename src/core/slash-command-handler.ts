/**
 * Slash Command Handler
 *
 * Core logic for handling slash commands
 * This module provides reusable command execution logic
 */

import { Message, TodoItem } from '../types/index.js';
import { sessionManager } from './session/session-manager.js';
import { usageTracker } from './usage-tracker.js';
import { contextTracker } from './compact/context-tracker.js';
import { logger } from '../utils/logger.js';
import { loadContextFile } from '../utils/context-loader.js';
// Planning mode is always 'auto' - other modes have been removed
export type PlanningMode = 'auto';

export interface CompactResult {
  success: boolean;
  originalMessageCount: number;
  newMessageCount: number;
  compactedMessages?: Message[];
  error?: string;
}

export interface CommandHandlerContext {
  planningMode: PlanningMode;
  messages: Message[];
  todos: TodoItem[];
  setPlanningMode: (mode: PlanningMode) => void;
  setMessages: (messages: Message[]) => void;
  setTodos: (todos: TodoItem[]) => void;
  exit: () => void;
  // Optional UI control callbacks
  onShowSessionBrowser?: () => void;
  onShowSettings?: () => void;
  onShowModelSelector?: () => void;
  onShowToolSelector?: () => void;
  onShowVisionSelector?: () => void;
  onCompact?: () => Promise<CompactResult>;
}

export interface CommandExecutionResult {
  handled: boolean;
  shouldContinue: boolean;
  updatedContext?: Partial<CommandHandlerContext>;
}


/**
 * Execute a slash command
 * Returns true if command was handled, false otherwise
 */
export async function executeSlashCommand(
  command: string,
  context: CommandHandlerContext
): Promise<CommandExecutionResult> {
  const trimmedCommand = command.trim();
  logger.enter('executeSlashCommand', { command: trimmedCommand });

  // Exit commands
  if (trimmedCommand === '/exit' || trimmedCommand === '/quit') {
    logger.flow('Exit command received');
    context.exit();
    logger.exit('executeSlashCommand', { handled: true, command: 'exit' });
    return { handled: true, shouldContinue: false };
  }

  // Clear command
  if (trimmedCommand === '/clear') {
    logger.flow('Clear command - resetting messages, todos, and context tracker');
    context.setMessages([]);
    context.setTodos([]);
    contextTracker.reset();
    logger.exit('executeSlashCommand', { handled: true, command: 'clear' });
    return {
      handled: true,
      shouldContinue: false,
      updatedContext: {
        messages: [],
        todos: [],
      },
    };
  }

  // Compact command - compress conversation history
  if (trimmedCommand === '/compact') {
    logger.flow('Compact command received');
    if (context.onCompact) {
      logger.flow('Executing compact callback');
      const result = await context.onCompact();
      logger.vars(
        { name: 'compactSuccess', value: result.success },
        { name: 'originalCount', value: result.originalMessageCount },
        { name: 'newCount', value: result.newMessageCount }
      );
      const compactMessage = result.success
        ? `✅  . (${result.originalMessageCount} → ${result.newMessageCount} )`
        : `❌  : ${result.error}`;
      // Use compacted messages if available, otherwise fall back to original
      const baseMessages = (result.success && result.compactedMessages)
        ? result.compactedMessages
        : context.messages;
      const updatedMessages = [
        ...baseMessages,
        { role: 'assistant' as const, content: compactMessage },
      ];
      context.setMessages(updatedMessages);
      return {
        handled: true,
        shouldContinue: false,
        updatedContext: {
          messages: updatedMessages,
        },
      };
    }
    // Fallback if no compact callback
    const fallbackMessage = '/compact interactive mode   .';
    const updatedMessages = [
      ...context.messages,
      { role: 'assistant' as const, content: fallbackMessage },
    ];
    context.setMessages(updatedMessages);
    return {
      handled: true,
      shouldContinue: false,
      updatedContext: {
        messages: updatedMessages,
      },
    };
  }

  // Settings command - show settings UI
  if (trimmedCommand === '/settings') {
    if (context.onShowSettings) {
      context.onShowSettings();
      return {
        handled: true,
        shouldContinue: false,
      };
    }
    // Fallback if no UI callback
    const settingsMessage = `Current Settings:\n  Planning Mode: ${context.planningMode}\n\nUse /settings in interactive mode to change settings.`;
    const updatedMessages = [
      ...context.messages,
      { role: 'assistant' as const, content: settingsMessage },
    ];
    context.setMessages(updatedMessages);
    return {
      handled: true,
      shouldContinue: false,
      updatedContext: {
        messages: updatedMessages,
      },
    };
  }

  // Model command - show model selector
  if (trimmedCommand === '/model') {
    if (context.onShowModelSelector) {
      context.onShowModelSelector();
      return {
        handled: true,
        shouldContinue: false,
      };
    }
    // Fallback if no UI callback
    const modelMessage = `Use /model in interactive mode to switch between LLM models.`;
    const updatedMessages = [
      ...context.messages,
      { role: 'assistant' as const, content: modelMessage },
    ];
    context.setMessages(updatedMessages);
    return {
      handled: true,
      shouldContinue: false,
      updatedContext: {
        messages: updatedMessages,
      },
    };
  }

  // Vision model command - show vision model selector
  if (trimmedCommand === '/vision') {
    if (context.onShowVisionSelector) {
      context.onShowVisionSelector();
      return {
        handled: true,
        shouldContinue: false,
      };
    }
    const visionMessage = `Use /vision in interactive mode to select which vision model to use for image analysis.`;
    const updatedMessages = [
      ...context.messages,
      { role: 'assistant' as const, content: visionMessage },
    ];
    context.setMessages(updatedMessages);
    return {
      handled: true,
      shouldContinue: false,
      updatedContext: {
        messages: updatedMessages,
      },
    };
  }

  // Tool command - show tool selector for optional tools
  if (trimmedCommand === '/tool' || trimmedCommand === '/tools') {
    if (context.onShowToolSelector) {
      context.onShowToolSelector();
      return {
        handled: true,
        shouldContinue: false,
      };
    }
    // Fallback if no UI callback
    const toolMessage = `Use /tool in interactive mode to enable/disable optional tools (Browser Automation, Background Processes).`;
    const updatedMessages = [
      ...context.messages,
      { role: 'assistant' as const, content: toolMessage },
    ];
    context.setMessages(updatedMessages);
    return {
      handled: true,
      shouldContinue: false,
      updatedContext: {
        messages: updatedMessages,
      },
    };
  }

  // Usage command - show token usage statistics
  if (trimmedCommand === '/usage') {
    const usageMessage = usageTracker.formatUsageDisplay();
    const updatedMessages = [
      ...context.messages,
      { role: 'assistant' as const, content: usageMessage },
    ];
    context.setMessages(updatedMessages);
    return {
      handled: true,
      shouldContinue: false,
      updatedContext: {
        messages: updatedMessages,
      },
    };
  }

  // Help command
  if (trimmedCommand === '/help') {
    const helpMessage = `
Available commands:
  /exit, /quit    - Exit the application
  /clear          - Clear conversation and TODOs
  /compact        - Compact conversation to free up context
  /context        - Show loaded context.md contents (or where to put one)
  /settings       - Open settings menu
  /model          - Switch between LLM models
  /vision         - Select vision model for image analysis
  /tool           - Enable/disable optional tools (Browser, Background)
  /load           - Load a saved session
  /usage          - Show token usage statistics

Keyboard shortcuts:
  Ctrl+C          - Exit
  Ctrl+T          - Toggle TODO details
  ESC             - Interrupt current execution

Note: All conversations are automatically saved.
    `;
    const updatedMessages = [
      ...context.messages,
      { role: 'assistant' as const, content: helpMessage },
    ];
    context.setMessages(updatedMessages);
    return {
      handled: true,
      shouldContinue: false,
      updatedContext: {
        messages: updatedMessages,
      },
    };
  }

  // Load command - load saved session
  if (trimmedCommand.startsWith('/load')) {
    logger.flow('Load command received');
    const parts = trimmedCommand.split(' ');
    const sessionIdOrIndex = parts[1];
    logger.vars({ name: 'sessionIdOrIndex', value: sessionIdOrIndex });

    try {
      const sessions = await sessionManager.listSessions();
      logger.vars({ name: 'availableSessions', value: sessions.length });

      if (sessions.length === 0) {
        const noSessionMessage = '  .';
        const updatedMessages = [
          ...context.messages,
          { role: 'assistant' as const, content: noSessionMessage },
        ];
        context.setMessages(updatedMessages);
        return {
          handled: true,
          shouldContinue: false,
          updatedContext: {
            messages: updatedMessages,
          },
        };
      }

      // If no session ID provided, show SessionBrowser UI if available, otherwise show text list
      if (!sessionIdOrIndex) {
        // If UI callback is available (React UI), trigger SessionBrowser
        if (context.onShowSessionBrowser) {
          context.onShowSessionBrowser();
          return {
            handled: true,
            shouldContinue: false,
          };
        }

        // Fallback to text list (Classic CLI mode)
        const sessionList = sessions.map((session, index) => {
          const date = new Date(session.createdAt).toLocaleDateString('ko-KR');
          return `${index + 1}. ${session.name} (${session.messageCount} , ${date})`;
        }).join('\n');

        const listMessage = `  :\n\n${sessionList}\n\n: /load <>  /load <ID>`;
        const updatedMessages = [
          ...context.messages,
          { role: 'assistant' as const, content: listMessage },
        ];
        context.setMessages(updatedMessages);
        return {
          handled: true,
          shouldContinue: false,
          updatedContext: {
            messages: updatedMessages,
          },
        };
      }

      // Load session by index or ID
      let sessionId: string;
      const index = parseInt(sessionIdOrIndex);
      if (!isNaN(index) && index > 0 && index <= sessions.length) {
        // Load by index
        sessionId = sessions[index - 1]!.id;
      } else {
        // Load by ID
        sessionId = sessionIdOrIndex;
      }

      const sessionData = await sessionManager.loadSession(sessionId);
      if (!sessionData) {
        logger.warn('Session not found', { sessionIdOrIndex });
        const errorMessage = `   : ${sessionIdOrIndex}`;
        const updatedMessages = [
          ...context.messages,
          { role: 'assistant' as const, content: errorMessage },
        ];
        context.setMessages(updatedMessages);
        return {
          handled: true,
          shouldContinue: false,
          updatedContext: {
            messages: updatedMessages,
          },
        };
      }

      // Restore messages (without adding success message)
      const loadedMessages = sessionData.messages;
      context.setMessages(loadedMessages);

      logger.flow('Session loaded successfully', { messageCount: loadedMessages.length });
      logger.exit('executeSlashCommand', { handled: true, command: 'load', sessionId });
      return {
        handled: true,
        shouldContinue: false,
        updatedContext: {
          messages: loadedMessages,
        },
      };
    } catch (error) {
      logger.error('Session load failed', error as Error);
      const errorMessage = `  : ${error instanceof Error ? error.message : 'Unknown error'}`;
      const updatedMessages = [
        ...context.messages,
        { role: 'assistant' as const, content: errorMessage },
      ];
      context.setMessages(updatedMessages);
      return {
        handled: true,
        shouldContinue: false,
        updatedContext: {
          messages: updatedMessages,
        },
      };
    }
  }

  // Context command - dump loaded context.md and system prompt info
  if (trimmedCommand === '/context') {
    const cwd = process.cwd();
    const contextContent = await loadContextFile();
    let contextMessage: string;
    if (contextContent) {
      contextMessage = `**Context file loaded** from: ${cwd}/context.md\n\n--- context.md contents ---\n${contextContent}\n--- end of context.md ---`;
    } else {
      contextMessage = `**No context file found.**\n\nLooked for: ${cwd}/context.md\n\nTo add project context, create a \`context.md\` file in your current directory. Its contents will be injected into the system prompt automatically.`;
    }
    const updatedMessages = [
      ...context.messages,
      { role: 'assistant' as const, content: contextMessage },
    ];
    context.setMessages(updatedMessages);
    return {
      handled: true,
      shouldContinue: false,
      updatedContext: { messages: updatedMessages },
    };
  }

  // Unknown command
  if (trimmedCommand.startsWith('/')) {
    const unknownMessage = `Unknown command: ${trimmedCommand}. Type /help for available commands.`;
    const updatedMessages = [
      ...context.messages,
      { role: 'assistant' as const, content: unknownMessage },
    ];
    context.setMessages(updatedMessages);
    return {
      handled: true,
      shouldContinue: false,
      updatedContext: {
        messages: updatedMessages,
      },
    };
  }

  // Not a command
  return { handled: false, shouldContinue: true };
}

/**
 * Check if a message is a slash command
 */
export function isSlashCommand(message: string): boolean {
  return message.trim().startsWith('/');
}
