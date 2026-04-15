/**
 * Compact Module
 *
 * Provides auto-compact functionality for managing context window usage.
 *
 * CLI parity: src/core/compact/index.ts
 */

import { llmClient, Message } from '../llm';
import { logger } from '../../utils/logger';

// Context tracking
export {
  contextTracker,
  getContextTracker,
  resetContextTracker,
  type ContextUsageInfo,
  type RecentFile,
} from './context-tracker';

// Compact prompts and utilities
export {
  COMPACT_SYSTEM_PROMPT,
  buildCompactUserPrompt,
  buildCompactedMessages,
  type CompactContext,
} from './compact-prompts';

// Compact manager
export {
  CompactManager,
  type CompactResult,
} from './compact-manager';

// Re-import for function wrappers
import {
  COMPACT_SYSTEM_PROMPT,
  buildCompactUserPrompt,
  buildCompactedMessages,
  type CompactContext,
} from './compact-prompts';
import type { CompactResult } from './compact-manager';

// =============================================================================
// Standalone functions (for ipc-handlers.ts compatibility)
// =============================================================================

const MIN_MESSAGES_FOR_COMPACT = 1;

/**
 * Execute conversation compaction
 * Wrapper function using llmClient singleton
 */
export async function compactConversation(
  messages: Message[],
  context: CompactContext
): Promise<CompactResult> {
  logger.enter('compactConversation', {
    messageCount: messages.length,
    workingDirectory: context.workingDirectory,
  });

  const nonSystemMessages = messages.filter(m => m.role !== 'system');
  if (nonSystemMessages.length < MIN_MESSAGES_FOR_COMPACT) {
    logger.flow('Compact skipped - not enough messages');
    logger.exit('compactConversation', { skipped: true });
    return {
      success: false,
      originalMessageCount: messages.length,
      newMessageCount: messages.length,
      error: ` ${MIN_MESSAGES_FOR_COMPACT}   . (: ${nonSystemMessages.length})`,
    };
  }

  try {
    logger.flow('Building compact prompt');
    const userPrompt = buildCompactUserPrompt(messages, context);

    logger.flow('Calling LLM for compaction');
    logger.startTimer('compact-llm');

    const response = await llmClient.sendMessage(userPrompt, COMPACT_SYSTEM_PROMPT);

    const elapsed = logger.endTimer('compact-llm');
    logger.debug('Compact LLM response received', { elapsed: `${elapsed}ms`, responseLength: response.length });

    if (!response || response.trim().length === 0) {
      throw new Error('LLM returned empty response');
    }

    const compactedMessages = buildCompactedMessages(response, context);

    logger.flow('Compact completed successfully');
    logger.exit('compactConversation', { success: true });

    return {
      success: true,
      originalMessageCount: messages.length,
      newMessageCount: compactedMessages.length,
      compactedSummary: response,
      compactedMessages,
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Compact failed', { error: errorMessage });
    logger.exit('compactConversation', { success: false, error: errorMessage });

    return {
      success: false,
      originalMessageCount: messages.length,
      newMessageCount: messages.length,
      error: `Compact : ${errorMessage}`,
    };
  }
}

/**
 * Check if compact is possible
 */
export function canCompact(messages: Message[]): { canCompact: boolean; reason?: string } {
  const nonSystemMessages = messages.filter(m => m.role !== 'system');

  if (nonSystemMessages.length < MIN_MESSAGES_FOR_COMPACT) {
    return {
      canCompact: false,
      reason: ` ${MIN_MESSAGES_FOR_COMPACT}   . (: ${nonSystemMessages.length})`,
    };
  }

  return { canCompact: true };
}
