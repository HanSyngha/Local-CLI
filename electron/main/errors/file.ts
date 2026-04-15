/**
 * File System Error Classes
 *
 *    
 */

import { BaseError, ErrorOptions } from './base';

/**
 * FileSystemError -    
 */
export class FileSystemError extends BaseError {
  public readonly path?: string;

  constructor(message: string, path?: string, options: ErrorOptions = {}) {
    super(
      message,
      'FILE_SYSTEM_ERROR',
      {
        ...options,
        details: {
          ...options.details,
          path,
        },
        isRecoverable: options.isRecoverable ?? false,
        userMessage: options.userMessage ?? `   ${path ? ` (: ${path})` : ''}.`,
      }
    );
    this.path = path;
  }
}

/**
 * FileNotFoundError -   
 */
export class FileNotFoundError extends BaseError {
  public readonly path: string;

  constructor(path: string, options: ErrorOptions = {}) {
    super(
      `File not found: ${path}`,
      'FILE_NOT_FOUND',
      {
        ...options,
        details: {
          ...options.details,
          path,
        },
        isRecoverable: false,
        userMessage: options.userMessage ?? `   : ${path}`,
      }
    );
    this.path = path;
  }
}

/**
 * DirectoryNotFoundError -   
 */
export class DirectoryNotFoundError extends BaseError {
  public readonly path: string;

  constructor(path: string, options: ErrorOptions = {}) {
    super(
      `Directory not found: ${path}`,
      'DIRECTORY_NOT_FOUND',
      {
        ...options,
        details: {
          ...options.details,
          path,
        },
        isRecoverable: false,
        userMessage: options.userMessage ?? `   : ${path}`,
      }
    );
    this.path = path;
  }
}

/**
 * PermissionError -  
 */
export class PermissionError extends BaseError {
  public readonly path?: string;
  public readonly operation?: string;

  constructor(
    message: string,
    path?: string,
    operation?: string,
    options: ErrorOptions = {}
  ) {
    super(
      message,
      'PERMISSION_ERROR',
      {
        ...options,
        details: {
          ...options.details,
          path,
          operation,
        },
        isRecoverable: false,
        userMessage: options.userMessage ?? ` ${path ? `: ${path}` : ''}${operation ? ` (task: ${operation})` : ''}.`,
      }
    );
    this.path = path;
    this.operation = operation;
  }
}

/**
 * FileReadError -   
 */
export class FileReadError extends BaseError {
  public readonly path: string;

  constructor(path: string, options: ErrorOptions = {}) {
    super(
      `Failed to read file: ${path}`,
      'FILE_READ_ERROR',
      {
        ...options,
        details: {
          ...options.details,
          path,
        },
        isRecoverable: false,
        userMessage: options.userMessage ?? `   : ${path}`,
      }
    );
    this.path = path;
  }
}

/**
 * FileWriteError -   
 */
export class FileWriteError extends BaseError {
  public readonly path: string;

  constructor(path: string, options: ErrorOptions = {}) {
    super(
      `Failed to write file: ${path}`,
      'FILE_WRITE_ERROR',
      {
        ...options,
        details: {
          ...options.details,
          path,
        },
        isRecoverable: true,
        userMessage: options.userMessage ?? `   : ${path}.   .`,
      }
    );
    this.path = path;
  }
}

/**
 * InvalidPathError -   
 */
export class InvalidPathError extends BaseError {
  public readonly path: string;

  constructor(path: string, options: ErrorOptions = {}) {
    super(
      `Invalid path: ${path}`,
      'INVALID_PATH_ERROR',
      {
        ...options,
        details: {
          ...options.details,
          path,
        },
        isRecoverable: true,
        userMessage: options.userMessage ?? ` : ${path}`,
      }
    );
    this.path = path;
  }
}
