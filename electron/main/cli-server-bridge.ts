/**
 * CLI Server Bridge
 *
 * Electron   CLI Server SSE   EventEmitter .
 * ipc-handlers, jarvis-service  emit → cli-server subscribe SSE .
 */

import { EventEmitter } from 'events';

export const cliBridge = new EventEmitter();

/**
 * CLI Server  
 */
export function emitToCLI(channel: string, ...args: unknown[]): void {
  cliBridge.emit(channel, ...args);
}
