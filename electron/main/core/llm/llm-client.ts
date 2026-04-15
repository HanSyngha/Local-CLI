/**
 * LLM Client for Electron Main Process
 * OpenAI Compatible API client
 * Aligned with CLI's llm-client.ts for feature parity
 */

import { logger } from '../../utils/logger';
import { configManager } from '../config';
import { getProviderConfig, type LLMProvider } from './providers';
import { usageTracker } from '../usage-tracker';
import {
  APIError,
  TimeoutError,
  ConnectionError,
  RateLimitError,
  ContextLengthError,
  StreamingError,
  ValidationError,
  LLMRetryExhaustedError,
} from '../../errors';
import { emitReasoning } from '../../tools/llm/simple/simple-tool-executor';
import { reportError } from '../telemetry/error-reporter';

// =============================================================================
// Types
// =============================================================================

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool' | 'error'; // 'error' added for CLI parity
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
  reasoning_content?: string; // For reasoning LLMs
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface LLMResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: Message & { reasoning?: string };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface LLMStreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: string;
      content?: string;
      reasoning?: string;
    };
    finish_reason: string | null;
  }>;
}

export interface ChatRequestOptions {
  messages: Message[];
  tools?: ToolDefinition[];
  tool_choice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };
  temperature?: number;
  stream?: boolean;
}

/**
 * Retry configuration interface (CLI parity)
 */
export interface RetryConfig {
  /** Maximum retry attempts (default: 3) */
  maxRetries?: number;
  /** Current attempt (internal use) */
  currentAttempt?: number;
  /** Disable retry */
  disableRetry?: boolean;
  /** Extended retry (2min wait + Phase 3) already done — prevents infinite loop (internal use) */
  extendedRetryDone?: boolean;
}

export type StreamCallback = (chunk: string, done: boolean) => void;

// =============================================================================
// LLM Client Class
// =============================================================================

class LLMClient {
  private abortController: AbortController | null = null;
  private isInterrupted: boolean = false;

  /**   — UI    */
  public countdownCallback: ((remainingSeconds: number) => void) | null = null;

  /** Default maximum retry attempts (CLI parity) */
  private static readonly DEFAULT_MAX_RETRIES = 3;

  /** Request timeout in milliseconds (10 minutes - CLI parity) */
  private static readonly REQUEST_TIMEOUT = 600000;

  /**
   * Get current endpoint config
   */
  private getEndpointConfig() {
    const endpoint = configManager.getCurrentEndpoint();
    const model = configManager.getCurrentModel();

    if (!endpoint || !model) {
      throw new ValidationError('No endpoint or model configured', undefined, undefined, {
        userMessage: 'LLM    . Settings .',
      });
    }

    return { endpoint, model };
  }

  /**
   * Preprocess messages for model-specific requirements (CLI parity)
   *
   * Handles:
   * 1. Strip reasoning traces from PAST assistant messages (token savings)
   *    - reasoning_content field (DeepSeek, etc.)
   *    - reasoning field
   *    - <think>...</think> tags in content (Qwen, DeepSeek-R1, etc.)
   * 2. reasoning_content → content conversion for LATEST assistant (if content empty)
   * 3. Harmony format for gpt-oss models
   */
  private preprocessMessages(messages: Message[], modelId: string): Message[] {
    // Find the index of the last assistant message (only this one keeps reasoning)
    let lastAssistantIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]!.role === 'assistant') {
        lastAssistantIdx = i;
        break;
      }
    }

    return messages.map((msg, index) => {
      // Skip non-assistant messages
      if (msg.role !== 'assistant') {
        return msg;
      }

      const msgAny = msg as any;
      const processedMsg = { ...msg };
      const isLatestAssistant = index === lastAssistantIdx;

      // 1. Strip reasoning traces from PAST assistant messages (token savings)
      //    Past reasoning is not needed — only the final content/tool_calls matter.
      //    The latest assistant message keeps reasoning for current-turn reference.
      if (!isLatestAssistant) {
        if (msgAny.reasoning_content) {
          delete (processedMsg as any).reasoning_content;
        }
        if (msgAny.reasoning) {
          delete (processedMsg as any).reasoning;
        }
        // Strip <think>...</think> tags from content
        if (processedMsg.content) {
          processedMsg.content = processedMsg.content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
        }
      }

      // 2. reasoning_content → content conversion (when content is empty)
      //    For latest assistant: use reasoning as content (model switching support)
      //    For past assistants: discard reasoning (already stripped above)
      if (msgAny.reasoning_content && (!processedMsg.content || processedMsg.content.trim() === '')) {
        processedMsg.content = isLatestAssistant ? msgAny.reasoning_content : '';
        delete (processedMsg as any).reasoning_content;
      }

      // 3. gpt-oss-120b / gpt-oss-20b: Harmony format handling
      // These models require content field even when tool_calls are present
      if (/^gpt-oss-(120b|20b)$/i.test(modelId)) {
        if (msg.tool_calls && msg.tool_calls.length > 0) {
          if (!processedMsg.content || processedMsg.content.trim() === '') {
            const toolNames = msg.tool_calls.map(tc => tc.function.name).join(', ');
            processedMsg.content = msgAny.reasoning || `Calling tools: ${toolNames}`;
          }
        }
      }

      // 4. Ensure content is at least empty string for assistant messages
      if (processedMsg.content === undefined || processedMsg.content === null) {
        processedMsg.content = '';
      }

      return processedMsg;
    });
  }

  /**
   * Check if error is retryable (CLI parity)
   * - 5xx server errors
   * - Network errors (ECONNREFUSED, ETIMEDOUT, ECONNRESET, etc.)
   * - Rate Limit (429)
   */
  private isRetryableError(error: unknown): boolean {
    // Check custom error types first
    if (error instanceof RateLimitError) {
      return true;
    }
    if (error instanceof ConnectionError || error instanceof TimeoutError) {
      return true;
    }
    if (error instanceof ContextLengthError) {
      return false; // Needs compact, not retry
    }
    if (error instanceof APIError) {
      // 5xx errors are retryable
      return error.statusCode !== undefined && error.statusCode >= 500;
    }

    if (error instanceof Error) {
      // User interrupt - don't retry
      if (error.message === 'INTERRUPTED' || error.name === 'AbortError') {
        return false;
      }

      const message = error.message.toLowerCase();

      // Network errors
      const networkErrors = ['econnrefused', 'etimedout', 'econnreset', 'econnaborted', 'enotfound', 'ehostunreach', 'timeout', 'network'];
      if (networkErrors.some(e => message.includes(e))) {
        return true;
      }

      // HTTP status based errors (fallback for non-custom errors)
      if (message.includes('429') || message.includes('rate limit')) {
        return true;
      }
      if (message.includes('500') || message.includes('502') || message.includes('503') || message.includes('504')) {
        return true;
      }

      // Context length error - don't retry (needs compact)
      if (message.includes('context') && message.includes('length')) {
        return false;
      }
    }

    return false;
  }

  /**
   * Check if error is context length exceeded (CLI parity)
   */
  private isContextLengthError(error: unknown): boolean {
    // Check custom error type first
    if (error instanceof ContextLengthError) {
      return true;
    }

    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      return (message.includes('context') && message.includes('length')) ||
             message.includes('maximum context') ||
             message.includes('token limit') ||
             message.includes('too many tokens');
    }
    return false;
  }

  /**
   * Enhanced error handler with detailed logging (CLI parity)
   * Converts raw errors into typed error classes for proper upstream handling.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private handleError(error: unknown, requestContext?: { method?: string; url?: string; body?: unknown }): Error {
    logger.error('LLM Client Error', { error: error instanceof Error ? error.message : error });

    if (requestContext) {
      logger.debug('Request Context', requestContext);
    }

    if (error instanceof Error) {
      const message = error.message.toLowerCase();

      // Already a typed error - rethrow
      if (error instanceof ContextLengthError || error instanceof RateLimitError ||
          error instanceof APIError || error instanceof TimeoutError ||
          error instanceof ConnectionError || error instanceof StreamingError) {
        return error;
      }

      // Context length exceeded
      if (this.isContextLengthError(error)) {
        return new ContextLengthError(0, undefined, {
          details: { originalMessage: error.message },
        });
      }

      // Timeout
      if (message.includes('timeout') || message.includes('econnaborted')) {
        return new TimeoutError(LLMClient.REQUEST_TIMEOUT, {
          cause: error,
          details: { endpoint: requestContext?.url },
        });
      }

      // Connection errors
      if (message.includes('econnrefused') || message.includes('enotfound') ||
          message.includes('econnreset') || message.includes('ehostunreach')) {
        return new ConnectionError(requestContext?.url, {
          cause: error,
        });
      }

      // Rate limit
      if (message.includes('429') || message.includes('rate limit')) {
        return new RateLimitError(undefined, {
          cause: error,
          details: { originalMessage: error.message },
        });
      }

      // HTTP status errors
      const statusMatch = message.match(/http\s+(\d{3})/i);
      if (statusMatch) {
        const status = parseInt(statusMatch[1]);
        return new APIError(error.message, status, requestContext?.url, {
          cause: error,
        });
      }
    }

    // Unknown error
    return error instanceof Error ? error : new Error(String(error));
  }

  /**
   * Sleep for specified milliseconds (for retry backoff) (CLI parity)
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   *   ( retry Phase 2)
   * @param totalSeconds    ()
   * @returns true:  , false: 
   */
  private async waitWithCountdown(totalSeconds: number): Promise<boolean> {
    for (let remaining = totalSeconds; remaining > 0; remaining -= 10) {
      if (this.isInterrupted) {
        this.countdownCallback?.(0);
        return false;
      }

      const waitSec = Math.min(10, remaining);
      this.countdownCallback?.(remaining);

      await this.sleep(waitSec * 1000);
    }
    this.countdownCallback?.(0);
    return !this.isInterrupted;
  }

  /**
   * Chat completion (non-streaming) with retry logic (CLI parity)
   */
  async chatCompletion(
    options: ChatRequestOptions,
    retryConfig?: RetryConfig
  ): Promise<LLMResponse> {
    const maxRetries = retryConfig?.disableRetry ? 1 : (retryConfig?.maxRetries ?? LLMClient.DEFAULT_MAX_RETRIES);
    const currentAttempt = retryConfig?.currentAttempt ?? 1;

    const { endpoint, model } = this.getEndpointConfig();
    const modelId = model.id;

    // Preprocess messages for model-specific requirements
    const processedMessages = this.preprocessMessages(options.messages, modelId);

    // [DEBUG] Log tool message integrity after preprocessing
    {
      const toolMsgs = processedMessages.filter(m => m.role === 'tool');
      const lastToolMsg = toolMsgs[toolMsgs.length - 1];
      if (lastToolMsg) {
        logger.info('[DEBUG] Last tool msg in request', {
          role: lastToolMsg.role,
          tool_call_id: (lastToolMsg as any).tool_call_id,
          contentSnippet: typeof lastToolMsg.content === 'string' ? lastToolMsg.content.substring(0, 200) : '(non-string)',
          totalToolMsgs: toolMsgs.length,
          totalMsgs: processedMessages.length,
        });
      }

      // [DEBUG] Check for orphaned tool_calls (assistant with tool_calls but no matching tool response)
      const assistantToolCallIds = new Set<string>();
      const toolResponseIds = new Set<string>();
      for (const m of processedMessages) {
        if (m.role === 'assistant' && (m as any).tool_calls) {
          for (const tc of (m as any).tool_calls) {
            assistantToolCallIds.add(tc.id);
          }
        }
        if (m.role === 'tool' && (m as any).tool_call_id) {
          toolResponseIds.add((m as any).tool_call_id);
        }
      }
      const orphanedIds = [...assistantToolCallIds].filter(id => !toolResponseIds.has(id));
      if (orphanedIds.length > 0) {
        logger.warn('[DEBUG] ORPHANED tool_calls (no matching tool response)!', { orphanedIds });
      }
    }

    const url = `${endpoint.baseUrl.replace(/\/$/, '')}/chat/completions`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (endpoint.apiKey) {
      headers['Authorization'] = `Bearer ${endpoint.apiKey}`;
    }

    const providerConfig = getProviderConfig(endpoint.provider as LLMProvider);
    const requestBody: Record<string, unknown> = {
      model: modelId,
      messages: processedMessages,
      temperature: options.temperature ?? 0.7,
      stream: false,
      // max_tokens removed: never send it (some providers reject it)
    };

    // GPT-OSS reasoning models: use high reasoning effort
    if (/^gpt-oss-(120b|20b)$/i.test(modelId)) {
      requestBody.reasoning_effort = 'high';
    }

    if (options.tools) {
      requestBody.tools = options.tools;
      if (providerConfig.supportsParallelToolCalls) {
        requestBody.parallel_tool_calls = false;
      }
      // Only send tool_choice if provider supports it (Z.AI rejects even 'auto')
      if (options.tool_choice && providerConfig.supportsToolChoice) {
        if (options.tool_choice === 'required' && !providerConfig.supportsToolChoiceRequired) {
          requestBody.tool_choice = 'auto';
        } else {
          requestBody.tool_choice = options.tool_choice;
        }
      }
    }

    logger.enter('chatCompletion', {
      model: modelId,
      messagesCount: options.messages.length,
      hasTools: !!options.tools,
      attempt: currentAttempt,
      maxRetries,
    });

    logger.httpRequest('POST', url, {
      model: modelId,
      messages: `${options.messages.length} messages`,
      temperature: requestBody.temperature,
      tools: options.tools ? `${options.tools.length} tools` : 'none',
    });

    // Check interrupt BEFORE creating new AbortController
    // Prevents race condition: abort() sets isInterrupted, but new controller overwrites the aborted one
    if (this.isInterrupted) {
      logger.flow('LLM chatCompletion skipped - already interrupted');
      this.isInterrupted = false;
      throw new Error('INTERRUPTED');
    }

    this.abortController = new AbortController();

    // Setup timeout
    const timeoutId = setTimeout(() => {
      this.abortController?.abort();
    }, LLMClient.REQUEST_TIMEOUT);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
        signal: this.abortController.signal,
      });

      clearTimeout(timeoutId);
      this.abortController = null;

      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage = `HTTP ${response.status}`;

        try {
          const errorJson = JSON.parse(errorText);
          errorMessage = errorJson.error?.message || errorJson.message || errorMessage;
        } catch {
          if (errorText) {
            errorMessage = errorText.substring(0, 500);
          }
        }

        // Log full error response body for debugging (CLI parity)
        logger.errorSilent('=== API ERROR DETAILS ===', {
          status: response.status,
          statusText: response.statusText,
          url,
          model: modelId,
          errorMessage,
          responseBody: errorText?.substring(0, 2000),
          messagesCount: options.messages.length,
        });

        // Use specific error classes based on status code
        if (response.status === 429) {
          throw new RateLimitError(undefined, {
            details: { originalMessage: errorMessage },
          });
        }
        // Context length error detection for non-stream (CLI parity with stream path)
        if (this.isContextLengthError(new Error(errorMessage))) {
          throw new ContextLengthError(0, undefined, {
            details: { originalMessage: errorMessage },
          });
        }
        throw new APIError(errorMessage, response.status, url);
      }

      const data = await response.json() as LLMResponse;

      // Validate response structure (CLI parity)
      // 502 Bad Gateway: LLM     return  (retry )
      if (!data.choices || !Array.isArray(data.choices) || data.choices.length === 0) {
        logger.errorSilent('Invalid response structure - missing or empty choices array', {
          hasChoices: !!data.choices,
          isArray: Array.isArray(data.choices),
          rawKeys: Object.keys(data || {}),
        });
        throw new APIError(
          'LLM    . choices   .',
          502,
          url
        );
      }

      logger.httpResponse(200, 'OK', {
        model: data.model,
        choices: data.choices.length,
        usage: data.usage,
      });

      logger.exit('chatCompletion', {
        success: true,
        choices: data.choices.length,
        tokensUsed: data.usage?.total_tokens || 0,
      });

      // Emit reasoning if present (CLI parity - extended thinking from o1/DeepSeek-V3 models)
      const reasoningContent = data.choices[0]?.message?.reasoning;
      if (reasoningContent) {
        emitReasoning(reasoningContent, false);
        logger.debug('Reasoning content emitted', { length: reasoningContent.length });
      }

      // Track usage (CLI parity - with context tracking)
      if (data.usage) {
        usageTracker.recordUsage(
          modelId,
          data.usage.prompt_tokens || 0,
          data.usage.completion_tokens || 0,
          undefined,
          data.usage.prompt_tokens // lastPromptTokens for context tracking
        );
      }

      return data;
    } catch (error) {
      clearTimeout(timeoutId);
      this.abortController = null;

      // User abort (CLI parity)
      if (error instanceof Error && (error.name === 'AbortError' || this.isInterrupted)) {
        this.isInterrupted = false;
        logger.flow('API   ( )');
        logger.exit('chatCompletion', { success: false, aborted: true });
        throw new Error('INTERRUPTED');
      }

      // Retry logic with exponential backoff (CLI parity)
      if (currentAttempt < maxRetries && this.isRetryableError(error)) {
        const delay = Math.pow(2, currentAttempt - 1) * 1000; // 1s, 2s, 4s
        logger.warn(`LLM call failed (${currentAttempt}/${maxRetries}), retrying in ${delay}ms...`, {
          error: (error as Error).message,
        });

        await this.sleep(delay);

        return this.chatCompletion(options, {
          ...retryConfig,
          maxRetries,
          currentAttempt: currentAttempt + 1,
        });
      }

      // Phase 1 (3)  → Phase 2 (2 ) → Phase 3 (3  retry)
      if (currentAttempt >= maxRetries && !retryConfig?.disableRetry && !retryConfig?.extendedRetryDone && this.isRetryableError(error)) {
        logger.warn(`Phase 1 (${maxRetries}) . 2   Phase 2 ...`, {
          error: (error as Error).message,
        });

        const waited = await this.waitWithCountdown(120);
        if (!waited) {
          logger.flow('   ');
          this.isInterrupted = false;
          throw new Error('INTERRUPTED');
        }

        logger.warn('Phase 2 (2 ) . Phase 3 (3  retry) ...');
        try {
          return await this.chatCompletion(options, {
            maxRetries,
            currentAttempt: 1,
            extendedRetryDone: true,
          });
        } catch (phase3Error) {
          const finalError = phase3Error instanceof Error ? phase3Error : new Error(String(phase3Error));
          if (finalError.message === 'INTERRUPTED') {
            throw finalError;
          }
          logger.errorSilent('Phase 3 ( 3) .  LLMRetryExhaustedError throw.', {
            error: finalError.message,
          });
          throw new LLMRetryExhaustedError(finalError);
        }
      }

      // Context length error - use custom error class
      if (this.isContextLengthError(error)) {
        logger.error('Context length exceeded', { error: (error as Error).message });
        logger.exit('chatCompletion', { success: false, error: 'context_length_exceeded' });
        // If already ContextLengthError, rethrow as-is
        if (error instanceof ContextLengthError) {
          throw error;
        }
        // Otherwise, wrap in ContextLengthError
        throw new ContextLengthError(0, undefined, {
          details: { originalMessage: (error as Error).message },
        });
      }

      logger.error('LLM API error', { error: (error as Error).message });
      logger.exit('chatCompletion', { success: false, error: (error as Error).message });
      const errModel = configManager.getCurrentModel();
      reportError(error, { type: 'llm', method: 'chatCompletion', modelId: errModel?.id, modelName: errModel?.name }).catch(() => {});
      throw error;
    }
  }

  /**
   * Chat completion with streaming (CLI parity)
   */
  async chatCompletionStream(
    options: ChatRequestOptions,
    onChunk: StreamCallback
  ): Promise<{ content: string; usage?: LLMResponse['usage'] }> {
    const { endpoint, model } = this.getEndpointConfig();
    const modelId = model.id;

    // Preprocess messages for model-specific requirements
    const processedMessages = this.preprocessMessages(options.messages, modelId);

    const url = `${endpoint.baseUrl.replace(/\/$/, '')}/chat/completions`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (endpoint.apiKey) {
      headers['Authorization'] = `Bearer ${endpoint.apiKey}`;
    }

    const providerConfig = getProviderConfig(endpoint.provider as LLMProvider);
    const requestBody: Record<string, unknown> = {
      model: modelId,
      messages: processedMessages,
      temperature: options.temperature ?? 0.7,
      stream: true,
      // max_tokens removed: never send it (some providers reject it)
    };

    // GPT-OSS reasoning models: use high reasoning effort
    if (/^gpt-oss-(120b|20b)$/i.test(modelId)) {
      requestBody.reasoning_effort = 'high';
    }

    if (options.tools) {
      requestBody.tools = options.tools;
      if (providerConfig.supportsParallelToolCalls) {
        requestBody.parallel_tool_calls = false;
      }
      if (options.tool_choice && providerConfig.supportsToolChoice) {
        if (options.tool_choice === 'required' && !providerConfig.supportsToolChoiceRequired) {
          requestBody.tool_choice = 'auto';
        } else {
          requestBody.tool_choice = options.tool_choice;
        }
      }
    }

    logger.enter('chatCompletionStream', {
      model: modelId,
      messagesCount: options.messages.length,
      hasTools: !!options.tools,
    });

    logger.httpStreamStart('POST', url);

    // Check interrupt BEFORE creating new AbortController (same fix as chatCompletion)
    if (this.isInterrupted) {
      logger.flow('LLM streamCompletion skipped - already interrupted');
      this.isInterrupted = false;
      throw new Error('INTERRUPTED');
    }

    this.abortController = new AbortController();

    // Setup timeout
    const timeoutId = setTimeout(() => {
      this.abortController?.abort();
    }, LLMClient.REQUEST_TIMEOUT);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
        signal: this.abortController.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage = `HTTP ${response.status}`;

        try {
          const errorJson = JSON.parse(errorText);
          errorMessage = errorJson.error?.message || errorJson.message || errorMessage;
        } catch {
          if (errorText) {
            errorMessage = errorText.substring(0, 500);
          }
        }

        // Log full error response body for debugging (CLI parity)
        logger.errorSilent('=== API ERROR DETAILS (stream) ===', {
          status: response.status,
          statusText: response.statusText,
          url,
          model: modelId,
          errorMessage,
          responseBody: errorText?.substring(0, 2000),
          messagesCount: options.messages.length,
        });

        // Use specific error classes based on status code
        if (response.status === 429) {
          throw new RateLimitError(undefined, {
            details: { originalMessage: errorMessage },
          });
        }
        // Context length error detection in stream (CLI parity)
        if (this.isContextLengthError(new Error(errorMessage))) {
          throw new ContextLengthError(0, undefined, {
            details: { originalMessage: errorMessage },
          });
        }
        throw new APIError(errorMessage, response.status, url);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new StreamingError('No response body available for streaming');
      }

      const decoder = new TextDecoder();
      let fullContent = '';
      let buffer = '';

      while (true) {
        // Check for interrupt (CLI parity)
        if (this.isInterrupted) {
          reader.cancel();
          throw new Error('INTERRUPTED');
        }

        const { done, value } = await reader.read();

        if (done) {
          onChunk('', true);
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === 'data: [DONE]') continue;

          if (trimmed.startsWith('data: ')) {
            try {
              const jsonStr = trimmed.slice(6);
              const chunk = JSON.parse(jsonStr) as LLMStreamChunk;
              const content = chunk.choices?.[0]?.delta?.content;

              if (content) {
                fullContent += content;
                onChunk(content, false);
              }

              // Emit reasoning delta if present (CLI parity - extended thinking)
              const reasoningDelta = chunk.choices?.[0]?.delta?.reasoning;
              if (reasoningDelta) {
                emitReasoning(reasoningDelta, true);
              }
            } catch {
              // Skip invalid JSON chunks
            }
          }
        }
      }

      this.abortController = null;

      logger.httpStreamEnd(fullContent.length, 0);
      logger.exit('chatCompletionStream', {
        success: true,
        contentLength: fullContent.length,
      });

      return { content: fullContent };
    } catch (error) {
      clearTimeout(timeoutId);
      this.abortController = null;

      if (error instanceof Error && (error.name === 'AbortError' || this.isInterrupted)) {
        this.isInterrupted = false;
        logger.flow('Stream  ( )');
        logger.exit('chatCompletionStream', { success: false, aborted: true });
        throw new Error('INTERRUPTED');
      }

      // Context length error - wrap in ContextLengthError (CLI parity)
      if (this.isContextLengthError(error)) {
        logger.error('Stream context length exceeded', { error: (error as Error).message });
        logger.exit('chatCompletionStream', { success: false, error: 'context_length_exceeded' });
        if (error instanceof ContextLengthError) {
          throw error;
        }
        throw new ContextLengthError(0, undefined, {
          details: { originalMessage: (error as Error).message },
        });
      }

      logger.error('Stream error', { error: (error as Error).message });
      logger.exit('chatCompletionStream', { success: false, error: (error as Error).message });
      const errModel2 = configManager.getCurrentModel();
      reportError(error, { type: 'llm', method: 'chatCompletionStream', modelId: errModel2?.id, modelName: errModel2?.name }).catch(() => {});
      throw error;
    }
  }

  /**
   * Simple message send (helper) (CLI parity)
   */
  async sendMessage(
    userMessage: string,
    systemPrompt?: string,
    stream?: boolean,
    onChunk?: StreamCallback
  ): Promise<string> {
    const messages: Message[] = [];

    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }

    messages.push({ role: 'user', content: userMessage });

    if (stream && onChunk) {
      const result = await this.chatCompletionStream({ messages }, onChunk);
      return result.content;
    } else {
      const response = await this.chatCompletion({ messages });
      return response.choices[0]?.message?.content || '';
    }
  }

  /**
   * Chat with conversation history
   */
  async chat(
    messages: Message[],
    stream?: boolean,
    onChunk?: StreamCallback
  ): Promise<{ content: string; message: Message }> {
    if (stream && onChunk) {
      const result = await this.chatCompletionStream({ messages }, onChunk);
      return {
        content: result.content,
        message: { role: 'assistant', content: result.content },
      };
    } else {
      const response = await this.chatCompletion({ messages });
      const assistantMessage = response.choices[0]?.message;
      return {
        content: assistantMessage?.content || '',
        message: assistantMessage || { role: 'assistant', content: '' },
      };
    }
  }

  /**
   * Abort current request and set interrupt flag (CLI parity)
   */
  abort(): void {
    logger.info('LLM Interrupt - aborting all operations');
    this.isInterrupted = true;

    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  /**
   * Check if interrupted (CLI parity)
   */
  checkInterrupted(): boolean {
    return this.isInterrupted;
  }

  /**
   * Reset interrupt flag (CLI parity)
   */
  resetInterrupt(): void {
    this.isInterrupted = false;
  }

  /**
   * Check if request is active (CLI parity)
   */
  isRequestActive(): boolean {
    return this.abortController !== null;
  }

  /**
   * Get current model info (CLI parity)
   */
  getModelInfo(): { model: string; endpoint: string } {
    const { endpoint, model } = this.getEndpointConfig();
    return {
      model: model.name,
      endpoint: endpoint.baseUrl,
    };
  }
}

// =============================================================================
// Export singleton instance
// =============================================================================

export const llmClient = new LLMClient();

// Also export class for potential extension
export { LLMClient };
