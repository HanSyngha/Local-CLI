/**
 * Approval Dialog Component
 *
 * Supervised Mode Tool      UI
 * - Approve:    
 * - Always Approve:    Tool  
 * - Reject:  + AI   
 */

import React, { useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { CustomTextInput } from '../CustomTextInput.js';
import { logger } from '../../../utils/logger.js';
import { useTerminalWidth, separatorLine, clampText } from '../../hooks/useTerminalWidth.js';

export interface ApprovalDialogProps {
  toolName: string;
  args: Record<string, unknown>;
  reason?: string;
  onResponse: (result: 'approve' | 'always' | { reject: true; comment: string }) => void;
}

/**
 * Format tool arguments for display
 */
function formatArgs(args: Record<string, unknown>): { key: string; value: string; isLong: boolean }[] {
  const result: { key: string; value: string; isLong: boolean }[] = [];

  for (const [key, value] of Object.entries(args)) {
    if (value === undefined || value === null) continue;

    let displayValue: string;
    let isLong = false;

    if (typeof value === 'string') {
      // Truncate long strings
      if (value.length > 200) {
        displayValue = value.substring(0, 200) + '...';
        isLong = true;
      } else if (value.includes('\n')) {
        // Multi-line content
        const lines = value.split('\n');
        if (lines.length > 10) {
          displayValue = lines.slice(0, 10).join('\n') + '\n...';
          isLong = true;
        } else {
          displayValue = value;
          isLong = lines.length > 3;
        }
      } else {
        displayValue = value;
      }
    } else if (typeof value === 'object') {
      displayValue = JSON.stringify(value, null, 2);
      isLong = displayValue.length > 100;
    } else {
      displayValue = String(value);
    }

    result.push({ key, value: displayValue, isLong });
  }

  return result;
}

/**
 * Get icon for parameter key
 */
function getParamIcon(key: string): string {
  const icons: Record<string, string> = {
    file_path: '📁',
    path: '📁',
    content: '📝',
    old_string: '➖',
    new_string: '➕',
    pattern: '🔍',
    message: '💬',
    reason: '💡',
  };
  return icons[key] || '•';
}

/**
 * Approval Dialog - Tool   
 */
export const ApprovalDialog: React.FC<ApprovalDialogProps> = ({
  toolName,
  args,
  reason,
  onResponse,
}) => {
  const termWidth = useTerminalWidth();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isRejectMode, setIsRejectMode] = useState(false);
  const [rejectComment, setRejectComment] = useState('');

  logger.enter('ApprovalDialog', { toolName, argsKeys: Object.keys(args) });

  const options = [
    { label: 'Approve', description: 'Approve this tool execution', icon: '✅' },
    { label: `Always Approve (${toolName})`, description: 'Always approve in this session', icon: '✅' },
    { label: 'Reject', description: 'Reject + add comment', icon: '❌' },
  ];

  const handleSelect = useCallback(() => {
    logger.flow('User selected option', { selectedIndex });

    if (selectedIndex === 0) {
      onResponse('approve');
    } else if (selectedIndex === 1) {
      onResponse('always');
    } else if (selectedIndex === 2) {
      setIsRejectMode(true);
    }
  }, [selectedIndex, onResponse]);

  const handleRejectSubmit = useCallback((text: string) => {
    if (!text.trim()) {
      // Empty comment - just reject without comment
      onResponse({ reject: true, comment: '' });
      return;
    }

    logger.flow('User submitted reject comment', { commentLength: text.length });
    onResponse({ reject: true, comment: text.trim() });
  }, [onResponse]);

  const handleRejectCancel = useCallback(() => {
    logger.flow('User cancelled reject mode');
    setIsRejectMode(false);
    setRejectComment('');
  }, []);

  // Keyboard navigation
  useInput((input, key) => {
    if (isRejectMode) {
      if (key.escape) {
        handleRejectCancel();
      }
      return;
    }

    if (key.upArrow) {
      setSelectedIndex(prev => (prev > 0 ? prev - 1 : options.length - 1));
    } else if (key.downArrow) {
      setSelectedIndex(prev => (prev < options.length - 1 ? prev + 1 : 0));
    } else if (key.return) {
      handleSelect();
    } else if (input >= '1' && input <= '3') {
      const numIndex = parseInt(input, 10) - 1;
      if (numIndex >= 0 && numIndex < options.length) {
        setSelectedIndex(numIndex);
        // Auto-select after number key
        setTimeout(() => {
          if (numIndex === 2) {
            setIsRejectMode(true);
          } else {
            onResponse(numIndex === 0 ? 'approve' : 'always');
          }
        }, 100);
      }
    }
  }, { isActive: !isRejectMode });

  const formattedArgs = formatArgs(args);

  // Reject mode: comment input
  if (isRejectMode) {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="red" paddingX={1} paddingY={0}>
        <Box marginBottom={1}>
          <Text color="red" bold>❌ Reject Tool: {toolName}</Text>
        </Box>
        <Box>
          <Text color="gray">Comment for AI (ESC: cancel, Enter: send): </Text>
        </Box>
        <Box>
          <Text color="yellow">&gt; </Text>
          <CustomTextInput
            value={rejectComment}
            onChange={setRejectComment}
            onSubmit={handleRejectSubmit}
            placeholder="Enter reason or alternative..."
            focus={true}
          />
        </Box>
      </Box>
    );
  }

  // Normal mode: approval selection
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1} paddingY={0}>
      {/* Header */}
      <Box marginBottom={1}>
        <Text color="yellow" bold>🔧 Tool Execution Approval</Text>
      </Box>

      {/* Tool name */}
      <Box>
        <Text color="cyan" bold>{toolName}</Text>
        {reason && (
          <Text color="gray"> - {reason}</Text>
        )}
      </Box>

      {/* Separator */}
      <Box marginY={0}>
        <Text color="gray">{separatorLine(termWidth, 6)}</Text>
      </Box>

      {/* Arguments */}
      <Box flexDirection="column" marginBottom={1}>
        {formattedArgs.map(({ key, value, isLong }, idx) => (
          <Box key={idx} flexDirection={isLong ? 'column' : 'row'}>
            <Text color="magenta">{getParamIcon(key)} {key}: </Text>
            {isLong ? (
              <Box marginLeft={2} flexDirection="column">
                {value.split('\n').map((line, lineIdx) => (
                  <Text key={lineIdx} color="white" dimColor>{line}</Text>
                ))}
              </Box>
            ) : (
              <Text color="white">{clampText(value, Math.max(20, termWidth - 12))}</Text>
            )}
          </Box>
        ))}
      </Box>

      {/* Separator */}
      <Box marginY={0}>
        <Text color="gray">{separatorLine(termWidth, 6)}</Text>
      </Box>

      {/* Options */}
      {options.map((option, index) => {
        const isSelected = index === selectedIndex;
        return (
          <Box key={index}>
            <Text color={isSelected ? 'cyan' : 'gray'}>
              {isSelected ? '▸ ' : '  '}
              [{index + 1}] {option.icon} {option.label}
            </Text>
            {isSelected && (
              <Text color="gray" dimColor> - {option.description}</Text>
            )}
          </Box>
        );
      })}

      {/* Help */}
      <Box marginTop={1}>
        <Text color="gray" dimColor>
          ↑↓  | Enter  | 1-3  
        </Text>
      </Box>
    </Box>
  );
};

export default ApprovalDialog;
