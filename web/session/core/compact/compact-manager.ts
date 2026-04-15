/**
 * Compact Manager
 *
 * Executes conversation compaction using LLM.
 * Handles the compact workflow: build prompt → call LLM → parse result.
 */

import { LLMClient } from '../llm/llm-client.js';
import { Message } from '../../types/index.js';
import {
  COMPACT_SYSTEM_PROMPT,
  buildCompactUserPrompt,
  buildCompactedMessages,
  CompactContext,
} from './compact-prompts.js';
import { logger } from '../../utils/logger.js';
import { reportError } from '../telemetry/error-reporter.js';

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

      logger.vars(
        { name: 'promptLength', value: userPrompt.length },
        { name: 'todoCount', value: context.todos?.length || 0 },
        { name: 'recentFilesCount', value: context.recentFiles?.length || 0 }
      );

      // Call LLM for compaction
      logger.flow('Calling LLM for compaction');
      logger.startTimer('compact-llm');

      const response = await this.llmClient.sendMessage(
        userPrompt,
        COMPACT_SYSTEM_PROMPT
      );

      const elapsed = logger.endTimer('compact-llm');
      logger.debug('Compact LLM response received', { elapsed, responseLength: response.length });

      // Validate response
      if (!response || response.trim().length === 0) {
        throw new Error('LLM returned empty response');
      }

      // Build compacted messages
      const compactedMessages = buildCompactedMessages(response, context);

      // Note: contextTracker.reset() is called by PlanExecutor after applying final messages
      // This keeps CompactManager focused on summary generation only

      logger.flow('Compact completed successfully');
      logger.vars(
        { name: 'originalCount', value: messages.length },
        { name: 'newCount', value: compactedMessages.length }
      );

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
      logger.errorSilent('Compact failed', error as Error);
      logger.exit('CompactManager.compact', { success: false, error: errorMessage });
      reportError(error, { type: 'compact' }).catch(() => {});

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
