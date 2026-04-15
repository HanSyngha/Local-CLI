/**
 * Validation Error Classes
 *
 *    
 */

import { BaseError, ErrorOptions } from './base';

/**
 * ValidationError -    
 */
export class ValidationError extends BaseError {
  public readonly field?: string;
  public readonly value?: unknown;

  constructor(
    message: string,
    field?: string,
    value?: unknown,
    options: ErrorOptions = {}
  ) {
    super(
      message,
      'VALIDATION_ERROR',
      {
        ...options,
        details: {
          ...options.details,
          field,
          value,
        },
        isRecoverable: true,
        userMessage: options.userMessage ?? `  ${field ? ` (: ${field})` : ''}.`,
      }
    );
    this.field = field;
    this.value = value;
  }
}

/**
 * InputError -   
 */
export class InputError extends BaseError {
  constructor(message: string, options: ErrorOptions = {}) {
    super(
      message,
      'INPUT_ERROR',
      {
        ...options,
        isRecoverable: true,
        userMessage: options.userMessage ?? ' .',
      }
    );
  }
}

/**
 * RequiredFieldError -    
 */
export class RequiredFieldError extends BaseError {
  public readonly field: string;

  constructor(field: string, options: ErrorOptions = {}) {
    super(
      `Required field missing: ${field}`,
      'REQUIRED_FIELD_ERROR',
      {
        ...options,
        details: {
          ...options.details,
          field,
        },
        isRecoverable: true,
        userMessage: options.userMessage ?? `  : ${field}`,
      }
    );
    this.field = field;
  }
}

/**
 * InvalidFormatError -   
 */
export class InvalidFormatError extends BaseError {
  public readonly expected: string;
  public readonly actual?: string;

  constructor(
    expected: string,
    actual?: string,
    options: ErrorOptions = {}
  ) {
    super(
      `Invalid format. Expected: ${expected}${actual ? `, got: ${actual}` : ''}`,
      'INVALID_FORMAT_ERROR',
      {
        ...options,
        details: {
          ...options.details,
          expected,
          actual,
        },
        isRecoverable: true,
        userMessage: options.userMessage ?? ` .  : ${expected}`,
      }
    );
    this.expected = expected;
    this.actual = actual;
  }
}
