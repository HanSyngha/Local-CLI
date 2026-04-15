/**
 * Network Error Classes
 *
 *   
 */

import { BaseError, ErrorOptions } from './base.js';

/**
 * NetworkError -   
 */
export class NetworkError extends BaseError {
  constructor(message: string, options: ErrorOptions = {}) {
    super(
      message,
      'NETWORK_ERROR',
      {
        ...options,
        isRecoverable: options.isRecoverable ?? true,
        userMessage: options.userMessage ?? '  .   .',
      }
    );
  }
}

/**
 * APIError - API  
 */
export class APIError extends BaseError {
  public readonly statusCode?: number;
  public readonly endpoint?: string;

  constructor(
    message: string,
    statusCode?: number,
    endpoint?: string,
    options: ErrorOptions = {}
  ) {
    super(
      message,
      'API_ERROR',
      {
        ...options,
        details: {
          ...options.details,
          statusCode,
          endpoint,
        },
        isRecoverable: options.isRecoverable ?? (statusCode ? statusCode >= 500 : true),
        userMessage: options.userMessage ?? APIError.getAPIErrorMessage(statusCode),
      }
    );
    this.statusCode = statusCode;
    this.endpoint = endpoint;
  }

  static getAPIErrorMessage(statusCode?: number): string {
    if (!statusCode) {
      return 'API    .';
    }

    if (statusCode === 401) {
      return 'API  . API Key .';
    } else if (statusCode === 403) {
      return '  . API Key  .';
    } else if (statusCode === 404) {
      return ' API    .';
    } else if (statusCode === 429) {
      return 'API   .    .';
    } else if (statusCode >= 500) {
      return 'API   .    .';
    } else {
      return `API     ( : ${statusCode}).`;
    }
  }
}

/**
 * TimeoutError -   
 */
export class TimeoutError extends BaseError {
  public readonly timeout: number;

  constructor(timeout: number, options: ErrorOptions = {}) {
    super(
      `Request timed out after ${timeout}ms`,
      'TIMEOUT_ERROR',
      {
        ...options,
        details: {
          ...options.details,
          timeout,
        },
        isRecoverable: true,
        userMessage: options.userMessage ?? `   (${timeout}ms).  .`,
      }
    );
    this.timeout = timeout;
  }
}

/**
 * ConnectionError -   
 */
export class ConnectionError extends BaseError {
  public readonly host?: string;

  constructor(host?: string, options: ErrorOptions = {}) {
    super(
      `Failed to connect${host ? ` to ${host}` : ''}`,
      'CONNECTION_ERROR',
      {
        ...options,
        details: {
          ...options.details,
          host,
        },
        isRecoverable: true,
        userMessage: options.userMessage ?? `   ${host ? ` (${host})` : ''}.   .`,
      }
    );
    this.host = host;
  }
}
