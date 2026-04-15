/**
 * Pipe Runner
 *
 * -p    
 * Non-interactive: CLI       
 * ask_to_user Manager LLM   (Jarvis )
 *
 * -ps : Full observability —  LLM , tool call, tool result,
 *   agent , TODO  stderr  
 */

import chalk from 'chalk';
import { Message, TodoItem } from '../types/index.js';
import type { AskUserRequest, AskUserResponse } from '../orchestration/types.js';
import { createLLMClient } from '../core/llm/llm-client.js';
import { configManager } from '../core/config/config-manager.js';
import { PlanExecutor } from '../orchestration/plan-executor.js';
import type { StateCallbacks } from '../orchestration/types.js';
import { setSubAgentToolCallLogger, setSubAgentPhaseLogger } from '../agents/common/sub-agent.js';

/**
 * stderr    (stdout   dedicated)
 */
function log(msg: string): void {
  process.stderr.write(msg + '\n');
}

/** Timestamp prefix for -ps logs */
function ts(): string {
  return chalk.gray(`[${new Date().toISOString().slice(11, 23)}]`);
}

/** Truncate long strings for display (configurable limit) */
function truncate(s: string, max = 1000): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + chalk.gray(` ...(${s.length - max} chars truncated)`);
}

export class PipeRunner {
  private specific: boolean;
  private llmClient: ReturnType<typeof createLLMClient> | null = null;
  private planExecutor: PlanExecutor;
  private lastResponse: string = '';
  private todos: TodoItem[] = [];
  private prompt: string = '';
  private toolCallTimers: Map<string, number> = new Map();

  constructor(specific: boolean) {
    this.specific = specific;
    this.planExecutor = new PlanExecutor();
  }

  async run(prompt: string): Promise<void> {
    this.prompt = prompt;

    try {
      // Register SubAgent loggers for -ps mode
      if (this.specific) {
        setSubAgentToolCallLogger((_appName, toolName, args, resultText, success, iteration, totalCalls) => {
          const summary = this.formatToolArgs(toolName, args);
          const prefix = `    [${iteration}/${totalCalls}]`;
          if (success) {
            log(chalk.dim(`${prefix} ${ts()} → ${chalk.blue(toolName)} ${summary}`));
            if (resultText) {
              log(chalk.dim(`${prefix}   ← ${truncate(resultText, 500)}`));
            }
          } else {
            log(chalk.red(`${prefix} ${ts()} → ${toolName} ${summary} FAILED`));
            if (resultText) {
              log(chalk.red(`${prefix}   ← ${truncate(resultText, 500)}`));
            }
          }
        });
        setSubAgentPhaseLogger((appName, phase, detail) => {
          log(chalk.yellow(`  ${ts()} [${appName}:${phase}] ${detail}`));
        });
      }

      // 
      await configManager.initialize();

      if (!configManager.hasEndpoints()) {
        log(chalk.red('Error:    .'));
        process.exit(1);
      }

      this.llmClient = createLLMClient();

      if (this.specific) {
        const endpoint = configManager.getCurrentEndpoint();
        const model = configManager.getCurrentModel();
        log(chalk.cyan(`\n${'═'.repeat(80)}`));
        log(chalk.cyan(`  Pipe Mode (-ps) | Model: ${model?.name || 'unknown'} | Endpoint: ${endpoint?.name || 'unknown'}`));
        log(chalk.cyan(`  Prompt: ${truncate(prompt, 200)}`));
        log(chalk.cyan(`${'═'.repeat(80)}\n`));
      }

      // 
      const messages: Message[] = [];
      const isInterruptedRef = { current: false };
      const callbacks = this.createCallbacks();

      const startTime = Date.now();

      await this.planExecutor.executeAutoMode(
        prompt,
        this.llmClient,
        messages,
        this.todos,
        isInterruptedRef,
        callbacks
      );

      if (this.specific) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const completed = this.todos.filter(t => t.status === 'completed').length;
        const failed = this.todos.filter(t => t.status === 'failed').length;
        log(chalk.cyan(`\n${'═'.repeat(80)}`));
        log(chalk.cyan(`  Done in ${elapsed}s | TODOs: ${completed} completed, ${failed} failed / ${this.todos.length} total`));
        log(chalk.cyan(`${'═'.repeat(80)}\n`));
      }

      //    (stdout)
      if (this.lastResponse) {
        console.log(this.lastResponse);
      }
    } catch (error) {
      log(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    } finally {
      // Cleanup global loggers
      setSubAgentToolCallLogger(null);
      setSubAgentPhaseLogger(null);
    }
  }

  private createCallbacks(): StateCallbacks {
    let previousMessages: Message[] = [];

    return {
      setTodos: (todosOrFn) => {
        const newTodos = typeof todosOrFn === 'function'
          ? todosOrFn(this.todos)
          : todosOrFn;

        if (this.specific) {
          for (const todo of newTodos) {
            const existing = this.todos.find(t => t.id === todo.id);
            if (!existing) {
              log(chalk.dim(`  ${ts()} #${newTodos.indexOf(todo) + 1} ${todo.title}`));
            } else if (existing.status !== todo.status) {
              if (todo.status === 'in_progress') {
                log(chalk.cyan(`\n${ts()} ${chalk.bold(`[Executing] #${newTodos.indexOf(todo) + 1} ${todo.title}`)}`));
              } else if (todo.status === 'completed') {
                log(chalk.green(`  ${ts()} ✓ ${todo.title}`));
              } else if (todo.status === 'failed') {
                log(chalk.red(`  ${ts()} ✗ ${todo.title}`));
              }
            }
          }
        }

        this.todos = newTodos;
      },

      setCurrentTodoId: () => {},
      setExecutionPhase: (phase) => {
        if (this.specific && phase === 'planning') {
          log(chalk.yellow(`\n${ts()} [Planning] TODO  ...`));
        }
      },
      setIsInterrupted: () => {},
      setCurrentActivity: () => {},

      setMessages: (messagesOrFn) => {
        const newMessages = typeof messagesOrFn === 'function'
          ? messagesOrFn(previousMessages)
          : messagesOrFn;

        const addedMessages = newMessages.slice(previousMessages.length);

        for (const msg of addedMessages) {
          // Tool call 
          if (msg.role === 'assistant' && msg.tool_calls) {
            for (const toolCall of msg.tool_calls) {
              let args: Record<string, unknown> = {};
              try { args = JSON.parse(toolCall.function.arguments); } catch { /* ignore */ }

              // final_response message lastResponse 
              if (toolCall.function.name === 'final_response' && typeof args['message'] === 'string') {
                this.lastResponse = args['message'];
              }

              // -ps : tool call  
              if (this.specific) {
                const toolName = toolCall.function.name;
                const formatted = this.formatToolArgs(toolName, args);
                log(`  ${ts()} ${chalk.blue('→')} ${chalk.bold(toolName)} ${formatted}`);
                this.toolCallTimers.set(toolCall.id || toolName, Date.now());
              }
            }
          }

          // Tool result  (-ps)
          if (this.specific && msg.role === 'tool') {
            const content = msg.content || '';
            const isError = content.startsWith('Error:') || content.startsWith('error:');
            const toolCallId = (msg as unknown as Record<string, unknown>)['tool_call_id'] as string | undefined;
            const elapsed = toolCallId && this.toolCallTimers.has(toolCallId)
              ? `${Date.now() - this.toolCallTimers.get(toolCallId)!}ms`
              : '';
            if (toolCallId) this.toolCallTimers.delete(toolCallId);

            const elapsedStr = elapsed ? chalk.gray(` (${elapsed})`) : '';

            if (isError) {
              log(chalk.red(`  ${ts()} ← ERROR${elapsedStr}: ${truncate(content, 500)}`));
            } else {
              // Show meaningful content preview
              const preview = this.formatToolResult(content);
              log(chalk.dim(`  ${ts()} ← OK${elapsedStr}${preview ? ': ' + preview : ''}`));
            }
          }

          // Assistant text   (-ps)
          if (msg.role === 'assistant' && !msg.tool_calls && msg.content) {
            this.lastResponse = msg.content;
            if (this.specific) {
              log(chalk.white(`  ${ts()} ${chalk.bold('[Agent Response]')} ${truncate(msg.content, 500)}`));
            }
          }
        }

        previousMessages = newMessages;
      },

      setAskUserRequest: () => {},

      // Manager LLM Sub-LLM    (Jarvis )
      askUser: async (request) => {
        return this.handleAskUser(request);
      },
    };
  }

  /**
   * Manager LLM ask_to_user    (Jarvis )
   */
  private async handleAskUser(request: AskUserRequest): Promise<AskUserResponse> {
    const optionsList = request.options.length > 0
      ? request.options.map((o, i) => `${i + 1}. ${o}`).join('\n')
      : '(  —  )';

    try {
      const response = await this.llmClient!.chatCompletion({
        messages: [
          {
            role: 'system',
            content: `You are an autonomous agent answering a sub-agent's question on behalf of the user.
Use the task context to make the best decision.
If options are given, reply with EXACTLY one of the option texts.
Reply in English. No explanation, just the answer.`,
          },
          {
            role: 'user',
            content: `<TASK>\n${this.prompt}\n</TASK>\n\n: ${request.question}\n\n:\n${optionsList}`,
          },
        ],
        temperature: 0.3,
      });

      const answer = response.choices?.[0]?.message?.content?.trim() || '';

      if (request.options.length > 0) {
        const exact = request.options.find(o => o === answer);
        const partial = !exact ? request.options.find(o => answer.includes(o) || o.includes(answer)) : undefined;
        const selected: string = exact ?? partial ?? request.options[0] ?? '';

        if (this.specific) {
          log(chalk.magenta(`  ${ts()} [Auto] Q: ${request.question} → A: ${selected}`));
        }
        return { selectedOption: selected, isOther: false };
      }

      if (this.specific) {
        log(chalk.magenta(`  ${ts()} [Auto] Q: ${request.question} → A: ${answer || 'Yes'}`));
      }
      return { selectedOption: answer || 'Yes', isOther: true };
    } catch {
      const fallback = request.options[0] || 'Yes';
      if (this.specific) {
        log(chalk.magenta(`  ${ts()} [Auto] Q: ${request.question} → A: ${fallback} (fallback)`));
      }
      return { selectedOption: fallback, isOther: false };
    }
  }

  /**
   * Format tool arguments for display — full detail, no truncation on critical info
   */
  private formatToolArgs(toolName: string, args: Record<string, unknown>): string {
    // Bash: show full command
    if (toolName === 'bash' && args['command']) {
      return chalk.yellow(String(args['command']));
    }

    // File ops: show path + relevant detail
    if (toolName === 'read_file' && args['path']) {
      return String(args['path']);
    }
    if (toolName === 'create_file' && args['path']) {
      const content = args['content'] ? String(args['content']) : '';
      return `${args['path']} (${content.length} chars)`;
    }
    if (toolName === 'edit_file' && args['path']) {
      const old_text = args['old_text'] ? String(args['old_text']).slice(0, 80) : '';
      return `${args['path']} "${old_text}..."`;
    }
    if (toolName === 'list_files' && args['path']) {
      return String(args['path']);
    }
    if (toolName === 'find_files' && args['pattern']) {
      return `pattern=${args['pattern']}${args['path'] ? ` in ${args['path']}` : ''}`;
    }

    // Search: show query
    if (toolName === 'search_content' && args['query']) {
      return `"${args['query']}"${args['path'] ? ` in ${args['path']}` : ''}`;
    }

    // final_response: show message preview
    if (toolName === 'final_response' && args['message']) {
      return truncate(String(args['message']), 200);
    }

    // tell_to_user / ask_to_user
    if (toolName === 'tell_to_user' && args['message']) {
      return truncate(String(args['message']), 200);
    }
    if (toolName === 'ask_to_user' && args['question']) {
      return `Q: ${truncate(String(args['question']), 150)}`;
    }

    // create_todos / write_todos
    if (toolName === 'create_todos' && args['todos']) {
      const todos = args['todos'] as Array<{ title?: string }>;
      return `${todos.length} TODOs`;
    }

    // Generic: show all args as JSON (compact)
    const keys = Object.keys(args);
    if (keys.length === 0) return '';
    try {
      const compact = JSON.stringify(args);
      return truncate(compact, 200);
    } catch {
      return '';
    }
  }

  /**
   * Format tool result for display — show meaningful preview
   */
  private formatToolResult(content: string): string {
    if (!content) return '';
    // Multi-line: show first line + line count
    const lines = content.split('\n');
    if (lines.length > 3) {
      const firstLine = lines[0]!.slice(0, 100);
      return `${firstLine} (${lines.length} lines)`;
    }
    return truncate(content.replace(/\n/g, ' '), 200);
  }
}

/**
 * Pipe   (CLI )
 */
export async function runPipeMode(prompt: string, specific: boolean): Promise<void> {
  const runner = new PipeRunner(specific);
  await runner.run(prompt);
}
