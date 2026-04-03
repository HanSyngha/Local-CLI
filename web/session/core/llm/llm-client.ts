/**
 * LLM Client
 *
 * OpenAI Compatible API 클라이언트
 * Gemini (HTTPS) 및 LiteLLM (HTTP) 지원
 *
 * Logger 사용 가이드:
 * - 이 파일은 이미 logger.httpRequest(), logger.httpResponse(), logger.errorSilent() 등을 사용 중입니다.
 * - 추가 개선 사항: 주요 public 함수에 logger.enter/exit 추가
 * - 예시: logger.enter('sendMessage', { messageLength: userMessage.length });
 * - 상세한 사용법은 docs/LOGGER_USAGE_KR.md 참고
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import { Message, LLMRequestOptions } from '../../types/index.js';
import { configManager } from '../config/config-manager.js';
import { SERVICE_ID } from '../../constants.js';
import {
  NetworkError,
  APIError,
  TimeoutError,
  ConnectionError,
} from '../../errors/network.js';
import {
  LLMError,
  TokenLimitError,
  RateLimitError,
  ContextLengthError,
  LLMRetryExhaustedError,
} from '../../errors/llm.js';
import { QuotaExceededError } from '../../errors/quota.js';
import { logger, isLLMLogEnabled } from '../../utils/logger.js';
import { reportError } from '../telemetry/error-reporter.js';
import { usageTracker } from '../usage-tracker.js';
import { getJsonStreamLogger } from '../../utils/json-stream-logger.js';

/**
 * LLM 응답 인터페이스 (OpenAI Compatible)
 */
export interface LLMResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: Message & {
      reasoning?: string;
    };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * 스트리밍 청크 인터페이스
 */
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

/**
 * 재시도 설정 인터페이스
 */
export interface RetryConfig {
  /** 최대 재시도 횟수 (기본값: 3) */
  maxRetries?: number;
  /** 현재 시도 횟수 (내부용) */
  currentAttempt?: number;
  /** 재시도 비활성화 여부 */
  disableRetry?: boolean;
  /** 확장 retry (2분 대기 + Phase 3) 이미 수행됨 — 무한 루프 방지 (내부용) */
  extendedRetryDone?: boolean;
}

/**
 * LLM Client 클래스
 */
export class LLMClient {
  private axiosInstance: AxiosInstance;
  private baseUrl: string;
  private apiKey: string;
  private model: string;
  private modelName: string;
  private currentAbortController: AbortController | null = null;
  private isInterrupted: boolean = false;

  /** 카운트다운 콜백 — UI에서 대기 시간 표시용 */
  public countdownCallback: ((remainingSeconds: number) => void) | null = null;

  /** 기본 최대 재시도 횟수 */
  private static readonly DEFAULT_MAX_RETRIES = 3;

  constructor(authToken?: string) {
    // ConfigManager에서 현재 설정 가져오기
    const endpoint = configManager.getCurrentEndpoint();
    const currentModel = configManager.getCurrentModel();

    if (!endpoint || !currentModel) {
      throw new Error('No endpoint or model configured. Run: open config init');
    }

    this.baseUrl = endpoint.baseUrl;
    this.apiKey = authToken || endpoint.apiKey || '';
    this.model = currentModel.id;
    this.modelName = currentModel.name;

    // Axios 인스턴스 생성
    this.axiosInstance = axios.create({
      baseURL: this.baseUrl,
      headers: {
        'Content-Type': 'application/json',
        'X-Service-Id': SERVICE_ID,
        ...(this.apiKey && { Authorization: `Bearer ${this.apiKey}` }),
      },
      timeout: 600000, // 600초 (10분)
    });
  }

  /**
   * Preprocess messages for model-specific requirements
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
   * Chat Completion API 호출 (Non-streaming)
   * 기본적으로 3번까지 재시도하며, 재시도 중에는 에러가 UI에 표시되지 않음
   */
  async chatCompletion(
    options: Partial<LLMRequestOptions>,
    retryConfig?: RetryConfig
  ): Promise<LLMResponse> {
    const maxRetries = retryConfig?.disableRetry ? 1 : (retryConfig?.maxRetries ?? LLMClient.DEFAULT_MAX_RETRIES);
    const currentAttempt = retryConfig?.currentAttempt ?? 1;

    logger.enter('chatCompletion', {
      model: options.model || this.model,
      messagesCount: options.messages?.length || 0,
      hasTools: !!options.tools,
      attempt: currentAttempt,
      maxRetries
    });

    const url = '/chat/completions';

    try {
      logger.flow('메시지 전처리 시작');
      // Preprocess messages for model-specific requirements
      const modelId = options.model || this.model;
      const processedMessages = options.messages ?
        this.preprocessMessages(options.messages, modelId) : [];

      logger.vars(
        { name: 'modelId', value: modelId },
        { name: 'originalMessages', value: options.messages?.length || 0 },
        { name: 'processedMessages', value: processedMessages.length },
        { name: 'temperature', value: options.temperature ?? 0.7 }
      );

      const requestBody = {
        model: modelId,
        messages: processedMessages,
        temperature: options.temperature ?? 0.7,
        stream: false,
        ...(options.max_tokens && { max_tokens: options.max_tokens }),
        // GPT-OSS reasoning models: always use high reasoning effort
        ...(/^gpt-oss-(120b|20b)$/i.test(modelId) && { reasoning_effort: 'high' }),
        ...(options.tools && {
          tools: options.tools,
          parallel_tool_calls: false,  // Enforce one tool at a time via API
          ...(options.tool_choice && { tool_choice: options.tool_choice }),
        }),
      };

      logger.flow('API 요청 준비 완료');

      // Log request
      logger.httpRequest('POST', `${this.baseUrl}${url}`, {
        model: modelId,
        messages: `${processedMessages.length} messages`,
        temperature: requestBody.temperature,
        tools: options.tools ? `${options.tools.length} tools` : 'none',
      });

      logger.verbose('Full Request Body', requestBody);

      // LLM Log mode: 요청 로깅
      if (isLLMLogEnabled()) {
        logger.llmRequest(processedMessages, modelId, options.tools);
      }

      logger.startTimer('llm-api-call');

      // Create AbortController for this request
      this.currentAbortController = new AbortController();

      const response = await this.axiosInstance.post<LLMResponse>(url, requestBody, {
        signal: this.currentAbortController.signal,
      });

      this.currentAbortController = null;
      const elapsed = logger.endTimer('llm-api-call');

      logger.flow('API 응답 수신 완료');

      // Validate response structure
      if (!response.data.choices || !Array.isArray(response.data.choices)) {
        logger.errorSilent('Invalid response structure - missing choices array', response.data);
        throw new Error('LLM 응답 형식이 올바르지 않습니다. choices 배열이 없습니다.');
      }

      // Log response
      logger.httpResponse(response.status, response.statusText, {
        choices: response.data.choices.length,
        usage: response.data.usage,
      });

      logger.verbose('Full Response', response.data);

      logger.vars(
        { name: 'responseChoices', value: response.data.choices.length },
        { name: 'tokensUsed', value: response.data.usage?.total_tokens || 0 },
        { name: 'responseTime', value: elapsed }
      );

      // LLM Log mode: 응답 로깅
      if (isLLMLogEnabled()) {
        const responseContent = response.data.choices[0]?.message?.content || '';
        const toolCalls = response.data.choices[0]?.message?.tool_calls;
        logger.llmResponse(responseContent, toolCalls);
      }

      // Emit reasoning if present (extended thinking from o1 models)
      // Only emit for user-facing responses (skip internal classifier calls)
      const reasoningContent = response.data.choices[0]?.message?.reasoning;
      const maxTokens = options.max_tokens;
      const isInternalCall = maxTokens && maxTokens < 500; // Internal calls use small max_tokens

      if (reasoningContent && !isInternalCall) {
        const { emitReasoning } = await import('../../tools/llm/simple/file-tools.js');
        emitReasoning(reasoningContent, false);
        logger.debug('Reasoning content emitted', { length: reasoningContent.length });
      } else if (reasoningContent && isInternalCall) {
        logger.debug('Reasoning skipped (internal call)', { maxTokens, length: reasoningContent.length });
      }

      // Track token usage (Phase 3) + context tracking for auto-compact
      if (response.data.usage) {
        const promptTokens = response.data.usage.prompt_tokens || 0;
        usageTracker.recordUsage(
          this.model,
          promptTokens,
          response.data.usage.completion_tokens || 0,
          undefined,  // sessionId
          promptTokens  // lastPromptTokens for context tracking
        );
      }

      logger.exit('chatCompletion', {
        success: true,
        choices: response.data.choices.length,
        elapsed
      });

      return response.data;
    } catch (error) {
      this.currentAbortController = null;

      // Check if this was an abort/cancel
      if (axios.isCancel(error) || (error instanceof Error && error.name === 'CanceledError')) {
        logger.flow('API 호출 취소됨 (사용자 인터럽트)');
        logger.exit('chatCompletion', { success: false, aborted: true });
        throw new Error('INTERRUPTED');
      }

      // 재시도 가능한 에러이고, 아직 재시도 횟수가 남아있으면 재시도
      if (currentAttempt < maxRetries && this.isRetryableError(error)) {
        // 재시도 중에는 debug 레벨로만 로깅 (UI에 표시 안됨)
        const delay = Math.pow(2, currentAttempt - 1) * 1000; // 지수 백오프: 1s, 2s, 4s
        logger.debug(`LLM 호출 실패 (${currentAttempt}/${maxRetries}), ${delay}ms 후 재시도...`, {
          error: (error as Error).message,
          attempt: currentAttempt,
          maxRetries,
          delay
        });

        await this.sleep(delay);

        // 재귀적으로 재시도
        return this.chatCompletion(options, {
          maxRetries,
          currentAttempt: currentAttempt + 1,
        });
      }

      // Phase 1 (3회) 실패 → Phase 2 (2분 대기) → Phase 3 (3회 추가 retry)
      // 단, retryable 에러이고 retry가 활성화되고 확장 retry가 아직 수행되지 않은 경우에만
      if (currentAttempt >= maxRetries && !retryConfig?.disableRetry && !retryConfig?.extendedRetryDone && this.isRetryableError(error)) {
        logger.warn(`Phase 1 (${maxRetries}회) 실패. 2분 대기 후 Phase 2 시작...`, {
          error: (error as Error).message,
        });

        // 2분 카운트다운 대기 (10초마다 콜백)
        const waited = await this.waitWithCountdown(120);
        if (!waited) {
          // 인터럽트됨 — throw
          logger.flow('카운트다운 중 인터럽트 감지');
          throw new Error('INTERRUPTED');
        }

        // Phase 3: 3회 추가 retry (재귀 호출, extendedRetryDone=true로 무한 루프 방지)
        logger.warn('Phase 2 (2분 대기) 완료. Phase 3 (3회 추가 retry) 시작...');
        try {
          return await this.chatCompletion(options, {
            maxRetries,
            currentAttempt: 1,
            extendedRetryDone: true,
          });
        } catch (phase3Error) {
          // Phase 3도 실패 → LLMRetryExhaustedError throw
          const finalError = phase3Error instanceof Error ? phase3Error : new Error(String(phase3Error));
          // INTERRUPTED는 그대로 전파
          if (finalError.message === 'INTERRUPTED') {
            throw finalError;
          }
          logger.errorSilent('Phase 3 (추가 3회) 실패. 최종 LLMRetryExhaustedError throw.', {
            error: finalError.message,
          });
          throw new LLMRetryExhaustedError(finalError);
        }
      }

      // 최종 실패: 에러 로깅 및 throw
      logger.flow('API 호출 실패 - 에러 처리');
      if (currentAttempt > 1) {
        // 재시도 후 최종 실패한 경우에만 에러 로그 표시
        logger.errorSilent(`LLM 호출 ${maxRetries}번 재시도 후 최종 실패`, {
          error: (error as Error).message,
          attempts: currentAttempt
        });
      }
      logger.exit('chatCompletion', { success: false, error: (error as Error).message, attempts: currentAttempt });
      const handled = this.handleError(error, {
        method: 'POST',
        url,
        body: options,
      });
      reportError(handled, { type: 'llm', method: 'chatCompletion', endpoint: url, modelId: this.model, modelName: this.modelName }).catch(() => {});
      throw handled;
    }
  }

  /**
   * Abort current LLM request and set interrupt flag (for ESC interrupt)
   */
  abort(): void {
    logger.flow('LLM 인터럽트 - 모든 동작 중단');
    this.isInterrupted = true;

    if (this.currentAbortController) {
      this.currentAbortController.abort();
      this.currentAbortController = null;
    }
  }

  /**
   * Check if interrupted
   */
  checkInterrupted(): boolean {
    return this.isInterrupted;
  }

  /**
   * Reset interrupt flag (call before starting new operation)
   */
  resetInterrupt(): void {
    this.isInterrupted = false;
  }

  /**
   * Check if there's an active request
   */
  isRequestActive(): boolean {
    return this.currentAbortController !== null;
  }

  /**
   * 재시도 가능한 에러인지 확인
   * - 5xx 서버 에러
   * - 네트워크 에러 (ECONNREFUSED, ETIMEDOUT, ECONNRESET 등)
   * - Rate Limit (429)
   * - Tool argument 파싱 에러는 재시도하지 않음 (LLM 응답 문제)
   */
  private isRetryableError(error: unknown): boolean {
    // 사용자 인터럽트는 재시도하지 않음
    if (error instanceof Error && error.message === 'INTERRUPTED') {
      return false;
    }

    // Quota exceeded는 재시도하지 않음 (서버 한도 초과)
    if (error instanceof QuotaExceededError) {
      return false;
    }

    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;

      // 네트워크 에러 (응답 없음)
      if (!axiosError.response) {
        const retryableCodes = ['ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET', 'ECONNABORTED', 'ENOTFOUND', 'EHOSTUNREACH'];
        if (axiosError.code && retryableCodes.includes(axiosError.code)) {
          return true;
        }
        // 타임아웃
        if (axiosError.message.includes('timeout')) {
          return true;
        }
        return true; // 기타 네트워크 에러도 재시도
      }

      const status = axiosError.response.status;

      // Rate Limit (429)
      if (status === 429) {
        return true;
      }

      // 서버 에러 (5xx)
      if (status >= 500) {
        return true;
      }

      // 인증/권한 에러는 재시도하지 않음 (401, 403)
      // 잘못된 요청도 재시도하지 않음 (400)
      // Context Length 초과도 재시도하지 않음
      return false;
    }

    // 기타 에러는 재시도하지 않음
    return false;
  }

  /**
   * 지정된 시간만큼 대기 (재시도용)
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 카운트다운 대기 (확장 retry Phase 2)
   * @param totalSeconds 총 대기 시간 (초)
   * @returns true: 정상 완료, false: 인터럽트됨
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
   * Chat Completion API 호출 (Streaming)
   */
  async *chatCompletionStream(
    options: Partial<LLMRequestOptions>
  ): AsyncGenerator<LLMStreamChunk, void, unknown> {
    const url = '/chat/completions';

    try {
      // Preprocess messages for model-specific requirements
      const modelId = options.model || this.model;
      const processedMessages = options.messages ?
        this.preprocessMessages(options.messages, modelId) : [];

      const requestBody = {
        model: modelId,
        messages: processedMessages,
        temperature: options.temperature ?? 0.7,
        stream: true,
        ...(options.max_tokens && { max_tokens: options.max_tokens }),
        // GPT-OSS reasoning models: always use high reasoning effort
        ...(/^gpt-oss-(120b|20b)$/i.test(modelId) && { reasoning_effort: 'high' }),
        ...(options.tools && {
          tools: options.tools,
          parallel_tool_calls: false,  // Enforce one tool at a time
          ...(options.tool_choice && { tool_choice: options.tool_choice }),
        }),
      };

      // Log request
      logger.httpRequest('POST (stream)', `${this.baseUrl}${url}`, {
        model: modelId,
        messages: `${processedMessages.length} messages`,
        temperature: requestBody.temperature,
      });

      logger.verbose('Full Streaming Request Body', requestBody);

      // Create AbortController for streaming request
      this.currentAbortController = new AbortController();

      const response = await this.axiosInstance.post(url, requestBody, {
        responseType: 'stream',
        signal: this.currentAbortController.signal,
      });

      logger.debug('Streaming response started', { status: response.status });
      {
        const sl = getJsonStreamLogger();
        sl?.log({ timestamp: new Date().toISOString(), type: 'http_event', content: `Stream started (status: ${response.status})`, category: 'http', metadata: { model: this.model } });
      }

      // SSE (Server-Sent Events) 파싱
      const stream = response.data as AsyncIterable<Buffer>;
      let buffer = '';
      let chunkCount = 0;

      // Check if this is an internal call (skip reasoning for classifier calls)
      const maxTokens = options.max_tokens;
      const isInternalCall = maxTokens && maxTokens < 500;

      // Import emitReasoning once before loop
      const { emitReasoning } = await import('../../tools/llm/simple/file-tools.js');

      try {
        for await (const chunk of stream) {
          // Check for interrupt at the start of each chunk
          if (this.isInterrupted) {
            logger.flow('Interrupt detected during streaming - stopping');
            throw new Error('INTERRUPTED');
          }

          buffer += chunk.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed === 'data: [DONE]') continue;

            if (trimmed.startsWith('data: ')) {
              try {
                const jsonStr = trimmed.slice(6);
                const data = JSON.parse(jsonStr) as LLMStreamChunk;
                chunkCount++;

                // Emit reasoning if present in stream (extended thinking)
                // Skip for internal classifier calls
                const reasoningDelta = data.choices[0]?.delta?.reasoning;
                if (reasoningDelta && !isInternalCall) {
                  emitReasoning(reasoningDelta, true);
                  logger.debug('Reasoning delta emitted', { length: reasoningDelta.length });
                } else if (reasoningDelta && isInternalCall) {
                  logger.debug('Reasoning delta skipped (internal call)', { maxTokens });
                }

                yield data;
              } catch (parseError) {
                // JSON 파싱 에러 무시 (불완전한 청크)
                logger.debug('Skipping invalid chunk', { line: trimmed });
                continue;
              }
            }
          }
        }
      } finally {
        // Clear abort controller after streaming completes
        this.currentAbortController = null;
      }

      logger.debug('Streaming response completed', { chunkCount });
      {
        const sl = getJsonStreamLogger();
        sl?.log({ timestamp: new Date().toISOString(), type: 'http_event', content: `Stream completed (${chunkCount} chunks)`, category: 'http', metadata: { chunkCount, model: this.model } });
      }

    } catch (error) {
      const handled = this.handleError(error, {
        method: 'POST (stream)',
        url,
        body: options,
      });
      reportError(handled, { type: 'llm', method: 'chatCompletionStream', endpoint: url, modelId: this.model, modelName: this.modelName }).catch(() => {});
      throw handled;
    }
  }

  /**
   * 간단한 채팅 메시지 전송 (헬퍼 메서드)
   */
  async sendMessage(userMessage: string, systemPrompt?: string): Promise<string> {
    logger.enter('sendMessage', {
      messageLength: userMessage.length,
      hasSystemPrompt: !!systemPrompt
    });

    logger.flow('메시지 배열 구성');
    const messages: Message[] = [];

    if (systemPrompt) {
      logger.vars({ name: 'systemPrompt', value: systemPrompt.substring(0, 100) + (systemPrompt.length > 100 ? '...' : '') });
      messages.push({
        role: 'system',
        content: systemPrompt,
      });
    }

    messages.push({
      role: 'user',
      content: userMessage,
    });

    logger.vars(
      { name: 'totalMessages', value: messages.length },
      { name: 'userMessage', value: userMessage.substring(0, 100) + (userMessage.length > 100 ? '...' : '') }
    );

    logger.flow('LLM API 호출');
    logger.startTimer('sendMessage-api');

    const response = await this.chatCompletion({ messages });

    const elapsed = logger.endTimer('sendMessage-api');

    logger.flow('응답 처리');
    if (response.choices.length === 0) {
      logger.flow('응답 없음 - 에러 발생');
      logger.exit('sendMessage', { success: false, reason: 'No response from LLM' });
      throw new Error('No response from LLM');
    }

    const responseContent = response.choices[0]?.message.content || '';

    logger.vars(
      { name: 'responseLength', value: responseContent.length },
      { name: 'apiTime', value: elapsed }
    );

    logger.exit('sendMessage', {
      success: true,
      responseLength: responseContent.length,
      elapsed
    });

    return responseContent;
  }

  /**
   * 스트리밍 채팅 메시지 전송
   */
  async *sendMessageStream(
    userMessage: string,
    systemPrompt?: string
  ): AsyncGenerator<string, void, unknown> {
    const messages: Message[] = [];

    if (systemPrompt) {
      messages.push({
        role: 'system',
        content: systemPrompt,
      });
    }

    messages.push({
      role: 'user',
      content: userMessage,
    });

    for await (const chunk of this.chatCompletionStream({ messages })) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        yield content;
      }
    }
  }

  /**
   * Chat Completion with Tools (대화 히스토리 유지)
   * Interactive Mode에서 사용 - 전체 대화 히스토리와 함께 tool calling 지원
   * No iteration limit - continues until LLM stops calling tools
   *
   * @param messages - 대화 히스토리
   * @param tools - 사용 가능한 도구들
   * @param options - 추가 옵션
   * @param options.getPendingMessage - 대기 중인 user message를 가져오는 콜백
   * @param options.clearPendingMessage - 대기 중인 message를 처리 후 클리어하는 콜백
   */
  async chatCompletionWithTools(
    messages: Message[],
    tools: import('../../types/index.js').ToolDefinition[],
    options?: {
      getPendingMessage?: () => string | null;
      clearPendingMessage?: () => void;
      /** 매 iteration마다 messages를 재구성하는 콜백. tool loop 내 메시지를 받아 [system, user] 형태로 반환 */
      rebuildMessages?: (toolLoopMessages: Message[]) => Message[];
      /** 매 tool 실행 후 호출. auto-compact 등 후처리 수행. toolLoopMessages를 in-place 수정 가능 */
      onAfterToolExecution?: (toolLoopMessages: Message[]) => Promise<void>;
      /** ask_to_user 도구 직접 처리 콜백 — 전역 callback 대신 사용 */
      askUser?: (request: { question: string; options: string[] }) => Promise<{ selectedOption: string; isOther: boolean; customText?: string }>;
    }
  ): Promise<{
    message: Message;
    toolCalls: Array<{ tool: string; args: unknown; result: string }>;
    allMessages: Message[];
  }> {
    let workingMessages = [...messages];
    const toolLoopMessages: Message[] = []; // Tool loop에서 생긴 메시지 추적 (rebuildMessages 모드용)
    const toolCallHistory: Array<{ tool: string; args: unknown; result: string }> = [];
    let iterations = 0;
    let contextLengthRecoveryAttempted = false;  // Prevent infinite recovery loop
    let noToolCallRetries = 0;  // Prevent infinite loop when LLM doesn't use tools
    let finalResponseFailures = 0;  // Prevent infinite loop when final_response keeps failing
    let consecutiveParseFailures = 0;  // Prevent infinite loop when model can't generate JSON
    let consecutiveTellToUserCalls = 0;  // Prevent tell_to_user infinite loop
    const MAX_NO_TOOL_CALL_RETRIES = 5;  // Max retries for enforcing tool usage
    const MAX_FINAL_RESPONSE_FAILURES = 3;  // Max retries for final_response failures
    const MAX_CONSECUTIVE_TELL_TO_USER = 2;  // Max consecutive tell_to_user before forcing final_response
    const MAX_CONSECUTIVE_PARSE_FAILURES = 3;  // Max retries for arg parse failures

    // Track parse failure tool_call_ids — stripped from returned history
    // Parse error hints are only useful for immediate retry, not for future sessions
    const parseFailureToolCallIds = new Set<string>();
    const stripParseFailures = (msgs: Message[]): Message[] => {
      if (parseFailureToolCallIds.size === 0) return msgs;
      return msgs.filter(msg => {
        if (msg.role === 'tool' && msg.tool_call_id && parseFailureToolCallIds.has(msg.tool_call_id)) return false;
        if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0 &&
            msg.tool_calls.every(tc => parseFailureToolCallIds.has(tc.id))) return false;
        return true;
      });
    };

    // Helper: workingMessages와 toolLoopMessages에 동시 추가
    const addMessage = (msg: Message) => {
      workingMessages.push(msg);
      if (options?.rebuildMessages) {
        toolLoopMessages.push(msg);
      }
    };

    // Helper: 반환용 allMessages 선택 (rebuildMessages 모드면 loop 메시지만, 아니면 전체)
    const getAllMessages = () => {
      return options?.rebuildMessages
        ? stripParseFailures(toolLoopMessages)
        : stripParseFailures(workingMessages);
    };

    while (true) {
      // Check for interrupt at start of each iteration
      if (this.isInterrupted) {
        logger.flow('Interrupt detected - stopping tool loop');
        throw new Error('INTERRUPTED');
      }

      iterations++;

      // rebuildMessages 모드: 매 iteration마다 messages 재구성
      // 최신 TODO 상태, 전체 대화 history + tool loop messages를 포함
      if (options?.rebuildMessages) {
        workingMessages = options.rebuildMessages(toolLoopMessages);
      }

      // Check for pending user message and inject it
      if (options?.getPendingMessage && options?.clearPendingMessage) {
        const pendingMsg = options.getPendingMessage();
        if (pendingMsg) {
          logger.flow('Injecting pending user message into conversation');
          if (options?.rebuildMessages) {
            // rebuildMessages 모드: toolLoopMessages에 추가 후 다시 rebuild
            toolLoopMessages.push({ role: 'user' as const, content: pendingMsg });
            workingMessages = options.rebuildMessages(toolLoopMessages);
          } else {
            workingMessages.push({ role: 'user' as const, content: pendingMsg });
          }
          options.clearPendingMessage();
        }
      }

      // LLM 호출 (tools 포함) - with ContextLengthError recovery
      // tool_choice: 'required' forces LLM to always use a tool (use final_response for final answer)
      let response: LLMResponse;
      try {
        response = await this.chatCompletion({
          messages: workingMessages,
          tools,
          tool_choice: 'required',
        });
      } catch (error) {
        // ContextLengthError recovery: rollback last tool + compact + retry
        if (error instanceof ContextLengthError && !contextLengthRecoveryAttempted) {
          contextLengthRecoveryAttempted = true;
          logger.flow('ContextLengthError detected - attempting recovery');

          if (options?.rebuildMessages) {
            // rebuildMessages 모드: toolLoopMessages에서 마지막 tool group 롤백
            // 다음 iteration에서 rebuild 시 자연스럽게 context가 줄어듦
            let rollbackIdx = toolLoopMessages.length - 1;
            while (rollbackIdx >= 0 && toolLoopMessages[rollbackIdx]?.role === 'tool') {
              rollbackIdx--;
            }
            if (rollbackIdx >= 0 && toolLoopMessages[rollbackIdx]?.tool_calls) {
              toolLoopMessages.length = rollbackIdx;
              logger.debug('Rolled back toolLoopMessages', { newLength: toolLoopMessages.length });
            }
            // 다음 iteration에서 rebuild로 재시도
            continue;
          }

          // 기존 모드: workingMessages rollback + compact
          logger.flow('Attempting recovery with compact');

          // Rollback: remove last tool results and assistant message with tool_calls
          let rollbackIdx = workingMessages.length - 1;
          while (rollbackIdx >= 0 && workingMessages[rollbackIdx]?.role === 'tool') {
            rollbackIdx--;
          }
          // rollbackIdx now points to last assistant message (with tool_calls)
          if (rollbackIdx >= 0 && workingMessages[rollbackIdx]?.tool_calls) {
            workingMessages = workingMessages.slice(0, rollbackIdx);
            logger.debug('Rolled back messages to before last tool execution', {
              removedCount: workingMessages.length - rollbackIdx,
            });
          }

          // Execute compact
          const { CompactManager } = await import('../compact/compact-manager.js');
          const { buildCompactedMessages } = await import('../compact/compact-prompts.js');
          const compactManager = new CompactManager(this);

          const compactResult = await compactManager.compact(workingMessages, {
            workingDirectory: process.cwd(),
          });

          if (compactResult.success && compactResult.compactedSummary) {
            // Replace workingMessages with compacted result
            const compactedMessages = buildCompactedMessages(compactResult.compactedSummary, {
              workingDirectory: process.cwd(),
            });
            workingMessages = [...compactedMessages];
            logger.flow('Compact completed, retrying with reduced context', {
              originalCount: compactResult.originalMessageCount,
              newCount: compactedMessages.length,
            });

            // Retry loop
            continue;
          } else {
            // Compact failed - throw original error
            logger.errorSilent('Compact failed during recovery', { error: compactResult.error });
            throw error;
          }
        }

        // Other errors or second ContextLengthError - rethrow
        throw error;
      }

      // Check for interrupt after LLM call
      if (this.isInterrupted) {
        logger.flow('Interrupt detected after LLM call - stopping');
        throw new Error('INTERRUPTED');
      }

      const choice = response.choices[0];
      if (!choice) {
        throw new Error('응답에서 choice를 찾을 수 없습니다.');
      }

      const assistantMessage = choice.message;
      addMessage(assistantMessage);

      // Tool calls 확인
      if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
        const streamLogger = getJsonStreamLogger();
        streamLogger?.log({
          timestamp: new Date().toISOString(),
          type: 'tool_call',
          content: `LLM requested tool: ${assistantMessage.tool_calls.map(tc => tc.function.name).join(', ')}`,
          category: 'tool',
          metadata: { tools: assistantMessage.tool_calls.map(tc => ({ name: tc.function.name, argsLength: tc.function.arguments.length })) },
        });
        // Enforce single tool per turn: only execute the FIRST tool call
        // Some LLM models ignore parallel_tool_calls:false and return multiple tools.
        // Executing all of them is incorrect because the LLM decided on tools 2..N
        // without seeing the result of tool 1.
        if (assistantMessage.tool_calls.length > 1) {
          const toolNames = assistantMessage.tool_calls.map(tc => tc.function.name).join(', ');
          logger.warn(`[SINGLE-TOOL ENFORCED] LLM returned ${assistantMessage.tool_calls.length} tools, truncating to first only: ${toolNames}`);
          assistantMessage.tool_calls = [assistantMessage.tool_calls[0]!];
        }

        // Tool call 실행 (single tool per turn enforced)
        for (const toolCall of assistantMessage.tool_calls!) {
          // Sanitize tool name: strip <|...|> special tokens and trailing garbage
          const rawToolName = toolCall.function.name;
          const toolName =
            rawToolName.replace(/<\|.*$/, '').replace(/[^a-zA-Z0-9_-]+$/, '').trim() || rawToolName;
          if (toolName !== rawToolName) {
            logger.warn('Tool name sanitized (model leaked special tokens)', {
              original: rawToolName,
              sanitized: toolName,
              model: this.model,
            });
            toolCall.function.name = toolName;
            reportError(new Error(`Tool name contaminated: ${rawToolName}`), {
              type: 'toolNameContamination',
              original: rawToolName,
              sanitized: toolName,
              modelId: this.model,
              modelName: this.modelName,
            }).catch(() => {});
          }
          let toolArgs: Record<string, unknown>;

          try {
            toolArgs = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
          } catch (parseError) {
            consecutiveParseFailures++;
            parseFailureToolCallIds.add(toolCall.id);
            const errorMsg = `Tool argument parsing failed for ${toolName}: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`;
            logger.errorSilent('Tool argument parse error', {
              toolName,
              error: errorMsg,
              consecutiveFailures: consecutiveParseFailures,
            });
            logger.debug('Raw arguments', { raw: toolCall.function.arguments });
            reportError(parseError, {
              type: 'toolArgParsing',
              tool: toolName,
              consecutiveFailures: consecutiveParseFailures,
              modelId: this.model,
              modelName: this.modelName,
              rawArguments: typeof toolCall.function.arguments === 'string' ? toolCall.function.arguments.substring(0, 500) : undefined,
            }).catch(() => {});

            // 3회 연속 parse 실패 시 강제 종료
            if (consecutiveParseFailures >= MAX_CONSECUTIVE_PARSE_FAILURES) {
              logger.errorSilent('[ABORT] Tool argument parse failed 3 times consecutively. Model may not support JSON function calling.');
              const abortMsg = 'I cannot generate valid JSON tool arguments. Please try a different model that supports JSON function calling.';
              addMessage({
                role: 'tool',
                content: errorMsg,
                tool_call_id: toolCall.id,
              });
              return {
                message: { role: 'assistant', content: abortMsg },
                toolCalls: toolCallHistory,
                allMessages: getAllMessages(),
              };
            }

            // LLM에게 구체적 피드백 — raw input + 실패 원인 + 올바른 형식 안내
            const rawArgs = toolCall.function.arguments;
            const rawPreview = typeof rawArgs === 'string' ? rawArgs.substring(0, 300) : String(rawArgs);
            const hintMsg = `Error: Failed to parse tool arguments for "${toolName}".

Parse error: ${parseError instanceof Error ? parseError.message : 'Unknown error'}

Your raw input was:
\`\`\`
${rawPreview}
\`\`\`

Fix the following issues:
1. Arguments MUST be valid JSON (not XML, not plain text)
2. All strings must use double quotes ("), not single quotes (')
3. No trailing commas after the last property
4. No comments inside JSON
5. Escape special characters in strings (\\n, \\", \\\\)

Correct format example:
\`\`\`json
{"reason": "description", "file_path": "src/index.ts"}
\`\`\`

Do NOT use XML tags like <arg_key> or <arg_value>. Retry with valid JSON.`;
            addMessage({
              role: 'tool',
              content: hintMsg,
              tool_call_id: toolCall.id,
            });

            toolCallHistory.push({
              tool: toolName,
              args: { raw: toolCall.function.arguments },
              result: `Error: Argument parsing failed`,
            });

            continue;
          }

          // Schema validation: required 파라미터 누락 및 타입 불일치 검증
          const toolDef = tools.find(t => t.function.name === toolName);
          if (toolDef?.function.parameters) {
            const schema = toolDef.function.parameters;
            const schemaErrors: string[] = [];

            // 1. required 파라미터 누락 체크
            if (schema.required) {
              for (const req of schema.required) {
                if (toolArgs[req] === undefined || toolArgs[req] === null) {
                  const propDef = schema.properties[req] as { type?: string } | undefined;
                  schemaErrors.push(`Missing required parameter: "${req}" (expected: ${propDef?.type || 'unknown'})`);
                }
              }
            }

            // 2. 제공된 파라미터 타입 불일치 체크
            for (const [key, value] of Object.entries(toolArgs)) {
              const propDef = schema.properties[key] as { type?: string } | undefined;
              if (propDef?.type && value !== null && value !== undefined) {
                const actualType = Array.isArray(value) ? 'array' : typeof value;
                if (actualType !== propDef.type) {
                  schemaErrors.push(`"${key}": expected ${propDef.type}, got ${actualType} (${JSON.stringify(value).substring(0, 50)})`);
                }
              }
            }

            if (schemaErrors.length > 0) {
              consecutiveParseFailures++;
              parseFailureToolCallIds.add(toolCall.id);

              // 3회 연속 실패 시 abort
              if (consecutiveParseFailures >= MAX_CONSECUTIVE_PARSE_FAILURES) {
                const abortMsg = 'Cannot generate valid tool arguments. Please try a different model.';
                addMessage({ role: 'tool', content: schemaErrors.join('\n'), tool_call_id: toolCall.id });
                return {
                  message: { role: 'assistant', content: abortMsg },
                  toolCalls: toolCallHistory,
                  allMessages: getAllMessages(),
                };
              }

              // 구체적 피드백: 어떤 파라미터가 잘못됐는지 + 올바른 스키마 안내
              const requiredList = (schema.required || [])
                .map(r => {
                  const p = schema.properties[r] as { type?: string } | undefined;
                  return `  "${r}": ${p?.type || 'unknown'}`;
                })
                .join('\n');
              const hintMsg = `Error: Schema validation failed for "${toolName}".

${schemaErrors.join('\n')}

Required parameters:
${requiredList}

Retry with correct parameter names and types.`;
              addMessage({ role: 'tool', content: hintMsg, tool_call_id: toolCall.id });
              toolCallHistory.push({ tool: toolName, args: toolArgs, result: 'Error: Schema validation failed' });
              continue;
            }
          }

          // JSON parse + schema validation 모두 통과 → 연속 실패 카운터 리셋
          consecutiveParseFailures = 0;

          // tell_to_user 연속 호출 감지 — 무한루프 방지
          if (toolName === 'tell_to_user') {
            consecutiveTellToUserCalls++;
            logger.info('[CHAT] tell_to_user called', {
              consecutive: consecutiveTellToUserCalls,
              message: (toolArgs['message'] as string || '').substring(0, 300),
            });

            if (consecutiveTellToUserCalls > MAX_CONSECUTIVE_TELL_TO_USER) {
              logger.errorSilent(`[LOOP DETECTED] tell_to_user called ${consecutiveTellToUserCalls} times consecutively — forcing final_response`, {
                lastMessage: (toolArgs['message'] as string || '').substring(0, 200),
              });
              reportError(new Error(`tell_to_user infinite loop detected (${consecutiveTellToUserCalls} consecutive calls)`), {
                type: 'tellToUserLoop',
                consecutiveCalls: consecutiveTellToUserCalls,
                lastMessage: (toolArgs['message'] as string || '').substring(0, 500),
                modelId: this.model,
                modelName: this.modelName,
                iterations,
              }).catch(() => {});

              addMessage({
                role: 'tool',
                content: `Error: tell_to_user has been called ${consecutiveTellToUserCalls} times consecutively. This indicates an infinite loop. You MUST call final_response now to complete the task. Do NOT call tell_to_user again.`,
                tool_call_id: toolCall.id,
              });
              toolCallHistory.push({ tool: toolName, args: toolArgs, result: 'Error: consecutive tell_to_user loop detected' });
              continue;
            }
          } else {
            // 다른 tool 호출 시 카운터 리셋
            consecutiveTellToUserCalls = 0;
          }

          // Tool 실행
          const { executeFileTool, executeAgentTool, requestToolApproval } = await import('../../tools/llm/simple/file-tools.js');
          const { isLLMAgentTool: checkAgentTool } = await import('../../tools/types.js');
          const { toolRegistry: registry } = await import('../../tools/registry.js');

          // Supervised Mode: Request user approval before tool execution
          const approvalResult = await requestToolApproval(toolName, toolArgs);

          if (approvalResult && typeof approvalResult === 'object' && approvalResult.reject) {
            // User rejected the tool execution
            logger.flow(`Tool rejected by user: ${toolName}`);

            const rejectMessage = approvalResult.comment
              ? `Tool execution rejected by user. Reason: ${approvalResult.comment}`
              : 'Tool execution rejected by user.';

            addMessage({
              role: 'tool',
              content: rejectMessage,
              tool_call_id: toolCall.id,
            });

            toolCallHistory.push({
              tool: toolName,
              args: toolArgs,
              result: rejectMessage,
            });

            continue;
          }

          logger.debug(`Executing tool: ${toolName}`, toolArgs);

          let result: { success: boolean; result?: string; error?: string; metadata?: Record<string, unknown> };

          // Handle ask_to_user specially — use direct callback instead of global
          if (toolName === 'ask_to_user' && options?.askUser) {
            const question = toolArgs['question'] as string;
            const askOptions = toolArgs['options'] as string[];
            const askStreamLogger = getJsonStreamLogger();
            askStreamLogger?.log({
              timestamp: new Date().toISOString(),
              type: 'tool_start',
              content: `ask_to_user: "${question}"`,
              category: 'chat',
              metadata: { question, options: askOptions },
            });
            if (question && Array.isArray(askOptions) && askOptions.length >= 2) {
              try {
                const askResponse = await options.askUser({ question, options: askOptions });
                const resultText = askResponse.isOther && askResponse.customText
                  ? `User provided custom response: "${askResponse.customText}"`
                  : `User selected: "${askResponse.selectedOption}"`;
                result = { success: true, result: resultText };
                askStreamLogger?.log({
                  timestamp: new Date().toISOString(),
                  type: 'tool_end',
                  content: `ask_to_user response: ${resultText}`,
                  category: 'chat',
                  metadata: { response: resultText },
                });
              } catch (askError) {
                result = { success: false, error: `Error asking user: ${askError instanceof Error ? askError.message : 'Unknown error'}` };
              }
            } else {
              result = { success: false, error: 'Invalid ask_to_user parameters' };
            }
          } else {

          try {
            // Route to agent tool executor or simple tool executor
            const registeredTool = registry.get(toolName);
            if (registeredTool && checkAgentTool(registeredTool)) {
              result = await executeAgentTool(toolName, toolArgs, this);
            } else {
              result = await executeFileTool(toolName, toolArgs);
            }
            logger.toolExecution(toolName, toolArgs, result);

            // LLM Log mode: Tool 결과 로깅
            if (isLLMLogEnabled()) {
              logger.llmToolResult(toolName, result.result || '', result.success);
            }

            // Handle final_response tool
            if (toolName === 'final_response') {
              if (result.success && result.metadata?.['isFinalResponse']) {
                // Success - return immediately
                // Note: emitAssistantResponse is already called via finalResponseCallback in final-response-tool.ts
                logger.flow('final_response tool executed successfully - returning');
                const frStreamLogger = getJsonStreamLogger();
                frStreamLogger?.logAssistantResponse(result.result || '');

                // Add tool result to messages for completeness
                addMessage({
                  role: 'tool',
                  content: result.result || '',
                  tool_call_id: toolCall.id,
                });

                // Add to history
                toolCallHistory.push({
                  tool: toolName,
                  args: toolArgs,
                  result: result.result || '',
                });

                // Return final response
                return {
                  message: {
                    role: 'assistant' as const,
                    content: result.result || '',
                  },
                  toolCalls: toolCallHistory,
                  allMessages: getAllMessages(),
                };
              } else {
                // Failure - track attempts to prevent infinite loop
                finalResponseFailures++;
                logger.flow(`final_response failed (attempt ${finalResponseFailures}/${MAX_FINAL_RESPONSE_FAILURES}): ${result.error}`);

                if (finalResponseFailures >= MAX_FINAL_RESPONSE_FAILURES) {
                  logger.warn('Max final_response failures exceeded - forcing completion');
                  const fallbackMessage = (toolArgs['message'] as string) || 'Task completed with incomplete TODOs.';

                  // Emit as assistant response
                  const { emitAssistantResponse } = await import('../../tools/llm/simple/file-tools.js');
                  emitAssistantResponse(fallbackMessage);

                  return {
                    message: { role: 'assistant' as const, content: fallbackMessage },
                    toolCalls: toolCallHistory,
                    allMessages: getAllMessages(),
                  };
                }
              }
            }
          } catch (toolError) {
            logger.toolExecution(toolName, toolArgs, undefined, toolError as Error);
            reportError(toolError, { type: 'toolExecution', tool: toolName, modelId: this.model, modelName: this.modelName, toolArgs }).catch(() => {});

            // LLM Log mode: Tool 에러 로깅
            if (isLLMLogEnabled()) {
              const errorMsg = toolError instanceof Error ? toolError.message : String(toolError);
              logger.llmToolResult(toolName, `Error: ${errorMsg}`, false);
            }

            result = {
              success: false,
              error: toolError instanceof Error ? toolError.message : String(toolError),
            };
          }
          } // close else (ask_to_user special handling)

          // 결과를 메시지에 추가
          addMessage({
            role: 'tool',
            content: result.success ? result.result || '' : `Error: ${result.error}`,
            tool_call_id: toolCall.id,
          });

          // 히스토리에 추가
          toolCallHistory.push({
            tool: toolName,
            args: toolArgs,
            result: result.success ? result.result || '' : `Error: ${result.error}`,
          });

          // Check for interrupt after tool execution
          if (this.isInterrupted) {
            logger.flow('Interrupt detected after tool execution - stopping');
            throw new Error('INTERRUPTED');
          }
        }

        // Auto-compact check after tool execution
        if (options?.onAfterToolExecution) {
          await options.onAfterToolExecution(toolLoopMessages);
        }

        // Tool 실행 완료 - 계속해서 LLM 호출 (continue)
        // LLM이 finish_reason: stop을 반환할 때까지 루프 계속
        continue;
      } else {
        // Tool call 없음 - tool call 강제
        // LLM은 반드시 tool을 사용해야 함 (final_response 포함)
        noToolCallRetries++;
        logger.flow(`No tool call - enforcing tool usage (attempt ${noToolCallRetries}/${MAX_NO_TOOL_CALL_RETRIES})`);

        // Remove empty assistant message from history to prevent context pollution
        // Empty messages (no content, no tool_calls) waste tokens and confuse the LLM on retry
        if (!assistantMessage.content && (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0)) {
          workingMessages.pop();
          if (options?.rebuildMessages) {
            toolLoopMessages.pop();
          }
          logger.debug('Removed empty assistant message from history');
        }

        // Max retries exceeded - return content as final response to prevent infinite loop
        if (noToolCallRetries > MAX_NO_TOOL_CALL_RETRIES) {
          logger.warn('Max no-tool-call retries exceeded - returning content as final response');
          const fallbackContent = assistantMessage.content || 'Task completed.';

          // Emit as assistant response
          const { emitAssistantResponse } = await import('../../tools/llm/simple/file-tools.js');
          emitAssistantResponse(fallbackContent);

          return {
            message: { role: 'assistant' as const, content: fallbackContent },
            toolCalls: toolCallHistory,
            allMessages: getAllMessages(),
          };
        }

        // Check for malformed tool call patterns in content
        const hasMalformedToolCall = assistantMessage.content &&
          (/<tool_call>/i.test(assistantMessage.content) ||
           /<arg_key>/i.test(assistantMessage.content) ||
           /<arg_value>/i.test(assistantMessage.content) ||
           /<\/tool_call>/i.test(assistantMessage.content) ||
           /bash<arg_key>/i.test(assistantMessage.content) ||
           /<xai:function_call/i.test(assistantMessage.content) ||
           /<\/xai:function_call>/i.test(assistantMessage.content) ||
           /<parameter\s+name=/i.test(assistantMessage.content));

        const retryMessage = hasMalformedToolCall
          ? 'Your previous response contained a malformed tool call (XML tags in content). You MUST use the proper tool_calls API format. Use final_response tool to deliver your message to the user.'
          : 'You must use tools for all actions. Use final_response tool to deliver your final message to the user after completing all tasks.';

        // Add retry instruction (assistant message already in history if it had content)
        addMessage({
          role: 'user',
          content: retryMessage,
        });

        logger.debug('Enforcing tool call - added retry message');

        // Continue loop to retry
        continue;
      }
    }
  }

  /**
   * 현재 모델 정보 가져오기
   */
  getModelInfo(): { model: string; endpoint: string } {
    return {
      model: this.modelName,
      endpoint: this.baseUrl,
    };
  }

  /**
   * Enhanced error handler with detailed logging
   */
  private handleError(error: unknown, requestContext?: { method?: string; url?: string; body?: unknown }): Error {
    // Log the error with context
    logger.errorSilent('LLM Client Error', error);

    if (requestContext) {
      logger.debug('Request Context', requestContext);
    }

    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;

      // Timeout error
      if (axiosError.code === 'ECONNABORTED' || axiosError.message.includes('timeout')) {
        logger.errorSilent('Request Timeout', {
          timeout: this.axiosInstance.defaults.timeout,
          endpoint: this.baseUrl,
        });
        return new TimeoutError(
          this.axiosInstance.defaults.timeout || 60000,
          {
            cause: axiosError,
            details: {
              endpoint: this.baseUrl,
              method: requestContext?.method,
              url: requestContext?.url,
            },
          }
        );
      }

      if (axiosError.response) {
        // Server responded with error status (4xx, 5xx)
        const status = axiosError.response.status;
        const data = axiosError.response.data as any;
        const errorMessage = data?.error?.message || data?.message || axiosError.message;
        const errorType = data?.error?.type || 'unknown';
        const errorCode = data?.error?.code || data?.code;

        // Enhanced error logging for debugging
        logger.errorSilent('=== API ERROR DETAILS ===', {
          status,
          statusText: axiosError.response.statusText,
          endpoint: this.baseUrl,
          model: this.model,
          errorMessage,
          errorType,
          errorCode,
          // Full API response body
          responseBody: JSON.stringify(data, null, 2),
          // Request info
          requestMethod: requestContext?.method,
          requestUrl: requestContext?.url,
          // Request body (truncated for large payloads)
          requestBody: requestContext?.body
            ? JSON.stringify(requestContext.body, null, 2).substring(0, 5000)
            : undefined,
          // Response headers
          responseHeaders: axiosError.response.headers,
        });

        logger.httpResponse(status, axiosError.response.statusText, data);

        // Context length exceeded (OpenAI standard + Dashboard proxy format)
        // errorType 조건을 제거: Dashboard 프록시가 비표준 포맷을 반환할 수 있음
        // (error가 object가 아닌 string이면 errorType이 'unknown'이 됨)
        if (
          status === 400 &&
          (errorMessage.includes('context_length_exceeded') ||
           errorMessage.includes('maximum context length') ||
           errorMessage.includes('Input too long') ||
           errorCode === 'context_length_exceeded' ||
           (typeof data?.error === 'string' && data.error.includes('Input too long')))
        ) {
          const maxLength = data?.error?.param?.max_tokens || 'unknown';
          logger.errorSilent('Context Length Exceeded', {
            maxLength,
            errorMessage,
            model: this.model,
          });

          return new ContextLengthError(
            typeof maxLength === 'number' ? maxLength : 0,
            undefined,
            {
              cause: axiosError,
              details: {
                model: this.model,
                endpoint: this.baseUrl,
                errorType,
                fullError: data,
              },
            }
          );
        }

        // Token limit error
        if (
          errorMessage.includes('token') &&
          (errorMessage.includes('limit') || errorMessage.includes('exceeded'))
        ) {
          logger.errorSilent('Token Limit Error', {
            errorMessage,
            model: this.model,
          });

          return new TokenLimitError(
            0, // We don't know the exact limit from error message
            undefined,
            {
              cause: axiosError,
              details: {
                model: this.model,
                endpoint: this.baseUrl,
                fullError: data,
              },
              userMessage: errorMessage,
            }
          );
        }

        // Rate limit (429) - check for quota_exceeded first
        if (status === 429) {
          if (errorType === 'quota_exceeded' && data?.error?.quota) {
            logger.errorSilent('Quota Exceeded', {
              period: data.error.quota.period,
              weekly: data.error.quota.weekly,
            });
            throw new QuotaExceededError(data.error.quota);
          }

          const retryAfter = axiosError.response.headers['retry-after'];
          const retrySeconds = retryAfter ? parseInt(retryAfter) : undefined;

          logger.errorSilent('Rate Limit Exceeded', {
            retryAfter: retrySeconds,
            errorMessage,
          });

          return new RateLimitError(retrySeconds, {
            cause: axiosError,
            details: {
              endpoint: this.baseUrl,
              model: this.model,
              fullError: data,
            },
          });
        }

        // Authentication error (401)
        if (status === 401) {
          logger.errorSilent('Authentication Failed', {
            endpoint: this.baseUrl,
            errorMessage,
          });

          return new APIError(
            `인증 실패: ${errorMessage}`,
            status,
            this.baseUrl,
            {
              cause: axiosError,
              details: {
                apiKeyProvided: !!this.apiKey,
                apiKeyLength: this.apiKey?.length || 0,
                fullError: data,
              },
              isRecoverable: false,
              userMessage: `API 키가 유효하지 않습니다. 설정을 확인해주세요.\n상세: ${errorMessage}`,
            }
          );
        }

        // Forbidden (403)
        if (status === 403) {
          logger.errorSilent('Access Forbidden', {
            endpoint: this.baseUrl,
            errorMessage,
          });

          return new APIError(
            `접근 거부: ${errorMessage}`,
            status,
            this.baseUrl,
            {
              cause: axiosError,
              details: {
                fullError: data,
              },
              isRecoverable: false,
            }
          );
        }

        // Not found (404)
        if (status === 404) {
          logger.errorSilent('Endpoint Not Found', {
            endpoint: this.baseUrl,
            url: requestContext?.url,
            errorMessage,
          });

          return new APIError(
            `엔드포인트를 찾을 수 없습니다: ${errorMessage}`,
            status,
            this.baseUrl,
            {
              cause: axiosError,
              details: {
                url: requestContext?.url,
                fullError: data,
              },
              isRecoverable: false,
              userMessage: `API 엔드포인트가 존재하지 않습니다.\nURL: ${this.baseUrl}${requestContext?.url || ''}\n상세: ${errorMessage}`,
            }
          );
        }

        // Server error (5xx)
        if (status >= 500) {
          logger.errorSilent('Server Error', {
            status,
            endpoint: this.baseUrl,
            errorMessage,
          });

          return new APIError(
            `서버 에러 (${status}): ${errorMessage}`,
            status,
            this.baseUrl,
            {
              cause: axiosError,
              details: {
                fullError: data,
              },
              isRecoverable: true, // Server errors are usually temporary
            }
          );
        }

        // Other API errors (4xx)
        logger.errorSilent('API Error', {
          status,
          endpoint: this.baseUrl,
          errorMessage,
          errorType,
          errorCode,
        });

        return new APIError(
          `API 에러 (${status}): ${errorMessage}`,
          status,
          this.baseUrl,
          {
            cause: axiosError,
            details: {
              errorType,
              errorCode,
              fullError: data,
            },
            userMessage: `API 요청 실패 (${status}):\n${errorMessage}\n\n에러 타입: ${errorType}\n에러 코드: ${errorCode}`,
          }
        );

      } else if (axiosError.request) {
        // Request sent but no response received (network error)
        const errorCode = axiosError.code;

        logger.errorSilent('Network Error - No Response', {
          code: errorCode,
          endpoint: this.baseUrl,
          message: axiosError.message,
        });

        // Connection refused, host not found, etc.
        if (
          errorCode === 'ECONNREFUSED' ||
          errorCode === 'ENOTFOUND' ||
          errorCode === 'ECONNRESET' ||
          errorCode === 'EHOSTUNREACH'
        ) {
          return new ConnectionError(this.baseUrl, {
            cause: axiosError,
            details: {
              code: errorCode,
              message: axiosError.message,
            },
            userMessage: `서버에 연결할 수 없습니다.\n엔드포인트: ${this.baseUrl}\n에러 코드: ${errorCode}\n상세: ${axiosError.message}\n\n네트워크 연결과 엔드포인트 URL을 확인해주세요.`,
          });
        }

        // General network error
        return new NetworkError(
          `네트워크 에러: ${axiosError.message}`,
          {
            cause: axiosError,
            details: {
              code: errorCode,
              endpoint: this.baseUrl,
            },
            userMessage: `네트워크 연결 실패.\n엔드포인트: ${this.baseUrl}\n에러: ${axiosError.message}`,
          }
        );
      }

      // Axios error without response or request
      logger.errorSilent('Axios Error', {
        code: axiosError.code,
        message: axiosError.message,
      });

      return new LLMError(
        `LLM 클라이언트 에러: ${axiosError.message}`,
        {
          cause: axiosError,
          details: {
            code: axiosError.code,
          },
        }
      );
    }

    // Non-axios error
    if (error instanceof Error) {
      logger.errorSilent('Unexpected Error', error);
      return new LLMError(
        `예상치 못한 에러: ${error.message}`,
        {
          cause: error,
          userMessage: `오류가 발생했습니다:\n${error.message}\n\n스택:\n${error.stack}`,
        }
      );
    }

    // Unknown error type
    logger.errorSilent('Unknown Error Type', { error });
    return new LLMError('알 수 없는 에러가 발생했습니다.', {
      details: { unknownError: error },
    });
  }

  /**
   * 재시도 로직이 포함된 Chat Completion
   * @deprecated chatCompletion이 이제 기본적으로 재시도를 수행합니다
   */
  async chatCompletionWithRetry(
    options: Partial<LLMRequestOptions>,
    maxRetries = 3
  ): Promise<LLMResponse> {
    // chatCompletion이 이제 내부적으로 재시도를 수행하므로 직접 호출
    return this.chatCompletion(options, { maxRetries });
  }

  /**
   * 현재 설정된 엔드포인트 Health Check
   */
  async healthCheck(): Promise<{
    success: boolean;
    latency?: number;
    error?: string;
  }> {
    const endpoint = configManager.getCurrentEndpoint();
    const model = configManager.getCurrentModel();

    if (!endpoint || !model) {
      return { success: false, error: 'No endpoint or model configured' };
    }

    const startTime = Date.now();

    try {
      const response = await this.axiosInstance.post<LLMResponse>('/chat/completions', {
        model: model.id,
        messages: [{ role: 'user', content: 'ping' }],
      });

      const latency = Date.now() - startTime;

      if (response.status === 200 && response.data.choices?.[0]?.message) {
        return { success: true, latency };
      } else {
        return { success: false, latency, error: 'Invalid response format' };
      }
    } catch (error) {
      const latency = Date.now() - startTime;
      const axiosError = error as AxiosError;

      if (axiosError.response) {
        const status = axiosError.response.status;
        return { success: false, latency, error: `HTTP ${status}` };
      } else if (axiosError.request) {
        return { success: false, latency, error: 'Connection failed' };
      } else {
        return { success: false, latency, error: axiosError.message || 'Unknown error' };
      }
    }
  }

  /**
   * 모든 등록된 엔드포인트 일괄 Health Check
   */
  static async healthCheckAll(): Promise<
    Map<string, { modelId: string; healthy: boolean; latency?: number; error?: string }[]>
  > {
    const endpoints = configManager.getAllEndpoints();
    const results = new Map<
      string,
      { modelId: string; healthy: boolean; latency?: number; error?: string }[]
    >();

    for (const endpoint of endpoints) {
      const modelResults: { modelId: string; healthy: boolean; latency?: number; error?: string }[] = [];

      // Dashboard endpoint: /health로 확인 (chat/completions ping은 사용량 기록됨)
      if (endpoint.id === 'dashboard') {
        const startTime = Date.now();
        try {
          const res = await axios.get(`${endpoint.baseUrl}/health`, {
            headers: {
              ...(endpoint.apiKey && { Authorization: `Bearer ${endpoint.apiKey}` }),
            },
            timeout: 10000,
          });
          const latency = Date.now() - startTime;
          const healthy = res.status === 200;
          for (const model of endpoint.models) {
            modelResults.push({ modelId: model.id, healthy, latency });
          }
        } catch (error) {
          const latency = Date.now() - startTime;
          const axiosError = error as AxiosError;
          let errorMessage = 'Unknown error';
          if (axiosError.response) errorMessage = `HTTP ${axiosError.response.status}`;
          else if (axiosError.code === 'ECONNREFUSED') errorMessage = 'Connection refused';
          else if (axiosError.code === 'ETIMEDOUT' || axiosError.code === 'ECONNABORTED') errorMessage = 'Timeout';
          else if (axiosError.request) errorMessage = 'Network error';
          for (const model of endpoint.models) {
            modelResults.push({ modelId: model.id, healthy: false, latency, error: errorMessage });
          }
        }
        results.set(endpoint.id, modelResults);
        continue;
      }

      for (const model of endpoint.models) {
        if (!model.enabled) {
          modelResults.push({
            modelId: model.id,
            healthy: false,
            error: 'Model disabled',
          });
          continue;
        }

        const startTime = Date.now();

        try {
          const axiosInstance = axios.create({
            baseURL: endpoint.baseUrl,
            headers: {
              'Content-Type': 'application/json',
              'X-Service-Id': SERVICE_ID,
              ...(endpoint.apiKey && { Authorization: `Bearer ${endpoint.apiKey}` }),
            },
            timeout: 30000,
          });

          const response = await axiosInstance.post<LLMResponse>('/chat/completions', {
            model: model.id,
            messages: [{ role: 'user', content: 'ping' }],
          });

          const latency = Date.now() - startTime;

          if (response.status === 200 && response.data.choices?.[0]?.message) {
            modelResults.push({ modelId: model.id, healthy: true, latency });
          } else {
            modelResults.push({
              modelId: model.id,
              healthy: false,
              latency,
              error: 'Invalid response',
            });
          }
        } catch (error) {
          const latency = Date.now() - startTime;
          const axiosError = error as AxiosError;

          let errorMessage = 'Unknown error';
          if (axiosError.response) {
            errorMessage = `HTTP ${axiosError.response.status}`;
          } else if (axiosError.code === 'ECONNREFUSED') {
            errorMessage = 'Connection refused';
          } else if (axiosError.code === 'ETIMEDOUT' || axiosError.code === 'ECONNABORTED') {
            errorMessage = 'Timeout';
          } else if (axiosError.request) {
            errorMessage = 'Network error';
          }

          modelResults.push({
            modelId: model.id,
            healthy: false,
            latency,
            error: errorMessage,
          });
        }
      }

      results.set(endpoint.id, modelResults);
    }

    return results;
  }

  /**
   * 엔드포인트 연결 테스트 (Static)
   * config init 시 사용하기 위한 정적 메서드
   */
  static async testConnection(
    baseUrl: string,
    apiKey: string,
    model: string
  ): Promise<{ success: boolean; latency?: number; error?: string }> {
    const startTime = Date.now();

    try {
      const axiosInstance = axios.create({
        baseURL: baseUrl,
        headers: {
          'Content-Type': 'application/json',
          'X-Service-Id': SERVICE_ID,
          ...(apiKey && { Authorization: `Bearer ${apiKey}` }),
        },
        timeout: 60000, // 60초 타임아웃
      });

      // 간단한 테스트 메시지로 연결 확인
      const response = await axiosInstance.post<LLMResponse>('/chat/completions', {
        model: model,
        messages: [
          {
            role: 'user',
            content: 'test',
          },
        ],
      });

      const latency = Date.now() - startTime;

      if (response.status === 200 && response.data.choices?.[0]?.message) {
        return { success: true, latency };
      } else {
        return { success: false, latency, error: '유효하지 않은 응답 형식' };
      }
    } catch (error) {
      const latency = Date.now() - startTime;
      const axiosError = error as AxiosError;

      if (axiosError.response) {
        const status = axiosError.response.status;
        const data = axiosError.response.data as { error?: { message?: string } };
        const message = data?.error?.message || axiosError.message;

        if (status === 401) {
          return { success: false, latency, error: 'API 키가 유효하지 않습니다.' };
        } else if (status === 404) {
          return { success: false, latency, error: '엔드포인트 또는 모델을 찾을 수 없습니다.' };
        } else {
          return { success: false, latency, error: `API 에러 (${status}): ${message}` };
        }
      } else if (axiosError.request) {
        return { success: false, latency, error: `네트워크 에러: 엔드포인트에 연결할 수 없습니다.` };
      } else {
        return { success: false, latency, error: axiosError.message || '알 수 없는 에러' };
      }
    }
  }
}

