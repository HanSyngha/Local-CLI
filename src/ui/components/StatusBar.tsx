/**
 * StatusBar Component
 *
 * Bottom status bar showing:
 * - Session info (message count, token total)
 * - Context usage bar
 * - Current time
 * - Keyboard shortcuts
 */

import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { logger } from '../../utils/logger.js';

export interface StatusBarProps {
  // Model and endpoint
  model?: string;
  endpoint?: string;
  // Working directory
  workingDirectory?: string;
  // Status
  status?: 'idle' | 'thinking' | 'executing' | 'error';
  message?: string;
  // Session info
  messageCount?: number;
  sessionTokens?: number;
  // Context usage
  contextUsage?: {
    current: number;
    max: number;
  };
  // Context remaining percentage for auto-compact indicator
  contextRemainingPercent?: number;
  // TODO status
  todoCount?: number;
  todoCompleted?: number;
  // Health status
  healthStatus?: 'healthy' | 'unhealthy' | 'checking' | 'unknown';
  // Claude Code style execution status
  currentActivity?: string;  // LLM    (: " ", " ")
  sessionElapsedSeconds?: number;  //   
}

/**
 * Format token count
 */
function formatTokens(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 1000000) return `${(count / 1000).toFixed(1)}k`;
  return `${(count / 1000000).toFixed(2)}M`;
}

/**
 * Clock component with live time
 */
const Clock: React.FC = () => {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const interval = setInterval(() => {
      setTime(new Date());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <Text color="gray">
      {time.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
    </Text>
  );
};

/**
 * Animated star component - pulses between large and small
 */
const AnimatedStar: React.FC = () => {
  const [phase, setPhase] = useState(0);

  // Animation phases: ✶ (large) → ✷ (medium) → ✸ (small) → ✷ → ✶
  const stars = ['✶', '✷', '✸', '✷'];
  const colors = ['magentaBright', 'magenta', 'gray', 'magenta'] as const;

  useEffect(() => {
    const interval = setInterval(() => {
      setPhase(p => (p + 1) % stars.length);
    }, 300); // 300ms per phase = ~1.2s full cycle
    return () => clearInterval(interval);
  }, []);

  return (
    <Text color={colors[phase]} bold>
      {stars[phase]}{' '}
    </Text>
  );
};

/**
 * Context usage mini bar
 */
const ContextMiniBar: React.FC<{ current: number; max: number }> = ({ current, max }) => {
  const percentage = Math.min(Math.round((current / max) * 100), 100);
  const barWidth = 8;
  const filled = Math.round((percentage / 100) * barWidth);
  const empty = barWidth - filled;

  // Color based on usage
  let color: string;
  if (percentage < 50) color = 'green';
  else if (percentage < 75) color = 'yellow';
  else if (percentage < 90) color = 'red';
  else color = 'redBright';

  return (
    <Box>
      <Text color={color}>{'█'.repeat(filled)}</Text>
      <Text color="gray">{'░'.repeat(empty)}</Text>
      <Text color={color}> {percentage}%</Text>
    </Box>
  );
};

/**
 * Format elapsed time (Claude Code style)
 */
function formatElapsedTime(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs}s`;
}

export const StatusBar: React.FC<StatusBarProps> = ({
  model,
  endpoint: _endpoint,
  workingDirectory,
  status = 'idle',
  message: _message,
  messageCount = 0,
  sessionTokens = 0,
  contextUsage,
  contextRemainingPercent,
  todoCount,
  todoCompleted,
  healthStatus,
  currentActivity,
  sessionElapsedSeconds,
}) => {
  // endpoint and message reserved for future enhanced display
  void _endpoint;
  void _message;
  useEffect(() => {
    logger.debug('StatusBar rendered', {
      status,
      messageCount,
      sessionTokens,
    });
  }, [status, messageCount, sessionTokens]);

  // Health indicator
  const getHealthIcon = () => {
    switch (healthStatus) {
      case 'healthy': return <Text color="green">●</Text>;
      case 'unhealthy': return <Text color="red">●</Text>;
      case 'checking': return <Text color="yellow">◐</Text>;
      default: return <Text color="gray">○</Text>;
    }
  };

  // Status indicator
  const getStatusIndicator = () => {
    switch (status) {
      case 'thinking':
        return <Text color="yellow">● THINK</Text>;
      case 'executing':
        return <Text color="green">● EXEC</Text>;
      case 'error':
        return <Text color="red">● ERR</Text>;
      default:
        return <Text color="gray">○ IDLE</Text>;
    }
  };

  // Claude Code style: "✶ ~  … (esc to interrupt · 2m 7s · ↑ 3.6k tokens)"
  const isActive = status === 'thinking' || status === 'executing';

  //    Claude Code   
  if (isActive && currentActivity) {
    return (
      <Box justifyContent="space-between" paddingX={1}>
        <Box>
          <AnimatedStar />
          <Text color="white">{currentActivity}… </Text>
          <Text color="gray">(esc to interrupt</Text>
          {sessionElapsedSeconds !== undefined && (
            <Text color="gray"> · {formatElapsedTime(sessionElapsedSeconds)}</Text>
          )}
          {sessionTokens > 0 && (
            <Text color="gray"> · ↑ {formatTokens(sessionTokens)} tokens</Text>
          )}
          <Text color="gray">)</Text>
        </Box>

        {/* Right: Model */}
        <Box>
          {model && <Text color="cyan">{model.slice(0, 15)}</Text>}
        </Box>
      </Box>
    );
  }

  // Context remaining indicator color
  const getContextColor = (percent: number): string => {
    if (percent > 50) return 'green';
    if (percent > 20) return 'yellow';
    return 'red';
  };

  //   (idle, error )
  return (
    <Box justifyContent="space-between" paddingX={1}>
      {/* Left section: Context remaining, Health, Status, Model */}
      <Box>
        {/* Context remaining indicator (for auto-compact) */}
        {contextRemainingPercent !== undefined && (
          <>
            <Text color={getContextColor(contextRemainingPercent)}>
              Context {contextRemainingPercent}%
            </Text>
            <Text color="gray"> | </Text>
          </>
        )}

        {getHealthIcon()}
        <Text> </Text>
        {getStatusIndicator()}

        {/* Model name */}
        {model && (
          <>
            <Text color="gray"> | </Text>
            <Text color="cyan">{model.slice(0, 15)}</Text>
          </>
        )}

        {/* Working directory */}
        {workingDirectory && (
          <>
            <Text color="gray"> | </Text>
            <Text color="gray">{workingDirectory}</Text>
          </>
        )}
      </Box>

      {/* Center section: Stats */}
      <Box>
        {/* Message count */}
        {messageCount > 0 && (
          <Box marginRight={2}>
            <Text color="gray">💬 {messageCount}</Text>
          </Box>
        )}

        {/* Session tokens */}
        {sessionTokens > 0 && (
          <Box marginRight={2}>
            <Text color="cyan">⚡ {formatTokens(sessionTokens)}</Text>
          </Box>
        )}

        {/* Context usage */}
        {contextUsage && contextUsage.current > 0 && (
          <Box marginRight={2}>
            <Text color="gray">CTX </Text>
            <ContextMiniBar current={contextUsage.current} max={contextUsage.max} />
          </Box>
        )}

        {/* TODO mini status */}
        {todoCount !== undefined && todoCount > 0 && (
          <Box>
            <Text color="gray">TODO </Text>
            <Text color="green">{todoCompleted || 0}</Text>
            <Text color="gray">/{todoCount}</Text>
          </Box>
        )}
      </Box>

      {/* Right section: Shortcuts and time */}
      <Box>
        <Text color="gray" dimColor>
          /help
        </Text>
        <Text color="gray"> | </Text>
        <Clock />
      </Box>
    </Box>
  );
};

export default StatusBar;
