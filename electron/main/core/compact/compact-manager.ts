/**
 * Compact Manager
 *
 * Executes conversation compaction using LLM.
 * Handles the compact workflow: build prompt → call LLM → parse result.
 *
 * CLI parity: src/core/compact/compact-manager.ts
 */

import { LLMClient, Message } from '../llm/llm-client';
import {
  COMPACT_SYSTEM_PROMPT,
  buildCompactUserPrompt,
  buildCompactedMessages,
  CompactContext,
} from './compact-prompts';
import { logger } from '../../utils/logger';

/**
 * Result of compact operation
 */
export interface CompactResult {
  /** Whether compact succeeded */
  success: boolean;
  /** Original message count */
  originalMessageCount: number;
  /** New message count after compact */
  newMessageCount: number;
  /** The compact summary generated */
  compactedSummary?: string;
  /** The compacted messages array (for caller to use) */
  compactedMessages?: Message[];
  /** Error message if failed */
  error?: string;
}

/**
 * Minimum messages required for compact
 */
const MIN_MESSAGES_FOR_COMPACT = 1;

/**
 * Compact Manager Class
 */
export class CompactManager {
  constructor(private llmClient: LLMClient) {}

  /**
   * Execute conversation compaction
   */
  async compact(
    messages: Message[],
    context: CompactContext
  ): Promise<CompactResult> {
    logger.enter('CompactManager.compact', {
      messageCount: messages.length,
      hasTodos: !!context.todos?.length,
    });

    // Validate minimum messages
    const nonSystemMessages = messages.filter(m => m.role !== 'system');
    if (nonSystemMessages.length < MIN_MESSAGES_FOR_COMPACT) {
      logger.flow('Compact skipped - not enough messages');
      logger.exit('CompactManager.compact', { skipped: true });
      return {
        success: false,
        originalMessageCount: messages.length,
        newMessageCount: messages.length,
        error: ` ${MIN_MESSAGES_FOR_COMPACT}   . (: ${nonSystemMessages.length})`,
      };
    }

    try {
      logger.flow('Building compact prompt');

      // Build the user prompt with context
      const userPrompt = buildCompactUserPrompt(messages, context);

      logger.vars({
        promptLength: userPrompt.length,
        todoCount: context.todos?.length || 0,
        recentFilesCount: context.recentFiles?.length || 0,
      });

      // Call LLM for compaction
      logger.flow('Calling LLM for compaction');
      logger.startTimer('compact-llm');

      const response = await this.llmClient.sendMessage(
        userPrompt,
        COMPACT_SYSTEM_PROMPT
      );

      const elapsed = logger.endTimer('compact-llm');
      logger.debug('Compact LLM response received', { elapsed: `${elapsed}ms`, responseLength: response.length });

      // Validate response
      if (!response || response.trim().length === 0) {
        throw new Error('LLM returned empty response');
      }

      // Build compacted messages
      const compactedMessages = buildCompactedMessages(response, context);

      logger.flow('Compact completed successfully');
      logger.vars({
        originalCount: messages.length,
        newCount: compactedMessages.length,
      });

      logger.exit('CompactManager.compact', { success: true });

      return {
        success: true,
        originalMessageCount: messages.length,
        newMessageCount: compactedMessages.length,
        compactedSummary: response,
        compactedMessages,
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Compact failed', error as Error);
      logger.exit('CompactManager.compact', { success: false, error: errorMessage });

      return {
        success: false,
        originalMessageCount: messages.length,
        newMessageCount: messages.length,
        error: `Compact : ${errorMessage}`,
      };
    }
  }

  /**
   * Build compacted messages from summary
   * Utility method for external use
   */
  buildCompactedMessages(summary: string, context: CompactContext): Message[] {
    return buildCompactedMessages(summary, context);
  }

  /**
   * Check if compact is possible
   */
  canCompact(messages: Message[]): { canCompact: boolean; reason?: string } {
    const nonSystemMessages = messages.filter(m => m.role !== 'system');

    if (nonSystemMessages.length < MIN_MESSAGES_FOR_COMPACT) {
      return {
        canCompact: false,
        reason: ` ${MIN_MESSAGES_FOR_COMPACT}   .`,
      };
    }

    return { canCompact: true };
  }
}
