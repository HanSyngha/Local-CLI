/**
 * Error Telemetry Reporter
 *
 * No-op for local-web: no Dashboard to report errors to.
 * Function signatures preserved for callers.
 */

//     (    )
const MAX_RECENT_MESSAGES = 10;

/**
 *       
 * plan-executor  agent-engine  iteration 
 */
export function updateRecentMessagesForTelemetry(messages: Array<{ role: string; content?: string | null }>): void {
  // No-op: retained for caller compatibility
  void messages;
  void MAX_RECENT_MESSAGES;
}

/**
 *  Dashboard API  (fire-and-forget)
 */
export async function reportError(
  _error: unknown,
  _context?: Record<string, unknown>,
): Promise<void> {
  // No-op: local-web has no Dashboard to report errors to
}
