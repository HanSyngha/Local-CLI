/**
 * Error Telemetry Reporter (local-cli-git stub)
 *
 * local-cli-git Dashboard    .
 *   reportError()   .
 */

/**
 * No-op: local-cli-git   
 */
export async function reportError(
  _error: unknown,
  _context?: Record<string, unknown>,
): Promise<void> {
  // No-op for local-cli-git (no Dashboard)
}

/**
 * No-op: local-cli-git    
 */
export function updateRecentMessagesForTelemetry(
  _messages: Array<{ role: string; content?: string | null }>,
): void {
  // No-op for local-cli-git (no Dashboard)
}
