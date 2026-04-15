/**
 * LLM Error Classes
 *
 * LLM  
 */

import { BaseError, ErrorOptions } from './base.js';

/**
 * LLMError -  LLM 
 */
export class LLMError extends BaseError {
  constructor(message: string, options: ErrorOptions = {}) {
    super(
      message,
      'LLM_ERROR',
      {
        ...options,
        isRecoverable: options.isRecoverable ?? true,
        userMessage: options.userMessage ?? 'LLM    .',
      }
    );
  }
}

/**
 * StreamingError -  
 */
export class StreamingError extends BaseError {
  constructor(message: string, options: ErrorOptions = {}) {
    super(
      message,
      'STREAMING_ERROR',
      {
        ...options,
        isRecoverable: true,
        userMessage: options.userMessage ?? '    .',
      }
    );
  }
}

/**
 * ModelError -   
 */
export class ModelError extends BaseError {
  public readonly modelId?: string;

  constructor(message: string, modelId?: string, options: ErrorOptions = {}) {
    super(
      message,
      'MODEL_ERROR',
      {
        ...options,
        details: {
          ...options.details,
          modelId,
        },
        isRecoverable: false,
        userMessage: options.userMessage ?? `  ${modelId ? ` (: ${modelId})` : ''}.`,
      }
    );
    this.modelId = modelId;
  }
}

/**
 * TokenLimitError -    
 */
export class TokenLimitError extends BaseError {
  public readonly limit: number;
  public readonly actual?: number;

  constructor(
    limit: number,
    actual?: number,
    options: ErrorOptions = {}
  ) {
    super(
      `Token limit exceeded. Limit: ${limit}${actual ? `, Actual: ${actual}` : ''}`,
      'TOKEN_LIMIT_ERROR',
      {
        ...options,
        details: {
          ...options.details,
          limit,
          actual,
        },
        isRecoverable: true,
        userMessage: options.userMessage ?? `   (: ${limit}${actual ? `, : ${actual}` : ''}).  .`,
      }
    );
    this.limit = limit;
    this.actual = actual;
  }
}

/**
 * RateLimitError - API   
 */
export class RateLimitError extends BaseError {
  public readonly retryAfter?: number;

  constructor(retryAfter?: number, options: ErrorOptions = {}) {
    super(
      `Rate limit exceeded${retryAfter ? `. Retry after ${retryAfter}s` : ''}`,
      'RATE_LIMIT_ERROR',
      {
        ...options,
        details: {
          ...options.details,
          retryAfter,
        },
        isRecoverable: true,
        userMessage: options.userMessage ?? `API   ${retryAfter ? `. ${retryAfter}   ` : '.    '}.`,
      }
    );
    this.retryAfter = retryAfter;
  }
}

/**
 * LLMRetryExhaustedError -  retry   
 * chatCompletion() Phase 1 (3) + Phase 2 (2 ) + Phase 3 (3)    throw
 * UI        
 */
export class LLMRetryExhaustedError extends BaseError {
  public readonly originalError: Error;

  constructor(originalError: Error, options: ErrorOptions = {}) {
    super(
      `LLM    (6  + 2    ): ${originalError.message}`,
      'LLM_RETRY_EXHAUSTED',
      {
        ...options,
        isRecoverable: true,
        userMessage: options.userMessage ?? `LLM   . Enter  .`,
      }
    );
    this.originalError = originalError;
  }
}

/**
 * ContextLengthError -    
 */
export class ContextLengthError extends BaseError {
  public readonly maxLength: number;
  public readonly actualLength?: number;

  constructor(
    maxLength: number,
    actualLength?: number,
    options: ErrorOptions = {}
  ) {
    super(
      `Context length exceeded. Max: ${maxLength}${actualLength ? `, Actual: ${actualLength}` : ''}`,
      'CONTEXT_LENGTH_ERROR',
      {
        ...options,
        details: {
          ...options.details,
          maxLength,
          actualLength,
        },
        isRecoverable: true,
        userMessage: options.userMessage ?? `    (: ${maxLength}${actualLength ? `, : ${actualLength}` : ''}). /clear   .`,
      }
    );
    this.maxLength = maxLength;
    this.actualLength = actualLength;
  }
}
